// Q12.C.6: conferência pós-transmissão via SERPRO CONSDECLARACAO13.
//
// Fluxo:
//   1. Apuracao precisa estar em estado "transmitida" (ou "confirmada" — re-conferência)
//   2. Resolve cert escritório
//   3. Chama SerproPgdasdService.consultarDeclaracaoIndice(periodoApuracao)
//   4. Parseia o índice — pega a declaração ATIVA mais recente (ignora retificadas)
//   5. Compara:
//        a) numeroDeclaracao retornado bate com Apuracao.numeroDeclaracao?
//        b) valorDevidoDAS retornado bate com Apuracao.dasValor (tolerância 0,01)?
//   6. Tudo bate → estado=confirmada
//      Algo diverge → cria ApuracaoDivergencia (tipo=CONFERENCIA_*) sem mudar estado
//   7. Audit em FiscalExecutionLog (action="pgdasd_conferir")
//
// Idempotência: pode rodar N vezes; só cria divergência se ainda não existir
// com mesmo (tipo, esperado, obtido) pra essa apuração.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { SerproPgdasdService } from "../../fiscal/serpro/SerproPgdasdService.js";
import { getResolvedSerproCredentials } from "../../fiscal/serpro/SerproRuntimeSettings.js";

const TOLERANCIA_VALOR = 0.01;

export class ApuracaoConferenciaError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Parseia o índice de declarações retornado por CONSDECLARACAO13.
 * Formato típico (Integra Contador):
 *   { dadosSaida: "[{numeroDeclaracao, dataHoraTransmissao, situacao, ...}, ...]" }
 * Onde situacao pode ser ATIVA, RETIFICADA, etc.
 *
 * Estratégia: pega a declaração com situacao="ATIVA" (ou a mais recente
 * se faltar campo de situação).
 */
function parseIndiceDeclaracoes(raw) {
  let dadosSaida = raw?.dadosSaida;
  if (typeof dadosSaida === "string") {
    try { dadosSaida = JSON.parse(dadosSaida); } catch { dadosSaida = null; }
  }
  const lista = Array.isArray(dadosSaida)
    ? dadosSaida
    : Array.isArray(dadosSaida?.declaracoes)
      ? dadosSaida.declaracoes
      : Array.isArray(dadosSaida?.listaDeclaracoes)
        ? dadosSaida.listaDeclaracoes
        : [];

  if (lista.length === 0) {
    return { ativa: null, total: 0, raw: dadosSaida, mensagens: raw?.mensagens || [] };
  }

  // Tenta pegar a ATIVA primeiro; se nenhuma marcada, pega a com maior dataHora
  const ativas = lista.filter((d) => {
    const sit = String(d?.situacao || d?.status || "").toUpperCase();
    return sit === "ATIVA" || sit === "TRANSMITIDA" || sit === "";
  });
  const candidatas = ativas.length > 0 ? ativas : lista;
  const ordenadas = [...candidatas].sort((a, b) => {
    const da = String(a?.dataHoraTransmissao || a?.dataTransmissao || "");
    const db = String(b?.dataHoraTransmissao || b?.dataTransmissao || "");
    return db.localeCompare(da);
  });
  const ativa = ordenadas[0];
  return {
    ativa: {
      numeroDeclaracao: ativa?.numeroDeclaracao || ativa?.numero || null,
      valorDevidoDAS: ativa?.valorDevidoDAS || ativa?.valorTotalDevido || null,
      dataHoraTransmissao: ativa?.dataHoraTransmissao || ativa?.dataTransmissao || null,
      situacao: ativa?.situacao || ativa?.status || null,
      raw: ativa,
    },
    total: lista.length,
    raw: dadosSaida,
    mensagens: raw?.mensagens || [],
  };
}

async function registrarDivergenciaIdempotente(tx, { apuracaoId, tipo, esperado, obtido }) {
  const exists = await tx.apuracaoDivergencia.findFirst({
    where: { apuracaoId, tipo, esperado: esperado || null, obtido: obtido || null },
  });
  if (exists) return exists;
  return tx.apuracaoDivergencia.create({
    data: { apuracaoId, tipo, esperado: esperado || null, obtido: obtido || null },
  });
}

/**
 * Confere a apuração transmitida contra o extrato SERPRO.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia YYYY-MM
 * @param {string} [opts.userId]
 * @returns {Promise<{ok, estado, conferiu, divergencias, ativa}>}
 */
export async function conferirApuracao({ portalClientId, competencia, userId }) {
  const apuracao = await prisma.apuracao.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (!apuracao) {
    throw new ApuracaoConferenciaError("APURACAO_NOT_FOUND",
      `Apuração não encontrada pra ${competencia}.`);
  }
  if (apuracao.estado !== "transmitida" && apuracao.estado !== "confirmada") {
    throw new ApuracaoConferenciaError("INVALID_STATE",
      `Conferência exige estado "transmitida" ou "confirmada" — atual: "${apuracao.estado}".`,
      { currentState: apuracao.estado });
  }

  // Cert escritório
  const creds = await getResolvedSerproCredentials().catch((err) => {
    throw new ApuracaoConferenciaError("OFFICE_CERT_NOT_CONFIGURED",
      `Cert escritório não configurado: ${err?.message || err}`);
  });
  if (!creds?.certificate?.hasCertificate) {
    throw new ApuracaoConferenciaError("OFFICE_CERT_NOT_CONFIGURED",
      "Cert do escritório não configurado em Configurações da Firma → SERPRO.");
  }
  const contratanteCnpj = String(creds.certificate.document || "").replace(/\D+/g, "");

  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { cnpj: true, razao: true },
  });
  const contribuinteCnpj = String(portal?.cnpj || "").replace(/\D+/g, "");
  if (contribuinteCnpj.length !== 14) {
    throw new ApuracaoConferenciaError("INVALID_CONTRIBUINTE_CNPJ",
      `CNPJ inválido pra empresa ${portal?.razao || portalClientId}`);
  }

  // Audit start
  const startedAt = Date.now();
  const execLog = await prisma.fiscalExecutionLog.create({
    data: {
      portalClientId, competencia,
      action: "pgdasd_conferir",
      status: "running",
      triggeredBy: userId || null,
    },
  }).catch(() => null);

  // Consulta índice
  const service = new SerproPgdasdService();
  let raw;
  try {
    raw = await service.consultarDeclaracaoIndice({
      contratanteCnpj, contribuinteCnpj, periodoApuracao: competencia,
    });
  } catch (err) {
    const errorMsg = `[${err?.code || "SERPRO_ERR"}] ${err?.message || err}`.slice(0, 500);
    if (execLog) {
      await prisma.fiscalExecutionLog.update({
        where: { id: execLog.id },
        data: { status: "failed", completedAt: new Date(), durationMs: Date.now() - startedAt, errorMessage: errorMsg },
      }).catch(() => null);
    }
    throw err;
  }

  const parsed = parseIndiceDeclaracoes(raw);
  const divergencias = [];

  await prisma.$transaction(async (tx) => {
    // Caso 1: SERPRO não retornou nenhuma declaração ativa
    if (!parsed.ativa) {
      const d = await registrarDivergenciaIdempotente(tx, {
        apuracaoId: apuracao.id,
        tipo: "CONFERENCIA_SEM_DECLARACAO_ATIVA",
        esperado: apuracao.numeroDeclaracao || "qualquer ativa",
        obtido: "nenhuma",
      });
      divergencias.push(d);
      return;
    }

    // Caso 2: numeroDeclaracao diverge
    const esperadoNum = String(apuracao.numeroDeclaracao || "").trim();
    const obtidoNum = String(parsed.ativa.numeroDeclaracao || "").trim();
    if (esperadoNum && obtidoNum && esperadoNum !== obtidoNum) {
      const d = await registrarDivergenciaIdempotente(tx, {
        apuracaoId: apuracao.id,
        tipo: "CONFERENCIA_NUMERO_DECLARACAO",
        esperado: esperadoNum,
        obtido: obtidoNum,
      });
      divergencias.push(d);
    }

    // Caso 3: valor DAS diverge
    const esperadoValor = Number(apuracao.dasValor || 0);
    const obtidoValor = Number(parsed.ativa.valorDevidoDAS || 0);
    if (esperadoValor > 0 && obtidoValor > 0
        && Math.abs(esperadoValor - obtidoValor) > TOLERANCIA_VALOR) {
      const d = await registrarDivergenciaIdempotente(tx, {
        apuracaoId: apuracao.id,
        tipo: "CONFERENCIA_VALOR_DAS",
        esperado: esperadoValor.toFixed(2),
        obtido: obtidoValor.toFixed(2),
      });
      divergencias.push(d);
    }

    // Se nada divergiu → confirmada
    if (divergencias.length === 0) {
      await tx.apuracao.update({
        where: { id: apuracao.id },
        data: { estado: "confirmada", erroMensagem: null },
      });
    }
  });

  const conferiu = divergencias.length === 0;

  if (execLog) {
    await prisma.fiscalExecutionLog.update({
      where: { id: execLog.id },
      data: {
        status: conferiu ? "completed" : "completed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        skipReason: conferiu ? null : `divergencias=${divergencias.length}`,
      },
    }).catch(() => null);
  }

  return {
    ok: true,
    estado: conferiu ? "confirmada" : apuracao.estado,
    conferiu,
    divergencias: divergencias.length,
    totalDeclaracoesNoSerpro: parsed.total,
    ativa: parsed.ativa,
    mensagens: parsed.mensagens,
  };
}
