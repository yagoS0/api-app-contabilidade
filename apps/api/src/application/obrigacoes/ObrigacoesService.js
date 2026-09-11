// Controle de Obrigações — o serviço que o escritório precisa fazer até uma data.
//
// NÃO é o vencimento da guia. Guia é o pagamento do CLIENTE e continua vindo de `Guide.vencimento`;
// obrigação é o trabalho do CONTADOR. Dois eixos, dois públicos, duas datas — por isso convivem no
// calendário sem nenhuma deduplicação entre si.
//
// Não existe catálogo pré-carregado: quem cadastra é o contador. Data de obrigação é dado fiscal
// que muda por ato normativo, e uma lista embutida colocaria prazo desatualizado na tela de todas
// as empresas de uma vez. Repetição entre empresas se resolve pela regra do escritório.

import { normalizarJanela, cicloDaOcorrencia, aplicarJanela, regraDoCiclo, normalizarRegraRecorrente, janelaDoCiclo } from './agendaSerie.js';
import { normalizarAgenda } from '../../../../../packages/shared/src/agenda.js';
import { sincronizarAgendaConfigurada } from './sincronizarAgendaConfigurada.js';
import { sincronizarAgenda } from './sincronizarAgenda.js';
import { prisma } from "../../infrastructure/db/prisma.js";
import { criarConsultorDeFeriados, paraISO } from "./diaUtil.js";
import {
  AJUSTES_DIA_UTIL,
  PERIODICIDADES_COM_AVULSA,
  calcularVencimentos,
} from "./gerarOcorrencias.js";

/** Janela rolante. 12 meses cobre o ano inteiro de qualquer periodicidade sem inchar a tabela. */
export const MESES_DA_JANELA = 12;

async function bloquearSerie(db, id) {
  // PostgreSQL lock transacional, compartilhado por worker e mudanças de alcance.
  if (db.$queryRaw) await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
}

export async function excluirOcorrencia({ portalIds, ocorrenciaId, alcance = "ESTA", userId = null, incluirConcluidas = false }, db = prisma) {
  if (!["ESTA", "ESTA_E_PROXIMAS"].includes(alcance)) throw new ObrigacaoError("alcance_invalido", "Escolha somente esta ocorrência ou esta e as próximas.");
  return db.$transaction(async tx => {
    let alvo = await tx.ocorrenciaObrigacao.findFirst({ where: { id: ocorrenciaId, obrigacao: { portalClientId: { in: portalIds } } }, include: { obrigacao: true } });
    if (!alvo) throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
    await bloquearSerie(tx, alvo.obrigacaoId);
    alvo = await tx.ocorrenciaObrigacao.findUnique({ where: { id: ocorrenciaId }, include: { obrigacao: true } });
    const serie = await tx.obrigacao.findUnique({ where: { id: alvo.obrigacaoId } });
    const ciclo = cicloDaOcorrencia(alvo, serie);
    const futuras = alcance === "ESTA_E_PROXIMAS";
    // Tombstones nunca são apagados; ativar uma regra de escritório não reintroduz o ciclo.
    await tx.obrigacao.update({ where: { id: serie.id }, data: {
      sobrescritaLocal: true,
      agendaVersoes: serie.agendaVersoes?.length ? serie.agendaVersoes : [{ aPartirDe: "0000-01", janela: serie.janelaTrabalho || null }],
      ...(futuras ? { encerradaAPartirDe: serie.encerradaAPartirDe && serie.encerradaAPartirDe < ciclo ? serie.encerradaAPartirDe : ciclo } : {}),
    } });
    const ocorrencias = futuras ? await tx.ocorrenciaObrigacao.findMany({ where: { obrigacaoId: serie.id } }) : [alvo];
    let canceladas = 0, concluidasPreservadas = 0;
    for (const oc of ocorrencias) {
      if (futuras && cicloDaOcorrencia(oc, serie) < ciclo) continue;
      if (oc.status === "CONCLUIDA" && !incluirConcluidas) { concluidasPreservadas++; continue; }
      if (oc.canceladaEm) continue;
      await tx.ocorrenciaObrigacao.update({ where: { id: oc.id }, data: { canceladaEm: new Date(), canceladaPorId: userId } });
      canceladas++;
    }
    return { canceladas, concluidasPreservadas, alcance };
  });
}

/**
 * Conjunto FECHADO. Cada chave precisa de um observador escrito à mão aqui embaixo — não é
 * extensível por configuração, justamente para nenhuma obrigação alegar conclusão automática
 * baseada em algo que o sistema não olha de verdade.
 */
export const VERIFICADORES = {
  APURACAO_TRANSMITIDA: "Quando a apuração da competência for transmitida",
  MES_FECHADO: "Quando o mês contábil da competência for fechado",
};

export class ObrigacaoError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const asTexto = (v) => String(v ?? "").trim();
const pad2 = (n) => String(n).padStart(2, "0");

function hojeUTC() {
  const agora = new Date();
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

// ── Validação ────────────────────────────────────────────────────────────────────────────────

/** Datas civis estritas: não aceita timestamp, rollover de fevereiro nem deslocamento por fuso. */
export function dataCivil(valor, campo = "data") {
  const iso = valor instanceof Date ? paraISO(valor) : asTexto(valor);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  if (!data || Number.isNaN(data.getTime()) || paraISO(data) !== iso) {
    throw new ObrigacaoError("data_invalida", `Informe ${campo} como uma data válida (AAAA-MM-DD).`);
  }
  return data;
}

function intervaloCivil(inicio, fim) {
  const dataInicio = dataCivil(inicio, "o início");
  const dataFim = dataCivil(fim, "o fim");
  if (dataFim < dataInicio) throw new ObrigacaoError("intervalo_invalido", "O fim deve ser igual ou posterior ao início.");
  return { dataInicio, dataFim };
}

export function normalizarEntrada(dados = {}) {
  let agendaConfig;
  if (dados.agendaConfig) {
    try { agendaConfig = { ...normalizarAgenda(dados.agendaConfig), ...(dados.agendaConfig.vencimentoFiscal ? { vencimentoFiscal: dataCivil(dados.agendaConfig.vencimentoFiscal).toISOString().slice(0,10) } : {}) }; }
    catch(e) { throw new ObrigacaoError("agenda_invalida", e.message); }
    if (agendaConfig.recorrencia !== dados.periodicidade) throw new ObrigacaoError("agenda_invalida", "A recorrência deve corresponder à agenda.");
  }
  let janelaTrabalho;
  try { janelaTrabalho = normalizarJanela(dados.janelaTrabalho); } catch (e) { throw new ObrigacaoError('janela_invalida', e.message); }
  const nome = asTexto(dados.nome);
  if (!nome) throw new ObrigacaoError("nome_obrigatorio", "Dê um nome à obrigação.");

  const periodicidade = asTexto(dados.periodicidade).toUpperCase();
  if (!PERIODICIDADES_COM_AVULSA.includes(periodicidade)) {
    throw new ObrigacaoError("periodicidade_invalida", "Escolha sem repetição, mensal, trimestral ou anual.");
  }

  if (["DIARIA", "SEMANAL"].includes(periodicidade) && !agendaConfig) throw new ObrigacaoError("agenda_invalida", "Informe as datas da recorrência.");
  const avulsa = periodicidade === "AVULSA";
  const tipo = asTexto(dados.tipo).toUpperCase() || "OBRIGACAO";
  if (!["TAREFA", "OBRIGACAO"].includes(tipo)) throw new ObrigacaoError("tipo_invalido", "Escolha tarefa ou obrigação.");
  const intervalo = avulsa ? intervaloCivil(dados.dataInicio, dados.dataFim) : { dataInicio: null, dataFim: null };
  const dataVencimento = avulsa
    ? (tipo === "TAREFA" ? intervalo.dataFim : dataCivil(dados.dataVencimento || intervalo.dataFim, "o vencimento"))
    : null;
  const diasPreparacao = avulsa ? 0 : Number(dados.diasPreparacao ?? 0);
  if (!Number.isInteger(diasPreparacao) || diasPreparacao < 0 || diasPreparacao > 365) {
    throw new ObrigacaoError("preparacao_invalida", "A preparação vai de 0 a 365 dias corridos.");
  }

  const diaVencimento = avulsa ? dataVencimento.getUTCDate() : Number(dados.diaVencimento);
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new ObrigacaoError("dia_vencimento_invalido", "O dia do vencimento vai de 1 a 31.");
  }

  const mesReferencia = dados.mesReferencia == null ? null : Number(dados.mesReferencia);
  if (["TRIMESTRAL", "ANUAL"].includes(periodicidade) && !(mesReferencia >= 1 && mesReferencia <= 12)) {
    throw new ObrigacaoError(
      "mes_referencia_obrigatorio",
      periodicidade === "ANUAL"
        ? "Informe em que mês do ano ela vence."
        : "Informe o primeiro mês do ciclo trimestral.",
    );
  }

  const ajusteDiaUtil = asTexto(dados.ajusteDiaUtil).toUpperCase() || "ANTECIPAR";
  if (!AJUSTES_DIA_UTIL.includes(ajusteDiaUtil)) {
    throw new ObrigacaoError("ajuste_dia_util_invalido", "Regra de dia útil desconhecida.");
  }

  const verificador = asTexto(dados.verificador).toUpperCase() || null;
  if (verificador && !VERIFICADORES[verificador]) {
    throw new ObrigacaoError("verificador_invalido", "Essa conclusão automática não existe.");
  }
  if (verificador && (avulsa || tipo === "TAREFA" || ["DIARIA", "SEMANAL"].includes(periodicidade))) {
    throw new ObrigacaoError("verificador_incompativel", "Tarefas e itens sem repetição têm conclusão manual.");
  }

  const defasagemMeses = dados.defasagemMeses == null ? 1 : Number(dados.defasagemMeses);
  if (!Number.isInteger(defasagemMeses) || defasagemMeses < 0 || defasagemMeses > 12) {
    throw new ObrigacaoError("defasagem_invalida", "A defasagem vai de 0 a 12 meses.");
  }

  const antecedenciaLembreteDias =
    dados.antecedenciaLembreteDias == null ? 5 : Number(dados.antecedenciaLembreteDias);
  if (!Number.isInteger(antecedenciaLembreteDias) || antecedenciaLembreteDias < 0 || antecedenciaLembreteDias > 90) {
    throw new ObrigacaoError("antecedencia_invalida", "A antecedência do lembrete vai de 0 a 90 dias.");
  }

  return {
    nome,
    ...(agendaConfig ? { agendaConfig } : {}),
    tipo,
    descricao: asTexto(dados.descricao) || null,
    ...intervalo,
    dataVencimento,
    diasPreparacao,
    ...(janelaTrabalho ? { janelaTrabalho } : {}),
    categoria: asTexto(dados.categoria) || null,
    periodicidade,
    diaVencimento,
    mesReferencia: periodicidade === "MENSAL" || avulsa ? null : mesReferencia,
    defasagemMeses,
    antecedenciaLembreteDias,
    ajusteDiaUtil,
    cor: asTexto(dados.cor) || null,
    verificador,
    ativa: dados.ativa === undefined ? true : Boolean(dados.ativa),
  };
}

// ── Geração de ocorrências ───────────────────────────────────────────────────────────────────

async function carregarConsultorDeFeriados(portalClientId, db = prisma) {
  const [empresa, feriados] = await Promise.all([
    db.portalClient.findUnique({ where: { id: portalClientId }, select: { municipio: true } }),
    db.feriado.findMany({ select: { data: true, abrangencia: true, municipio: true } }),
  ]);
  return criarConsultorDeFeriados(feriados, empresa?.municipio || null);
}

/**
 * Reconcilia as ocorrências da obrigação com a janela de 12 meses a partir do mês corrente.
 *
 * Regra que não se negocia: **ocorrência CONCLUÍDA nunca é tocada**. Ela é histórico do que o
 * escritório fez, e mudar o dia de vencimento hoje não pode reescrever o passado. Só as futuras
 * pendentes somem/nascem.
 *
 * ⚠ **NINGUÉM NASCE VENCIDO.** A janela começa no mês CORRENTE, e o vencimento desse mês pode já
 * ter passado — cadastrar dia 15 no dia 16 criava, na hora, uma ocorrência de ontem, que a leitura
 * (`situacaoDaOcorrencia`) mostra em vermelho como VENCIDA. Numa regra do escritório isso acusa
 * atraso na carteira inteira de uma vez, e vermelho que aparece sozinho treina o olho a ignorar
 * vermelho. VENCIDA passou a ser sempre efeito do TEMPO PASSANDO sobre uma pendência que existiu:
 * ocorrência com data anterior a hoje não é criada.
 *
 * ⚠ **Isso NÃO apaga atraso real**: as ocorrências já gravadas com data passada não entram em
 * `existentes` (a query é `gte: hoje`) e seguem intocadas, vencidas, no banco e na tela.
 *
 * @param {{incluirVencidoDoMes?: boolean}} opcoes  `true` só quando o contador declarou, no
 *   cadastro daquela empresa, que o vencimento já passado é uma pendência de verdade. Não há
 *   default silencioso e a regra do escritório não oferece a opção — ver `criar`.
 */
export async function sincronizarOcorrencias(obrigacaoId, db = prisma, { incluirVencidoDoMes = false, atualizarJanelas = false, transacionada = false } = {}) {
  if (db === prisma && !transacionada && prisma.$transaction) return prisma.$transaction(tx => sincronizarOcorrencias(obrigacaoId, tx, { incluirVencidoDoMes, atualizarJanelas, transacionada: true }));
  await bloquearSerie(db, obrigacaoId);
  const obrigacao = await db.obrigacao.findUnique({ where: { id: obrigacaoId } });
  if (!obrigacao) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);

  const hoje = hojeUTC();

  if (!obrigacao.ativa) {
    // Pausa reversível: a leitura filtra ativa, sem destruir IDs, janelas ou exceções.
    return { criadas: 0, removidas: 0 };
  }

  if (obrigacao.agendaConfig) return sincronizarAgendaConfigurada(db, obrigacao, { hoje, incluirVencidoDoMes });

  if (obrigacao.periodicidade === "AVULSA") {
    // Uma tarefa é uma ocorrência, mesmo que dure meses. Reexecução conserva seu ID e conclusão.
    const existentes = await db.ocorrenciaObrigacao.findMany({ where: { obrigacaoId } });
    const existente = existentes[0];
    const data = { dataInicio: obrigacao.dataInicio, dataFim: obrigacao.dataFim, dataVencimento: obrigacao.dataVencimento };
    if (existente) {
      if (atualizarJanelas && existente.status === "PENDENTE") {
        await db.ocorrenciaObrigacao.update({ where: { id: existente.id }, data });
      }
      return { criadas: 0, removidas: 0 };
    }
    const out = await db.ocorrenciaObrigacao.createMany({ data: [{ obrigacaoId, ...data, competenciaRef: null, status: "PENDENTE" }], skipDuplicates: true });
    return { criadas: out.count, removidas: 0 };
  }

  const ehFeriado = await carregarConsultorDeFeriados(obrigacao.portalClientId, db);
  if (obrigacao.janelaTrabalho || obrigacao.agendaVersoes?.length || obrigacao.encerradaAPartirDe) {
    return sincronizarAgenda(db, obrigacao, { hoje, ehFeriado, incluirVencidoDoMes });
  }
  const inicio = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 };
  const naJanela = (quantidadeMeses) =>
    calcularVencimentos(obrigacao, { inicio, quantidadeMeses }, ehFeriado)
      .filter((p) => incluirVencidoDoMes || p.data >= hoje);

  let previstas = naJanela(MESES_DA_JANELA);
  if (!previstas.length) {
    // A janela inteira ficou para trás. Só acontece na ANUAL cujo mês de referência é o corrente e
    // já venceu: sem isto a obrigação nasceria sem NENHUM vencimento, e "não tem prazo" é pior que
    // "o próximo é daqui a um ano". Procura só a PRÓXIMA, fora da janela.
    previstas = naJanela(MESES_DA_JANELA + 12).slice(0, 1);
  }
  const previstasPorIso = new Map(previstas.map((p) => [p.iso, p]));

  const existentes = await db.ocorrenciaObrigacao.findMany({
    where: { obrigacaoId, dataVencimento: { gte: hoje } },
    select: { id: true, dataVencimento: true, status: true, competenciaRef: true, janelaPersonalizada: true },
  });
  const existentesIso = new Set(existentes.map((o) => paraISO(o.dataVencimento)));
  const competenciasConcluidas = new Set(existentes.filter((o) => o.status === "CONCLUIDA").map((o) => o.competenciaRef).filter(Boolean));
  // Ciclos concluídos ou movidos para o passado não renascem ao renovar a janela.
  const historico = await db.ocorrenciaObrigacao.findMany({
    where: { obrigacaoId, OR: [{ status: "CONCLUIDA" }, { janelaPersonalizada: true }] },
    select: { competenciaRef: true, status: true, janelaPersonalizada: true },
  });
  for (const o of historico) if (o.status === "CONCLUIDA" && o.competenciaRef) competenciasConcluidas.add(o.competenciaRef);
  const competenciasPersonalizadas = new Set(existentes.filter((o) => o.janelaPersonalizada).map((o) => o.competenciaRef));
  for (const o of historico) if (o.janelaPersonalizada && o.competenciaRef) competenciasPersonalizadas.add(o.competenciaRef);

  // Só a edição explícita da série refaz janelas. O worker não apaga edições de uma ocorrência.
  if (atualizarJanelas) {
    for (const o of existentes) {
      const p = previstasPorIso.get(paraISO(o.dataVencimento))
        || (o.janelaPersonalizada ? previstas.find((p) => p.competenciaRef === o.competenciaRef) : null);
      if (o.status === "PENDENTE" && p) {
        await db.ocorrenciaObrigacao.update({ where: { id: o.id }, data: { dataInicio: p.dataInicio, dataFim: p.dataFim, dataVencimento: p.data, janelaPersonalizada: false } });
        existentesIso.add(p.iso);
      }
    }
  }

  const obsoletas = existentes
    .filter((o) => o.status === "PENDENTE" && !o.janelaPersonalizada && !previstasPorIso.has(paraISO(o.dataVencimento)))
    .map((o) => o.id);
  if (obsoletas.length) {
    await db.ocorrenciaObrigacao.deleteMany({ where: { id: { in: obsoletas } } });
  }

  const novas = previstas.filter((p) => !existentesIso.has(p.iso) && !competenciasConcluidas.has(p.competenciaRef) && !competenciasPersonalizadas.has(p.competenciaRef));
  if (novas.length) {
    // `skipDuplicates` + o unique (obrigacaoId, dataVencimento): rodar de novo não duplica, o que
    // torna o worker mensal seguro de chamar quantas vezes for.
    await db.ocorrenciaObrigacao.createMany({
      data: novas.map((p) => ({
        obrigacaoId,
        dataVencimento: p.data,
        dataInicio: p.dataInicio,
        dataFim: p.dataFim,
        competenciaRef: p.competenciaRef,
        status: "PENDENTE",
      })),
      skipDuplicates: true,
    });
  }

  return { criadas: novas.length, removidas: obsoletas.length };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────────────────────

export async function criar({ portalClientId, dados, criadoPorId = null }) {
  const limpo = normalizarEntrada(dados);
  // ⚠ ESCOLHA EXPLÍCITA, UMA EMPRESA POR VEZ. `incluirVencidoDoMes` não é campo da obrigação (não
  // vai para `normalizarEntrada` nem para o banco): é uma decisão sobre ESTE cadastro, tomada por
  // quem sabe se aquela empresa de fato deixou de entregar. A regra do escritório não a oferece —
  // lá o mesmo clique afirmaria atraso de 38 empresas que ninguém conferiu uma a uma.
  const incluirVencidoDoMes = dados?.incluirVencidoDoMes === true;
  return prisma.$transaction(async (db) => {
    const obrigacao = await db.obrigacao.create({
      data: { ...limpo, portalClientId, criadoPorId },
    });
    const geradas = await sincronizarOcorrencias(obrigacao.id, db, { incluirVencidoDoMes, transacionada: true });
    return { obrigacao, ...geradas };
  });
}

export async function atualizar({ portalIds, obrigacaoId, dados }) {
  return prisma.$transaction(async (db) => {
  await bloquearSerie(db, obrigacaoId);
  // Escopo por LISTA de empresas visíveis, igual a `concluir`: a rota não precisa descobrir a
  // empresa antes de chamar, e uma obrigação de fora do escopo some como 404 em vez de 403 —
  // não confirmamos a existência de dado que o usuário não pode ver.
  const atual = await db.obrigacao.findFirst({
    where: { id: obrigacaoId, portalClientId: { in: portalIds } },
  });
  if (!atual) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);

  const limpo = normalizarEntrada({ ...atual, ...dados });
  if ((atual.periodicidade === "AVULSA") !== (limpo.periodicidade === "AVULSA")) {
    throw new ObrigacaoError("recorrencia_incompativel", "Crie outro cadastro para trocar entre item sem repetição e recorrência.", 409);
  }
  const camposJanela = ["dataInicio", "dataFim", "dataVencimento", "diasPreparacao", "diaVencimento", "mesReferencia", "ajusteDiaUtil", "periodicidade"];
  const atualizarJanelas = camposJanela.some((campo) => dados[campo] !== undefined && String(limpo[campo]) !== String(atual[campo]));
  if (atual.periodicidade === "AVULSA" && atualizarJanelas) {
    const concluida = await db.ocorrenciaObrigacao.findFirst({ where: { obrigacaoId, status: "CONCLUIDA" } });
    if (concluida) throw new ObrigacaoError("ocorrencia_concluida", "Reabra a ocorrência antes de alterar seu período.", 409);
  }
  const obrigacao = await db.obrigacao.update({
    where: { id: obrigacaoId },
    data: {
      ...limpo,
      // Editar na empresa uma obrigação que veio de regra a DESLIGA da regra: a partir daqui a
      // regra não sobrescreve mais. Sem isso, a próxima propagação apagaria a escolha local sem
      // avisar ninguém.
      ...(atual.regraId ? { sobrescritaLocal: true } : {}),
    },
  });
  const geradas = await sincronizarOcorrencias(obrigacao.id, db, { atualizarJanelas, transacionada: true });
  return { obrigacao, ...geradas };
  });
}

export async function remover({ portalIds, obrigacaoId }) {
  const atual = await prisma.obrigacao.findFirst({
    where: { id: obrigacaoId, portalClientId: { in: portalIds } },
  });
  if (!atual) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);
  // Cascade leva as ocorrências junto — inclusive as concluídas. É exclusão de verdade, pedida
  // explicitamente; quem só quer parar de gerar usa `ativa: false`.
  await prisma.$transaction(async tx => {
    await bloquearSerie(tx, obrigacaoId);
    await tx.obrigacao.update({ where: { id: obrigacaoId }, data: { encerradaAPartirDe: '0000-01', sobrescritaLocal: true, ativa: false } });
    await tx.ocorrenciaObrigacao.updateMany({ where: { obrigacaoId, status: 'PENDENTE', canceladaEm: null }, data: { canceladaEm: new Date() } });
  });
  return { id: obrigacaoId, nome: atual.nome };
}

// ── Leitura ──────────────────────────────────────────────────────────────────────────────────

/**
 * VENCIDA é DERIVADA, nunca lida do banco. Status calculado a partir do relógio envelhece: a
 * ocorrência venceria à meia-noite e a tela seguiria dizendo "pendente" até alguém rodar um job.
 */
export function situacaoDaOcorrencia(ocorrencia, hoje = hojeUTC()) {
  if (ocorrencia.status === "CONCLUIDA") return "CONCLUIDA";
  return ocorrencia.dataVencimento < hoje ? "VENCIDA" : "PENDENTE";
}

export async function listar({ portalIds, companyId = null, incluirInativas = false }) {
  const alvos = companyId ? portalIds.filter((id) => id === companyId) : portalIds;
  if (!alvos.length) return { obrigacoes: [], resumo: { pendentes: 0, vencendoEm7Dias: 0, vencidas: 0 } };

  const hoje = hojeUTC();
  const obrigacoes = await prisma.obrigacao.findMany({
    where: { portalClientId: { in: alvos }, ...(incluirInativas ? {} : { ativa: true }) },
    include: {
      portalClient: { select: { id: true, razao: true, cnpj: true } },
      // A central oferece histórico/concluídas, inclusive depois do prazo final.
      ocorrencias: {
        where: { canceladaEm: null, foraDaRecorrencia: false },
        orderBy: { dataVencimento: "asc" },
      },
    },
    orderBy: [{ nome: "asc" }],
  });

  const emSeteDias = new Date(hoje.getTime());
  emSeteDias.setUTCDate(emSeteDias.getUTCDate() + 7);

  let pendentes = 0;
  let vencendoEm7Dias = 0;
  let vencidas = 0;

  const saida = obrigacoes.map((o) => {
    const ocorrencias = o.ocorrencias.map((oc) => ({
      ocorrenciaId: oc.id,
      ...(oc.agendaConfig ? { agendaConfig: oc.agendaConfig } : {}),
      cicloChave: cicloDaOcorrencia(oc, o),
      dataVencimento: paraISO(oc.dataVencimento),
      dataInicio: paraISO(oc.dataInicio || oc.dataVencimento),
      dataFim: paraISO(oc.dataFim || oc.dataVencimento),
      competenciaRef: oc.competenciaRef,
      situacao: situacaoDaOcorrencia(oc, hoje),
      concluidaEm: oc.concluidaEm ? oc.concluidaEm.toISOString() : null,
      fonteConclusao: oc.fonteConclusao,
    }));

    for (const oc of ocorrencias) {
      if (oc.situacao === "VENCIDA") vencidas += 1;
      else if (oc.situacao === "PENDENTE") {
        pendentes += 1;
        if (new Date(`${oc.dataVencimento}T00:00:00Z`) <= emSeteDias) vencendoEm7Dias += 1;
      }
    }

    const proxima = ocorrencias.find((oc) => oc.situacao === "PENDENTE") || null;
    return {
      obrigacaoId: o.id,
      companyId: o.portalClientId,
      empresa: o.portalClient?.razao || null,
      cnpj: o.portalClient?.cnpj || null,
      nome: o.nome,
      ...(o.agendaConfig ? { agendaConfig: o.agendaConfig } : {}),
      tipo: o.tipo || "OBRIGACAO",
      descricao: o.descricao || null,
      dataInicio: o.dataInicio ? paraISO(o.dataInicio) : null,
      dataFim: o.dataFim ? paraISO(o.dataFim) : null,
      dataVencimento: o.dataVencimento ? paraISO(o.dataVencimento) : null,
      diasPreparacao: o.diasPreparacao || 0,
    janelaTrabalho: o.janelaTrabalho || null,
    agendaVersoes: o.agendaVersoes || [],
    encerradaAPartirDe: o.encerradaAPartirDe || null,
      categoria: o.categoria,
      periodicidade: o.periodicidade,
      diaVencimento: o.diaVencimento,
      mesReferencia: o.mesReferencia,
      defasagemMeses: o.defasagemMeses,
      antecedenciaLembreteDias: o.antecedenciaLembreteDias,
      ajusteDiaUtil: o.ajusteDiaUtil,
      cor: o.cor,
      ativa: o.ativa,
      verificador: o.verificador,
      // A UI usa isso pra NÃO oferecer "concluir" no que se conclui sozinho, e dizer de onde veio.
      conclusaoAutomatica: Boolean(o.verificador),
      regraId: o.regraId,
      sobrescritaLocal: o.sobrescritaLocal,
      proximoVencimento: proxima?.dataVencimento || null,
      ocorrencias,
    };
  });

  return { obrigacoes: saida, resumo: { pendentes, vencendoEm7Dias, vencidas } };
}

// ── Conclusão ────────────────────────────────────────────────────────────────────────────────

export async function atualizarOcorrencia({ portalIds, ocorrenciaId, dados, userId = null }, db = prisma) {
  if (dados.alcance && !['ESTA', 'ESTA_E_PROXIMAS'].includes(dados.alcance)) throw new ObrigacaoError('alcance_invalido', 'Escolha um alcance válido.');
  const executar = async (tx) => {
  let oc = await tx.ocorrenciaObrigacao.findFirst({
    where: { id: ocorrenciaId, obrigacao: { portalClientId: { in: portalIds } } },
    include: { obrigacao: true },
  });
  if (!oc) throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  await bloquearSerie(tx, oc.obrigacaoId);
  oc = await tx.ocorrenciaObrigacao.findFirst({ where: { id: ocorrenciaId, obrigacao: { portalClientId: { in: portalIds } } }, include: { obrigacao: true } });
  if (!oc) throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  if (oc.canceladaEm || oc.foraDaRecorrencia) throw new ObrigacaoError('ocorrencia_cancelada', 'Esta ocorrência foi excluída da agenda.', 409);
  if (dados.alcance === 'ESTA_E_PROXIMAS') {
    if (oc.obrigacao.periodicidade === 'AVULSA') throw new ObrigacaoError('sem_recorrencia', 'Este item não se repete.');
    const ciclo = cicloDaOcorrencia(oc, oc.obrigacao);
    const serie = await tx.obrigacao.findUnique({ where: { id: oc.obrigacaoId } });
    let janela, regra;
    try {
      janela = normalizarJanela(Object.hasOwn(dados, 'janelaTrabalho') ? dados.janelaTrabalho : janelaDoCiclo(serie, ciclo));
      regra = normalizarRegraRecorrente(dados.regra || {}, regraDoCiclo(serie, ciclo));
    } catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
    const versoes = [...(serie.agendaVersoes || []), { aPartirDe: ciclo, janela, regra, alteradaPorId: userId, alteradaEm: new Date().toISOString() }];
    const atualizada = await tx.obrigacao.update({ where: { id: oc.obrigacaoId }, data: { agendaVersoes: versoes, sobrescritaLocal: true } });
    const ehFeriado = await carregarConsultorDeFeriados(serie.portalClientId, tx);
    await sincronizarAgenda(tx, atualizada, { hoje: new Date(ciclo + '-01T00:00:00Z'), ehFeriado, incluirVencidoDoMes: true });
    return tx.ocorrenciaObrigacao.findUnique({ where: { id: ocorrenciaId } });
  }
  if (oc.status === "CONCLUIDA") throw new ObrigacaoError("ocorrencia_concluida", "Reabra a ocorrência antes de alterar seu período.", 409);
  if (dados.dataVencimento !== undefined) throw new ObrigacaoError("vencimento_preservado", "Edite o cadastro para alterar o prazo; este ajuste altera somente a janela de trabalho.");
  const data = intervaloCivil(dados.dataInicio ?? oc.dataInicio ?? oc.dataVencimento, dados.dataFim ?? oc.dataFim ?? oc.dataVencimento);
  data.janelaPersonalizada = true;
  // Para tarefa, o fim é seu próprio prazo. Obrigação conserva o vencimento fiscal separado.
  if (oc.obrigacao.tipo === "TAREFA") data.dataVencimento = data.dataFim;
  const atualizada = await tx.ocorrenciaObrigacao.update({ where: { id: ocorrenciaId }, data });
  if (oc.obrigacao.periodicidade === "AVULSA") {
    // O cadastro avulso representa esta única ocorrência; reabrir seu formulário deve mostrar
    // a janela recém-editada, não a que existia antes do ajuste feito pelo calendário.
    await tx.obrigacao.update({ where: { id: oc.obrigacaoId }, data: {
      dataInicio: data.dataInicio, dataFim: data.dataFim,
      ...(oc.obrigacao.tipo === "TAREFA" ? { dataVencimento: data.dataFim, diaVencimento: data.dataFim.getUTCDate() } : {}),
    } });
  }
  return atualizada;
  };
  try {
    return await (db.$transaction ? db.$transaction(executar) : executar(db));
  } catch (err) {
    if (err?.code === "P2002") {
      throw new ObrigacaoError("prazo_em_uso", "Outra ocorrência preservada já usa esse vencimento. Escolha outro prazo; nenhuma ocorrência ou versão foi alterada.", 409);
    }
    throw err;
  }
}

export async function concluir({ portalIds, ocorrenciaId, userId = null }) {
  return prisma.$transaction(async tx => {
  let oc = await tx.ocorrenciaObrigacao.findUnique({
    where: { id: ocorrenciaId },
    include: { obrigacao: { select: { portalClientId: true, verificador: true } } },
  });
  if (oc) {
    await bloquearSerie(tx, oc.obrigacaoId);
    oc = await tx.ocorrenciaObrigacao.findUnique({ where: { id: ocorrenciaId }, include: { obrigacao: { select: { portalClientId: true, verificador: true } } } });
  }
  if (!oc || oc.canceladaEm || oc.foraDaRecorrencia || !portalIds.includes(oc.obrigacao.portalClientId)) {
    throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  }
  if (oc.obrigacao.verificador) {
    throw new ObrigacaoError(
      "conclusao_automatica",
      "Esta obrigação se conclui sozinha quando o sistema observa o serviço feito.",
      409,
    );
  }
  const atualizada = await tx.ocorrenciaObrigacao.update({
    where: { id: ocorrenciaId },
    data: { status: "CONCLUIDA", concluidaEm: new Date(), concluidaPorId: userId, fonteConclusao: "MANUAL" },
  });
  return atualizada;
  });
}

export async function reabrir({ portalIds, ocorrenciaId }) {
  return prisma.$transaction(async tx => {
  let oc = await tx.ocorrenciaObrigacao.findUnique({
    where: { id: ocorrenciaId },
    include: { obrigacao: { select: { portalClientId: true } } },
  });
  if (oc) {
    await bloquearSerie(tx, oc.obrigacaoId);
    oc = await tx.ocorrenciaObrigacao.findUnique({ where: { id: ocorrenciaId }, include: { obrigacao: { select: { portalClientId: true, verificador: true } } } });
  }
  if (!oc || oc.canceladaEm || oc.foraDaRecorrencia || !portalIds.includes(oc.obrigacao.portalClientId)) {
    throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  }
  return tx.ocorrenciaObrigacao.update({
    where: { id: ocorrenciaId },
    data: { status: "PENDENTE", concluidaEm: null, concluidaPorId: null, fonteConclusao: null },
  });
  });
}

/**
 * Conclui sozinhas as ocorrências cujo serviço o sistema CONSEGUE observar.
 *
 * O calendário já dizia, no seu próprio cabeçalho, que agenda alimentada à mão envelhece e ninguém
 * confia. Pedir clique para confirmar algo que está gravado no banco é isso. Aqui o estado do
 * sistema é a fonte, e o contador não marca nada.
 *
 * Só olha PENDENTE: reabrir à mão uma que o verificador já concluiu voltaria a fechar no próximo
 * ciclo — mas isso é coerente, porque a apuração continua transmitida.
 */
export async function aplicarVerificadores({ portalIds = null } = {}) {
  const pendentes = await prisma.ocorrenciaObrigacao.findMany({
    where: {
      status: "PENDENTE",
      canceladaEm: null,
      foraDaRecorrencia: false,
      competenciaRef: { not: null },
      obrigacao: {
        ativa: true,
        verificador: { not: null },
        ...(portalIds ? { portalClientId: { in: portalIds } } : {}),
      },
    },
    include: { obrigacao: { select: { portalClientId: true, verificador: true } } },
  });
  if (!pendentes.length) return { concluidas: 0 };

  const porCompetencia = new Map();
  for (const oc of pendentes) {
    const chave = `${oc.obrigacao.portalClientId}|${oc.competenciaRef}`;
    if (!porCompetencia.has(chave)) porCompetencia.set(chave, []);
    porCompetencia.get(chave).push(oc);
  }

  const clientes = [...new Set(pendentes.map((o) => o.obrigacao.portalClientId))];
  const competencias = [...new Set(pendentes.map((o) => o.competenciaRef))];

  // Duas queries para todo o conjunto, no molde de `GET /firm/companies/annual` — não uma por
  // ocorrência.
  const [snapshots, circulares] = await Promise.all([
    prisma.apuracaoSnapshot.findMany({
      where: { portalClientId: { in: clientes }, competencia: { in: competencias } },
      select: { portalClientId: true, competencia: true, estado: true },
    }),
    prisma.companyMonthlyCircular.findMany({
      where: { portalClientId: { in: clientes }, competencia: { in: competencias } },
      select: { portalClientId: true, competencia: true, fechadoContabilEm: true },
    }),
  ]);

  const APURADA = new Set(["transmitida", "confirmada"]);
  const transmitidas = new Set(
    snapshots.filter((s) => APURADA.has(String(s.estado || ""))).map((s) => `${s.portalClientId}|${s.competencia}`),
  );
  const fechadas = new Set(
    circulares.filter((c) => c.fechadoContabilEm).map((c) => `${c.portalClientId}|${c.competencia}`),
  );

  const aConcluir = [];
  for (const [chave, ocorrencias] of porCompetencia) {
    for (const oc of ocorrencias) {
      const v = oc.obrigacao.verificador;
      const feito =
        (v === "APURACAO_TRANSMITIDA" && transmitidas.has(chave)) ||
        (v === "MES_FECHADO" && fechadas.has(chave));
      if (feito) aConcluir.push(oc.id);
    }
  }
  if (!aConcluir.length) return { concluidas: 0 };

  await prisma.ocorrenciaObrigacao.updateMany({
    where: { id: { in: aConcluir }, canceladaEm: null, foraDaRecorrencia: false },
    data: { status: "CONCLUIDA", concluidaEm: new Date(), fonteConclusao: "AUTOMATICA" },
  });
  return { concluidas: aConcluir.length };
}

/** Ocorrências do mês, no formato que o calendário consome (mesma forma dos outros itens do dia). */
export async function ocorrenciasDoPeriodo({ portalIds, inicio, fim, companyId = null }, db = prisma) {
  const alvos = companyId ? portalIds.filter((id) => id === companyId) : portalIds;
  if (!alvos.length) return [];
  const hoje = hojeUTC();

  const ocorrencias = await db.ocorrenciaObrigacao.findMany({
    where: {
      canceladaEm: null,
      foraDaRecorrencia: false,
      OR: [
        { dataInicio: { lt: fim }, dataFim: { gte: inicio } },
        { dataInicio: null, dataVencimento: { gte: inicio, lt: fim } },
      ],
      obrigacao: { ativa: true, portalClientId: { in: alvos } },
    },
    include: {
      obrigacao: {
        select: {
          id: true, nome: true, tipo: true, descricao: true, categoria: true, cor: true, verificador: true,
          regraId: true, portalClientId: true,
          // ⚠ Os dois abaixo são o que permite a tela sair de 3 estados (pendente/vencida/
          // concluída) para o CICLO de 4 (aguardando → aberta → urgente → transmitida).
          // `antecedenciaLembreteDias` é a janela DECLARADA pelo escritório: sem ela a tela teria
          // de cravar um número de dias, que numa obrigação mensal deixaria tudo urgente o mês
          // inteiro. `periodicidade` distingue a anual, que é a que aparece na listagem principal.
          periodicidade: true, antecedenciaLembreteDias: true,
          portalClient: { select: { razao: true } },
        },
      },
    },
  });

  return ocorrencias.map((oc) => ({
    tipo: "obrigacao",
    natureza: oc.obrigacao.tipo || "OBRIGACAO",
    id: oc.id,
    obrigacaoId: oc.obrigacao.id,
    // Chave de agrupamento do calendário: uma regra do escritório aplicada a 38 empresas geraria
    // 38 chips no mesmo dia. O `nome` sozinho NÃO serve — duas empresas podem ter obrigações de
    // mesmo nome vindas de regras diferentes, e agrupar juntaria coisas que não são a mesma.
    // Campo aditivo: quem já consome a lista plana não muda.
    grupoChave: oc.obrigacao.regraId || `nome:${String(oc.obrigacao.nome || "").trim().toLowerCase()}`,
    titulo: oc.obrigacao.nome,
    descricao: oc.obrigacao.descricao || null,
    categoria: oc.obrigacao.categoria,
    cor: oc.obrigacao.cor,
    periodicidade: oc.obrigacao.periodicidade,
    antecedenciaLembreteDias: oc.obrigacao.antecedenciaLembreteDias,
    companyId: oc.obrigacao.portalClientId,
    empresa: oc.obrigacao.portalClient?.razao || null,
    competencia: oc.competenciaRef,
    data: paraISO(oc.dataVencimento),
    dataVencimento: paraISO(oc.dataVencimento),
    dataInicio: paraISO(oc.dataInicio || oc.dataVencimento),
    dataFim: paraISO(oc.dataFim || oc.dataVencimento),
    situacao: situacaoDaOcorrencia(oc, hoje),
    // O calendário risca o que está resolvido — mesma convenção da guia paga.
    resolvido: oc.status === "CONCLUIDA",
    conclusaoAutomatica: Boolean(oc.obrigacao.verificador),
    fonteConclusao: oc.fonteConclusao,
  }));
}

/** Data do lembrete de uma ocorrência (aviso interno, não prazo legal). */
export function competenciaDeHoje() {
  const h = hojeUTC();
  return `${h.getUTCFullYear()}-${pad2(h.getUTCMonth() + 1)}`;
}
