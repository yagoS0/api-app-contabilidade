// O CLIENTE DA ANTHROPIC — o laço de ferramentas, com teto de iterações. Rede INJETÁVEL.
//
// Referência: a skill `claude-api` (`typescript/claude-api/tool-use.md`, lida em 02/09/2026):
//   · `client.messages.create({ model, max_tokens, system, messages, tools, output_config })`;
//   · o laço manual: enquanto `stop_reason === "tool_use"`, executar CADA bloco `tool_use` e
//     devolver TODOS os `tool_result` numa ÚNICA mensagem `user`, na mesma ordem;
//   · `is_error: true` no `tool_result` quando a ferramenta recusou;
//   · `stop_reason === "refusal"` é recusa do modelo (não é erro de rede) — vira frase fixa;
//   · erros tipados do SDK, do mais específico ao mais geral.
//
// ⚠ O que este arquivo NÃO sabe: o que as ferramentas fazem, quem é o cliente, o que é uma guia. Ele
// recebe `executar(nome, input)` e devolve texto + uso. Toda decisão de negócio mora nas ferramentas.
//
// ⚠ Máximo de iterações (default 6): sem teto, um modelo que insiste numa ferramenta que recusa
// gasta dinheiro em laço. Estourou ⇒ a resposta é o texto que houver + `stopReason: "max_iteracoes"`.

import Anthropic from "@anthropic-ai/sdk";
import { IA_MODELO, IA_MAX_TOKENS, IA_ESFORCO, IA_MAX_ITERACOES, log as logPadrao } from "../../config.js";
import { somarUsage } from "./precosIa.js";

export const STOP_LOCAL = Object.freeze({ MAX_ITERACOES: "max_iteracoes", ERRO: "erro" });

/** O erro que sobe daqui: nunca carrega a chave nem o corpo da conversa. */
export class AssistenteClientError extends Error {
  constructor(codigo, mensagem, { status = null, retentavel = false } = {}) {
    super(mensagem);
    this.name = "AssistenteClientError";
    this.codigo = codigo;
    this.status = status;
    this.retentavel = retentavel;
  }
}

function serializarResultado(r) {
  if (typeof r === "string") return r;
  try {
    return JSON.stringify(r ?? null);
  } catch {
    return String(r);
  }
}

export function textoDaResposta(content) {
  return (Array.isArray(content) ? content : [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export class AssistenteClient {
  /**
   * @param {object} [opcoes]
   * @param {object} [opcoes.client]  ⚠ o ponto de injeção — o teste passa um dublê; produção usa `new Anthropic()`
   */
  constructor({ client = null, modelo = IA_MODELO, maxTokens = IA_MAX_TOKENS, esforco = IA_ESFORCO, maxIteracoes = IA_MAX_ITERACOES, log = logPadrao } = {}) {
    this.client = client;
    this.modelo = modelo;
    this.maxTokens = maxTokens;
    this.esforco = esforco;
    this.maxIteracoes = Math.max(1, Number(maxIteracoes) || 6);
    this.log = log;
  }

  cliente() {
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  /**
   * UM TURNO: mensagens + ferramentas → texto final.
   *
   * @param {object} p
   * @param {Array} p.system  os blocos de `montarSystem`
   * @param {Array} p.messages  o histórico, já no formato da API
   * @param {Array} p.ferramentas  as definições (`ferramentas.definicoes()`)
   * @param {(nome:string, input:object) => Promise<{ok:boolean}|object>} p.executar
   * @returns {Promise<{texto:string, usage:object, iteracoes:number, ferramentasChamadas:string[], stopReason:string, recusou:boolean}>}
   */
  async responder({ system, messages, ferramentas = [], executar }) {
    const conversa = [...(messages || [])];
    const usages = [];
    const ferramentasChamadas = [];
    let iteracoes = 0;
    let ultimo = null;

    while (iteracoes < this.maxIteracoes) {
      iteracoes += 1;
      let resposta;
      try {
        resposta = await this.cliente().messages.create({
          model: this.modelo,
          max_tokens: this.maxTokens,
          ...(this.esforco ? { output_config: { effort: this.esforco } } : {}),
          system,
          messages: conversa,
          ...(ferramentas.length ? { tools: ferramentas } : {}),
        });
      } catch (err) {
        throw traduzirErro(err);
      }
      usages.push(resposta?.usage || null);
      ultimo = resposta;

      if (resposta?.stop_reason === "refusal") {
        return { texto: "", usage: somarUsage(usages), iteracoes, ferramentasChamadas, stopReason: "refusal", recusou: true };
      }

      const usos = (resposta?.content || []).filter((b) => b?.type === "tool_use");
      if (resposta?.stop_reason !== "tool_use" || !usos.length) {
        return { texto: textoDaResposta(resposta?.content), usage: somarUsage(usages), iteracoes, ferramentasChamadas, stopReason: resposta?.stop_reason || "end_turn", recusou: false };
      }

      // O bloco `assistant` volta INTEIRO (texto + tool_use), e os resultados vão TODOS numa única
      // mensagem `user`, na ordem — é o contrato do laço.
      conversa.push({ role: "assistant", content: resposta.content });
      const resultados = [];
      for (const uso of usos) {
        ferramentasChamadas.push(uso.name);
        let saida;
        let erro = false;
        try {
          const input = uso.input && typeof uso.input === "object" ? uso.input : JSON.parse(String(uso.input || "{}"));
          saida = await executar(uso.name, input);
          erro = saida && typeof saida === "object" && saida.ok === false;
        } catch (e) {
          // ⚠ A exceção de uma ferramenta NÃO derruba o turno: vira `is_error` e o modelo explica.
          this.log?.warn?.({ ferramenta: uso.name, err: e?.message }, "assistente: ferramenta lançou");
          saida = { ok: false, motivo: "FERRAMENTA_FALHOU", mensagem: "Não consegui consultar isso agora." };
          erro = true;
        }
        resultados.push({ type: "tool_result", tool_use_id: uso.id, content: serializarResultado(saida), ...(erro ? { is_error: true } : {}) });
      }
      conversa.push({ role: "user", content: resultados });
    }

    this.log?.warn?.({ iteracoes }, "assistente: teto de iterações atingido");
    return { texto: textoDaResposta(ultimo?.content), usage: somarUsage(usages), iteracoes, ferramentasChamadas, stopReason: STOP_LOCAL.MAX_ITERACOES, recusou: false };
  }
}

/** Do mais específico ao mais geral — e sem a chave, sem o corpo. */
export function traduzirErro(err) {
  const status = Number(err?.status ?? err?.statusCode ?? 0) || null;
  if (err instanceof Anthropic.RateLimitError || status === 429) {
    return new AssistenteClientError("IA_RATE_LIMIT", "limite de taxa do modelo", { status: 429, retentavel: true });
  }
  if (err instanceof Anthropic.AuthenticationError || status === 401) {
    return new AssistenteClientError("IA_AUTENTICACAO", "chave da API recusada", { status: 401 });
  }
  if (err instanceof Anthropic.APIConnectionError || err?.name === "APIConnectionError") {
    return new AssistenteClientError("IA_CONEXAO", "não foi possível falar com a API do modelo", { retentavel: true });
  }
  if (err instanceof Anthropic.APIError || status) {
    return new AssistenteClientError("IA_API", `a API do modelo respondeu ${status || "erro"}`, { status, retentavel: Boolean(status && status >= 500) });
  }
  return new AssistenteClientError("IA_DESCONHECIDO", String(err?.message || err || "erro"), {});
}
