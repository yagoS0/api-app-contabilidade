// Q12.B+ rework: client REST do ADN Nacional NFS-e (Padrão Nacional / gov.br).
//
// Substitui o AdnSyncService legado (deprecated em Q8.B). URLs e paths
// baseados na documentação do Padrão Nacional NFS-e:
//   https://www.gov.br/nfse/pt-br
//   https://www.producaorestrita.nfse.gov.br (homologação restrita pública)
//
// API REST com mTLS (mesmo cert do escritório usado no SERPRO).
// Endpoint principal pra distribuição de DFe-NFSe:
//   GET /sefin/rest/dfe/{cnpj}/distribuicao/{ultimoNSU}
//
// Resposta (JSON):
//   {
//     "StatusProcessamento": "ARQUIVO_LOCALIZADO" | "NENHUM_DOCUMENTO_LOCALIZADO" | "REJEICAO",
//     "LoteDFe": [
//       { "NSU": "...", "ChaveAcesso": "...", "TipoDocumento": "NFSE|EVENTO",
//         "ArquivoXml": "<base64 (talvez gzip)>" },
//       ...
//     ]
//   }
//
// ATENÇÃO: ADN Nacional ainda evolui. Se o endpoint exato mudar, ajuste
// PATH_TEMPLATE abaixo. Mantém compatibilidade com 2 paths conhecidos
// via fallback (igual padrão do AdnSyncService legado).

import https from "node:https";
import axios from "axios";
import { extractTlsMaterialFromPfx } from "../pfxToTls.js";

const ENDPOINTS = {
  // URLs públicas oficiais do ADN Nacional (gov.br/nfse) — confirmadas via DNS
  // (resolvem para router-ha.estaleiro.serpro.gov.br, infra do SERPRO).
  prod: "https://adn.nfse.gov.br",
  hom:  "https://adn.producaorestrita.nfse.gov.br",
};

// Endpoint oficial confirmado:
//   GET /DFe/{NSU}?cnpjConsulta=<CNPJ>&lote=true
//
// NSU = path param (cursor incremental)
// cnpjConsulta = query param (CNPJ alvo da consulta)
// lote = query param (default true, traz N docs por chamada)
//
// Outro endpoint útil (futuro): GET /NFSe/{ChaveAcesso}/Eventos
const PATH_TEMPLATES = [
  ({ cnpj, ultNSU }) => `/DFe/${ultNSU}?cnpjConsulta=${cnpj}&lote=true`,
];

export class AdnNacionalClientError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function buildHttpsAgent({ pfxBuffer, password }) {
  // Mesma extração via node-forge usada no DfeClient — bypassa OpenSSL 3 strict.
  const tls = extractTlsMaterialFromPfx(pfxBuffer, password);
  return new https.Agent({
    cert: tls.cert,
    key: tls.key,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    keepAlive: true,
  });
}

/**
 * Consulta DFe-NFSe via ADN Nacional. Tenta cada PATH_TEMPLATE até obter
 * resposta válida (status 200 OU 404 com JSON `StatusProcessamento`).
 *
 * @param {Object} opts
 * @param {string} opts.cnpj        — CNPJ do contribuinte (14 dígitos)
 * @param {number|bigint|string} opts.ultNSU
 * @param {Buffer} opts.pfxBuffer   — PFX do escritório (cert SERPRO)
 * @param {string} opts.password
 * @param {"prod"|"hom"} [opts.env="prod"]
 * @param {number} [opts.timeoutMs=20000]
 * @returns {Promise<{status, items, errors, raw}>}
 */
export async function fetchDfeNFSe({ cnpj, ultNSU, pfxBuffer, password, env = "prod", timeoutMs = 20000 }) {
  const cleanCnpj = String(cnpj || "").replace(/\D+/g, "");
  if (cleanCnpj.length !== 14) {
    throw new AdnNacionalClientError("INVALID_CNPJ", `CNPJ inválido: ${cnpj}`);
  }
  const baseUrl = ENDPOINTS[env];
  if (!baseUrl) throw new AdnNacionalClientError("INVALID_ENV", `env=${env} (prod|hom)`);

  const agent = buildHttpsAgent({ pfxBuffer, password });
  const client = axios.create({
    baseURL: baseUrl,
    httpsAgent: agent,
    timeout: timeoutMs,
    validateStatus: () => true,
    // ADN devolve text/plain com payload JSON — peço como string e parseio manual.
    headers: { Accept: "text/plain, application/json, */*" },
    responseType: "text",
    transformResponse: [(data) => data],
  });

  const ultNSUStr = String(ultNSU || "0");
  const path = PATH_TEMPLATES[0]({ cnpj: cleanCnpj, ultNSU: ultNSUStr });

  let res;
  try {
    res = await client.get(path);
  } catch (err) {
    throw new AdnNacionalClientError("NETWORK_ERROR",
      `Falha de rede no ADN Nacional (${path}): ${err?.message || err}`, { cause: err });
  }

  // Body sempre vem como string. Tenta JSON.parse pra todos os status
  // que tenham body — o ADN retorna JSON em 200, 400 e 404 (com Erros[]).
  let parsedBody = null;
  if (typeof res.data === "string" && res.data.trim()) {
    try { parsedBody = JSON.parse(res.data); } catch { parsedBody = null; }
  } else if (res.data && typeof res.data === "object") {
    parsedBody = res.data;
  }

  if (parsedBody && parsedBody.StatusProcessamento) {
    return parseResponse(parsedBody, { triedPath: path, httpStatus: res.status });
  }

  // Sem body JSON válido — erro real
  const bodyPreview = typeof res.data === "string"
    ? res.data.slice(0, 300)
    : JSON.stringify(res.data || {}).slice(0, 300);
  throw new AdnNacionalClientError(`HTTP_${res.status}`,
    `ADN Nacional retornou ${res.status} sem body JSON válido. Path: ${path}. Body: ${bodyPreview}`,
    { status: res.status, body: res.data, path });
}

function parseResponse(data, { triedPath, httpStatus }) {
  // Normaliza nomes (case variável: StatusProcessamento|statusProcessamento|status)
  const status = data.StatusProcessamento || data.statusProcessamento || data.status || null;
  const itemsRaw = data.LoteDFe || data.loteDFe || data.documentos || [];
  const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
  const errors = data.Erros || data.erros || [];
  return {
    status: status ? String(status).toUpperCase() : null,
    items,
    errors,
    raw: data,
    triedPath,
    httpStatus,
  };
}

export const _internal = { ENDPOINTS, PATH_TEMPLATES };
