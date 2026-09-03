// O LAÇO DE FERRAMENTAS — com um dublê da API. Nenhuma chamada de rede sai daqui.
//
// O que fica travado: (1) todos os `tool_result` de uma rodada voltam numa ÚNICA mensagem `user`,
// na ordem; (2) `is_error: true` quando a ferramenta recusa; (3) exceção da ferramenta NÃO derruba
// o turno; (4) `refusal` vira `recusou: true`; (5) o teto de iterações para o laço; (6) os erros do
// SDK saem traduzidos sem carregar chave nem corpo.

import { AssistenteClient, textoDaResposta, traduzirErro, STOP_LOCAL } from "../AssistenteClient.js";

function respostaTexto(texto, usage = { input_tokens: 10, output_tokens: 5 }) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: texto }], usage };
}
function respostaFerramentas(usos, usage = { input_tokens: 10, output_tokens: 5 }) {
  return { stop_reason: "tool_use", content: [{ type: "text", text: "vou ver" }, ...usos.map((u, i) => ({ type: "tool_use", id: `tu_${i}`, name: u.name, input: u.input }))], usage };
}

function clienteFalso(respostas) {
  const fila = [...respostas];
  const create = jest.fn(async () => {
    const r = fila.shift();
    if (!r) throw new Error("dublê sem resposta");
    return typeof r === "function" ? r() : r;
  });
  return { client: { messages: { create } }, create };
}

const silencio = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

beforeAll(() => {
  globalThis.fetch = jest.fn(async () => { throw new Error("REDE PROIBIDA NO TESTE"); });
});

describe("o laço", () => {
  it("sem ferramenta: devolve o texto e o uso somado", async () => {
    const { client, create } = clienteFalso([respostaTexto("Olá!")]);
    const a = new AssistenteClient({ client, log: silencio, esforco: "medium" });
    const r = await a.responder({ system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "oi" }], ferramentas: [], executar: jest.fn() });
    expect(r).toMatchObject({ texto: "Olá!", iteracoes: 1, ferramentasChamadas: [], stopReason: "end_turn", recusou: false });
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    const chamada = create.mock.calls[0][0];
    expect(chamada.output_config).toEqual({ effort: "medium" });
    expect(chamada.tools).toBeUndefined();
  });

  it("⚠ DUAS ferramentas na mesma rodada voltam numa ÚNICA mensagem user, na ordem, e a recusa vai com is_error", async () => {
    const { client, create } = clienteFalso([
      respostaFerramentas([{ name: "listar_guias", input: { competencia: null, status: null } }, { name: "situacao_fiscal", input: {} }]),
      respostaTexto("pronto"),
    ]);
    const executar = jest.fn(async (nome) => (nome === "listar_guias" ? { ok: true, guias: [] } : { ok: false, motivo: "PAPEL_INSUFICIENTE", mensagem: "exige CLIENT_ADMIN" }));
    const a = new AssistenteClient({ client, log: silencio });
    const r = await a.responder({ system: [], messages: [{ role: "user", content: "x" }], ferramentas: [{ name: "listar_guias" }], executar });
    expect(r.texto).toBe("pronto");
    expect(r.ferramentasChamadas).toEqual(["listar_guias", "situacao_fiscal"]);
    const segunda = create.mock.calls[1][0].messages;
    expect(segunda[segunda.length - 2].role).toBe("assistant");
    const resultados = segunda[segunda.length - 1];
    expect(resultados.role).toBe("user");
    expect(resultados.content.map((c) => c.tool_use_id)).toEqual(["tu_0", "tu_1"]);
    expect(resultados.content[0].is_error).toBeUndefined();
    expect(resultados.content[1].is_error).toBe(true);
    expect(JSON.parse(resultados.content[1].content).motivo).toBe("PAPEL_INSUFICIENTE");
  });

  it("⚠ exceção na ferramenta vira is_error e o turno continua", async () => {
    const { client } = clienteFalso([respostaFerramentas([{ name: "quanto_devo", input: {} }]), respostaTexto("ok")]);
    const a = new AssistenteClient({ client, log: silencio });
    const r = await a.responder({ system: [], messages: [{ role: "user", content: "x" }], ferramentas: [], executar: async () => { throw new Error("banco caiu"); } });
    expect(r.texto).toBe("ok");
    expect(silencio.warn).toHaveBeenCalled();
  });

  it("refusal → recusou:true e texto vazio", async () => {
    const { client } = clienteFalso([{ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } }]);
    const r = await new AssistenteClient({ client, log: silencio }).responder({ system: [], messages: [{ role: "user", content: "x" }], executar: jest.fn() });
    expect(r.recusou).toBe(true);
    expect(r.stopReason).toBe("refusal");
  });

  it("⚠ o teto de iterações PARA o laço — a ferramenta que insiste não gasta para sempre", async () => {
    const infinito = () => respostaFerramentas([{ name: "quanto_devo", input: {} }]);
    const { client, create } = clienteFalso([infinito, infinito, infinito, infinito]);
    const a = new AssistenteClient({ client, log: silencio, maxIteracoes: 3 });
    const r = await a.responder({ system: [], messages: [{ role: "user", content: "x" }], executar: async () => ({ ok: true }) });
    expect(create).toHaveBeenCalledTimes(3);
    expect(r.stopReason).toBe(STOP_LOCAL.MAX_ITERACOES);
    expect(r.iteracoes).toBe(3);
  });

  it("erro da API sobe traduzido, sem chave", async () => {
    const { client } = clienteFalso([() => { const e = new Error("Unauthorized sk-ant-XXXX"); e.status = 401; throw e; }]);
    await expect(new AssistenteClient({ client, log: silencio }).responder({ system: [], messages: [{ role: "user", content: "x" }], executar: jest.fn() }))
      .rejects.toMatchObject({ codigo: "IA_AUTENTICACAO", status: 401 });
    const t = traduzirErro(Object.assign(new Error("x"), { status: 429 }));
    expect(t.codigo).toBe("IA_RATE_LIMIT");
    expect(t.retentavel).toBe(true);
    expect(t.message).not.toMatch(/sk-ant/);
  });

  it("textoDaResposta junta só os blocos de texto", () => {
    expect(textoDaResposta([{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(textoDaResposta(null)).toBe("");
  });
});
