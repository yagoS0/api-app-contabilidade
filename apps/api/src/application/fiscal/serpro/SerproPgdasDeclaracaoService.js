import { Buffer } from "node:buffer";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { GuideStorageService } from "../../guides/GuideStorageService.js";
import { generateEntriesFromCircular } from "../../accounting/AccountingEntryGeneratorService.js";
import { normalizeCompetencia } from "../../guides/guideContract.js";
import { markGuideOpenBySerpro, markGuidePaidBySerpro } from "../../guides/GuidePaymentStatusService.js";
import { capturePgdasGuideForCompany } from "./CaptureSerproGuidesService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";
import { SerproPgdasdService, SERPRO_PGDASD_SERVICE_NORMAL } from "./SerproPgdasdService.js";

const SERPRO_PGDASD_SERVICE_DECLARACAO = "CONSULTIMADECREC14";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeCompetenciaAaaamm(value) {
  const normalized = normalizeCompetencia(value);
  if (!normalized) return null;
  return normalized.replace("-", "");
}

function validateCompetenciaAaaamm(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    const err = new Error("Competência deve estar no formato AAAAMM.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  const month = Number(normalized.slice(4, 6));
  if (month < 1 || month > 12) {
    const err = new Error("Mês da competência inválido.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }
  return normalized;
}

function parseDecimal(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
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

function buildConsultarDeclaracaoPayload({ companyCnpj, competenciaAaaamm, contratanteCnpj }) {
  return {
    contratante: { numero: contratanteCnpj, tipo: 2 },
    autorPedidoDados: { numero: contratanteCnpj, tipo: 2 },
    contribuinte: { numero: onlyDigits(companyCnpj), tipo: 2 },
    pedidoDados: {
      idSistema: "PGDASD",
      idServico: SERPRO_PGDASD_SERVICE_DECLARACAO,
      versaoSistema: "1.0",
      dados: JSON.stringify({ periodoApuracao: competenciaAaaamm }),
    },
  };
}

function parseCompactDateTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}-03:00`);
}

function parseSerproJsonField(responseData) {
  const rawDados = typeof responseData?.dados === "string" ? responseData.dados.trim() : "";
  if (!rawDados) return null;
  try {
    return JSON.parse(rawDados);
  } catch {
    return null;
  }
}

function findDasIndexNode(input) {
  const node = searchValueDeep(input, (key, value) => /indice.*das/i.test(String(key || "")) && value && typeof value === "object");
  if (node && typeof node === "object") return node;
  return null;
}

function parseDasIndexResponse(responseData) {
  const dados = parseSerproJsonField(responseData);
  const indiceDas = findDasIndexNode(dados) || findDasIndexNode(responseData);
  if (!indiceDas) return null;
  const numeroDocumento = String(indiceDas.numeroDas || indiceDas.numeroDocumento || "").trim() || null;
  const dasPagoRaw = indiceDas.dasPago;
  const dasPago = dasPagoRaw === true || String(dasPagoRaw || "").trim().toLowerCase() === "true";
  const dataHoraEmissaoDas = parseCompactDateTime(indiceDas.dataHoraEmissaoDas || indiceDas.dataEmissaoDas || "");
  return {
    numeroDocumento,
    dasPago,
    dataHoraEmissaoDas: dataHoraEmissaoDas ? dataHoraEmissaoDas.toISOString() : null,
    rawDados: dados,
  };
}

async function tryEnsureDasGuideRecord(params) {
  try {
    const guide = await ensureDasGuideRecord(params);
    return { guide, error: null };
  } catch (error) {
    return {
      guide: null,
      error: {
        code: error?.code || "SERPRO_PGDASD_GUIDE_FETCH_FAILED",
        message: error?.message || "Falha ao baixar guia DAS no SERPRO.",
      },
    };
  }
}

async function ensureDasGuideRecord({ portalClientId, competencia, contratanteCnpj, dasIndex }) {
  let guide = await prisma.guide.findFirst({
    where: {
      portalClientId,
      competencia,
      tipo: "SIMPLES",
      source: "SERPRO",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!guide) {
    const captured = await capturePgdasGuideForCompany({
      portalClientId,
      competencia,
      contratanteCnpj,
      serviceId: SERPRO_PGDASD_SERVICE_NORMAL,
    });
    guide = await prisma.guide.findUnique({ where: { id: captured.guide.guideId } });
  }

  if (!guide) return null;

  if (dasIndex?.dasPago) {
    await markGuidePaidBySerpro({ guideId: guide.id });
  } else {
    await markGuideOpenBySerpro({ guideId: guide.id });
  }

  return prisma.guide.findUnique({ where: { id: guide.id } });
}

function parseSerproDados(responseData) {
  const rawDados = typeof responseData?.dados === "string" ? responseData.dados.trim() : "";
  if (!rawDados) {
    const notFoundMessage = Array.isArray(responseData?.mensagens)
      ? responseData.mensagens.find((item) => /não há declaração transmitida para o período informado/i.test(String(item?.texto || "")))
      : null;
    if (notFoundMessage) {
      return {
        notFound: true,
        message: String(notFoundMessage.texto || "").trim(),
      };
    }
    const err = new Error("SERPRO não retornou o campo dados.");
    err.code = "SERPRO_PGDASD_DADOS_NOT_FOUND";
    throw err;
  }
  try {
    return JSON.parse(rawDados);
  } catch {
    const err = new Error("Falha ao interpretar o campo dados do SERPRO.");
    err.code = "SERPRO_PGDASD_DADOS_INVALID";
    throw err;
  }
}

function pickPdfPayload(file) {
  if (!file || typeof file !== "object") return null;
  const nomeArquivo = String(file.nomeArquivo || file.filename || file.name || "").trim() || null;
  const pdf = String(file.pdf || file.PDFByteArrayBase64 || file.base64 || "").trim() || null;
  if (!pdf) return null;
  return { nomeArquivo, pdf };
}

function decodeBase64Pdf(value, code) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) {
    const err = new Error(code.toLowerCase());
    err.code = code;
    throw err;
  }
  return buffer;
}

async function saveBase64Pdf({ companyId, competencia, type, filename, base64 }) {
  const buffer = decodeBase64Pdf(base64, "SERPRO_PGDASD_PDF_INVALID");
  const key = `serpro/pgdas/${companyId}/${competencia}/${type}-${Date.now()}-${String(filename || "documento.pdf").replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
  const storage = GuideStorageService.create();
  const uploaded = await storage.upload({ key, buffer, contentType: "application/pdf" });
  return {
    id: uploaded.key,
    storageKey: uploaded.key,
    url: uploaded.url,
    buffer,
  };
}

function extractMoneyFromTextByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const parsed = parseDecimal(match[1]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

async function parsePgdasDeclarationPdf(buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(buffer);
  const rawText = String(pdfData?.text || "");

  const activityDescription =
    rawText.match(/Valor do Débito por Tributo para a Atividade \(R\$\):\s*([\s\S]*?)\s*Receita Bruta Informada:/i)?.[1] || "";

  const receitaBruta = extractMoneyFromTextByPatterns(rawText, [
    /Receita Bruta do PA \(RPA\) - Compet[êe]ncia\s+(\d+[\d.]*,\d{2})\s+\d+[\d.]*,\d{2}\s+\d+[\d.]*,\d{2}/i,
    /Receita Bruta Informada:\s*R\$\s*(\d+[\d.]*,\d{2})/i,
    /receita\s+bruta[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /total\s+de\s+receitas?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /receita\s+total[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
  ]);

  // Tabela de tributos — suporta colunas sem espaço (pdf-parse concatena): "IRPJCSLLTotal\n25,20...630,00"
  // \s* entre nomes de coluna para funcionar com ou sem espaços entre elas
  let impostoApurado = null;
  const tributoTableMatch = rawText.match(
    /IRPJ\s*CSLL\s*COFINS\s*PIS\S*Pasep\s*INSS\S*CPP\s*ICMS\s*IPI\s*ISS\s*Total\s*([\d.,]+)/i
  );
  if (tributoTableMatch?.[1]) {
    // Extrai todos os valores monetários da linha concatenada e pega o último (Total)
    const values = tributoTableMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
    if (values && values.length > 0) {
      impostoApurado = parseDecimal(values[values.length - 1]);
    }
  }

  // Fallback: "Principal 630,00 Multa 0,00 Juros 0,00 Total 630,00" (seção 6 do extrato)
  // \s* para funcionar com ou sem espaços (pdf-parse às vezes concatena)
  if (impostoApurado == null) {
    impostoApurado = extractMoneyFromTextByPatterns(rawText, [
      /Principal\s*\d+[\d.]*,\d{2}\s*Multa\s*\d+[\d.]*,\d{2}\s*Juros\s*\d+[\d.]*,\d{2}\s*Total\s*(\d+[\d.]*,\d{2})/i,
    ]);
  }

  // Fallback: DAS — "Valor Total do Documento" seguido do valor
  if (impostoApurado == null) {
    impostoApurado = extractMoneyFromTextByPatterns(rawText, [
      /Valor\s+Total\s+do\s+Documento\s*\n\s*(\d+[\d.]*,\d{2})/i,
      /Valor\s+Total\s+do\s+Documento\s+(\d+[\d.]*,\d{2})/i,
    ]);
  }

  // Fallback: DAS — linha "Totais X,XX X,XX" captura o último valor (coluna Total)
  if (impostoApurado == null) {
    const totaisMatch = rawText.match(/^Totais\s+([\d.,]+)/im);
    if (totaisMatch?.[1]) {
      const values = totaisMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
      if (values && values.length > 0) {
        impostoApurado = parseDecimal(values[values.length - 1]);
      }
    }
  }

  let receitaServicos = extractMoneyFromTextByPatterns(rawText, [
    /receita[^\n]{0,40}servi[cç]os?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /prest[aã]?[cç][aã]o\s+de\s+servi[cç]os?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
  ]) ?? 0;

  let receitaVendas = extractMoneyFromTextByPatterns(rawText, [
    /receita[^\n]{0,40}vendas?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /revenda\s+de\s+mercadorias?[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
    /com[ée]rcio[^\d]{0,60}(\d+[\d.]*,\d{2})/i,
  ]) ?? 0;

  if (receitaBruta != null && receitaServicos === 0 && receitaVendas === 0) {
    if (/prest[aã]?[cç][aã]o\s+de\s+servi[cç]os/i.test(activityDescription)) {
      receitaServicos = receitaBruta;
    } else if (/revenda\s+de\s+mercadorias|com[ée]rcio/i.test(activityDescription)) {
      receitaVendas = receitaBruta;
    }
  }

  return {
    receitaBruta,
    impostoApurado,
    receitaServicos,
    receitaVendas,
    rawText,
  };
}

async function findOrCreateCircular({ portalClientId, competencia }) {
  const now = new Date();
  return prisma.companyMonthlyCircular.upsert({
    where: { portalClientId_competencia: { portalClientId, competencia } },
    create: {
      portalClientId,
      competencia,
      receitaServicos: 0,
      receitaVendas: 0,
      receitaStatus: "PENDING",
      dasStatus: "PENDING",
      serproSyncStatus: "RUNNING",
      serproLastSyncAt: now,
      serproLastError: null,
    },
    update: {
      serproSyncStatus: "RUNNING",
      serproLastSyncAt: now,
      serproLastError: null,
    },
  });
}

export async function syncPgdasByCompetencia({ portalClientId, competencia, contratanteCnpj }) {
  const normalizedPortalClientId = String(portalClientId || "").trim();
  const competenciaStorage = normalizeCompetencia(competencia);
  const competenciaAaaamm = validateCompetenciaAaaamm(normalizeCompetenciaAaaamm(competencia));

  if (!normalizedPortalClientId) {
    const err = new Error("Empresa não encontrada.");
    err.code = "PORTAL_COMPANY_ID_REQUIRED";
    throw err;
  }
  if (!competenciaStorage) {
    const err = new Error("Competência inválida.");
    err.code = "SERPRO_INVALID_COMPETENCIA";
    throw err;
  }

  const company = await prisma.portalClient.findUnique({
    where: { id: normalizedPortalClientId },
    select: { id: true, cnpj: true, razao: true },
  });
  if (!company) {
    const err = new Error("Empresa não encontrada.");
    err.code = "PORTAL_COMPANY_NOT_FOUND";
    throw err;
  }
  if (!onlyDigits(company.cnpj)) {
    const err = new Error("Empresa sem CNPJ cadastrado.");
    err.code = "SERPRO_INVALID_CONTRIBUINTE_CNPJ";
    throw err;
  }

  const circular = await findOrCreateCircular({ portalClientId: company.id, competencia: competenciaStorage });

  try {
    const runtime = await getResolvedSerproCredentials();
    const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
    if (!procuradorCnpj || procuradorCnpj.length !== 14) {
      const err = new Error("serpro_procurador_cnpj_not_configured");
      err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
      throw err;
    }

    const pgdasService = new SerproPgdasdService();
    const declarationIndexResponse = await pgdasService.consultarDeclaracaoIndice({
      contratanteCnpj: procuradorCnpj,
      contribuinteCnpj: company.cnpj,
      periodoApuracao: competenciaStorage,
    });
    const dasIndex = parseDasIndexResponse(declarationIndexResponse);

    const client = new SerproHttpClient();
    const response = await client.post(
      "/Consultar",
      buildConsultarDeclaracaoPayload({
        companyCnpj: company.cnpj,
        competenciaAaaamm,
        contratanteCnpj: procuradorCnpj,
      })
    );

    const dados = parseSerproDados(response);

    if (dados?.notFound) {
      const updated = await prisma.companyMonthlyCircular.update({
        where: { id: circular.id },
        data: {
          receitaStatus: "NOT_FOUND",
          dasNumeroDocumento: dasIndex?.numeroDocumento || null,
          dasPago: dasIndex?.dasPago ?? null,
          dasDataEmissao: dasIndex?.dataHoraEmissaoDas ? new Date(dasIndex.dataHoraEmissaoDas) : null,
          dasStatus: dasIndex?.numeroDocumento ? (dasIndex.dasPago ? "SUCCESS_PAID" : "SUCCESS_OPEN") : "NOT_FOUND",
          serproSyncStatus: "NOT_FOUND",
          serproLastSyncAt: new Date(),
          serproLastError: null,
          metadata: {
            ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
            integrationSource: "SERPRO_PGDASD_DECLARACAO",
            sistema: "PGDASD",
            servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
            declarationIndexResponse,
            dasIndex,
            rawPayload: response,
            dados,
          },
        },
      });
      const guideResult = dasIndex?.numeroDocumento
        ? await tryEnsureDasGuideRecord({
            portalClientId: company.id,
            competencia: competenciaStorage,
            contratanteCnpj: procuradorCnpj,
            dasIndex,
          })
        : { guide: null, error: null };
      return { company, circular: updated, guide: guideResult.guide, guideFetchError: guideResult.error, accounting: { ok: true, generatedEntries: [] }, dados, dasIndex };
    }

    const declaracaoPayload = pickPdfPayload(dados?.declaracao);
    const reciboPayload = pickPdfPayload(dados?.recibo);

    if (!declaracaoPayload?.pdf) {
      const updated = await prisma.companyMonthlyCircular.update({
        where: { id: circular.id },
        data: {
          receitaStatus: "NOT_FOUND",
          dasStatus: "NOT_FOUND",
          serproSyncStatus: "NOT_FOUND",
          serproLastSyncAt: new Date(),
          metadata: {
            ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
            integrationSource: "SERPRO_PGDASD_DECLARACAO",
            sistema: "PGDASD",
            servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
            rawPayload: response,
            dados,
          },
        },
      });
      return { company, circular: updated, accounting: { ok: true, generatedEntries: [] }, dados };
    }

    const declaracaoFile = await saveBase64Pdf({
      companyId: company.id,
      competencia: competenciaStorage,
      type: "PGDAS_DECLARACAO",
      filename: declaracaoPayload.nomeArquivo || `pgdas-declaracao-${competenciaAaaamm}.pdf`,
      base64: declaracaoPayload.pdf,
    });

    const reciboFile = reciboPayload?.pdf
      ? await saveBase64Pdf({
          companyId: company.id,
          competencia: competenciaStorage,
          type: "PGDAS_RECIBO",
          filename: reciboPayload.nomeArquivo || `pgdas-recibo-${competenciaAaaamm}.pdf`,
          base64: reciboPayload.pdf,
        })
      : null;

    const parsedPgdas = await parsePgdasDeclarationPdf(declaracaoFile.buffer);
    const receitaBruta = parsedPgdas.receitaBruta ?? null;
    const dasTotal = parsedPgdas.impostoApurado ?? null;
    const receitaServicos = parsedPgdas.receitaServicos || 0;
    const receitaVendas = parsedPgdas.receitaVendas || 0;

    const updated = await prisma.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: {
        receitaBruta,
        receitaServicos,
        receitaVendas,
        dasTotal,
        dasNumeroDocumento: dasIndex?.numeroDocumento || null,
        dasPago: dasIndex?.dasPago ?? null,
        dasDataEmissao: dasIndex?.dataHoraEmissaoDas ? new Date(dasIndex.dataHoraEmissaoDas) : null,
        pgdasNumeroDeclaracao: dados.numeroDeclaracao ? String(dados.numeroDeclaracao) : null,
        pgdasDeclaracaoFileId: declaracaoFile.id,
        pgdasDeclaracaoFileUrl: declaracaoFile.url,
        pgdasReciboFileId: reciboFile?.id || null,
        pgdasReciboFileUrl: reciboFile?.url || null,
        receitaStatus: receitaBruta ? "SUCCESS" : "NOT_FOUND",
        dasStatus: dasIndex?.numeroDocumento ? (dasIndex.dasPago ? "SUCCESS_PAID" : "SUCCESS_OPEN") : dasTotal ? "SUCCESS" : "NOT_FOUND",
        serproSyncStatus: "SUCCESS",
        serproLastSyncAt: new Date(),
        serproLastError: null,
        metadata: {
          ...(circular.metadata && typeof circular.metadata === "object" ? circular.metadata : {}),
          integrationSource: "SERPRO_PGDASD_DECLARACAO",
          sistema: "PGDASD",
          servico: SERPRO_PGDASD_SERVICE_DECLARACAO,
          declarationIndexResponse,
          dasIndex,
          rawPayload: response,
          dados,
          parsedPgdas,
        },
      },
    });

    const guideResult = dasIndex?.numeroDocumento
      ? await tryEnsureDasGuideRecord({
          portalClientId: company.id,
          competencia: competenciaStorage,
          contratanteCnpj: procuradorCnpj,
          dasIndex,
        })
      : { guide: null, error: null };

    const finalCircular = guideResult.error
      ? await prisma.companyMonthlyCircular.update({
          where: { id: updated.id },
          data: {
            metadata: {
              ...(updated.metadata && typeof updated.metadata === "object" ? updated.metadata : {}),
              guideFetchError: guideResult.error,
            },
          },
        })
      : updated;

    const accounting = await generateEntriesFromCircular({
      portalClientId: company.id,
      competencia: competenciaStorage,
      now: new Date(),
    });

    return {
      company,
      circular: finalCircular,
      guide: guideResult.guide,
      guideFetchError: guideResult.error,
      accounting,
      dados,
      dasIndex,
      files: {
        declaracaoFileId: declaracaoFile.id,
        reciboFileId: reciboFile?.id || null,
      },
    };
  } catch (error) {
    await prisma.companyMonthlyCircular.update({
      where: { id: circular.id },
      data: {
        serproSyncStatus: "ERROR",
        serproLastError: error?.message || "Erro ao sincronizar PGDAS-D.",
        serproLastSyncAt: new Date(),
      },
    });
    throw error;
  }
}
