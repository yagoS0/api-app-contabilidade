import axios from "axios";
import { mapSerproError } from "./SerproErrorMapper.js";
import { SerproAuthService } from "./SerproAuthService.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { autorizarChamada, concluirChamada } from "./SerproCallGuard.js";
import { lerResposta, guardarResposta } from "./SerproRespostaCache.js";

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
    const salva = await lerResposta(data, path);
    if (salva !== null) return raw ? { status: 200, data: salva, headers: {} } : salva;
    // GUARDA DE CUSTO — antes de qualquer coisa, inclusive antes de autenticar. Este é o único
    // ponto central dos consumidores deste client, e a identificação (CNPJ + idServiço) sai do
    // próprio envelope `pedidoDados`: nenhuma chamada nova escapa por esquecimento do chamador.
    // Recusa vem como exceção `SerproGuardError` e sobe intacta até a tela.
    const autorizacao = await autorizarChamada({ payload: data, rota: path });

    let runtime, tokens, httpsAgent;
    try {
      [runtime, tokens, httpsAgent] = await Promise.all([
        getResolvedSerproCredentials(), this.authService.authenticate(), this.authService.buildHttpsAgent(),
      ]);
    } catch (error) {
      await concluirChamada(autorizacao, { abortadaAuth: true, erroCodigo: error?.code || "SERPRO_AUTH_ERROR", erroMensagem: "Autenticação ou certificado indisponível antes do envio da operação." });
      throw mapSerproError(error);
    }
    let response;
    try {
      response = await axios.request({
        method,
        url: this.buildUrl(runtime.baseUrl, path),
        data,
        params,
        timeout: runtime.timeoutMs,
        httpsAgent,
        // Q41 (SITFIS): permite ao chamador aceitar 202/304 sem lançar (fluxo assíncrono).
        ...(typeof validateStatus === "function" ? { validateStatus } : {}),
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          jwt_token: tokens.jwtToken,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Role-Type": "TERCEIROS",
          ...headers,
        },
      });
    } catch (error) {
      // Q43.2: no modo raw, o chamador quer inspecionar QUALQUER status (ex.: SITFIS 304 no /Apoiar,
      // que o axios teima em lançar mesmo com validateStatus). Se houver response, devolve-a em vez de lançar.
      if (raw && error?.response) {
        await concluirChamada(autorizacao, { httpStatus: error.response.status,
          erroCodigo: error.response.status >= 400 ? `HTTP_${error.response.status}` : null,
          erroMensagem: error.response.status >= 400 ? "Resposta HTTP de erro do provedor." : null });
        return { status: error.response.status, data: error.response.data, headers: error.response.headers };
      }
      const mapeado = mapSerproError(error);
      // Erros também contam preventivamente para o teto; cobrança depende do extrato do provedor.
      await concluirChamada(autorizacao, {
        httpStatus: error?.response?.status ?? null,
        erroCodigo: mapeado?.code || "SERPRO_ERROR",
        // O código do SERPRO é genérico (`SERPRO_BUSINESS_ERROR` para tudo). É a MENSAGEM que
        // distingue "período desnecessário" de "declaração já transmitida" de "CNPJ sem procuração"
        // — o motivo ajuda a conciliar e corrigir tentativas sem resultado útil.
        erroMensagem: mapeado?.message || error?.message || null,
      });
      throw mapeado;
    }
    // Persistir antes de liberar a reserva e antes de interpretar PDF/gerar lançamentos.
    // Se falhar, a reserva permanece em aberto e impede uma repetição silenciosa.
    try { await guardarResposta(data, path, response); }
    catch {
      const erro = new Error("A resposta SERPRO não pôde ser guardada. Confira a tentativa anterior antes de repetir.");
      erro.code = "SERPRO_REGISTRO_INDETERMINADO";
      throw erro;
    }
    // Finalização fora do catch de rede: falha do ledger não vira segunda finalização nem retry fiscal.
    await concluirChamada(autorizacao, { httpStatus: response.status,
      erroCodigo: response.status >= 400 ? `HTTP_${response.status}` : null,
      erroMensagem: response.status >= 400 ? "Resposta HTTP de erro do provedor." : null });
    return raw ? { status: response.status, data: response.data, headers: response.headers } : response.data;
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
