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

  async request({ method = "POST", path = "", data, headers = {}, params }) {
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
        headers: {
          Authorization: `Bearer ${accessToken}`,
          jwt_token: jwtToken,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Role-Type": "TERCEIROS",
          ...headers,
        },
      });
      return response.data;
    } catch (error) {
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
    });
  }
}
