// Q15.5 — Orquestrador do fechamento de apuração (motor do FechamentoModal).
//
// 4 operações:
//   getDados  → tudo que o modal precisa (faturamento, atividades default, folha,
//               rbt12, disparidades, regime) — pré-preenchido da memória de config
//   calcular  → simulação oficial SERPRO (indicadorTransmissao:false) = verdade do preview
//   salvar    → persiste config no snapshot, estado "fechada", grava memória
//   transmitir→ consulta-antes-de-transmitir + TRANSDECLARACAO11 (individual)

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "../../../fiscal/serpro/SerproRuntimeSettings.js";
import { SerproPgdasdService } from "../../../fiscal/serpro/SerproPgdasdService.js";
import { PgdasSimulacaoService, parseRetornoSimulacao } from "../../../fiscal/serpro/PgdasSimulacaoService.js";
import { montarAtividadesDefault, carregarAtividades } from "./AtividadeResolver.js";
import { getRbt12, gravarDaSimulacao } from "./RbtExtratoService.js";
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
async function faturamentoEmitDaCompetencia(portalClientId, competencia) {
  if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) return 0;
  const { gte, lt } = rangeMes(competencia);
  const agg = await prisma.portalInvoice.aggregate({
    where: { clientId: String(portalClientId), papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
    _sum: { total: true },
  });
  return round2(Number(agg._sum?.total || 0));
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
    receitaPorTipo,
    semClassificacao,
    atividades,
    origemAtividades,
    folhaMensal12: memory?.folhaMensal12 || null,
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

// A RFB só aceita receitasBrutasAnteriores dos meses que ela NÃO tem declarados; para os demais
// rejeita com "SN-Entregar: Foi enviada receita bruta de um período desnecessário: MM/AAAA. Remova
// este período e tente novamente." Fazemos literalmente isso: remove o PA apontado e re-executa,
// até a lista convergir (pior caso: 12 remoções → lista vazia, campo omitido do payload).
// Qualquer OUTRO erro propaga intacto (não mascara rejeições reais).
const RE_PERIODO_DESNECESSARIO = /per[íi]odo desnecess[áa]rio:?\s*(\d{2})\/(\d{4})/i;
async function executarComAjusteReceitas(executar, { receitasBrutasAnteriores, ...params }) {
  let detalhe = [...(receitasBrutasAnteriores || [])];
  const removidos = [];
  for (let tentativa = 0; tentativa <= 13; tentativa += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resultado = await executar({ ...params, receitasBrutasAnteriores: detalhe });
      return { resultado, receitasAceitas: detalhe, periodosRemovidos: removidos };
    } catch (err) {
      const m = String(err?.message || "").match(RE_PERIODO_DESNECESSARIO);
      if (!m) throw err;
      const pa = `${m[2]}-${m[1]}`; // "06/2025" → "2025-06"
      const antes = detalhe.length;
      detalhe = detalhe.filter((r) => String(r.pa) !== pa);
      if (detalhe.length === antes) throw err; // PA não está na lista → evita loop infinito
      removidos.push(pa);
    }
  }
  throw new FechamentoError("RECEITAS_ANTERIORES_NAO_CONVERGIU", "A RFB rejeitou as receitas brutas anteriores repetidamente.");
}

/**
 * [Calcular] — simulação oficial SERPRO (não transmite). Verdade do preview.
 * Persiste snapshot estado "calculada" + grava RBT12 da simulação no cache.
 */
export async function calcularFechamento({ portalClientId, competencia, atividades, folhaMensal12, regimeApuracao, semMovimento = false }) {
  const semAtividades = !Array.isArray(atividades) || atividades.length === 0;
  if (semAtividades) {
    // Declaração SEM MOVIMENTO: só permitida quando NÃO há faturamento EMIT na competência
    // (trava de segurança — nunca declarar zerado quem tem nota). Senão, mantém o bloqueio.
    if (semMovimento) {
      const fat = await faturamentoEmitDaCompetencia(portalClientId, competencia);
      if (fat > 0) {
        throw new FechamentoError(
          "SEM_MOVIMENTO_COM_FATURAMENTO",
          `Não é possível declarar sem movimento: a empresa tem faturamento de R$ ${fat.toFixed(2)} na competência.`,
          { faturamento: fat },
        );
      }
    } else {
      throw new FechamentoError("NO_ATIVIDADES", "Sem atividades pra calcular.");
    }
  }
  // Normaliza pra [] (sem movimento) — o restante usa atividades.reduce/JSON.stringify.
  atividades = Array.isArray(atividades) ? atividades : [];
  const { contratanteCnpj, contribuinteCnpj } = await resolverCnpjs(portalClientId);
  const rbt = await getRbt12({ portalClientId, competencia });

  const sim = new PgdasSimulacaoService();
  const folhasSalario = await folhasSalarioSeAplicavel(atividades, folhaMensal12);
  const { resultado, receitasAceitas, periodosRemovidos } = await executarComAjusteReceitas(
    (p) => sim.simular(p),
    {
      contratanteCnpj, contribuinteCnpj, competencia,
      regimeApuracao: regimeApuracao || "COMPETENCIA",
      atividades: atividades || [],
      receitasBrutasAnteriores: rbt.detalhePorMes || [],
      folhasSalario,
      permitirSemMovimento: semMovimento && semAtividades,
    },
  );

  // Se a RFB devolveu RBT12 oficial, grava no cache (fonte SIMULACAO) — com a lista ACEITA
  // (já sem os meses "desnecessários"), pro transmitir reusar sem retry.
  if (resultado.rbt12 != null) {
    await gravarDaSimulacao({
      portalClientId, competencia,
      rbt12: resultado.rbt12,
      receitasBrutasAnteriores: receitasAceitas,
    }).catch(() => null);
  }

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

  // Q55: GUARDA ANTI-ZERO — não gravar apuração zerada de empresa que TEM faturamento.
  // (Empresa sem notas capturadas → faturamento 0 → não bloqueia, é "sem movimento" legítimo.)
  if (faturamentoInterno + faturamentoExterno === 0) {
    const fat = await faturamentoEmitDaCompetencia(portalClientId, competencia);
    if (fat > 0) {
      throw new FechamentoError(
        "APURACAO_ZERADA_COM_FATURAMENTO",
        `Empresa com faturamento de R$ ${fat.toFixed(2)} na competência, mas as atividades somam R$ 0,00. Classifique/preencha as receitas antes de apurar.`,
        { faturamento: fat },
      );
    }
  }

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
    // Auto-ajuste das receitas anteriores também aqui: a rejeição "período desnecessário" ocorre
    // ANTES de a declaração ser aceita, então re-tentar com a lista corrigida é seguro. O cache
    // já convergido pelo Calcular torna o retry raro.
    const exec = await executarComAjusteReceitas(
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
