import { createRealApi } from "../realApi";

test("salvar cenário envia JSON válido com os campos de edição preservados", async () => {
  const anterior = global.fetch;
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    expect(body.entradas.formularioCenario.receita).toBe("98.068,68");
    return { ok: true, status: 201, json: async () => ({ ok: true, simulacao: { id: "s1" } }) };
  });
  try {
    await createRealApi().salvarSimulacaoPlanejamento("empresa-teste", { competencia: "2026-08", entradas: { formularioCenario: { receita: "98.068,68" } }, resultado: {} });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/empresa-teste\/planejamento\/simulacoes$/), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "Content-Type": "application/json" }), body: expect.any(String) }));
  } finally { global.fetch = anterior; }
});
