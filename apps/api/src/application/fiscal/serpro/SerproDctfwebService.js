import { Buffer } from "node:buffer";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { createOrUpdateGuideFromProcessing, hashPdf, toGuideResponse } from "../../guides/GuideService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";
import { parseArrecadacaoComposicao } from "./parseArrecadacao.js";
import { gravarAcrescimoCircular } from "../circularAcrescimos.js";
import { parseDctfwebDeclaracao } from "./parseDctfwebDeclaracao.js";

const SERPRO_DCTFWEB_SYSTEM = "DCTFWEB";
const SERPRO_DCTFWEB_SERVICE_RECEIPT = "CONSRECIBO32";
const SERPRO_DCTFWEB_SERVICE_GUIDE = "GERARGUIA31";
// Módulo Fiscal M2 (spike, NÃO VALIDADO): consulta da declaração completa DCTFWeb.
// [CONFIRMAR] idServico/payload no catálogo SERPRO — por isso o probe retorna cru.
const SERPRO_DCTFWEB_SERVICE_DECL_COMPLETA = "CONSDECCOMPLETA33";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function parseNestedJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input === "string") {
    const parsed = parseNestedJsonString(input);
    if (parsed) return searchValueDeep(parsed, matcher);
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    if (typeof value === "string") {
      const parsed = parseNestedJsonString(value);
      if (parsed != null) {
        const nestedFound = searchValueDeep(parsed, matcher);
        if (nestedFound != null) return nestedFound;
      }
    }
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function parseDecimal(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function parsePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00.000Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractPdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/pdf|arquivo|documento/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function isDefinitelyNotTransmitted(payload) {
  const value = searchValueDeep(payload, (key, val) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(recib|protoc|transmiss|declar)/.test(normalized)) return false;
    return typeof val === "string" || typeof val === "number";
  });
  if (value == null) return false;
  return /nao|não|inexist|ausente|pendente|nao transmit|não transmit/i.test(String(value));
}

function extractAmount(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(valor.*total|valortotal|total|vlr|valor)/.test(normalized) && parseDecimal(value) != null;
  });
  return parseDecimal(raw);
}

function extractDueDate(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /venc/.test(normalized) && typeof value === "string";
  });
  return parsePossibleDate(raw);
}

// Q40: número do documento (DARF/guia) para confirmar o pagamento via PAGTOWEB depois.
function extractDocumentNumber(payload, rawText = "") {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(numerodocumento|numerodarf|numeroguia|nrodocumento|numero.*documento|documento.*arrecad)/.test(normalized)) {
      return false;
    }
    return typeof value === "string" || typeof value === "number";
  });
  if (raw != null && String(raw).trim()) return String(raw).trim();
  // Fallback: procura no texto do PDF um "Número do Documento" seguido de dígitos.
  const fromText = String(rawText || "").match(/n[uú]mero\s+do\s+documento\D{0,10}([0-9.\-/]{6,})/i)?.[1];
  return fromText ? fromText.replace(/\s+/g, "").trim() : null;
}

function buildDctfwebPayload({ competencia, idServico }) {
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) {
    const err = new Error("competencia_invalida");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  const [year, month] = normalized.split("-");
  return {
    pedidoDados: {
      idSistema: SERPRO_DCTFWEB_SYSTEM,
      idServico,
      versaoSistema: "1.0",
      dados: JSON.stringify({ categoria: "GERAL_MENSAL", anoPA: year, mesPA: month }),
    },
  };
}

/**
 * SPIKE M2 (read-only, NÃO VALIDADO) — probe da Consultar Declaração Completa (CONSDECCOMPLETA33).
 *
 * Serviço de /Consultar (leitura): NÃO transmite, NÃO confessa, NÃO emite. Só lê o que já
 * está na Receita. Objetivo: descobrir se os débitos vêm como DADO ESTRUTURADO ou só PDF.
 * NÃO persiste nada — devolve a resposta CRUA + um resumo pra inspeção.
 *
 * @param {Object} opts
 * @param {string} opts.contribuinteCnpj — CNPJ da empresa (contribuinte)
 * @param {string} opts.competencia — YYYY-MM
 * @param {string} [opts.categoria="GERAL_MENSAL"]
 * @param {string} [opts.idServico=CONSDECCOMPLETA33]
 * @param {Object} [opts.dadosOverride] — sobrescreve o objeto `dados` (pra iterar no spike)
 */
export async function probeConsultarDeclaracaoCompleta({
  contribuinteCnpj,
  competencia,
  categoria = "GERAL_MENSAL",
  idServico = SERPRO_DCTFWEB_SERVICE_DECL_COMPLETA,
  dadosOverride,
} = {}) {
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(runtime?.certificate?.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const cnpj = onlyDigits(contribuinteCnpj);
  const normalized = normalizeCompetencia(competencia);
  const [year, month] = String(normalized || "-").split("-");
  const dados = dadosOverride ?? { categoria, anoPA: year, mesPA: month };

  const client = new SerproHttpClient();
  const res = await client.post(
    "/Consultar",
    {
      contratante: { numero: procuradorCnpj, tipo: 2 },
      autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
      contribuinte: { numero: cnpj, tipo: 2 },
      pedidoDados: { idSistema: SERPRO_DCTFWEB_SYSTEM, idServico, versaoSistema: "1.0", dados: JSON.stringify(dados) },
    },
    { raw: true, validateStatus: () => true }
  );

  const envelope = res?.data ?? res ?? null;
  const pdf = extractPdfBase64(envelope);
  const dadosBruto = envelope && typeof envelope === "object" ? envelope.dados ?? null : null;
  const dadosParsed = parseNestedJsonString(dadosBruto);

  // "Estruturado" de verdade = parsed tem chave que NÃO é PDF/arquivo/documento.
  const nonPdfKeys = dadosParsed && typeof dadosParsed === "object"
    ? Object.keys(dadosParsed).filter((k) => !/pdf|arquivo|documento|base64/i.test(k))
    : [];
  const temDadosEstruturados = nonPdfKeys.length > 0;

  // Extrai o TEXTO do PDF pra avaliarmos se os débitos são parseáveis.
  let pdfTexto = null;
  let pdfTextoErro = null;
  if (pdf) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(Buffer.from(String(pdf), "base64"));
      pdfTexto = String(parsed?.text || "").slice(0, 6000);
    } catch (e) {
      pdfTextoErro = e?.message || "falha ao extrair texto do PDF";
    }
  }

  return {
    verificadoTrial: false, // spike — contrato NÃO validado no catálogo SERPRO
    idServico,
    httpStatus: res?.status ?? null,
    enviado: { idSistema: SERPRO_DCTFWEB_SYSTEM, idServico, dados },
    temPdf: Boolean(pdf),
    pdfLength: pdf ? String(pdf).length : 0,
    temDadosEstruturados,
    dadosKeys: dadosParsed && typeof dadosParsed === "object" ? Object.keys(dadosParsed) : [],
    nonPdfKeys,
    pdfTexto,
    pdfTextoErro,
    mensagens: envelope && typeof envelope === "object" ? envelope.mensagens ?? null : null,
    envelopeKeys: envelope && typeof envelope === "object" ? Object.keys(envelope) : [],
    // dadosParsed omitido do retorno quando só tem PDF (base64 gigante) — ver pdfTexto.
    dadosParsed: temDadosEstruturados ? dadosParsed : "[só PDF — omitido; ver pdfTexto]",
  };
}

/**
 * Módulo Fiscal M2 — consulta a Declaração Completa DCTFWeb (Lucro Presumido) e devolve os
 * débitos parseados (principal por código). /Consultar (leitura, sem ato fiscal).
 * Sem PDF na resposta = declaração ainda não transmitida por terceiros → estado NORMAL (erro tratável).
 */
export async function consultarDeclaracaoCompletaLp({ contribuinteCnpj, competencia }) {
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(runtime?.certificate?.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const cnpj = onlyDigits(contribuinteCnpj);
  const normalized = normalizeCompetencia(competencia);
  if (!normalized) {
    const err = new Error("competencia_invalida");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  const [year, month] = normalized.split("-");

  const client = new SerproHttpClient();
  const res = await client.post(
    "/Consultar",
    {
      contratante: { numero: procuradorCnpj, tipo: 2 },
      autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
      contribuinte: { numero: cnpj, tipo: 2 },
      pedidoDados: {
        idSistema: SERPRO_DCTFWEB_SYSTEM,
        idServico: SERPRO_DCTFWEB_SERVICE_DECL_COMPLETA,
        versaoSistema: "1.0",
        dados: JSON.stringify({ categoria: "GERAL_MENSAL", anoPA: year, mesPA: month }),
      },
    },
    { raw: true, validateStatus: () => true }
  );

  const envelope = res?.data ?? res ?? null;
  const pdf = extractPdfBase64(envelope);
  if (!pdf) {
    const err = new Error("dctfweb_declaracao_nao_transmitida");
    err.code = "SERPRO_DCTFWEB_LP_NAO_TRANSMITIDA";
    err.mensagens = envelope && typeof envelope === "object" ? envelope.mensagens : null;
    throw err;
  }
  const pdfParse = (await import("pdf-parse")).default;
  const texto = String((await pdfParse(Buffer.from(String(pdf), "base64")))?.text || "");
  const parsed = parseDctfwebDeclaracao(texto);
  return { ...parsed, competencia: normalized, cnpj };
}

/**
 * Módulo Fiscal M2 — emite o DARF DCTFWeb (GERARGUIA31) e devolve valor/vencimento/nº documento
 * + a composição (principal/multa/juros por código). Deriva da declaração já transmitida
 * (não confessa, não paga). Usado na captura do Lucro Presumido pra gerar a guia a pagar.
 */
export async function emitirDarfDctfweb({ contribuinteCnpj, competencia, categoria = "GERAL_MENSAL" }) {
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(runtime?.certificate?.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const cnpj = onlyDigits(contribuinteCnpj);
  const normalized = normalizeCompetencia(competencia);
  const [year, month] = String(normalized || "-").split("-");
  const client = new SerproHttpClient();
  const res = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: cnpj, tipo: 2 },
    pedidoDados: { idSistema: SERPRO_DCTFWEB_SYSTEM, idServico: SERPRO_DCTFWEB_SERVICE_GUIDE, versaoSistema: "1.0", dados: JSON.stringify({ categoria, anoPA: year, mesPA: month }) },
  });
  const mapped = await parsePdfResponse(res); // { pdfBuffer, numeroDocumento, composicao, parsed:{inssTotal,inssVencimento} }
  return {
    valor: mapped.parsed?.inssTotal ?? null,
    vencimento: mapped.parsed?.inssVencimento ?? null,
    numeroDocumento: mapped.numeroDocumento ?? null,
    composicao: mapped.composicao || { itens: [], totais: null },
    pdfBuffer: mapped.pdfBuffer,
  };
}

/**
 * SPIKE M2 (read-adjacent, NÃO persiste) — probe do Emitir DARF DCTFWeb (GERARGUIA31).
 *
 * /Emitir gera a guia a partir da declaração JÁ TRANSMITIDA — não envia info nova, não
 * confessa, não paga. É a MESMA operação que o app já faz em produção pro INSS. O probe
 * NÃO cria Guide nem salva PDF: só emite, extrai valor/vencimento/nº documento e devolve.
 *
 * Objetivo: descobrir a `categoria`/params certos pros débitos de LP (PIS/COFINS/IRPJ/CSLL).
 */
export async function probeEmitirDarfDctfweb({
  contribuinteCnpj,
  competencia,
  categoria = "GERAL_MENSAL",
  idServico = SERPRO_DCTFWEB_SERVICE_GUIDE,
  dadosOverride,
} = {}) {
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(runtime?.certificate?.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const cnpj = onlyDigits(contribuinteCnpj);
  const normalized = normalizeCompetencia(competencia);
  const [year, month] = String(normalized || "-").split("-");
  const dados = dadosOverride ?? { categoria, anoPA: year, mesPA: month };

  const client = new SerproHttpClient();
  const res = await client.post(
    "/Emitir",
    {
      contratante: { numero: procuradorCnpj, tipo: 2 },
      autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
      contribuinte: { numero: cnpj, tipo: 2 },
      pedidoDados: { idSistema: SERPRO_DCTFWEB_SYSTEM, idServico, versaoSistema: "1.0", dados: JSON.stringify(dados) },
    },
    { raw: true, validateStatus: () => true }
  );

  const envelope = res?.data ?? res ?? null;
  const pdf = extractPdfBase64(envelope);
  let parsed = null;
  let pdfTexto = null;
  let pdfTextoErro = null;
  let composicao = null;
  if (pdf) {
    try {
      const r = await parsePdfResponse(envelope); // parse puro (não salva no storage)
      parsed = { valor: r.parsed?.inssTotal ?? null, vencimento: r.parsed?.inssVencimento ?? null, numeroDocumento: r.numeroDocumento ?? null };
      composicao = r.composicao ?? null; // principal/multa/juros por código (do texto do DARF)
      pdfTexto = String(r.rawText || "").slice(0, 4000);
    } catch (e) {
      pdfTextoErro = e?.message || "falha ao parsear PDF do DARF";
    }
  }

  return {
    verificadoTrial: false,
    idServico,
    httpStatus: res?.status ?? null,
    enviado: { idSistema: SERPRO_DCTFWEB_SYSTEM, idServico, dados },
    temPdf: Boolean(pdf),
    pdfLength: pdf ? String(pdf).length : 0,
    parsed, // { valor, vencimento, numeroDocumento }
    composicao, // { itens: [{ codigo, principal, multa, juros, total, denominacao }], totais }
    pdfTexto,
    pdfTextoErro,
    mensagens: envelope && typeof envelope === "object" ? envelope.mensagens ?? null : null,
    envelopeKeys: envelope && typeof envelope === "object" ? Object.keys(envelope) : [],
  };
}

async function parsePdfResponse(response) {
  const pdfBase64 = extractPdfBase64(response);
  if (!pdfBase64) {
    const err = new Error("serpro_dctfweb_pdf_not_found");
    err.code = "SERPRO_DCTFWEB_PDF_NOT_FOUND";
    err.details = response;
    throw err;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  if (!pdfBuffer.length) {
    const err = new Error("serpro_dctfweb_pdf_invalid");
    err.code = "SERPRO_DCTFWEB_PDF_INVALID";
    err.details = response;
    throw err;
  }

  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(pdfBuffer);
  const rawText = String(pdfData?.text || "");

  const amountCandidates = [
    rawText.match(/(?:valor\s+total|total\s+a\s+pagar|valor\s+do\s+documento|valor)\D{0,20}(\d+[\d.]*,\d{2})/i)?.[1],
    rawText.match(/(?:r\$\s*)?(\d+[\d.]*,\d{2})/i)?.[1],
  ].filter(Boolean);

  const dueCandidates = [
    rawText.match(/(?:vencimento|data\s+de\s+vencimento)\D{0,20}(\d{2}\/\d{2}\/\d{4})/i)?.[1],
    rawText.match(/(\d{4}-\d{2}-\d{2})/i)?.[1],
  ].filter(Boolean);

  const inssTotal = extractAmount(response) ?? parseDecimal(amountCandidates[0]) ?? 0;
  const inssVencimento = extractDueDate(response) || parsePossibleDate(dueCandidates[0]);
  const numeroDocumento = extractDocumentNumber(response, rawText);

  return {
    pdfBuffer,
    rawText,
    numeroDocumento,
    // Frente B: composição principal/multa/juros por código (dado do PDF, antes descartado).
    composicao: parseArrecadacaoComposicao(rawText),
    parsed: {
      inssTotal,
      inssVencimento: inssVencimento ? inssVencimento.toISOString() : null,
    },
    rawPayload: response,
  };
}

export async function syncSerproInssForCompany({ portalClientId, competencia, contratanteCnpj, emailStatusOverride }) {
  const normalizedCompanyId = String(portalClientId || "").trim();
  const normalizedCompetencia = normalizeCompetencia(competencia);
  if (!normalizedCompanyId) {
    const err = new Error("portal_company_id_required");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!normalizedCompetencia) {
    const err = new Error("competencia_required");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }

  const portalClient = await prisma.portalClient.findUnique({
    where: { id: normalizedCompanyId },
    select: { id: true, cnpj: true, razao: true, companyId: true },
  });
  if (!portalClient) {
    const err = new Error("portal_company_not_found");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }

  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }

  const client = new SerproHttpClient();
  const receiptResponse = await client.post("/Consultar", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: portalClient.cnpj, tipo: 2 },
    ...buildDctfwebPayload({ competencia: normalizedCompetencia, idServico: SERPRO_DCTFWEB_SERVICE_RECEIPT }),
  });

  if (isDefinitelyNotTransmitted(receiptResponse)) {
    const circular = await prisma.companyMonthlyCircular.upsert({
      where: {
        portalClientId_competencia: {
          portalClientId: portalClient.id,
          competencia: normalizedCompetencia,
        },
      },
      create: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
        receitaBruta: 0,
        receitaServicos: 0,
        receitaVendas: 0,
        dasTotal: 0,
        inssTotal: 0,
        inssStatus: "NOT_TRANSMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: SERPRO_DCTFWEB_SYSTEM,
          servico: SERPRO_DCTFWEB_SERVICE_RECEIPT,
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          rawPayload: receiptResponse,
        },
      },
      update: {
        inssStatus: "NOT_TRANSMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: SERPRO_DCTFWEB_SYSTEM,
          servico: SERPRO_DCTFWEB_SERVICE_RECEIPT,
          contratanteCnpj: procuradorCnpj,
          contribuinteCnpj: portalClient.cnpj,
          rawPayload: receiptResponse,
        },
      },
    });

    return {
      company: { id: portalClient.id, razao: portalClient.razao, cnpj: portalClient.cnpj },
      circular,
      accounting: { ok: true, generatedEntries: [] },
      inss: { status: "NOT_TRANSMITTED", competencia: normalizedCompetencia },
      receiptResponse,
    };
  }

  const guideResponse = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: portalClient.cnpj, tipo: 2 },
    ...buildDctfwebPayload({ competencia: normalizedCompetencia, idServico: SERPRO_DCTFWEB_SERVICE_GUIDE }),
  });

  const mapped = await parsePdfResponse(guideResponse);
  const storage = GuideStorageService.create();
  const storageKey = `serpro/inss/${portalClient.id}/${normalizedCompetencia}/${Date.now()}.pdf`;
  const uploaded = await storage.upload({ key: storageKey, buffer: mapped.pdfBuffer, contentType: "application/pdf" });
  const now = new Date();

  const circular = await prisma.companyMonthlyCircular.upsert({
    where: {
      portalClientId_competencia: {
        portalClientId: portalClient.id,
        competencia: normalizedCompetencia,
      },
    },
    create: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      receitaBruta: 0,
      receitaServicos: 0,
      receitaVendas: 0,
      dasTotal: 0,
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento ? new Date(mapped.parsed.inssVencimento) : null,
      inssPdfFileId: uploaded.key,
      inssPdfUrl: uploaded.url,
      inssStatus: "EMITTED",
      metadata: {
        integrationSource: "SERPRO_DCTFWEB",
        sistema: SERPRO_DCTFWEB_SYSTEM,
        servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        rawPayload: mapped.rawPayload,
        rawText: mapped.rawText,
        capturedAt: now.toISOString(),
      },
    },
    update: {
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento ? new Date(mapped.parsed.inssVencimento) : null,
      inssPdfFileId: uploaded.key,
      inssPdfUrl: uploaded.url,
      inssStatus: "EMITTED",
      metadata: {
        integrationSource: "SERPRO_DCTFWEB",
        sistema: SERPRO_DCTFWEB_SYSTEM,
        servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
        contratanteCnpj: procuradorCnpj,
        contribuinteCnpj: portalClient.cnpj,
        rawPayload: mapped.rawPayload,
        rawText: mapped.rawText,
        capturedAt: now.toISOString(),
      },
    },
  });

  // Frente B: grava o split principal/juros/multa do INSS na circular (dado do PDF, antes descartado).
  // Guarda de sanidade: só grava se o total parseado bate com o total conhecido (evita split
  // errado caso o layout do PDF divirja do esperado). Se não bater, não grava (a provisão segue no total).
  const inssTot = mapped?.composicao?.totais;
  if (inssTot && Math.abs((Number(inssTot.total) || 0) - (Number(mapped.parsed.inssTotal) || 0)) < 0.02) {
    await gravarAcrescimoCircular({
      client: prisma,
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      valores: { INSS: { principal: inssTot.principal, juros: inssTot.juros, multa: inssTot.multa } },
    }).catch(() => {});
  }

  const inssSourceFileId = `serpro:dctfweb:${onlyDigits(portalClient.cnpj)}:${normalizedCompetencia}`;
  const existingInssGuide = await prisma.guide.findFirst({
    where: { sourceFileId: inssSourceFileId },
    select: { id: true, paymentStatus: true, paymentStatusSource: true, paymentConfirmedAt: true },
  });

  // Preserve existing payment status — emitir a guia no SERPRO não confirma pagamento
  const preservedPayment = existingInssGuide
    ? {
        paymentStatus: existingInssGuide.paymentStatus,
        paymentStatusSource: existingInssGuide.paymentStatusSource,
        paymentConfirmedAt: existingInssGuide.paymentConfirmedAt,
      }
    : { paymentStatus: "OPEN" };

  const guide = await createOrUpdateGuideFromProcessing({
    existingGuideId: existingInssGuide?.id || null,
    portalClientId: portalClient.id,
    legacyCompanyId: portalClient.companyId || null,
    parsed: {
      cnpj: portalClient.cnpj,
      competencia: normalizedCompetencia,
      tipo: "INSS",
      valor: mapped.parsed.inssTotal,
      vencimento: mapped.parsed.inssVencimento,
    },
    source: "SERPRO",
    sourceFileId: inssSourceFileId,
    sourcePath: `SERPRO DCTFWEB ${normalizedCompetencia}`,
    driveInboxFolderId: null,
    driveFinalFolderId: null,
    driveFinalFileId: null,
    pdfBytes: mapped.pdfBuffer,
    hash: hashPdf(mapped.pdfBuffer),
    status: "PROCESSED",
    errors: [],
    ...preservedPayment,
    emailStatusOverride,
    serproLastCheckedAt: now,
    serproLastCheckResult: "FOUND_INSS",
    serproLastSeenAt: now,
    serproService: SERPRO_DCTFWEB_SERVICE_GUIDE,
    extracted: {
      integrationSource: "SERPRO_DCTFWEB",
      sistema: SERPRO_DCTFWEB_SYSTEM,
      servico: SERPRO_DCTFWEB_SERVICE_GUIDE,
      numeroDocumento: mapped.numeroDocumento, // Q40: usado na confirmação de pagamento (PAGTOWEB)
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: portalClient.cnpj,
      referencia: normalizedCompetencia,
      rawPayload: mapped.rawPayload,
    },
  });

  await prisma.guide.deleteMany({
    where: {
      portalClientId: portalClient.id,
      competencia: normalizedCompetencia,
      tipo: "INSS",
      source: "SERPRO",
      status: "PROCESSED",
      NOT: { id: guide.id },
    },
  });

  return {
    company: { id: portalClient.id, razao: portalClient.razao, cnpj: portalClient.cnpj },
    guide: toGuideResponse(guide),
    circular,
    accounting: { ok: true, generatedEntries: [] },
    inss: {
      status: "EMITTED",
      competencia: normalizedCompetencia,
      inssTotal: mapped.parsed.inssTotal,
      inssVencimento: mapped.parsed.inssVencimento,
      pdfFileId: uploaded.key,
      pdfUrl: uploaded.url,
    },
    receiptResponse,
    guideResponse,
  };
}
