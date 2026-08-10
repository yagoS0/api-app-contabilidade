// Q15.5 — Orquestrador do fechamento de apuração (motor do FechamentoModal).
//
// 4 operações:
//   getDados  → tudo que o modal precisa (faturamento, atividades default, folha,
//               rbt12, disparidades, regime) — pré-preenchido da memória de config
//   calcular  → simulação oficial SERPRO (indicadorTransmissao:false) = verdade do preview
//   salvar    → persiste config no snapshot, estado "fechada", grava memória
//   transmitir→ consulta-antes-de-transmitir + TRANSDECLARACAO11 (individual)

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { derivarFolha12m } from "./FolhaDerivadaService.js";
import { getResolvedSerproCredentials } from "../../../fiscal/serpro/SerproRuntimeSettings.js";
import { SerproPgdasdService } from "../../../fiscal/serpro/SerproPgdasdService.js";
import { PgdasSimulacaoService, parseRetornoSimulacao } from "../../../fiscal/serpro/PgdasSimulacaoService.js";
import { montarAtividadesDefault, carregarAtividades } from "./AtividadeResolver.js";
import { getRbt12, lerPeriodosAceitos, gravarPeriodosAceitos } from "./RbtExtratoService.js";
import { lerConfigMemory, salvarConfigMemory } from "./ApuracaoConfigMemoryService.js";
import { detectarDisparidades } from "./DisparidadeService.js";

function onlyDigits(v) { return String(v || "").replace(/\D+/g, ""); }
function round2(n) { return +Number(n || 0).toFixed(2); }

export class FechamentoError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

// Q55: soma das atividades preenchidas (interno + externo).
function somaAtividades(atividades) {
  return round2((Array.isArray(atividades) ? atividades : []).reduce(
    (s, a) => s + Number(a?.valorInterno || 0) + Number(a?.valorExterno || 0), 0));
}

// Q55: faturamento REAL da competência = notas EMIT autorizadas (fonte da guarda anti-zero).
// Se não houver notas capturadas, retorna 0 (não bloqueia — tratamos como "sem movimento").
//
// EXPORTADA porque a marcação de "mês sem faturamento" (fechamento contábil) precisa da MESMA
// definição de faturamento que a apuração usa. Duas cópias desta query divergiriam, e aí a
// apuração e o fechamento discordariam sobre se o mês teve receita — com o contador no meio.
export async function faturamentoEmitDaCompetencia(portalClientId, competencia) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) return 0;
  const { gte, lt } = rangeMes(competencia);
  const agg = await prisma.portalInvoice.aggregate({
    where: { ...whereFaturamentoEmit(competencia), clientId: String(portalClientId), competencia: { gte, lt } },
    _sum: { total: true },
  });
  return round2(Number(agg._sum?.total || 0));
}

/**
 * O QUE CONTA COMO FATURAMENTO — uma definição só, para todo mundo.
 *
 * Nota EMIT autorizada. Nem rascunho, nem cancelada, nem recebida. Está isolada aqui porque já são
 * cinco chamadores (guarda anti-zero, "mês sem faturamento", transmissão zerada, conferência do
 * chip de guia vazia) e cada cópia desta cláusula é uma chance de duas telas discordarem sobre se
 * o mês teve receita.
 */
function whereFaturamentoEmit() {
  return { papel: "EMIT", statusEfetivo: "autorizada" };
}

/**
 * Faturamento da competência para VÁRIAS empresas, numa query só.
 *
 * Existe para o chip de guia "vazia" poder ser confrontado com a realidade sem uma query por
 * empresa: marcar sem movimento é declaração fiscal, e se depois aparecer nota emitida naquele mês
 * o chip precisa voltar a pedir ação.
 *
 * @returns {Promise<Map<string, number>>} portalClientId → total (só quem tem > 0)
 */
export async function faturamentoEmitPorEmpresa({ portalIds, competencia }) {
  const mapa = new Map();
  if (!Array.isArray(portalIds) || !portalIds.length) return mapa;
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) return mapa;
  const { gte, lt } = rangeMes(competencia);
  const linhas = await prisma.portalInvoice.groupBy({
    by: ["clientId"],
    where: { ...whereFaturamentoEmit(), clientId: { in: portalIds }, competencia: { gte, lt } },
    _sum: { total: true },
  });
  for (const l of linhas) {
    const total = round2(Number(l._sum?.total || 0));
    if (total > 0) mapa.set(l.clientId, total);
  }
  return mapa;
}

/** Receita do mês segregada por tipoReceita + mercado (interno/externo). */
async function receitaPorTipoMercado({ portalClientId, competencia }) {
  const notas = await prisma.portalInvoice.findMany({
    where: { clientId: portalClientId, papel: "EMIT", statusEfetivo: "autorizada", competencia: rangeMes(competencia) },
    select: { total: true, itens: { select: { valor: true, tipoReceita: true, flagExportacao: true } } },
  });
  const acc = {};           // "TIPO|MERCADO" → valor
  const porTipo = {};       // TIPO → valor (pra disparidade)
  let semClassificacao = 0;
  for (const n of notas) {
    const total = Number(n.total || 0);
    const somaItens = (n.itens || []).reduce((s, it) => s + Number(it.valor || 0), 0);
    const escala = somaItens > 0 ? total / somaItens : 0;
    if (!n.itens || n.itens.length === 0) { semClassificacao += total; continue; }
    for (const it of n.itens) {
      const tipo = it.tipoReceita || "RECEITA_NAO_CLASSIFICADA";
      const mercado = it.flagExportacao ? "EXTERNO" : "INTERNO";
      const v = Number(it.valor || 0) * escala;
      acc[`${tipo}|${mercado}`] = (acc[`${tipo}|${mercado}`] || 0) + v;
      porTipo[tipo] = (porTipo[tipo] || 0) + v;
      if (tipo === "RECEITA_NAO_CLASSIFICADA") semClassificacao += v;
    }
  }
  for (const k of Object.keys(acc)) acc[k] = round2(acc[k]);
  for (const k of Object.keys(porTipo)) porTipo[k] = round2(porTipo[k]);
  return { receitaPorTipoMercado: acc, receitaPorTipo: porTipo, semClassificacao: round2(semClassificacao) };
}

// Q44: deriva a(s) atividade(s) default a partir do CNAE da empresa (quando não há notas
// classificadas nem memória). Reusa CnaeAnexo (cnae→tipoReceitaSugerido) + carregarAtividades
// (tipoReceita+mercado→idAtividade/anexo). Emite a linha mesmo com faturamento 0, só pra TRAZER o
// ANEXO — o contador ajusta os valores. Best-effort: sem CNAE/mapeamento → retorna [].
async function montarAtividadesDoCnae({ cnaePrincipal, faturamentoInterno = 0, faturamentoExterno = 0, dataReferencia = new Date() }) {
  const cnae = String(cnaePrincipal || "").replace(/\D+/g, "");
  if (cnae.length < 7) return [];
  const anexoRow = await prisma.cnaeAnexo.findUnique({ where: { cnae: cnae.slice(0, 7) } }).catch(() => null);
  const tipo = anexoRow?.tipoReceitaSugerido;
  if (!tipo) return [];
  const { map } = await carregarAtividades(dataReferencia);
  const atvInterno = map.get(`${tipo}|INTERNO`);
  const atvExterno = map.get(`${tipo}|EXTERNO`);
  const out = [];
  if (faturamentoExterno > 0 && atvExterno) {
    out.push({
      idAtividade: atvExterno.idAtividade, descricao: atvExterno.descricao, anexoImplicito: atvExterno.anexoImplicito,
      mercado: atvExterno.mercado, sujeitoFatorR: atvExterno.sujeitoFatorR, tipoReceita: atvExterno.tipoReceita,
      valorInterno: 0, valorExterno: round2(faturamentoExterno),
    });
  }
  if (atvInterno) {
    out.push({
      idAtividade: atvInterno.idAtividade, descricao: atvInterno.descricao, anexoImplicito: atvInterno.anexoImplicito,
      mercado: atvInterno.mercado, sujeitoFatorR: atvInterno.sujeitoFatorR, tipoReceita: atvInterno.tipoReceita,
      valorInterno: round2(faturamentoInterno), valorExterno: 0,
    });
  }
  return out;
}

// ─── A DECLARAÇÃO ENTREGUE **FORA** DO PORTAL ──────────────────────────────────────────────────
//
// Fato novo do dono (10/08/2026): *"já fiz envios antes para a Receita com a empresa sem
// faturamento"*. Ou seja, a declaração zerada É entregue — só que não por aqui (as 190 competências
// zeradas medidas em produção não têm um único `ApuracaoSnapshot`). Logo existem TRÊS desfechos, e
// nenhum pode se parecer com o outro na tela:
//
//   1. entregue POR AQUI      → `ApuracaoSnapshot.estado === "transmitida"` (+ `numeroDeclaracao`)
//   2. entregue POR FORA      → esta marca, e/ou o número que o extrato da RFB devolve
//   3. NÃO entregue           → nenhuma das duas. É a perigosa: vira obrigação esquecida
//
// ⚠ POR QUE `EntregaObrigacaoArquivo`, E NÃO UMA COLUNA NOVA
// Ela já é, letra por letra, "obrigação entregue no programa/portal oficial, marcada À MÃO pelo
// contador, nunca escrita por automação, com recibo e observação", chaveada por
// (empresa, tipo, competência). É o mesmo desenho que a DEFIS usa. Uma coluna nova em
// `ApuracaoSnapshot` seria pior por dois motivos: os 190 casos NÃO TÊM snapshot, e criar um só
// para guardar esta marca exigiria inventar `rbt12`/`receitaPorTipo` (NOT NULL) — dado fiscal
// fabricado num registro auditável.
//
// ⚠ ISTO NÃO TRANSMITE NADA e NÃO É PROVA. `transmitidaEm` aqui é a afirmação do contador. A prova
// é `CompanyMonthlyCircular.pgdasNumeroDeclaracao`, que vem do índice da própria RFB. Os dois ficam
// em campos separados de propósito: promovida a comprovação, a afirmação faria o portal responder
// "entregue" a partir de nada além de um clique.
export const TIPO_ENTREGA_PGDAS = "PGDAS_D";

export async function lerEntregaExternaPgdas({ portalClientId, competencia }) {
  return prisma.entregaObrigacaoArquivo.findUnique({
    where: {
      portalClientId_tipo_competencia: {
        portalClientId, tipo: TIPO_ENTREGA_PGDAS, competencia,
      },
    },
    select: { transmitidaEm: true, transmitidaPorId: true, observacao: true },
  }).catch(() => null);
}

/**
 * Registra (ou desfaz) a afirmação "esta declaração foi entregue FORA do portal".
 *
 * ⚠ RECUSA quando a apuração desta competência já consta como transmitida POR AQUI: seriam duas
 * histórias sobre a mesma entrega, e a segunda apagaria a primeira na leitura. A saída vai na
 * mensagem.
 *
 * Desmarcar é explícito (`entregue: false`) — erro de marcação não pode virar permanente.
 */
export async function registrarEntregaExternaPgdas({
  portalClientId, competencia, entregue, observacao = null, userId = null,
}) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
    throw new FechamentoError("competencia_required", "Competência inválida.");
  }
  const snapshot = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    select: { estado: true, numeroDeclaracao: true },
  }).catch(() => null);
  if (entregue && snapshot?.estado === "transmitida") {
    throw new FechamentoError(
      "ENTREGA_EXTERNA_JA_TRANSMITIDA",
      "Esta competência já consta como TRANSMITIDA pelo portal"
      + (snapshot.numeroDeclaracao ? ` (declaração ${snapshot.numeroDeclaracao})` : "")
      + ". Não dá para registrar também uma entrega feita fora — seriam duas histórias sobre a "
      + "mesma declaração. Se a transmissão daqui não aconteceu de fato, reabra a apuração antes.",
    );
  }

  const texto = String(observacao || "").trim();
  const data = entregue
    ? {
      transmitidaEm: new Date(),
      transmitidaPorId: userId,
      observacao: texto || null,
    }
    : { transmitidaEm: null, transmitidaPorId: null, observacao: null };

  const entrega = await prisma.entregaObrigacaoArquivo.upsert({
    where: {
      portalClientId_tipo_competencia: {
        portalClientId, tipo: TIPO_ENTREGA_PGDAS, competencia,
      },
    },
    create: { portalClientId, tipo: TIPO_ENTREGA_PGDAS, competencia, ...data },
    update: data,
  });
  return { ok: true, competencia, entregueFora: Boolean(entregue), entrega };
}

/**
 * Dados pro modal de fechamento. Pré-preenche atividades/folha da memória de config.
 */
export async function getDadosFechamento({ portalClientId, competencia }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { cnpj: true, razao: true, companyId: true, empresaZerada: true },
  });
  if (!portal) throw new FechamentoError("PORTAL_NOT_FOUND", "Empresa não encontrada");

  const cadastro = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
  // Q44: CNAE efetivo — do CadastroFiscal, senão do cadastro da empresa (Company legada, vindo do CNPJ).
  let companyCnae = null;
  if (!cadastro?.cnaePrincipal && portal.companyId) {
    companyCnae = await prisma.company.findUnique({
      where: { id: portal.companyId }, select: { cnaePrincipal: true },
    }).catch(() => null);
  }
  const cnaePrincipalEfetivo = cadastro?.cnaePrincipal || companyCnae?.cnaePrincipal || null;
  // Afirmação de "mês sem faturamento" feita no fechamento contábil — entra aqui só como dica.
  //
  // ⚠ `pgdasNumeroDeclaracao` e `serproLastSyncAt` viajam junto porque são a PROVA de entrega que
  // não é nossa: o número vem do índice da RFB (`CONSDECLARACAO13`, via `syncPgdasByCompetencia`).
  // É ele que distingue "a declaração existe na Receita" de "o contador diz que entregou".
  const circularDoMes = await prisma.companyMonthlyCircular.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    select: {
      semFaturamento: true, semFaturamentoEm: true, semFaturamentoConferencia: true,
      pgdasNumeroDeclaracao: true, pgdasDeclaracaoFileId: true,
      serproSyncStatus: true, serproLastSyncAt: true,
    },
  }).catch(() => null);
  const entregaExterna = await lerEntregaExternaPgdas({ portalClientId, competencia });
  const { receitaPorTipoMercado: rtm, receitaPorTipo, semClassificacao } =
    await receitaPorTipoMercado({ portalClientId, competencia });

  const faturamentoInterno = round2(Object.entries(rtm).filter(([k]) => k.endsWith("|INTERNO")).reduce((s, [, v]) => s + v, 0));
  const faturamentoExterno = round2(Object.entries(rtm).filter(([k]) => k.endsWith("|EXTERNO")).reduce((s, [, v]) => s + v, 0));

  // Atividades default: da memória (última config) OU derivadas das notas
  const memory = await lerConfigMemory({ portalClientId });
  let atividades;
  let origemAtividades;
  if (memory?.atividadesEscolhidas && Array.isArray(memory.atividadesEscolhidas) && memory.atividadesEscolhidas.length) {
    atividades = memory.atividadesEscolhidas;
    origemAtividades = `memoria(${memory.atualizadoEm ? new Date(memory.atualizadoEm).toISOString().slice(0,10) : "?"})`;
  } else {
    const dataRef = rangeMes(competencia).gte;
    const { atividades: def, semMapeamento } = await montarAtividadesDefault({ receitaPorTipoMercado: rtm, dataReferencia: dataRef });
    atividades = def;
    origemAtividades = "notas";
    if (semMapeamento.length) {
      // anexa info de receita sem mapeamento (vira aviso na UI)
      atividades._semMapeamento = semMapeamento;
    }
  }

  // Q44: sem atividades (nem memória nem notas classificadas) → deriva do CNAE da empresa
  // pra TRAZER O ANEXO automaticamente. O contador ajusta atividade/valores no modal.
  if ((!Array.isArray(atividades) || atividades.length === 0) && cnaePrincipalEfetivo) {
    const doCnae = await montarAtividadesDoCnae({
      cnaePrincipal: cnaePrincipalEfetivo, faturamentoInterno, faturamentoExterno,
      dataReferencia: rangeMes(competencia).gte,
    });
    if (doCnae.length) { atividades = doCnae; origemAtividades = "cnae"; }
  }

  const rbt = await getRbt12({ portalClientId, competencia });
  const disparidades = await detectarDisparidades({ portalClientId, atividadesEscolhidas: atividades, receitaPorTipo });

  const snapshot = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });

  return {
    portalClientId, competencia,
    razao: portal.razao, cnpj: portal.cnpj,
    regimeApuracao: cadastro?.regimeApuracao || "COMPETENCIA",
    // Q44: completo se há CadastroFiscal OU CNAE utilizável (Company) — some o aviso p/ empresa com CNPJ.
    cadastroCompleto: Boolean(cadastro) || Boolean(cnaePrincipalEfetivo),
    cnaePrincipal: cnaePrincipalEfetivo,
    faturamento: { interno: faturamentoInterno, externo: faturamentoExterno, total: round2(faturamentoInterno + faturamentoExterno) },
    // Sem movimento: disponível quando não há faturamento EMIT na competência. empresaZerada = dica p/ UI.
    semMovimentoDisponivel: round2(faturamentoInterno + faturamentoExterno) === 0,
    empresaZerada: Boolean(portal.empresaZerada),
    // Afirmação POR MÊS feita na aba Lançamentos (`CompanyMonthlyCircular.semFaturamento`).
    // Só DICA para a UI pré-marcar a caixa — não decide nada aqui: quem transmite é o contador.
    semFaturamento: circularDoMes?.semFaturamento === true,
    semFaturamentoEm: circularDoMes?.semFaturamentoEm || null,
    semFaturamentoConferencia: circularDoMes?.semFaturamentoConferencia || null,
    // ─── ONDE ESTÁ A DECLARAÇÃO DESTA COMPETÊNCIA ────────────────────────────────────────────
    // Fatos crus, sem veredito: quem os combina é `features/apuracao/lib/entregaPgdas.js`, do lado
    // da tela, numa cópia só. Combinar aqui TAMBÉM daria duas leituras da mesma pergunta — o
    // defeito que mais reapareceu neste projeto.
    entregaPgdas: {
      // A RFB confirmando que a declaração existe (extrato do PGDAS-D). É PROVA, e não é nossa.
      //
      // ⚠ A ÂNCORA É A COLUNA, NUNCA O PDF. O `metadata` guarda declaração/recibo/autenticação em
      // base64, mas 20 das 102 circulares com marca de PGDAS-D já perderam esse bloco (sync
      // posterior sobrescreveu, ou é formato antigo). `pgdasNumeroDeclaracao` é coluna e
      // sobreviveu — perder o PDF não pode virar "não foi entregue".
      numeroDeclaracaoRfb: circularDoMes?.pgdasNumeroDeclaracao || null,
      temPdfDaDeclaracao: Boolean(circularDoMes?.pgdasDeclaracaoFileId),
      // ⚠ "Nunca consultamos" ≠ "consultamos e não há". `NOT_FOUND` é a Receita respondendo que não
      // existe declaração no período; `null` é ninguém ter perguntado. Sem esta distinção, toda
      // competência que ninguém buscou apareceria como obrigação em aberto.
      extratoStatus: circularDoMes?.serproSyncStatus || null,
      extratoConsultadoEm: circularDoMes?.serproLastSyncAt || null,
      // O contador afirmando que entregou fora do portal. É AFIRMAÇÃO — nunca vira prova sozinha.
      declaradaForaEm: entregaExterna?.transmitidaEm || null,
      declaradaForaPor: entregaExterna?.transmitidaPorId || null,
      declaradaForaObservacao: entregaExterna?.observacao || null,
    },
    receitaPorTipo,
    semClassificacao,
    atividades,
    origemAtividades,
    folhaMensal12: memory?.folhaMensal12 || null,
    // CONFERÊNCIA da folha: soma dos lançamentos contábeis de folha/pró-labore dos 12 meses.
    // Não substitui `folhaMensal12` (que o contador digita) — vai ao lado, para comparar.
    // O Fator R decide Anexo III ou V, e hoje esse número não tem nenhuma segunda fonte.
    folhaDerivada: await derivarFolha12m({ portalClientId, competencia }),
    rbt12: rbt.rbt12,
    rbt12Origem: rbt.origem,
    disparidades,
    estado: snapshot?.estado || "aberta",
    snapshot,
  };
}

/** Resolve credenciais SERPRO (contratante = escritório) + contribuinte. */
async function resolverCnpjs(portalClientId) {
  const creds = await getResolvedSerproCredentials().catch((err) => {
    throw new FechamentoError("OFFICE_CERT_NOT_CONFIGURED", `Cert escritório não configurado: ${err?.message || err}`);
  });
  if (!creds?.certificate?.hasCertificate) {
    throw new FechamentoError("OFFICE_CERT_NOT_CONFIGURED", "Cert do escritório não configurado (Configurações da Firma → SERPRO).");
  }
  const contratanteCnpj = onlyDigits(creds.certificate.document);
  const portal = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true } });
  const contribuinteCnpj = onlyDigits(portal?.cnpj);
  if (contribuinteCnpj.length !== 14) throw new FechamentoError("INVALID_CNPJ", "CNPJ da empresa inválido");
  return { contratanteCnpj, contribuinteCnpj };
}

// PGDAS-D rejeita a declaração inteira se folhasSalario vier sem atividade sujeita ao Fator-R
// ("SN-Entregar: Foi informada a lista de Folha de Salários mas não há atividade com este requisito").
// A folha vem pré-preenchida da memória de config, então só entra no payload quando alguma atividade
// selecionada exige Fator-R. Se NENHUMA atividade trouxer o campo definido (payload de cliente antigo),
// consulta o catálogo AtividadePgdasd — nunca cortar a folha de quem precisa (Anexo III/V).
async function folhasSalarioSeAplicavel(atividades, folhaMensal12) {
  const lista = Array.isArray(folhaMensal12) ? folhaMensal12 : [];
  if (!lista.length) return [];
  const atvs = Array.isArray(atividades) ? atividades : [];
  const algumDefinido = atvs.some((a) => a && a.sujeitoFatorR !== undefined);
  let temFatorR;
  if (algumDefinido) {
    temFatorR = atvs.some((a) => a?.sujeitoFatorR === true);
  } else {
    const ids = atvs.map((a) => Number(a?.idAtividade)).filter(Number.isFinite);
    const doCatalogo = ids.length
      ? await prisma.atividadePgdasd.findMany({ where: { idAtividade: { in: ids }, sujeitoFatorR: true }, select: { id: true }, take: 1 })
      : [];
    temFatorR = doCatalogo.length > 0;
  }
  return temFatorR ? lista.map((f) => ({ pa: f.pa, valor: f.valor })) : [];
}

// A RFB só aceita, tanto em `receitasBrutasAnteriores` quanto em `folhasSalario`, os meses que ela
// NÃO tem declarados. Para os demais rejeita a declaração inteira apontando o mês:
//
//   "SN-Entregar: Foi enviada receita bruta de um período desnecessário: MM/AAAA. Remova este
//    período e tente novamente."
//   "SN-Entregar: Foi enviada folha de um período desnecessário: 07/2025. Remova este período e
//    tente novamente."
//
// Fazemos literalmente o que ela manda: remove o PA apontado da lista CERTA e re-executa, até
// convergir (pior caso: as duas listas esvaziam e os campos somem do payload — a RFB usa o que ela
// já tem). Qualquer OUTRO erro propaga intacto: não mascaramos rejeição real.
//
// ⚠ O ajuste da FOLHA foi o bug que travava o Calcular de toda empresa com Fator-R. O regex antigo
// casava com as duas mensagens mas removia sempre de `receitasBrutasAnteriores`: quando a queixa
// era de folha, ou o mês não estava na lista de receitas e o erro voltava intacto (Calcular "não
// fazia nada", porque a mensagem ainda era engolida pelo front), ou estava, e aí comia um mês de
// receita que a RFB precisava, repetindo até estourar em 14 chamadas SERPRO por clique.
//
// Por isso o subject entra no regex: é ele que decide de QUAL lista remover.
const RE_PERIODO_DESNECESSARIO = /foi enviada\s+(folha|receita bruta)[^:]*per[íi]odo desnecess[áa]rio:?\s*(\d{2})\/(\d{4})/i;
// Guarda de compatibilidade: se a RFB mudar a frase e o subject não casar, volta ao comportamento
// antigo (tratar como receita) em vez de deixar de ajustar.
const RE_PERIODO_DESNECESSARIO_SEM_SUJEITO = /per[íi]odo desnecess[áa]rio:?\s*(\d{2})\/(\d{4})/i;

// Exportada para teste: a regra de "de qual lista remover" já saiu errada uma vez e travou o
// Calcular de toda empresa com Fator-R, sem deixar rastro nenhum.
export async function executarComAjusteDePeriodos(executar, { receitasBrutasAnteriores, folhasSalario, ...params }) {
  let receitas = [...(receitasBrutasAnteriores || [])];
  let folhas = [...(folhasSalario || [])];
  const removidos = { receitas: [], folhas: [] };
  // Teto: as duas listas têm 12 meses cada, então 24 remoções + margem. Antes era 13, dimensionado
  // só para as receitas — com as duas listas ele podia estourar antes de convergir.
  for (let tentativa = 0; tentativa <= 26; tentativa += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resultado = await executar({ ...params, receitasBrutasAnteriores: receitas, folhasSalario: folhas });
      return { resultado, receitasAceitas: receitas, folhasAceitas: folhas, periodosRemovidos: removidos };
    } catch (err) {
      const msg = String(err?.message || "");
      const comSujeito = msg.match(RE_PERIODO_DESNECESSARIO);
      const generico = comSujeito ? null : msg.match(RE_PERIODO_DESNECESSARIO_SEM_SUJEITO);
      if (!comSujeito && !generico) throw err;

      const ehFolha = comSujeito ? /folha/i.test(comSujeito[1]) : false;
      const [mes, ano] = comSujeito ? [comSujeito[2], comSujeito[3]] : [generico[1], generico[2]];
      const pa = `${ano}-${mes}`; // "06/2025" → "2025-06"

      const alvo = ehFolha ? folhas : receitas;
      const depois = alvo.filter((r) => String(r.pa) !== pa);
      if (depois.length === alvo.length) throw err; // PA não está na lista → evita loop infinito
      if (ehFolha) { folhas = depois; removidos.folhas.push(pa); }
      else { receitas = depois; removidos.receitas.push(pa); }
    }
  }
  throw new FechamentoError(
    "RECEITAS_ANTERIORES_NAO_CONVERGIU",
    "A RFB rejeitou os períodos anteriores (receita bruta / folha) repetidamente.",
  );
}

// A RECUSA DA DECLARAÇÃO ZERADA, DITA POR INTEIRO.
//
// O contador que apura uma empresa sem faturamento recebia, como única explicação, a frase de
// campo da RFB — que fala de "valor da atividade" numa tela onde ele acabou de afirmar que o mês
// não teve receita nenhuma. Medido em produção (10/08/2026, PHAOS CONSULTORIA LTDA, competência
// sem uma única nota, duas chamadas PAGAS seguidas):
//
//     HTTP 400 — "SN-Entregar: O valor da atividade deve ser maior que zero."
//
// ⚠ A recusa é da RECEITA, não nossa, e NÃO É AFROUXADA aqui: o erro continua sendo erro e nada
// é transmitido. O que muda é só o que o contador lê — a frase da RFB continua citada literalmente
// (não se reescreve mensagem de órgão), com o contexto que falta em volta dela.
//
// ⚠ A CAUSA FOI ENCONTRADA E CORRIGIDA — esta função virou REDE, não explicação do defeito.
//
// O payload zerado saía com `estabelecimentos[0].atividades: []`, e a forma que a RFB aceita é
// **omitir a chave**. Está na documentação oficial do `TRANSDECLARACAO11` ("Se não houve atividade
// para o estabelecimento, não enviar esta lista") e na AÇÃO do próprio erro, no catálogo de
// mensagens do PGDAS-D (`MSG_ISN_023`). Corrigido em `buildDeclaracaoPayload`, com teste de forma
// em `fiscal/serpro/__tests__/buildDeclaracaoPayloadZerada.test.js`.
//
// ⚠ MAS A CORREÇÃO NÃO FOI EXERCIDA CONTRA A RECEITA — nenhuma chamada real foi feita depois dela
// (regra 5: não se dispara ato fiscal para testar). Então esta tradução FICA: se a recusa voltar, o
// contador precisa ler algo melhor que a frase de campo da RFB, e o texto tem de dizer que o
// formato documentado já está sendo enviado — senão manda investigar o que já foi investigado.
const RE_ATIVIDADE_MAIOR_QUE_ZERO = /valor da atividade deve ser maior que zero/i;

export function traduzirRecusaDeclaracaoZerada(err, declaracaoZerada) {
  if (!declaracaoZerada) return err;
  const msg = String(err?.message || "");
  if (!RE_ATIVIDADE_MAIOR_QUE_ZERO.test(msg)) return err;
  return new FechamentoError(
    "DECLARACAO_ZERADA_RECUSADA_RFB",
    "A Receita recusou a declaração SEM MOVIMENTO. **Nada foi transmitido.** "
    + `Resposta da RFB: "${msg}". `
    + "⚠ Isto não deveria mais acontecer: o portal já envia a declaração zerada no formato que a "
    + "documentação oficial descreve (sem a lista de atividades). Se esta mensagem apareceu, a "
    + "causa é outra e precisa ser investigada — entregue esta competência pelo portal do PGDAS-D "
    + "e registre a entrega aqui.",
    { rfb: msg },
  );
}

/**
 * [Calcular] — simulação oficial SERPRO (não transmite). Verdade do preview.
 * Persiste snapshot estado "calculada" + grava RBT12 da simulação no cache.
 */
export async function calcularFechamento({ portalClientId, competencia, atividades, folhaMensal12, regimeApuracao, semMovimento = false }) {
  // Normaliza pra [] — o restante usa atividades.reduce/JSON.stringify.
  atividades = Array.isArray(atividades) ? atividades : [];

  // ⚠ A DECLARAÇÃO É ZERADA QUANDO AS ATIVIDADES **SOMAM** ZERO — não quando a lista está vazia.
  //
  // `buildDeclaracaoPayload` descarta a linha de valor 0 (`if (valor <= 0) return null`), então
  // lista vazia e lista com R$ 0,00 produzem **o mesmo payload**. Enquanto esta guarda perguntava
  // pelo COMPRIMENTO, a empresa sem faturamento cujo modal vinha com uma linha derivada do CNAE
  // (`montarAtividadesDoCnae` emite a atividade mesmo com faturamento 0, só pra trazer o anexo)
  // ou da memória da última competência passava por AQUI SEM NENHUMA VERIFICAÇÃO e ia direto para
  // o SERPRO — chamada PAGA — para receber 400 da RFB. Medido em produção (10/08/2026, PHAOS
  // CONSULTORIA, dois cliques, duas chamadas pagas):
  //
  //     HTTP 400 — "SN-Entregar: O valor da atividade deve ser maior que zero."
  //
  // Perguntar pela SOMA alinha esta guarda com o payload que de fato sai daqui, e faz a trava
  // anti-zero (`SEM_MOVIMENTO_COM_FATURAMENTO`) alcançar também esse caso — que antes escapava
  // dela por completo e só era pego DEPOIS de pagar, pela guarda de baixo.
  const declaracaoZerada = somaAtividades(atividades) === 0;
  if (declaracaoZerada) {
    // ⚠ O FATURAMENTO É CONSULTADO ANTES DE ESCOLHER A MENSAGEM, e não é detalhe de redação.
    //
    // A recusa genérica ("marque Declarar SEM MOVIMENTO se o mês não teve receita") só é verdadeira
    // para quem realmente não faturou. Dita a uma empresa COM nota na competência, ela aponta para
    // uma ação que a trava seguinte recusa — mandar o contador tentar o que vai ser negado é a
    // mesma classe de defeito que "desabilitado sem explicação".
    //
    // ⚠ E é aqui que mora a guarda anti-zero da Q55 (`APURACAO_ZERADA_COM_FATURAMENTO`), que ficava
    // DEPOIS da simulação: com a decisão pela soma, nenhuma execução chegava mais nela — a guarda
    // virava letra morta enquanto o comentário ainda a anunciava como cinto. Subi-la para cá a faz
    // voltar a morder E economiza a chamada PAGA que ela antes só pegava depois de gastar.
    const fat = await faturamentoEmitDaCompetencia(portalClientId, competencia);
    if (fat > 0) {
      throw semMovimento
        ? new FechamentoError(
          "SEM_MOVIMENTO_COM_FATURAMENTO",
          `Não é possível declarar sem movimento: a empresa tem faturamento de R$ ${fat.toFixed(2)} na competência.`,
          { faturamento: fat },
        )
        : new FechamentoError(
          "APURACAO_ZERADA_COM_FATURAMENTO",
          `Empresa com faturamento de R$ ${fat.toFixed(2)} na competência, mas as atividades somam R$ 0,00. Classifique/preencha as receitas antes de apurar.`,
          { faturamento: fat },
        );
    }
    if (!semMovimento) {
      throw new FechamentoError(
        "NO_ATIVIDADES",
        atividades.length
          ? "As atividades somam R$ 0,00. Preencha os valores, ou marque \"Declarar SEM MOVIMENTO\" se o mês realmente não teve receita."
          : "Sem atividades pra calcular. Adicione a atividade, ou marque \"Declarar SEM MOVIMENTO\" se o mês realmente não teve receita.",
      );
    }
  }
  const semAtividades = declaracaoZerada;
  const { contratanteCnpj, contribuinteCnpj } = await resolverCnpjs(portalClientId);
  const rbt = await getRbt12({ portalClientId, competencia });

  const sim = new PgdasSimulacaoService();
  const folhasSalario = await folhasSalarioSeAplicavel(atividades, folhaMensal12);

  // ─── PARTIR DA LISTA QUE A RFB JÁ ACEITOU ─────────────────────────────────────────────────
  //
  // O laço abaixo converge por tentativa e erro: a RFB rejeita apontando um mês "desnecessário", o
  // código remove aquele mês e re-executa — e **cada re-execução é uma chamada COBRADA**. Medido em
  // produção: 18 rejeições para 1 sucesso na mesma empresa, e exatamente o mesmo custo repetido no
  // dia seguinte. 75 das 214 chamadas pagas do mês (35%) eram esse laço.
  //
  // A lista aceita SEMPRE foi calculada e devolvida pelo laço — só era jogada fora, porque a
  // gravação estava atrás de `if (resultado.rbt12 != null)` e o simulador devolve `rbt12: null`
  // sempre (a RFB não retorna RBT12). Guarda que nunca podia ser verdadeira.
  //
  // Palpite BOM, não verdade: se a empresa transmitir uma declaração retroativa, o conjunto muda e
  // a lista envelhece — a RFB rejeita, o laço reconverge e regrava. Pior caso volta a ser o de hoje.
  const aceitos = await lerPeriodosAceitos({ portalClientId, competencia }).catch(() => null);
  const podar = (lista, aceitosPa) => (
    Array.isArray(aceitosPa) && aceitosPa.length
      ? (lista || []).filter((r) => aceitosPa.includes(String(r.pa)))
      : (lista || [])
  );
  const receitasIniciais = podar(rbt.detalhePorMes, aceitos?.receitas);
  const folhasIniciais = podar(folhasSalario, aceitos?.folhas);

  const { resultado, receitasAceitas, folhasAceitas, periodosRemovidos } = await executarComAjusteDePeriodos(
    (p) => sim.simular(p),
    {
      contratanteCnpj, contribuinteCnpj, competencia,
      regimeApuracao: regimeApuracao || "COMPETENCIA",
      atividades: atividades || [],
      receitasBrutasAnteriores: receitasIniciais,
      folhasSalario: folhasIniciais,
      permitirSemMovimento: semMovimento && semAtividades,
    },
  ).catch((err) => { throw traduzirRecusaDeclaracaoZerada(err, declaracaoZerada); });

  // Guarda o que a RFB aceitou — as DUAS listas. `gravarDaSimulacao` só cobria as receitas, e é a
  // FOLHA que precisa ser podada nas empresas de Fator-R (exatamente as que mais gastavam).
  //
  // ⚠ Sem tocar em `rbt12` nem em `origem`: a RFB não devolve RBT12, então o número continua sendo
  // nosso. Gravá-lo como "veio da simulação" promoveria a confiabilidade de um dado que nós
  // calculamos — o tipo de mentira de procedência que este projeto não aceita.
  await gravarPeriodosAceitos({
    portalClientId, competencia,
    receitas: receitasAceitas,
    folhas: folhasAceitas,
  }).catch(() => null);

  // Memória da última config (anexo/atividades/folha/regime) já no Calcular — antes só o Salvar
  // gravava, e quando o cálculo falhava a escolha se perdia. Best-effort.
  await salvarConfigMemory({
    portalClientId,
    atividadesEscolhidas: atividades,
    folhaMensal12: folhaMensal12 || null,
    regimeApuracao: regimeApuracao || null,
  }).catch(() => null);

  const faturamentoInterno = round2(atividades.reduce((s, a) => s + Number(a.valorInterno || 0), 0));
  const faturamentoExterno = round2(atividades.reduce((s, a) => s + Number(a.valorExterno || 0), 0));

  // ⚠ A guarda anti-zero da Q55 (`APURACAO_ZERADA_COM_FATURAMENTO`) MORAVA AQUI e subiu para o
  // gate do topo. Não foi removida — `atividades` não é reatribuída entre um ponto e outro, então
  // com a decisão pela soma esta posição passou a ser inalcançável: soma 0 já tinha lançado lá em
  // cima, e soma > 0 nunca satisfaz a condição. Deixá-la aqui seria manter um cinto que não
  // aperta, com o comentário afirmando que aperta.

  // Persiste snapshot (configurando→calculada)
  const idempotencyKey = `${portalClientId}:${competencia}:${JSON.stringify(atividades)}:${resultado.dasValor}`;
  const data = {
    rbt12: round2(resultado.rbt12 ?? rbt.rbt12),
    rbt12Extrato: round2(resultado.rbt12 ?? rbt.rbt12),
    atividadesEscolhidas: atividades,
    folhaMensal12: folhaMensal12 || null,
    receitaInterna: faturamentoInterno,
    receitaExterna: faturamentoExterno,
    simulacaoSerpro: resultado.raw || resultado,
    dasCalculadoLocal: resultado.dasValor != null ? round2(resultado.dasValor) : null,
    receitaPorTipo: {},   // mantém compat com schema (NOT NULL? — confere)
    receitaPorAnexo: {},
    estado: "calculada",
    idempotencyKey,
    erroMensagem: null,
  };
  const existing = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  const snapshot = existing
    ? await prisma.apuracaoSnapshot.update({ where: { id: existing.id }, data })
    : await prisma.apuracaoSnapshot.create({ data: { ...data, portalClientId, competencia } });

  return { ok: true, dasValor: resultado.dasValor, rbt12: data.rbt12, mensagens: resultado.mensagens, periodosRemovidos, snapshot };
}

/**
 * [Salvar] — congela a config (estado "fechada") + grava memória pra próxima.
 */
export async function salvarFechamento({ portalClientId, competencia, atividades, folhaMensal12, regimeApuracao, userId }) {
  const existing = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (!existing) throw new FechamentoError("NAO_CALCULADA", "Calcule a apuração antes de salvar.");

  // Camada 2 (Robustez): se a conferência com o ADN achou nota que falta no nosso lado, TRAVA o
  // fechamento (é o "28 vs 27"). Só trava em divergência confirmada — "nao_conferivel" (município
  // fora do ADN / sem cert próprio) e "ok" liberam. Resolver: capturar/importar a(s) nota(s) faltante(s)
  // e reconferir. Ver ConferenciaAdnService / docs/robustez-nfse-adn.md.
  if (existing.conferenciaStatus === "divergente") {
    const r = existing.conferenciaResultado || {};
    const n = Array.isArray(r.faltantes) ? r.faltantes.length : 0;
    throw new FechamentoError(
      "DIVERGENCIA_CONFERENCIA",
      `Conferência com o ADN achou ${n} nota(s) que faltam no nosso lado (ADN ${r.adnTotal ?? "?"} × nós ${r.nossoTotal ?? "?"}). Capture/importe as notas faltantes e reconfira antes de fechar.`,
    );
  }

  const snapshot = await prisma.apuracaoSnapshot.update({
    where: { id: existing.id },
    data: {
      atividadesEscolhidas: atividades ?? existing.atividadesEscolhidas,
      folhaMensal12: folhaMensal12 ?? existing.folhaMensal12,
      estado: "fechada",
      fechadaEm: new Date(),
      fechadaPor: userId || null,
    },
  });

  // memória pra próxima competência
  await salvarConfigMemory({
    portalClientId,
    atividadesEscolhidas: atividades ?? existing.atividadesEscolhidas,
    folhaMensal12: folhaMensal12 ?? existing.folhaMensal12,
    regimeApuracao,
    userId,
  });

  return { ok: true, snapshot };
}

/**
 * [Apurar/Transmitir] individual — consulta-antes-de-transmitir + TRANSDECLARACAO11.
 */
/**
 * C12 — pós-transmissão: reconsulta o extrato e traz a guia DAS, para o contador NÃO precisar
 * rodar uma busca depois. Antes isso só acontecia na retificação; agora vale para toda
 * transmissão (inclusive quando o PA já estava declarado).
 *
 * Best-effort por definição: a declaração já foi transmitida quando chegamos aqui, então
 * falha de rede/SERPRO NÃO pode desfazer nada — volta como `skipped` no payload.
 *
 * @param {boolean} liberarReenvio  só na RETIFICAÇÃO: zera os flags de e-mail da guia DAS para
 *   ela poder ser reenviada ao cliente (numa transmissão normal a guia já nasce PENDING).
 */
async function sincronizarExtratoEGuia({ portalClientId, competencia, liberarReenvio = false }) {
  const out = { extrato: null, guia: null };

  // (a) extrato: reescreve a circular (receitas/DAS) e re-roda os lançamentos RECEITA_*/DAS.
  try {
    const { syncPgdasByCompetencia } = await import("../../../fiscal/serpro/SerproPgdasDeclaracaoService.js");
    const r = await syncPgdasByCompetencia({ portalClientId, competencia });
    out.extrato = {
      ok: true,
      receitaStatus: r?.circular?.receitaStatus ?? null,
      receitaBruta: r?.circular?.receitaBruta ?? null,
      dasTotal: r?.circular?.dasTotal ?? null,
    };
  } catch (err) {
    out.extrato = { skipped: true, reason: err?.message || "erro" };
  }

  // (b) guia DAS: emite/atualiza o PDF e devolve os dados pra tela mostrar na hora.
  try {
    try {
      const { capturePgdasGuideForCompany } = await import("../../../fiscal/serpro/CaptureSerproGuidesService.js");
      await capturePgdasGuideForCompany({ portalClientId, competencia });
    } catch { /* PDF é bônus; se falhar ainda devolvemos a guia que já existir */ }

    const dasGuide = await prisma.guide.findFirst({
      where: { portalClientId, competencia, tipo: "SIMPLES", source: "SERPRO" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, valor: true, vencimento: true, emailStatus: true },
    });
    if (!dasGuide) {
      out.guia = { skipped: true, reason: "das_guide_nao_encontrada" };
    } else {
      if (liberarReenvio && dasGuide.status === "PROCESSED") {
        await prisma.guide.update({
          where: { id: dasGuide.id },
          data: { emailStatus: "PENDING", emailAttempts: 0, emailLastError: null, emailSentAt: null, emailNextRetryAt: null },
        });
      }
      out.guia = {
        guideId: dasGuide.id,
        status: dasGuide.status,
        valor: dasGuide.valor != null ? Number(dasGuide.valor) : null,
        vencimento: dasGuide.vencimento || null,
        liberadaReenvio: Boolean(liberarReenvio && dasGuide.status === "PROCESSED"),
      };
    }
  } catch (err) {
    out.guia = { skipped: true, reason: err?.message || "erro" };
  }

  return out;
}

export async function transmitirFechamento({ portalClientId, competencia, userId, retificar = false }) {
  const snapshot = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (!snapshot) throw new FechamentoError("NAO_CALCULADA", "Apuração não calculada.");
  // Q55: retificar permite reprocessar uma competência já "transmitida".
  const estadosOk = retificar ? ["fechada", "calculada", "transmitida"] : ["fechada", "calculada"];
  if (!estadosOk.includes(snapshot.estado)) {
    throw new FechamentoError("ESTADO_INVALIDO", `Estado "${snapshot.estado}" não permite ${retificar ? "retificar" : "transmitir"}.`);
  }

  // Q55: GUARDA ANTI-ZERO — nunca transmitir declaração zerada de empresa com faturamento.
  // (Roda ANTES de qualquer chamada ao SERPRO — usa os valores já salvos no snapshot.)
  const somaAtiv = somaAtividades(snapshot.atividadesEscolhidas);
  const fatEmit = await faturamentoEmitDaCompetencia(portalClientId, competencia);
  if (fatEmit > 0 && somaAtiv === 0) {
    throw new FechamentoError(
      "TRANSMISSAO_ZERADA_BLOQUEADA",
      `Transmissão bloqueada: empresa com faturamento R$ ${fatEmit.toFixed(2)} mas a apuração está zerada (atividades R$ 0,00). Recalcule com os valores corretos antes de transmitir.`,
      { faturamento: fatEmit },
    );
  }
  // Declaração SEM MOVIMENTO: atividades = 0 só chega aqui quando faturamento também é 0 (a guarda
  // acima bloqueia fat>0 + soma 0). Nesse caso transmite o PGDAS-D zerado (atividades vazias).
  const semMovimento = somaAtiv === 0;

  const { contratanteCnpj, contribuinteCnpj } = await resolverCnpjs(portalClientId);

  // 1. CONSULTA-ANTES-DE-TRANSMITIR: já existe declaração pra esse PA?
  const pgdas = new SerproPgdasdService();
  const indice = await pgdas.consultarDeclaracaoIndice({
    contratanteCnpj, contribuinteCnpj, periodoApuracao: competencia,
  }).catch(() => null);
  const jaDeclarado = detectarDeclaracaoExistente(indice);
  // Q55: em RETIFICAÇÃO, NÃO fazemos o short-circuit — o objetivo é justamente retransmitir.
  if (jaDeclarado && !retificar) {
    const updated = await prisma.apuracaoSnapshot.update({
      where: { id: snapshot.id },
      data: { estado: "transmitida", erroMensagem: null, transmitidoEm: snapshot.transmitidoEm || new Date() },
    });
    // C12: mesmo sem retransmitir, traz extrato + guia — é justamente o caso em que o contador
    // mais precisava rodar a busca na mão (a declaração existe, mas a guia podia não estar aqui).
    const posTransmissao = await sincronizarExtratoEGuia({ portalClientId, competencia });
    return {
      ok: true, jaDeclarado: true, snapshot: updated, posTransmissao,
      mensagem: "PA já declarado — não retransmitido (evita retificadora acidental).",
    };
  }

  // 2. Transmite de fato
  const sim = new PgdasSimulacaoService();
  const rbt = await getRbt12({ portalClientId, competencia });
  let resultado;
  try {
    // Auto-ajuste dos períodos anteriores (receita bruta E folha) também aqui: a rejeição "período
    // desnecessário" ocorre ANTES de a declaração ser aceita, então re-tentar com a lista corrigida
    // é seguro. O cache já convergido pelo Calcular torna o retry raro.
    const exec = await executarComAjusteDePeriodos(
      (p) => sim.transmitir(p),
      {
        contratanteCnpj, contribuinteCnpj, competencia,
        regimeApuracao: "COMPETENCIA",
        // Q55: retificadora (2) na retificação explícita; original (1) caso contrário.
        tipoDeclaracao: retificar ? 2 : 1,
        atividades: snapshot.atividadesEscolhidas || [],
        receitasBrutasAnteriores: rbt.detalhePorMes || [],
        // Mesmo gate do calcular — senão a transmissão sofreria a mesma rejeição da RFB.
        folhasSalario: await folhasSalarioSeAplicavel(snapshot.atividadesEscolhidas, snapshot.folhaMensal12),
        permitirSemMovimento: semMovimento,
      },
    );
    resultado = exec.resultado;
  } catch (err) {
    // Q44: rede de segurança — se o SERPRO recusar por já existir declaração (pede Retificadora),
    // a consulta-antes não pegou, mas o erro prova que já está declarado. Decisão do dono: só
    // reconhecer, NÃO retransmitir (sem retificadora). Marca como já declarada em vez de erro.
    if (erroIndicaJaDeclarado(err) && !retificar) {
      const updated = await prisma.apuracaoSnapshot.update({
        where: { id: snapshot.id },
        data: { estado: "transmitida", erroMensagem: null, transmitidoEm: snapshot.transmitidoEm || new Date() },
      });
      const posTransmissao = await sincronizarExtratoEGuia({ portalClientId, competencia });
      return {
        ok: true, jaDeclarado: true, snapshot: updated, posTransmissao,
        mensagem: "PA já declarado na Receita — não retransmitido (para alterar, seria necessária uma retificadora).",
      };
    }
    throw err;
  }

  const updated = await prisma.apuracaoSnapshot.update({
    where: { id: snapshot.id },
    data: {
      estado: "transmitida",
      dasRetornadoSerpro: resultado.dasValor != null ? round2(resultado.dasValor) : null,
      numeroDeclaracao: resultado.numeroDeclaracao || null,
      transmitidoEm: new Date(),
      erroMensagem: null,
    },
  });
  // C12: toda transmissão (não só a retificação) já devolve extrato + guia — o contador não
  // precisa mais rodar uma busca depois. Só a retificação libera a guia pra reenvio.
  const posTransmissao = await sincronizarExtratoEGuia({ portalClientId, competencia, liberarReenvio: retificar });

  return {
    ok: true,
    jaDeclarado: false,
    dasValor: resultado.dasValor,
    numeroDeclaracao: resultado.numeroDeclaracao,
    snapshot: updated,
    posTransmissao,
    // Nome antigo mantido enquanto houver quem leia (o bloco nasceu só pra retificação).
    posRetificacao: retificar ? posTransmissao : null,
  };
}

/**
 * Q55 — [Reabrir para retificar] rebaixa uma apuração "transmitida" → "calculada",
 * para o contador corrigir os valores (modal → calcular → fechar) e retransmitir como retificadora.
 * Não toca na RFB; só muda o estado local.
 */
export async function reabrirFechamento({ portalClientId, competencia, userId }) {
  void userId;
  const snapshot = await prisma.apuracaoSnapshot.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (!snapshot) throw new FechamentoError("NAO_CALCULADA", "Apuração não encontrada.");
  if (snapshot.estado !== "transmitida") {
    throw new FechamentoError("ESTADO_INVALIDO", `Só uma apuração 'transmitida' pode ser reaberta para retificar (estado atual: ${snapshot.estado}).`);
  }
  const updated = await prisma.apuracaoSnapshot.update({
    where: { id: snapshot.id },
    data: { estado: "calculada", erroMensagem: null },
  });
  return { ok: true, snapshot: updated };
}

/** Heurística: o índice CONSDECLARACAO13 indica declaração existente pro PA?
 * Q44: o retorno do SERPRO usa `dados` (não `dadosSaida`) — lê os dois por robustez. */
function detectarDeclaracaoExistente(indice) {
  if (!indice) return false;
  let dados = indice?.dados ?? indice?.dadosSaida;
  if (typeof dados === "string") { try { dados = JSON.parse(dados); } catch { dados = null; } }
  if (!dados) return false;
  const arr = Array.isArray(dados)
    ? dados
    : (dados.declaracoes || dados.listaDeclaracoes || dados.declaracaoTransmitida || []);
  if (Array.isArray(arr) && arr.length > 0) return true;
  // objeto único de declaração (idDeclaracao/numeroDeclaracao presentes)
  if (!Array.isArray(dados) && (dados.idDeclaracao || dados.numeroDeclaracao)) return true;
  return false;
}

// Q44: a mensagem de negócio do SERPRO que prova que já existe declaração no PA
// ("...1-Original não está de acordo... O correto é 2-Retificadora.").
function erroIndicaJaDeclarado(err) {
  if (!err) return false;
  if (err.code !== "SERPRO_BUSINESS_ERROR") return false;
  const msg = String(err.message || "");
  return /retificadora|n[ãa]o est[áa] de acordo|1[-\s]?original/i.test(msg);
}
