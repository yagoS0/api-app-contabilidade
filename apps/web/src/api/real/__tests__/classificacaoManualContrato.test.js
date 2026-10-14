import { createRealApi } from "../realApi";
test("classificação manual envia escolhas explícitas e competência ao servidor", async () => {
 const anterior = global.fetch;
 const classificacoes = [{ notaId: "n1", tipoReceita: "SERVICO_ANEXO_IV" }];
 global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { classified: 1 } }) }));
 try { await createRealApi().classificarV2("pc1", { competencia: "2026-09", classificacoes }); expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/pc1/classificar-v2?competencia=2026-09"), expect.objectContaining({ method: "POST", body: JSON.stringify({ competencia: "2026-09", classificacoes }) })); } finally { global.fetch = anterior; }
});
