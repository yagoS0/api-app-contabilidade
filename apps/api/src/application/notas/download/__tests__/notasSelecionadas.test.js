import { baixarNotasSelecionadas, gerarDanfeNfe } from "../NotasSelecionadasService.js";
import { xmlParaDanfe } from "./danfeFixture.js";

function db(notas = []) { return {
  portalInvoice: { findMany: jest.fn().mockResolvedValue(notas) },
  portalClient: { findUnique: jest.fn().mockResolvedValue({ companyId: "legada-a" }) },
  serviceInvoice: { findMany: jest.fn().mockResolvedValue([]) },
}; }
const nota = { id: "n1", numero: "101", type: "NFE", xmlRaw: xmlParaDanfe() };
it("baixa XMLs completos uma vez e inclui diagnóstico de arquivo indisponível", async () => {
  const client = db([nota, { id: "n2", type: "NFE", xmlRaw: "<resNFe/>" }]);
  const out = await baixarNotasSelecionadas({ portalClientId: "pc-a", notaIds: ["n1", "n1", "n2"], formato: "XML", client });
  expect(out).toMatchObject({ geradas: 1, falhas: 1 });
  expect(out.zip.subarray(0, 2).toString()).toBe("PK");
  expect(out.zip.toString()).toContain("RELATORIO.txt");
  expect(out.zip.toString()).toContain("NFE-101-n1.xml");
  expect(client.portalInvoice.findMany.mock.calls[0][0].where).toEqual({ clientId: "pc-a", id: { in: ["n1", "n2"] } });
});
it("não entrega nota de outra empresa e limita a consulta da emissão ao ID legado autorizado", async () => {
  const client = db();
  await expect(baixarNotasSelecionadas({ portalClientId: "pc-a", notaIds: ["outra"], formato: "XML", client })).rejects.toMatchObject({ status: 404 });
  expect(client.serviceInvoice.findMany.mock.calls[0][0].where).toEqual({ companyId: "legada-a", id: { in: ["outra"] } });
});
it("recusa lote vazio, muito grande e formato inválido antes de consultar", async () => {
  const client = db();
  for (const args of [{ notaIds: [] }, { notaIds: Array(101).fill("n1") }, { notaIds: ["n1"], formato: "EXE" }]) {
    await expect(baixarNotasSelecionadas({ portalClientId: "pc-a", formato: "XML", ...args, client })).rejects.toMatchObject({ status: 400 });
  }
  expect(client.portalInvoice.findMany).not.toHaveBeenCalled();
});
it("informa falha total sem gerar um ZIP vazio", async () => {
  await expect(baixarNotasSelecionadas({ portalClientId: "pc-a", notaIds: ["n1"], formato: "PDF", client: db([{ ...nota, xmlRaw: null }]) })).rejects.toMatchObject({ status: 422 });
});
it("usa o gerador correto e marca NF-e cancelada", async () => {
  const gerarNfe = jest.fn().mockResolvedValue(Buffer.from("pdf"));
  const gerarNfse = jest.fn().mockResolvedValue({ pdf: Buffer.from("pdf") });
  const client = db([{ ...nota, statusEfetivo: "cancelada" }, { id: "ns", type: "NFSE", xmlRaw: "<NFSe/>" }]);
  const out = await baixarNotasSelecionadas({ portalClientId: "pc-a", notaIds: ["n1", "ns"], formato: "PDF", client, gerarNfe, gerarNfse });
  expect(out.geradas).toBe(2);
  expect(gerarNfe).toHaveBeenCalledWith({ xml: nota.xmlRaw, cancelada: true });
  expect(gerarNfse).toHaveBeenCalledWith({ portalClientId: "pc-a", notaId: "ns", client });
});
it("gera DANFE de uma NF-e completa e recusa resumo ou XML sem autorização", async () => {
  const pdf = await gerarDanfeNfe({ xml: xmlParaDanfe() });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(gerarDanfeNfe({ xml: "<resNFe/>" })).rejects.toThrow("XML completo");
  await expect(gerarDanfeNfe({ xml: xmlParaDanfe().replace("<cStat>100", "<cStat>110") })).rejects.toThrow("autorização");
});
