jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { prepararParcelamentoDaGuia, vincularGuiaParcelamentoTx } from "../GuiaAvulsaParcelamentoService.js";

const destino = { id: "contrato", portalClientId: "empresa", tipo: "PARCSN", origem: "MANUAL", status: "ATIVO" };
const origem = { id: "avulso", portalClientId: "empresa", tipo: "PARCSN", origem: "GUIA_AVULSA", updatedAt: new Date("2026-09-01Z") };
function contexto(extra = {}, candidato = null) {
  const guide = { id: "g", portalClientId: "empresa", parcelamentoId: "avulso", parcelamento: origem,
    competencia: "2026-09", vencimento: new Date("2026-09-20Z"), valor: 110, updatedAt: new Date(), numeroParcela: 3,
    paymentStatus: "PAID", extracted: { comprovante: { principal: 100, total: 100, juros: 0 }, indicacaoParcelamentoId: "ind" },
    parcela: { id: "prestacao", updatedAt: new Date("2026-09-01Z"), pagamentoStatus: "CONFIRMADO", valorPago: 100, pagamentoEvidencia: { comprovante: { total: 100 } } }, ...extra };
  return { guide, tx: {
    guide: { findFirst: jest.fn(async () => guide), updateMany: jest.fn(async () => ({ count: 1 })) },
    parcelamento: { findFirst: jest.fn(async () => destino), updateMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async x => ({ id: "novo", ...x.data })) },
    parcela: { findFirst: jest.fn(async () => candidato), create: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })), deleteMany: jest.fn(async () => ({ count: 1 })) },
  } };
}
test("subir parcela avulsa não inventa número, calendário, saldo ou provisão", async () => {
  const { tx } = contexto();
  const result = await prepararParcelamentoDaGuia({ portalClientId: "empresa", metadata: { isParcelamento: true, parcelamentoTipo: "PARCSN" }, client: tx });
  expect(result).toMatchObject({ origem: "GUIA_AVULSA", numeroParcelamento: null, numParcelas: null, totalValue: null, competenciaInicial: null });
  expect(result).not.toHaveProperty("aberturaEntryId");
  expect(tx.parcela.create).not.toHaveBeenCalled();
});
test("guia normal não passa a ser parcelamento por inferência", async () => {
  const { tx } = contexto();
  expect(await prepararParcelamentoDaGuia({ portalClientId: "empresa", metadata: { tipo: "SIMPLES" }, client: tx })).toBeNull();
  expect(tx.parcelamento.create).not.toHaveBeenCalled();
});
test("vínculo posterior conserva pagamento e identidade da parcela e remove só previsão vazia", async () => {
  const { tx, guide } = contexto({}, { id: "previsao", numeroParcela: 3, origem: "CONTRATO", updatedAt: new Date("2026-09-02Z") });
  const prova = JSON.stringify(guide.parcela);
  await vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato", numeroParcela: 3 });
  expect(tx.parcela.updateMany).toHaveBeenCalledWith({ where: { id: "prestacao", portalClientId: "empresa", parcelamentoId: "avulso", guiaId: "g", updatedAt: guide.parcela.updatedAt, origemBaixa: null, baixadaEm: null }, data: { parcelamentoId: "contrato", numeroParcela: 3 } });
  expect(JSON.stringify(guide.parcela)).toBe(prova);
  expect(tx.parcela.deleteMany).toHaveBeenCalledWith({ where: { id: "previsao", portalClientId: "empresa", parcelamentoId: "contrato", origem: "CONTRATO", updatedAt: new Date("2026-09-02Z"), guiaId: null, origemBaixa: null, baixadaEm: null, pagamentoStatus: null, pagamentoConsultadoEm: null, pagamentoEm: null, valorPago: null, pagamentoErro: null } });
  expect(tx.guide.updateMany.mock.calls[0][0].data).not.toHaveProperty("paymentStatus");
  expect(tx.guide.updateMany.mock.calls[0][0].data).not.toHaveProperty("valor");
  expect(tx.parcelamento.updateMany).toHaveBeenCalledWith({ where: { id: "avulso", portalClientId: "empresa", origem: "GUIA_AVULSA", aberturaEntryId: null, updatedAt: origem.updatedAt }, data: { status: "EXCLUIDO" } });
});
test.each([{ guiaId: "outra" }, { pagamentoStatus: "CONFIRMADO" }, { origemBaixa: "MANUAL" }])("não substitui evidência existente no destino %j", async dado => {
  const { tx } = contexto({}, { id: "previsao", ...dado });
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato" })).rejects.toMatchObject({ code: "PARCELA_JA_VINCULADA" });
  expect(tx.guide.updateMany).not.toHaveBeenCalled();
});
test("vínculo não altera guia já contabilizada", async () => {
  const { tx } = contexto({ baixada: true });
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato" })).rejects.toMatchObject({ code: "GUIA_CONTABILIZADA" });
});
test("guia de contrato real não muda de acordo por este atalho", async () => {
  const { tx } = contexto({ parcelamento: { ...origem, origem: "MANUAL" } });
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato" })).rejects.toMatchObject({ code: "VINCULO_EXISTENTE" });
});
test("mudança concorrente interrompe antes de mover parcelas", async () => {
  const { tx } = contexto(); tx.guide.updateMany.mockResolvedValue({ count: 0 });
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato" })).rejects.toMatchObject({ code: "GUIA_ALTERADA" });
  expect(tx.parcela.updateMany).not.toHaveBeenCalled();
});
test("destino e guia são consultados dentro da empresa autorizada", async () => {
  const { tx } = contexto(); tx.parcelamento.findFirst.mockResolvedValue(null);
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "outra-empresa" })).rejects.toMatchObject({ code: "VINCULO_NAO_ENCONTRADO" });
  expect(tx.parcelamento.findFirst.mock.calls[0][0].where.portalClientId).toBe("empresa");
  expect(tx.guide.findFirst.mock.calls[0][0].where.portalClientId).toBe("empresa");
});

test("evidência concorrente na previsão aborta sem mover a parcela fiscal", async () => {
  const { tx } = contexto({}, { id: "previsao", origem: "CONTRATO", updatedAt: new Date() });
  tx.parcela.deleteMany.mockResolvedValue({ count: 0 });
  await expect(vincularGuiaParcelamentoTx(tx, { portalClientId: "empresa", guideId: "g", parcelamentoId: "contrato" })).rejects.toMatchObject({ code: "PARCELA_ALTERADA" });
  expect(tx.parcela.updateMany).not.toHaveBeenCalled();
});
