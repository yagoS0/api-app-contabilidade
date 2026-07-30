// Controle de Obrigações — o serviço que o escritório precisa fazer até uma data.
//
// NÃO é o vencimento da guia. Guia é o pagamento do CLIENTE e continua vindo de `Guide.vencimento`;
// obrigação é o trabalho do CONTADOR. Dois eixos, dois públicos, duas datas — por isso convivem no
// calendário sem nenhuma deduplicação entre si.
//
// Não existe catálogo pré-carregado: quem cadastra é o contador. Data de obrigação é dado fiscal
// que muda por ato normativo, e uma lista embutida colocaria prazo desatualizado na tela de todas
// as empresas de uma vez. Repetição entre empresas se resolve pela regra do escritório.

import { prisma } from "../../infrastructure/db/prisma.js";
import { criarConsultorDeFeriados, paraISO } from "./diaUtil.js";
import {
  AJUSTES_DIA_UTIL,
  PERIODICIDADES,
  calcularVencimentos,
} from "./gerarOcorrencias.js";

/** Janela rolante. 12 meses cobre o ano inteiro de qualquer periodicidade sem inchar a tabela. */
export const MESES_DA_JANELA = 12;

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

export function normalizarEntrada(dados = {}) {
  const nome = asTexto(dados.nome);
  if (!nome) throw new ObrigacaoError("nome_obrigatorio", "Dê um nome à obrigação.");

  const periodicidade = asTexto(dados.periodicidade).toUpperCase();
  if (!PERIODICIDADES.includes(periodicidade)) {
    throw new ObrigacaoError("periodicidade_invalida", "Escolha mensal, trimestral ou anual.");
  }

  const diaVencimento = Number(dados.diaVencimento);
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new ObrigacaoError("dia_vencimento_invalido", "O dia do vencimento vai de 1 a 31.");
  }

  const mesReferencia = dados.mesReferencia == null ? null : Number(dados.mesReferencia);
  if (periodicidade !== "MENSAL" && !(mesReferencia >= 1 && mesReferencia <= 12)) {
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
    categoria: asTexto(dados.categoria) || null,
    periodicidade,
    diaVencimento,
    mesReferencia: periodicidade === "MENSAL" ? null : mesReferencia,
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
 */
export async function sincronizarOcorrencias(obrigacaoId, db = prisma) {
  const obrigacao = await db.obrigacao.findUnique({ where: { id: obrigacaoId } });
  if (!obrigacao) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);

  const hoje = hojeUTC();

  if (!obrigacao.ativa) {
    // Inativar não apaga histórico: remove só o que ainda não venceu e não foi feito.
    const removidas = await db.ocorrenciaObrigacao.deleteMany({
      where: { obrigacaoId, status: "PENDENTE", dataVencimento: { gte: hoje } },
    });
    return { criadas: 0, removidas: removidas.count };
  }

  const ehFeriado = await carregarConsultorDeFeriados(obrigacao.portalClientId, db);
  const previstas = calcularVencimentos(
    obrigacao,
    { inicio: { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 }, quantidadeMeses: MESES_DA_JANELA },
    ehFeriado,
  );
  const previstasPorIso = new Map(previstas.map((p) => [p.iso, p]));

  const existentes = await db.ocorrenciaObrigacao.findMany({
    where: { obrigacaoId, dataVencimento: { gte: hoje } },
    select: { id: true, dataVencimento: true, status: true },
  });
  const existentesIso = new Set(existentes.map((o) => paraISO(o.dataVencimento)));

  const obsoletas = existentes
    .filter((o) => o.status === "PENDENTE" && !previstasPorIso.has(paraISO(o.dataVencimento)))
    .map((o) => o.id);
  if (obsoletas.length) {
    await db.ocorrenciaObrigacao.deleteMany({ where: { id: { in: obsoletas } } });
  }

  const novas = previstas.filter((p) => !existentesIso.has(p.iso));
  if (novas.length) {
    // `skipDuplicates` + o unique (obrigacaoId, dataVencimento): rodar de novo não duplica, o que
    // torna o worker mensal seguro de chamar quantas vezes for.
    await db.ocorrenciaObrigacao.createMany({
      data: novas.map((p) => ({
        obrigacaoId,
        dataVencimento: p.data,
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
  const obrigacao = await prisma.obrigacao.create({
    data: { ...limpo, portalClientId, criadoPorId },
  });
  const geradas = await sincronizarOcorrencias(obrigacao.id);
  return { obrigacao, ...geradas };
}

export async function atualizar({ portalIds, obrigacaoId, dados }) {
  // Escopo por LISTA de empresas visíveis, igual a `concluir`: a rota não precisa descobrir a
  // empresa antes de chamar, e uma obrigação de fora do escopo some como 404 em vez de 403 —
  // não confirmamos a existência de dado que o usuário não pode ver.
  const atual = await prisma.obrigacao.findFirst({
    where: { id: obrigacaoId, portalClientId: { in: portalIds } },
  });
  if (!atual) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);

  const limpo = normalizarEntrada({ ...atual, ...dados });
  const obrigacao = await prisma.obrigacao.update({
    where: { id: obrigacaoId },
    data: {
      ...limpo,
      // Editar na empresa uma obrigação que veio de regra a DESLIGA da regra: a partir daqui a
      // regra não sobrescreve mais. Sem isso, a próxima propagação apagaria a escolha local sem
      // avisar ninguém.
      ...(atual.regraId ? { sobrescritaLocal: true } : {}),
    },
  });
  const geradas = await sincronizarOcorrencias(obrigacao.id);
  return { obrigacao, ...geradas };
}

export async function remover({ portalIds, obrigacaoId }) {
  const atual = await prisma.obrigacao.findFirst({
    where: { id: obrigacaoId, portalClientId: { in: portalIds } },
  });
  if (!atual) throw new ObrigacaoError("nao_encontrada", "Obrigação não encontrada.", 404);
  // Cascade leva as ocorrências junto — inclusive as concluídas. É exclusão de verdade, pedida
  // explicitamente; quem só quer parar de gerar usa `ativa: false`.
  await prisma.obrigacao.delete({ where: { id: obrigacaoId } });
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
      portalClient: { select: { id: true, razao: true } },
      // Só o que interessa à tela: a próxima e as atrasadas. Trazer as 12 de cada obrigação
      // encheria a resposta de dado que ninguém lê.
      ocorrencias: {
        where: { OR: [{ status: "PENDENTE" }, { dataVencimento: { gte: hoje } }] },
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
      dataVencimento: paraISO(oc.dataVencimento),
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
      nome: o.nome,
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

export async function concluir({ portalIds, ocorrenciaId, userId = null }) {
  const oc = await prisma.ocorrenciaObrigacao.findUnique({
    where: { id: ocorrenciaId },
    include: { obrigacao: { select: { portalClientId: true, verificador: true } } },
  });
  if (!oc || !portalIds.includes(oc.obrigacao.portalClientId)) {
    throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  }
  if (oc.obrigacao.verificador) {
    throw new ObrigacaoError(
      "conclusao_automatica",
      "Esta obrigação se conclui sozinha quando o sistema observa o serviço feito.",
      409,
    );
  }
  const atualizada = await prisma.ocorrenciaObrigacao.update({
    where: { id: ocorrenciaId },
    data: { status: "CONCLUIDA", concluidaEm: new Date(), concluidaPorId: userId, fonteConclusao: "MANUAL" },
  });
  return atualizada;
}

export async function reabrir({ portalIds, ocorrenciaId }) {
  const oc = await prisma.ocorrenciaObrigacao.findUnique({
    where: { id: ocorrenciaId },
    include: { obrigacao: { select: { portalClientId: true } } },
  });
  if (!oc || !portalIds.includes(oc.obrigacao.portalClientId)) {
    throw new ObrigacaoError("nao_encontrada", "Ocorrência não encontrada.", 404);
  }
  return prisma.ocorrenciaObrigacao.update({
    where: { id: ocorrenciaId },
    data: { status: "PENDENTE", concluidaEm: null, concluidaPorId: null, fonteConclusao: null },
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
    where: { id: { in: aConcluir } },
    data: { status: "CONCLUIDA", concluidaEm: new Date(), fonteConclusao: "AUTOMATICA" },
  });
  return { concluidas: aConcluir.length };
}

/** Ocorrências do mês, no formato que o calendário consome (mesma forma dos outros itens do dia). */
export async function ocorrenciasDoPeriodo({ portalIds, inicio, fim, companyId = null }) {
  const alvos = companyId ? portalIds.filter((id) => id === companyId) : portalIds;
  if (!alvos.length) return [];
  const hoje = hojeUTC();

  const ocorrencias = await prisma.ocorrenciaObrigacao.findMany({
    where: {
      dataVencimento: { gte: inicio, lt: fim },
      obrigacao: { ativa: true, portalClientId: { in: alvos } },
    },
    include: {
      obrigacao: {
        select: {
          nome: true, categoria: true, cor: true, verificador: true, portalClientId: true,
          portalClient: { select: { razao: true } },
        },
      },
    },
  });

  return ocorrencias.map((oc) => ({
    tipo: "obrigacao",
    id: oc.id,
    titulo: oc.obrigacao.nome,
    categoria: oc.obrigacao.categoria,
    cor: oc.obrigacao.cor,
    companyId: oc.obrigacao.portalClientId,
    empresa: oc.obrigacao.portalClient?.razao || null,
    competencia: oc.competenciaRef,
    data: paraISO(oc.dataVencimento),
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
