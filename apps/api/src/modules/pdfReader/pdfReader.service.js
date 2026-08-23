import axios from "axios";

/**
 * POST /extract on the pdf-reader FastAPI service.
 * @param {object} opts
 * @param {string} opts.baseURL
 * @param {string} opts.contentBase64
 * @param {string} [opts.filename]
 * @param {string} [opts.requestId]
 * @param {number} opts.timeoutMs
 * @returns {Promise<import("axios").AxiosResponse>}
 */
export async function postExtract({
  baseURL,
  contentBase64,
  filename,
  requestId,
  timeoutMs,
}) {
  const root = String(baseURL || "").replace(/\/$/, "");
  const url = `${root}/extract`;
  const headers = {
    "Content-Type": "application/json",
    ...(requestId ? { "X-Request-Id": String(requestId) } : {}),
  };
  return axios.post(
    url,
    {
      content_base64: contentBase64,
      filename: filename ?? null,
    },
    {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    }
  );
}

/**
 * POST /sitfis/posicional no MESMO serviço pdf-reader.
 *
 * ⚠ Mesmo transporte do `/extract` de propósito (axios, `validateStatus: () => true`, header
 * `X-Request-Id`, `timeoutMs` de `PDF_READER_TIMEOUT_MS`): um segundo cliente HTTP divergiria na
 * primeira correção de timeout ou de cabeçalho, e o SITFIS passaria a falhar por um motivo que
 * ninguém consertou nas guias.
 *
 * ⚠ O que muda é só o CAMINHO e a FORMA DA RESPOSTA: o SITFIS não é uma guia — não tem valor,
 * vencimento nem código de receita —, então o corpo volta com `relatorio` (as tabelas do
 * relatório) em vez de `fields`. Ver `apps/pdf-reader/app/routers/sitfis.py`.
 *
 * @param {object} opts
 * @param {string} opts.baseURL
 * @param {string} opts.contentBase64
 * @param {string} [opts.filename]
 * @param {string} [opts.requestId]
 * @param {number} opts.timeoutMs
 * @returns {Promise<import("axios").AxiosResponse>}
 */
export async function postSitfisPosicional({
  baseURL,
  contentBase64,
  filename,
  requestId,
  timeoutMs,
}) {
  const root = String(baseURL || "").replace(/\/$/, "");
  const url = `${root}/sitfis/posicional`;
  const headers = {
    "Content-Type": "application/json",
    ...(requestId ? { "X-Request-Id": String(requestId) } : {}),
  };
  return axios.post(
    url,
    {
      content_base64: contentBase64,
      filename: filename ?? null,
    },
    {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    }
  );
}
