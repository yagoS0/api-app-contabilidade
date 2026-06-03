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
    headers: { Accept: "application/json" },
  });

  const ultNSUStr = String(ultNSU || "0");
  const tried = [];
  let last404Body = null;

  for (const tmpl of PATH_TEMPLATES) {
    const path = tmpl({ cnpj: cleanCnpj, ultNSU: ultNSUStr });
    tried.push(path);
    try {
      const res = await client.get(path);
      // Sucesso (200) — devolve direto
      if (res.status === 200 && res.data) {
        return parseResponse(res.data, { triedPath: path });
      }
      // 404 + JSON: o ADN às vezes retorna 404 com body válido
      if (res.status === 404 && res.data && typeof res.data === "object" && res.data.StatusProcessamento) {
        last404Body = res.data;
        return parseResponse(res.data, { triedPath: path });
      }
      // 404 sem body útil → tenta o próximo template
      if (res.status === 404) continue;

      // Outros status — joga erro com info da resposta
      throw new AdnNacionalClientError(`HTTP_${res.status}`,
        `ADN Nacional retornou ${res.status}: ${typeof res.data === "string" ? res.data.slice(0, 200) : JSON.stringify(res.data || {}).slice(0, 200)}`,
        { status: res.status, body: res.data });
    } catch (err) {
      if (err instanceof AdnNacionalClientError) throw err;
      // erro de rede/TLS — propaga
      throw new AdnNacionalClientError("NETWORK_ERROR",
        `Falha de rede no ADN Nacional (${path}): ${err?.message || err}`,
        { cause: err });
    }
  }

  // Esgotou todos os paths sem sucesso
  throw new AdnNacionalClientError("ENDPOINT_NOT_FOUND",
    `Nenhum path conhecido do ADN Nacional retornou resposta válida. Paths tentados: ${tried.join(", ")}. ` +
    `Verifique se o endpoint do gov.br/nfse mudou — atualize PATH_TEMPLATES em AdnNacionalClient.js.`,
    { tried, last404Body });
}

function parseResponse(data, { triedPath }) {
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
  };
}

export const _internal = { ENDPOINTS, PATH_TEMPLATES };
