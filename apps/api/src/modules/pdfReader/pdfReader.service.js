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
