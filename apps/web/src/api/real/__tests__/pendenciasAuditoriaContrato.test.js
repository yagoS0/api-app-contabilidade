import { createRealApi } from "../realApi";

let anterior;
beforeEach(() => { anterior = global.fetch; global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, pendencias: [] }) })); });
afterEach(() => { global.fetch = anterior; });

test("concluir pendência pós-fechamento não chama a resolução de classificação", async () => {
  await createRealApi().resolverPendenciaPosFechamento("empresa", "pendencia");
  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/firm\/companies\/empresa\/pendencias-pos-fechamento\/pendencia\/resolver$/), expect.objectContaining({ method: "POST" }));
});

test("HTTP 200 sem lista não anuncia ausência de pendências", async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await expect(createRealApi().listPendenciasPosFechamento("empresa")).rejects.toThrow(/confirmar as pendências/);
});

test("lista vazia confirmada permanece válida", async () => {
  await expect(createRealApi().listPendenciasPosFechamento("empresa")).resolves.toEqual([]);
});
