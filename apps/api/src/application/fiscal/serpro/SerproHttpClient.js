import axios from "axios";
import { mapSerproError } from "./SerproErrorMapper.js";
import { SerproAuthService } from "./SerproAuthService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";

export class SerproHttpClient {
  constructor(options = {}) {
    this.config = options.config || null;
    this.authService = options.authService || new SerproAuthService({ config: this.config });
  }

  buildUrl(baseUrl, path) {
    const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    const normalizedPath = String(path || "").trim();
    if (!normalizedPath) return normalizedBaseUrl;
    if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
    return `${normalizedBaseUrl}/${normalizedPath.replace(/^\/+/, "")}`;
  }

  async request({ method = "POST", path = "", data, headers = {}, params, raw = false, validateStatus }) {
    const [runtime, { accessToken, jwtToken }, httpsAgent] = await Promise.all([
      getResolvedSerproCredentials(),
      this.authService.authenticate(),
      this.authService.buildHttpsAgent(),
    ]);

    try {
      const response = await axios.request({
        method,
        url: this.buildUrl(runtime.baseUrl, path),
        data,
        params,
        timeout: runtime.timeoutMs,
        httpsAgent,
        // Q41 (SITFIS): permite ao chamador aceitar 202/304 sem lançar (fluxo assíncrono).
        ...(typeof validateStatus === "function" ? { validateStatus } : {}),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          jwt_token: jwtToken,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Role-Type": "TERCEIROS",
          ...headers,
        },
      });
      // raw=true devolve { status, data, headers } para casos que dependem do status HTTP.
      return raw ? { status: response.status, data: response.data, headers: response.headers } : response.data;
    } catch (error) {
      // Q43.2: no modo raw, o chamador quer inspecionar QUALQUER status (ex.: SITFIS 304 no /Apoiar,
      // que o axios teima em lançar mesmo com validateStatus). Se houver response, devolve-a em vez de lançar.
      if (raw && error?.response) {
        return { status: error.response.status, data: error.response.data, headers: error.response.headers };
      }
      throw mapSerproError(error);
    }
  }

  async post(path, payload, options = {}) {
    return this.request({
      method: "POST",
      path,
      data: payload,
      headers: options.headers,
      params: options.params,
      raw: options.raw,
      validateStatus: options.validateStatus,
    });
  }
}
