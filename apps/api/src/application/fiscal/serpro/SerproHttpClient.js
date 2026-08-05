import axios from "axios";
import { mapSerproError } from "./SerproErrorMapper.js";
import { SerproAuthService } from "./SerproAuthService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { autorizarChamada, concluirChamada } from "./SerproCallGuard.js";

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
    // GUARDA DE CUSTO — antes de qualquer coisa, inclusive antes de autenticar. Este é o único
    // ponto por onde TODAS as chamadas pagas passam, e a identificação (CNPJ + idServiço) sai do
    // próprio envelope `pedidoDados`: nenhuma chamada nova escapa por esquecimento do chamador.
    // Recusa vem como exceção `SerproGuardError` e sobe intacta até a tela.
    const autorizacao = await autorizarChamada({ payload: data, rota: path });

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
      await concluirChamada(autorizacao, { httpStatus: response.status });
      // raw=true devolve { status, data, headers } para casos que dependem do status HTTP.
      return raw ? { status: response.status, data: response.data, headers: response.headers } : response.data;
    } catch (error) {
      // Q43.2: no modo raw, o chamador quer inspecionar QUALQUER status (ex.: SITFIS 304 no /Apoiar,
      // que o axios teima em lançar mesmo com validateStatus). Se houver response, devolve-a em vez de lançar.
      if (raw && error?.response) {
        // A chamada SAIU e foi cobrada — registra como sucesso de rede, com o status real.
        await concluirChamada(autorizacao, { httpStatus: error.response.status });
        return { status: error.response.status, data: error.response.data, headers: error.response.headers };
      }
      const mapeado = mapSerproError(error);
      // Erro de negócio da RFB também é chamada cobrada: entra no registro e conta para o teto.
      await concluirChamada(autorizacao, {
        httpStatus: error?.response?.status ?? null,
        erroCodigo: mapeado?.code || "SERPRO_ERROR",
        // O código do SERPRO é genérico (`SERPRO_BUSINESS_ERROR` para tudo). É a MENSAGEM que
        // distingue "período desnecessário" de "declaração já transmitida" de "CNPJ sem procuração"
        // — e sem ela o log registra que a chamada foi cobrada sem registrar por quê.
        erroMensagem: mapeado?.message || error?.message || null,
      });
      throw mapeado;
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
