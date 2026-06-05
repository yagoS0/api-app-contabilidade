// Q12.C.5 (2/3): orquestra transmissão PGDAS-D ao SERPRO.
//
// Fluxo:
//   1. Carrega Apuracao (precisa estado "revisada")
//   2. Resolve cert escritório (SERPRO) — IGUAL captura SERPRO já existente,
//      reusa SerproProcurationService padrão
//   3. Monta payload PGDAS-D a partir da Apuracao + receitaPorAnexo
//   4. Chama SerproPgdasdService.transmitirDeclaracao
//   5. Parse retorno: numeroDeclaracao, recibo, valor DAS
//   6. Atualiza Apuracao → estado "transmitida" + persiste IDs
//   7. Audit log em FiscalExecutionLog
//
// Idempotência: o idempotencyKey da Apuracao + SERPRO interno (mesma
// declaração + mesmo PA = retorna a existente). Se cStat de "duplicidade"
// → trata como sucesso, atualiza com retorno existente.

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  SerproPgdasdService,
  SERPRO_PGDASD_SERVICE_TRANSDECLARACAO,
} from "../../fiscal/serpro/SerproPgdasdService.js";
import { getResolvedSerproCredentials } from "../../fiscal/serpro/SerproRuntimeSettings.js";

// Mapeamento dos códigos de atividade PGDAS-D conforme tabela SERPRO:
//   1 = Receita de revenda de mercadorias (Anexo I)
//   2 = Receita de venda de produção industrial (Anexo II)
//   3 = Receita decorrente da locação de bens móveis (Anexo III)
//   4 = Receita de prestação de serviços (Anexo III)
//   5 = Receita de prestação de serviços (Anexo IV)
//   6 = Receita de prestação de serviços (Anexo V)
//   ... (existem mais sub-tipos pra ICMS-ST, ISS retido, exportação etc — fase atual ignora)
const ID_ATIVIDADE_POR_ANEXO = {
  III: 4,   // serviços comuns no III
  IV: 5,
  V: 6,
};

export class ApuracaoTransmissaoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Monta o payload PGDAS-D a partir da Apuracao calculada.
 *
 * Versão MÍNIMA — cobre o caso típico Simples Nacional com receita de
 * serviços (LENTE/Medical Marketing). Versão completa precisaria:
 *   - múltiplos estabelecimentos (filial)
 *   - ICMS-ST / ISS retido / exportação
 *   - retenções na fonte
 *   - imunidade/isenção/redução
 * Estes campos ficam pra fase futura quando necessário.
 */
function buildPayloadPgdasd({ apuracao, contribuinteCnpj }) {
  const periodoApuracaoStr = String(apuracao.competencia).replace("-", ""); // "2026-05" → "202605"
  const receitaPorAnexo = apuracao.receitaPorAnexo || {};

  // Atividades: 1 entrada por anexo com receita > 0
  const atividades = [];
  for (const [anexo, valor] of Object.entries(receitaPorAnexo)) {
    const v = Number(valor);
    if (!Number.isFinite(v) || v <= 0) continue;
    const idAtividade = ID_ATIVIDADE_POR_ANEXO[anexo];
    if (!idAtividade) continue; // DEFAULT, Anexo I/II (não suportado ainda)
    atividades.push({
      idAtividade,
      valorAtividade: +v.toFixed(2),
      receitasAtividade: [{
        valor: +v.toFixed(2),
        municipio: 0,         // 0 = sem município específico (serviço genérico)
        // outras flags (ISS retido, ST, etc) — não preenchidas nessa fase
      }],
    });
  }

  if (atividades.length === 0) {
    throw new ApuracaoTransmissaoError("NO_RECEITA",
      "Apuração sem receita por anexo válida. Verifique se os itens foram classificados.");
  }

  return {
    tipoDeclaracao: 1, // 1 = original; 2 = retificadora
    receitaPaCompetenciaInterno: +Number(apuracao.receitaMes).toFixed(2),
    receitaPaCompetenciaExterno: 0, // exportação — não suportado nessa fase
    estabelecimentos: [{
      cnpjCompleto: contribuinteCnpj,
      atividades,
    }],
    // Outros campos opcionais não preenchidos (folha, retenção, isenção, etc).
    _periodoApuracao: periodoApuracaoStr, // só pro nosso log; SERPRO não usa
  };
}

/**
 * Parseia o retorno do SERPRO TRANSDECLARACAO15.
 * Retorno típico: { dadosSaida: "JSON string" } ou similar.
 */
function parseRetornoTransmissao(raw) {
  // O Integra Contador devolve `dadosSaida` como string JSON com o resultado real.
  let dadosSaida = raw?.dadosSaida;
  if (typeof dadosSaida === "string") {
    try { dadosSaida = JSON.parse(dadosSaida); } catch { /* mantém string */ }
  }
  // Campos típicos no retorno PGDAS-D:
  //   numeroDeclaracao, dataHoraTransmissao, valorDevidoDAS, valorTotalDeclarado, nProtocolo
  const numeroDeclaracao =
    dadosSaida?.numeroDeclaracao || dadosSaida?.numero || dadosSaida?.declaracao?.numero || null;
  const reciboNumero =
    dadosSaida?.nProtocolo || dadosSaida?.recibo || dadosSaida?.numeroRecibo || null;
  const dasValor =
    dadosSaida?.valorDevidoDAS || dadosSaida?.valorTotalDevido || null;
  const mensagens =
    raw?.mensagens || dadosSaida?.mensagens || [];

  return { numeroDeclaracao, reciboNumero, dasValor, mensagens, rawDadosSaida: dadosSaida };
}

/**
 * Detecta cStat de duplicidade (declaração já transmitida).
 * SERPRO retorna mensagens com código tipo "[Aviso-PGDAS-D-MSG004]" etc.
 */
function isDuplicidade(mensagens) {
  if (!Array.isArray(mensagens)) return false;
  return mensagens.some((m) => {
    const code = String(m?.codigo || m?.code || "").toUpperCase();
    const text = String(m?.texto || m?.mensagem || "").toLowerCase();
    return code.includes("DUPLICID") || text.includes("já transmitida") || text.includes("ja transmitida");
  });
}

/**
 * Transmite a apuração de UMA empresa/competência.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {string} opts.competencia YYYY-MM
 * @param {string} [opts.userId] — pra audit log
 * @returns {Promise<{ok, apuracaoId, estado, numeroDeclaracao, reciboNumero, dasValor, message?}>}
 */
export async function transmitirApuracao({ portalClientId, competencia, userId }) {
  // 1. Carrega Apuracao
  const apuracao = await prisma.apuracao.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (!apuracao) {
    throw new ApuracaoTransmissaoError("APURACAO_NOT_FOUND",
      `Apuração não encontrada pra ${competencia}. Calcule primeiro.`);
  }
  if (apuracao.estado !== "revisada") {
    throw new ApuracaoTransmissaoError("INVALID_STATE",
      `Apuração está em "${apuracao.estado}", precisa estar "revisada" pra transmitir.`,
      { currentState: apuracao.estado });
  }

  // 2. Resolve cert escritório (SERPRO config — mesmo cert usado pra PGDAS consulta)
  const creds = await getResolvedSerproCredentials().catch((err) => {
    throw new ApuracaoTransmissaoError("OFFICE_CERT_NOT_CONFIGURED",
      `Cert do escritório não configurado: ${err?.message || err}`);
  });
  if (!creds?.certificate?.hasCertificate) {
    throw new ApuracaoTransmissaoError("OFFICE_CERT_NOT_CONFIGURED",
      "Cert do escritório não configurado em Configurações da Firma → SERPRO.");
  }
  const contratanteCnpj = String(creds.certificate.document || "").replace(/\D+/g, "");
  if (contratanteCnpj.length !== 14) {
    throw new ApuracaoTransmissaoError("INVALID_CONTRATANTE_CNPJ",
      "CNPJ do contratante (escritório) inválido — confira cert no SERPRO");
  }

  // 3. CNPJ do contribuinte (cliente)
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { cnpj: true, razao: true },
  });
  const contribuinteCnpj = String(portal?.cnpj || "").replace(/\D+/g, "");
  if (contribuinteCnpj.length !== 14) {
    throw new ApuracaoTransmissaoError("INVALID_CONTRIBUINTE_CNPJ",
      `CNPJ inválido pra empresa ${portal?.razao || portalClientId}`);
  }

  // 4. Monta payload
  const declaracao = buildPayloadPgdasd({ apuracao, contribuinteCnpj });

  // 5. Audit start
  const startedAt = Date.now();
  const execLog = await prisma.fiscalExecutionLog.create({
    data: {
      portalClientId,
      competencia,
      action: "pgdasd_transmitir",
      status: "running",
      triggeredBy: userId || null,
    },
  }).catch(() => null);

  // 6. Transmite
  const service = new SerproPgdasdService();
  let raw;
  try {
    raw = await service.transmitirDeclaracao({
      contratanteCnpj, contribuinteCnpj,
      periodoApuracao: competencia,
      declaracao,
    });
  } catch (err) {
    const errorMsg = `[${err?.code || "SERPRO_ERR"}] ${err?.message || err}`.slice(0, 500);
    await prisma.apuracao.update({
      where: { id: apuracao.id },
      data: { estado: "erro", erroMensagem: errorMsg },
    });
    if (execLog) {
      await prisma.fiscalExecutionLog.update({
        where: { id: execLog.id },
        data: { status: "failed", completedAt: new Date(), durationMs: Date.now() - startedAt, errorMessage: errorMsg },
      }).catch(() => null);
    }
    throw err;
  }

  // 7. Parse retorno
  const parsed = parseRetornoTransmissao(raw);
  const duplicidade = isDuplicidade(parsed.mensagens);

  // 8. Atualiza Apuracao
  const updated = await prisma.apuracao.update({
    where: { id: apuracao.id },
    data: {
      estado: "transmitida",
      numeroDeclaracao: parsed.numeroDeclaracao,
      reciboNumero: parsed.reciboNumero,
      dasValor: parsed.dasValor ? Number(parsed.dasValor) : null,
      transmitidoEm: new Date(),
      erroMensagem: null,
    },
  });

  // 9. Audit success
  if (execLog) {
    await prisma.fiscalExecutionLog.update({
      where: { id: execLog.id },
      data: {
        status: duplicidade ? "skipped" : "completed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        skipReason: duplicidade ? "ja_transmitida_antes" : null,
      },
    }).catch(() => null);
  }

  return {
    ok: true,
    apuracaoId: updated.id,
    estado: updated.estado,
    numeroDeclaracao: parsed.numeroDeclaracao,
    reciboNumero: parsed.reciboNumero,
    dasValor: parsed.dasValor,
    duplicidade,
    mensagens: parsed.mensagens,
  };
}

export { ID_ATIVIDADE_POR_ANEXO };
