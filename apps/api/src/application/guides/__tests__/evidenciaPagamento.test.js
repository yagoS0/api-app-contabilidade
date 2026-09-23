jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findUnique: jest.fn(), updateMany: jest.fn() } } }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { atualizarGuiaComEvidencia } from "../atualizarGuiaComEvidencia.js";
import { markGuidePaidByComprovante, markGuidePaidManual } from "../GuidePaymentStatusService.js";
import { dataDoComprovante, comprovanteParaRegistro } from "../lib/comprovantePagamento.js";

const comprovante = { principal: 1000, juros: 0, multa: 0, total: 1000, confiavel: true, dataArrecadacaoBR: "18/07/2026" };
let guia;
beforeEach(() => {
  jest.clearAllMocks();
  guia = { id: "g1", valor: 1100, updatedAt: new Date("2026-09-01"), extracted: { numeroDocumento: "doc1" } };
  prisma.guide.findUnique.mockImplementation(async () => ({ ...guia }));
  prisma.guide.updateMany.mockImplementation(async ({ data }) => { guia = { ...guia, ...data }; return { count: 1 }; });
});

test("comprovante persiste data real e valor pago diferente da cobrança", async () => {
  const r = await markGuidePaidByComprovante({ guideId: "g1", comprovante });
  expect(r.valor).toBe(1100);
  expect(r.paymentConfirmedAt).toEqual(new Date("2026-07-18T00:00:00Z"));
  expect(r.extracted).toMatchObject({ numeroDocumento: "doc1", comprovante: { total: 1000, juros: 0, multa: 0, dataArrecadacao: "18/07/2026" } });
});

test("consulta sem data não fabrica instante da confirmação como pagamento", async () => {
  const r = await markGuidePaidByComprovante({ guideId: "g1" });
  expect(r.paymentConfirmedAt).toBeNull();
});

test("reconfirmar guia não sobrescreve data/autoria da baixa já registrada", async () => {
  guia = { ...guia, baixada: true, paymentConfirmedAt: new Date("2026-07-17"), paymentConfirmedByUserId: "contador" };
  const r = await markGuidePaidManual({ guideId: "g1", userId: "outro", pagoEm: new Date("2026-07-18"), comprovante, preservarBaixa: true });
  expect(r.paymentConfirmedByUserId).toBe("contador");
  expect(r.paymentConfirmedAt).toEqual(new Date("2026-07-17"));
  expect(r.extracted.comprovante.total).toBe(1000);
});

test("baixa existente conserva data e autoria quando comprovante é localizado depois", async () => {
  guia = { ...guia, baixada: true, paymentConfirmedAt: new Date("2026-07-17"), paymentConfirmedByUserId: "contador" };
  const r = await markGuidePaidByComprovante({ guideId: "g1", comprovante });
  expect(r.paymentConfirmedByUserId).toBe("contador");
  expect(r.paymentConfirmedAt).toEqual(new Date("2026-07-17"));
  expect(r.extracted.comprovante.total).toBe(1000);
});

test("perder corrida relê JSON e não apaga evidência recebida durante a atualização", async () => {
  prisma.guide.updateMany.mockImplementationOnce(async () => {
    guia = { ...guia, updatedAt: new Date("2026-09-02"), extracted: { numeroDocumento: "doc2", comprovante } };
    return { count: 0 };
  });
  const r = await atualizarGuiaComEvidencia(prisma, "g1", atual => ({ extracted: { ...atual.extracted, novo: true } }));
  expect(r.extracted).toMatchObject({ numeroDocumento: "doc2", comprovante, novo: true });
  expect(prisma.guide.updateMany.mock.calls[1][0].where.updatedAt).toEqual(new Date("2026-09-02"));
});

test("disputa persistente recusa sem afirmar sucesso", async () => {
  prisma.guide.updateMany.mockResolvedValue({ count: 0 });
  await expect(atualizarGuiaComEvidencia(prisma, "g1", () => ({}))).rejects.toMatchObject({ code: "GUIA_ALTERADA" });
});

test.each(["31/02/2026", "2026-02-31", "inválido", null])("data documental inválida %s continua desconhecida", dataArrecadacao => {
  expect(dataDoComprovante({ dataArrecadacao })).toBeNull();
});

test("serialização conserva encargos zero como números conhecidos", () => {
  expect(comprovanteParaRegistro(comprovante)).toMatchObject({ juros: 0, multa: 0, total: 1000, dataArrecadacao: "18/07/2026" });
});
