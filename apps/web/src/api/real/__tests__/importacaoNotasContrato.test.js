import { createRealApi } from "../realApi";
test.each([["NFE", "nfe"], ["NFSE", "xml"]])("importação %s usa a rota própria e preserva o lote", async (type, rota) => {
  const anterior = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  try {
    const arquivos = [new File(["<nota/>"], "primeira.xml"), new File(["<nota/>"], "segunda.xml")];
    await createRealApi().importInvoicesXml("empresa-teste", arquivos, { type });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`/clients/empresa-teste/invoices/import/${rota}$`)), expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(global.fetch.mock.calls[0][1].body.getAll("files").map(f => f.name)).toEqual(["primeira.xml", "segunda.xml"]);
  } finally { global.fetch = anterior; }
});
