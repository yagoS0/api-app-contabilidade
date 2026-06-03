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

// Endpoint base oficial: GET /DFe/{NSU}?cnpjConsulta=<CNPJ>&lote=true
// MAS o swagger pode ter base-path não documentado no path. Testa variações
// comuns (Servlet/API/v1) antes de desistir.
// Endpoint da API ADN Contribuinte (gov.br/nfse):
//   GET https://adn.nfse.gov.br/DFe/{NSU}?cnpjConsulta=<CNPJ>&lote=true
//
// Mesmo path da API ADN Município — o roteamento é feito pelo SERVIDOR
// baseado no cert digital apresentado no mTLS. Cert de escritório =
// API Contribuinte; cert de prefeitura = API Município.
//
// Query: cnpjConsulta + lote (true default). NÃO tem tipoNSU (só Município).
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
export async function fetchDfeNFSe({ cnpj, ultNSU, pfxBuffer, password, env = "prod", timeoutMs = 20000, autoDiscover = false }) {
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
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Node) AdnNacionalClient/1.0",
    },
    responseType: "text",
    transformResponse: [(data) => data],
  });

  // Q12.B+++: autodescoberta de NSU inicial — alguns ADNs são 1-indexed.
  // Se autoDiscover=true (usado quando cursor=0 na 1ª sync) e NSU=0 dá 404 vazio,
  // tenta NSU=1 antes de desistir.
  const nsuCandidates = autoDiscover
    ? [String(ultNSU || "0"), "1"]
    : [String(ultNSU || "0")];

  const tried = [];
  let lastEmpty404 = null;

  for (const nsuStr of nsuCandidates) {
    for (const tmpl of PATH_TEMPLATES) {
      const path = tmpl({ cnpj: cleanCnpj, ultNSU: nsuStr });
      tried.push(path);

      let res;
      try {
        res = await client.get(path);
      } catch (err) {
        throw new AdnNacionalClientError("NETWORK_ERROR",
          `Falha de rede no ADN Nacional (${path}): ${err?.message || err}`, { cause: err });
      }

      // Body como string — tenta JSON.parse
      let parsedBody = null;
      if (typeof res.data === "string" && res.data.trim()) {
        try { parsedBody = JSON.parse(res.data); } catch { parsedBody = null; }
      } else if (res.data && typeof res.data === "object") {
        parsedBody = res.data;
      }

      // Body JSON válido (qualquer status: 200/400/404 com Erros[])
      if (parsedBody && parsedBody.StatusProcessamento) {
        return parseResponse(parsedBody, { triedPath: path, httpStatus: res.status });
      }

      // 404 sem body → registra e tenta próximo path/NSU
      if (res.status === 404) {
        lastEmpty404 = { path, headers: res.headers };
        continue;
      }

      // Outros status sem body JSON → erro real
      const bodyPreview = typeof res.data === "string"
        ? res.data.slice(0, 300)
        : JSON.stringify(res.data || {}).slice(0, 300);
      const headersPreview = JSON.stringify(res.headers || {}).slice(0, 300);
      throw new AdnNacionalClientError(`HTTP_${res.status}`,
        `ADN Nacional retornou ${res.status}. Path: ${path}. Body: ${bodyPreview || "(vazio)"}. Headers: ${headersPreview}`,
        { status: res.status, body: res.data, headers: res.headers, path });
    }
  }

  // Esgotou todas as combinações (path × NSU) sem resposta útil
  if (lastEmpty404) {
    throw new AdnNacionalClientError("CNPJ_NOT_IN_ADN",
      `CNPJ ${cleanCnpj} não responde no ADN Contribuinte (gov.br/nfse). Possíveis causas:\n` +
      `1. CNPJ não cadastrado no Padrão Nacional NFS-e (município ainda não aderiu — muitas cidades grandes só vão entrar até 2027)\n` +
      `2. Certificado A1 da empresa não autorizado pra esse CNPJ (confira se o cert é do mesmo CNPJ)\n` +
      `3. Servidor ADN instável (tente novamente em alguns minutos)\n` +
      `Tentativas: ${tried.join(", ")}`,
      { tried, lastEmpty404 });
  }

  throw new AdnNacionalClientError("ENDPOINT_NOT_FOUND",
    `Nenhum path retornou JSON válido. Tentados: ${tried.join(", ")}.`,
    { tried });
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
