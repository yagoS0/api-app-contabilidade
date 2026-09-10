import { createRealApi } from "../realApi";
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test("carrega também a guia posterior aos primeiros 50 registros", async () => {
  const primeira = Array.from({ length: 50 }, (_, i) => ({ guideId: `g${i}` }));
  global.fetch = jest.fn(async (url) => ({ ok: true, status: 200,
    json: async () => ({ total: 51, data: String(url).includes("page=1&") ? primeira : [{ guideId: "parcela-setembro" }] }),
  }));
  const result = await createRealApi().getCompanyGuides("empresa");
  expect(result).toHaveLength(51);
  expect(result[50].guideId).toBe("parcela-setembro");
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
test("falha na segunda página não retorna uma lista parcial como completa", async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ total: 51, data: Array(50).fill({ guideId: "g" }) }) })
    .mockRejectedValueOnce(new Error("Falha de conexão"));
  await expect(createRealApi().getCompanyGuides("empresa")).rejects.toThrow();
});
