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

// ADN Contribuinte (gov.br/nfse) — base com /contribuintes incluído.
// API REST liberada oficialmente em 01/10/2025.
const ENDPOINTS = {
  prod: "https://adn.nfse.gov.br/contribuintes",
  hom:  "https://adn.producaorestrita.nfse.gov.br/contribuintes",
};

// Endpoint base oficial: GET /DFe/{NSU}?cnpjConsulta=<CNPJ>&lote=true
// MAS o swagger pode ter base-path não documentado no path. Testa variações
// comuns (Servlet/API/v1) antes de desistir.
// ADN Contribuinte: GET /DFe/{NSU}
//
// CRÍTICO: cert ICP-Brasil identifica o tomador via SAN extension
// (otherName OID 2.16.76.1.3.3). NÃO passar cnpjConsulta — é redundante.
// cnpjConsulta SÓ deve ser usado quando o cert tem CNPJ-RAIZ diferente
// (escritório consultando filial). Default: sem cnpjConsulta.
//
// Diferenças vs SEFAZ NF-e:
// - Sem maxNSU (ADN não retorna teto)
// - Sem limite 90 dias (ainda)
// - Loop até StatusProcessamento=NENHUM_DOCUMENTO_LOCALIZADO
const PATH_TEMPLATES = [
  ({ ultNSU }) => `/DFe/${ultNSU}`,
];

// gov.br/nfse (ADN Contribuinte) responde 502/503/504 quando o gateway está sem backend
// (instabilidade frequente do serviço, liberado só em out/2025). Tratamos como transitório:
// algumas tentativas com backoff curto antes de desistir com mensagem amigável.
const MAX_5XX_RETRIES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Q42: consulta em LOTE (até 50 docs por chamada). SEM este parâmetro o ADN devolve 1 doc por
// requisição (varredura 1-em-1) → enxurrada de chamadas e empresa nova "travada". Env-overridável
// (ADN_LOTE=0) caso o Swagger do ADN mude o nome/rota do lote.
const ADN_LOTE = process.env.ADN_LOTE !== "0";

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
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          // Q42: lote=true → retorna até 50 docs por chamada (corrige a varredura 1-em-1).
          res = await client.get(path, ADN_LOTE ? { params: { lote: true } } : undefined);
        } catch (err) {
          throw new AdnNacionalClientError("NETWORK_ERROR",
            `Falha de rede no ADN Nacional (${path}): ${err?.message || err}`, { cause: err });
        }
        // 5xx = gateway/serviço do gov.br instável → tenta de novo (backoff curto)
        if (res.status >= 500 && attempt < MAX_5XX_RETRIES) {
          attempt += 1;
          // eslint-disable-next-line no-await-in-loop
          await sleep(1000 * attempt);
          continue;
        }
        break;
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

      // 5xx persistente após os retries → serviço do gov.br fora do ar. Mensagem amigável (sem HTML cru).
      if (res.status >= 500) {
        throw new AdnNacionalClientError("ADN_UNAVAILABLE",
          `O ADN Nacional (gov.br/nfse) está temporariamente indisponível (${res.status}). ` +
          `Isso é uma instabilidade do serviço da Receita, não do sistema. Tente novamente em alguns minutos.`,
          { status: res.status, path });
      }

      // ⚠ 429 NÃO É FALHA DO SISTEMA — é um limite externo sendo respeitado, e a mensagem tem de
      // dizer isso e QUANDO tentar de novo.
      //
      // Antes o 429 caía no `throw` genérico abaixo, que concatena `res.data` na mensagem. O corpo
      // do gov.br é HTML (`<html><body><h1>429 Too Many Requests</h1>…`), então o que chegava ao
      // contador era um despejo de HTML cru dentro de um `<span>` vermelho — a tela parecia
      // quebrada justamente quando o sistema estava se comportando corretamente. Medido em
      // produção (14 empresas, 09/08/2026): o texto gravado em `adnLastError` começava com
      // `[HTTP_429] ADN Nacional retornou 429. Path: /DFe/10. Body: <html>…`.
      //
      // ⚠ O CÓDIGO TEM DE CONTINUAR SENDO `HTTP_429`: `AdnNotasService` decide o tamanho do backoff
      // comparando `code === "HTTP_429"`. Trocar o código aqui alonga o bloqueio em silêncio.
      //
      // ⚠ `Retry-After` NÃO VEM nesta resposta — medido nas 13 ocorrências gravadas em produção, os
      // headers eram só `content-length`, `cache-control` e `content-type`. Lemos o header quando
      // ele existir (é de graça e é a resposta certa), mas quem decide a espera na prática é o
      // backoff do serviço, não o servidor. Prometer "respeitamos o Retry-After" seria inventar.
      if (res.status === 429) {
        const retryAfterRaw = res.headers?.["retry-after"] ?? res.headers?.["Retry-After"] ?? null;
        const retryAfterSec = retryAfterRaw != null && /^\d+$/.test(String(retryAfterRaw).trim())
          ? Number(String(retryAfterRaw).trim())
          : null;
        const quando = retryAfterSec != null
          ? `O próprio ADN pediu para aguardar ${retryAfterSec}s.`
          : "O ADN não informou quanto esperar.";
        throw new AdnNacionalClientError("HTTP_429",
          `O ADN Nacional (gov.br/nfse) recusou a consulta por excesso de requisições. ` +
          `Isso é um limite do serviço da Receita, não um defeito do sistema — nenhuma nota foi perdida ` +
          `e a busca recomeça do mesmo ponto. ${quando}`,
          { status: 429, path, retryAfterSec });
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

  // Esgotou todas as combinações (path × NSU) sem resposta útil.
  if (lastEmpty404) {
    // Paginação (autoDiscover=false, cursor>0 — já tínhamos NSU): um 404 vazio aqui significa
    // apenas "não há mais documentos", NÃO "CNPJ fora do ADN". Termina o lote limpo (o loop de
    // syncAdnNotasForCompany quebra em NENHUM_DOCUMENTO_LOCALIZADO) — antes isso lançava CNPJ_NOT_IN_ADN
    // por engano no fim da paginação, mesmo já tendo capturado notas nesta sync.
    if (!autoDiscover) {
      return {
        status: "NENHUM_DOCUMENTO_LOCALIZADO",
        items: [],
        errors: [],
        raw: null,
        triedPath: lastEmpty404.path,
        httpStatus: 404,
      };
    }
    // 1º contato real (autoDiscover=true, tentou NSU 0 e 1 e nada) → aí sim CNPJ não responde no ADN.
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
