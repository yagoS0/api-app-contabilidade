import https from "node:https";
import fs from "node:fs";
import axios from "axios";
import { gunzipSync } from "node:zlib";
import { parseXmlMetadata } from "./AdnXmlMetadata.js";
import { parseDate } from "../../utils/date.js";
import {
  ADN_BASE_URL,
  ADN_CERT_PATH,
  ADN_KEY_PATH,
  ADN_DFE_PATH,
  ADN_CNPJ_CONSULTA,
  log,
} from "../../config.js";
import { AdnRepository } from "../../infrastructure/db/AdnRepository.js";

function integrationReady() {
  return Boolean(ADN_BASE_URL && ADN_CERT_PATH && ADN_KEY_PATH);
}

function buildAdnClient() {
  if (!integrationReady()) {
    const err = new Error("ADN: integração não configurada");
    err.code = "ADN_NOT_CONFIGURED";
    throw err;
  }

  const cert = fs.readFileSync(ADN_CERT_PATH);
  const key = fs.readFileSync(ADN_KEY_PATH);
  const agent = new https.Agent({
    cert,
    key,
    minVersion: "TLSv1.2",
    ALPNProtocols: ["http/1.1"],
    rejectUnauthorized: true,
  });

  return axios.create({
    baseURL: ADN_BASE_URL.replace(/\/+$/, ""),
    httpsAgent: agent,
    timeout: 15000,
    headers: { Accept: "application/json" },
  });
}

function normalizeStatus(value) {
  if (!value) return null;
  return String(value).toUpperCase();
}


function decodeXml(arquivoXml) {
  const raw = Buffer.from(arquivoXml, "base64");
  try {
    return gunzipSync(raw).toString("utf-8");
  } catch (err) {
    return raw.toString("utf-8");
  }
}

function parseLoteResponse(data) {
  if (!data || typeof data !== "object") return { status: null, items: [] };
  const status =
    data.StatusProcessamento ||
    data.statusProcessamento ||
    data.status ||
    data.Status ||
    null;
  const items =
    data.LoteDFe ||
    data.loteDFe ||
    data.documentos ||
    data.Documentos ||
    data.itens ||
    [];
  return {
    status: normalizeStatus(status),
    items: Array.isArray(items) ? items : [items],
    errors: data.Erros || data.erros || [],
  };
}

export class AdnSyncService {
  static async fetchLote({ nsu, cnpjConsulta, lote = true }) {
    const client = buildAdnClient();
    const basePath = (ADN_DFE_PATH || "/DFe").replace(/\/+$/, "");
    const basePathLower = basePath.toLowerCase();
    const basePathCaseFixed = basePath.replace(/\/dfe$/i, "/DFe");
    const candidates = [
      `${basePath}/${encodeURIComponent(nsu)}`,
      basePath,
      `${basePathCaseFixed}/${encodeURIComponent(nsu)}`,
      basePathCaseFixed,
      `${basePathLower}/${encodeURIComponent(nsu)}`,
      basePathLower,
    ];

    let lastError = null;
    for (const path of candidates) {
      try {
        const includesNsu = path.endsWith(`/${encodeURIComponent(nsu)}`);
        const params = {
          lote: String(lote).toLowerCase(),
          ...(cnpjConsulta ? { cnpjConsulta } : {}),
          ...(includesNsu ? {} : { nsu: String(nsu) }),
        };
        const { data } = await client.get(path, { params });
        return data;
      } catch (err) {
        lastError = err;
        const status = err?.response?.status;
        if (status === 404) {
          const responseData = err?.response?.data;
          if (responseData && responseData.StatusProcessamento) {
            return responseData;
          }
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  static async syncOnce({ lote = true, cnpjConsulta } = {}) {
    const state = await AdnRepository.ensureState();
    const cnpj = (cnpjConsulta || ADN_CNPJ_CONSULTA || "").replace(/\D+/g, "");
    if (!cnpj) {
      const err = new Error("adn_cnpj_required");
      err.code = "ADN_CNPJ_REQUIRED";
      throw err;
    }
    const ultimoNSU = state.ultimoNSU ?? BigInt(0);
    const response = await this.fetchLote({
      nsu: ultimoNSU.toString(),
      lote,
      cnpjConsulta: cnpj,
    });

    const { status, items, errors } = parseLoteResponse(response);
    if (status === "REJEICAO") {
      const err = new Error("adn_rejected");
      err.code = "ADN_REJEICAO";
      err.details = errors;
      throw err;
    }

    if (status === "NENHUM_DOCUMENTO_LOCALIZADO") {
      return { status, processed: 0, nextNSU: ultimoNSU.toString() };
    }

    let maxNSU = ultimoNSU;
    let processed = 0;

    for (const item of items) {
      const nsuRaw = item.NSU || item.nsu || item.Nsu;
      if (!nsuRaw) continue;
      const nsuValue = BigInt(nsuRaw);
      if (nsuValue > maxNSU) maxNSU = nsuValue;

      const tipoDocumento = item.TipoDocumento || item.tipoDocumento || null;
      const tipoEvento = item.TipoEvento || item.tipoEvento || null;
      const dataHoraGeracao = item.DataHoraGeracao || item.dataHoraGeracao || null;
      const chaveAcesso = item.ChaveAcesso || item.chaveAcesso || null;
      const arquivoXml = item.ArquivoXml || item.arquivoXml || null;

      let xmlPlain = null;
      let metadata = {};
      if (arquivoXml) {
        xmlPlain = decodeXml(arquivoXml);
        metadata = parseXmlMetadata(xmlPlain);
      }

      const payload = {
        nsu: nsuValue.toString(),
        chaveAcesso: chaveAcesso ? String(chaveAcesso) : null,
        tipoDocumento: tipoDocumento ? String(tipoDocumento) : null,
        tipoEvento: tipoEvento ? String(tipoEvento) : null,
        dataHoraGeracao: dataHoraGeracao ? parseDate(dataHoraGeracao) : null,
        xmlBase64Gzip: arquivoXml,
        xmlPlain,
        ...metadata,
      };

      const result = await AdnRepository.upsertDocument(payload);
      if (payload.tipoDocumento === "EVENTO" && payload.chaveAcesso) {
        await AdnRepository.updateByChaveAcesso(payload.chaveAcesso, {
          situacao: metadata.situacao,
          tipoEvento: payload.tipoEvento,
          xmlPlain: payload.xmlPlain,
          xmlBase64Gzip: payload.xmlBase64Gzip,
          cnpjPrestador: metadata.cnpjPrestador,
          cnpjTomador: metadata.cnpjTomador,
        });
      }
      if (result.action) processed += 1;
    }

    const nextNSU = (maxNSU + BigInt(1)).toString();
    await AdnRepository.updateState(nextNSU);
    return { status, processed, nextNSU };
  }

  static async syncUntilEmpty({ lote = true, maxIterations = 50, cnpjConsulta } = {}) {
    let total = 0;
    let iterations = 0;
    while (iterations < maxIterations) {
      const result = await this.syncOnce({ lote, cnpjConsulta });
      total += result.processed;
      iterations += 1;
      if (result.status === "NENHUM_DOCUMENTO_LOCALIZADO") {
        return { total, iterations, status: result.status, nextNSU: result.nextNSU };
      }
    }
    return { total, iterations, status: "LIMITE_ITERACOES" };
  }
}
