jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  parcela: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  portalClient: { findUnique: jest.fn() }, guide: { findUnique: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "11111111000191" } })) }));
jest.mock("../SerproParcelamentoService.js", () => ({ SerproParcelamentoService: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproParcelamentoService } from "../SerproParcelamentoService.js";
import { confirmarPagamentoParcela, confirmarPagamentosParcelasEmLote } from "../SerproParcelaPagamentoService.js";
const raw = { status: 200, dados: { numeroParcelamento: 123, paDasGerado: 202609, numeroParcela: 3,
  dataPagamento: 20260920, valorPagoArrecadacao: 100, pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 100, juros: 0, multa: 0, total: 100 }] }] } };
const consultar = jest.fn();
const item = extra => ({ id: "p", portalClientId: "empresa", anoMesParcela: "202609", numeroParcela: 3, valorPrevisto: 100,
  parcelamento: { tipo: "PARCSN", numeroParcelamento: "123" }, ...extra });
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z"));
  prisma.parcela.findFirst.mockResolvedValue(item({}));
  prisma.parcela.updateMany.mockResolvedValue({ count: 1 });
  prisma.portalClient.findUnique.mockResolvedValue({ cnpj: "22222222000191" });
  prisma.$transaction.mockImplementation(fn => fn(prisma));
  consultar.mockResolvedValue({ raw });
  SerproParcelamentoService.mockImplementation(() => ({ consultarPagamentoParcela: consultar }));
});
afterEach(() => jest.useRealTimers());
test("confirma sem guia e sem abertura contábil, sem criar nenhum lançamento", async () => {
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: true, status: "CONFIRMADO" });
  expect(consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "PARCSN", numeroParcelamento: 123, anoMesParcela: 202609 }));
  const data = prisma.parcela.updateMany.mock.calls.at(-1)[0].data;
  expect(data).toMatchObject({ pagamentoStatus: "CONFIRMADO", valorPago: 100, pagamentoEm: new Date("2026-09-20Z") });
  expect(data).not.toHaveProperty("origemBaixa");
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
});
test("MEI usa sua modalidade e confirmação não requer regime atual da empresa", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ parcelamento: { tipo: "PARCMEI", numeroParcelamento: "123" } }));
  await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" });
  expect(consultar.mock.calls[0][0].tipo).toBe("PARCMEI");
});
test.each([{ origemBaixa: "MANUAL" }, { pagamentoStatus: "CONFIRMADO" }, { guia: { paymentStatus: "PAID" } }])("preserva baixa/confirmacao existente sem custo: %j", async extra => {
  prisma.parcela.findFirst.mockResolvedValue(item(extra));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ skipped: "already_paid" });
  expect(consultar).not.toHaveBeenCalled();
});
test("reserva concorrente perdida não faz consulta", async () => {
  prisma.parcela.updateMany.mockResolvedValue({ count: 0 });
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ skipped: "consulta_em_andamento" });
  expect(consultar).not.toHaveBeenCalled();
});
test("erro de procuração mantém pagamento anterior e registra motivo", async () => {
  consultar.mockRejectedValueOnce(Object.assign(new Error("Sem permissão"), { code: "SEM_PROCURACAO" }));
  await expect(confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).rejects.toMatchObject({ code: "SEM_PROCURACAO" });
  expect(prisma.parcela.updateMany.mock.calls.at(-1)[0].data).toEqual({ pagamentoErro: "SEM_PROCURACAO" });
});
test("lease perdida antes de iniciar não lê nem consulta", async () => {
  await expect(confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p", assertActive: () => { throw Error("lease"); } })).rejects.toThrow("lease");
  expect(prisma.parcela.findFirst).not.toHaveBeenCalled();
});
test("intervalo mínimo persistido impede repetição mesmo em chamada manual", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ pagamentoConsultadoEm: new Date("2026-09-24T14:59:00Z") }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p", force: true })).toMatchObject({ skipped: "intervalo_minimo" });
  expect(consultar).not.toHaveBeenCalled();
});
test("correção de permissão permite nova tentativa manual após 15min sem liberar o lote diário", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ pagamentoConsultadoEm: new Date("2026-09-24T14:44:00Z"), pagamentoErro: "SEM_PROCURACAO" }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ skipped: "intervalo_minimo" });
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p", force: true })).toMatchObject({ pago: true });
  expect(consultar).toHaveBeenCalledTimes(1);
});
test("PDF capturado após vencimento com fields.composicao não invalida pagamento original sem juros", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ valorPrevisto: 110, guia: { valor: 110, extracted: { fields: {
    composicao: [{ codigo: "1001", principal: 100, juros: 10, multa: 0, total: 110 }],
  } } } }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: true });
});
test("composição parcial do PDF não reduz o limiar para quitar pagamento incompleto", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ valorPrevisto: 110, guia: { valor: 110, extracted: { fields: {
    composicao: [{ codigo: "1001", principal: 50, juros: 10, multa: 0, total: 60 }],
  } } } }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: false, status: "DIVERGENTE" });
});
test("contrato excluído não gera chamada individual", async () => {
  prisma.parcela.findFirst.mockResolvedValue(item({ parcelamento: { tipo: "PARCSN", status: "EXCLUIDO", numeroParcelamento: "123" } }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ skipped: "contrato_excluido" });
  expect(consultar).not.toHaveBeenCalled();
});
test("lote inclui anteriores e exclui futuro, prioriza nunca consultadas e passa de 500 com orçamento explícito", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: `p${String(i).padStart(4, "0")}`, portalClientId: "empresa" }));
  prisma.parcela.findMany.mockImplementation(async ({ where, take }) => rows.filter(r => !(where.id?.notIn || []).includes(r.id)).slice(0, take));
  prisma.parcela.findFirst.mockImplementation(async ({ where }) => item({ id: where.id, pagamentoStatus: "CONFIRMADO" }));
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], limite: 600 });
  expect(r.total).toBe(501);
  expect(prisma.parcela.findMany.mock.calls[0][0]).toMatchObject({ where: { anoMesParcela: { not: null, lte: "202609" } },
    orderBy: [{ pagamentoConsultadoEm: { sort: "asc", nulls: "first" } }, { id: "asc" }] });
  expect(consultar).not.toHaveBeenCalled();
  expect(prisma.parcela.findMany.mock.calls[0][0].where.parcelamento.status).toEqual({ not: "EXCLUIDO" });
  expect(prisma.parcela.findMany.mock.calls[0][0].where).toMatchObject({ baixadaEm: null, guia: { isNot: { OR: [{ paymentStatus: "PAID" }, { baixada: true }] } } });
});
