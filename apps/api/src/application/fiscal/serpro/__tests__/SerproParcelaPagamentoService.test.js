jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  parcela: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  portalClient: { findUnique: jest.fn() }, guide: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() }, $transaction: jest.fn(), $queryRaw: jest.fn(),
  guidePaymentObservation: { findUnique: jest.fn(), create: jest.fn() },
} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "11111111000191" } })) }));
jest.mock("../SerproParcelamentoService.js", () => ({ SerproParcelamentoService: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { SerproParcelamentoService } from "../SerproParcelamentoService.js";
import { confirmarPagamentoParcela, confirmarPagamentosParcelasEmLote } from "../SerproParcelaPagamentoService.js";
const raw = { status: 200, dados: { numeroParcelamento: 123, paDasGerado: 202609, numeroParcela: 3,
  dataPagamento: 20260920, valorPagoArrecadacao: 100, pagamentoDebitos: [{ discriminacoesDebito: [{ principal: 100, juros: 0, multa: 0, total: 100 }] }] } };
const consultar = jest.fn();
const item = extra => ({ id: "p", portalClientId: "empresa", parcelamentoId: "contrato", anoMesParcela: "202609", numeroParcela: 3, valorPrevisto: 100,
  parcelamento: { id: "contrato", portalClientId: "empresa", tipo: "PARCSN", numeroParcelamento: "123" }, ...extra });
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z"));
  prisma.parcela.findFirst.mockResolvedValue(item({}));
  prisma.parcela.updateMany.mockResolvedValue({ count: 1 });
  prisma.portalClient.findUnique.mockResolvedValue({ cnpj: "22222222000191" });
  prisma.$transaction.mockImplementation(fn => fn(prisma));
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.guidePaymentObservation.findUnique.mockResolvedValue(null);
  prisma.guidePaymentObservation.create.mockImplementation(async ({data}) => ({ id: "observacao", ...data }));
  prisma.guide.update.mockImplementation(async ({data}) => data);
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
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, status: "DIVERGENTE" });
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

test.each([[[]], [[null, "", "  "]]])("seleção explícita vazia %j não amplia para todas as parcelas", async parcelaIds => {
  expect(await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds })).toEqual({ total: 0, results: [] });
  expect(prisma.parcela.findMany).not.toHaveBeenCalled();
  expect(consultar).not.toHaveBeenCalled();
});

test.each([null, "p1", {}])("seleção inválida %j não executa lote geral", async parcelaIds => {
  await expect(confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds })).rejects.toMatchObject({ code: "PARCELA_IDS_INVALIDOS" });
  expect(prisma.parcela.findMany).not.toHaveBeenCalled();
});

test("retomada consulta somente subconjunto selecionado dentro da carteira autorizada", async () => {
  const rows = [{ id: "p1", portalClientId: "empresa" }, { id: "p2", portalClientId: "empresa" }, { id: "p3", portalClientId: "outra-empresa" }];
  prisma.parcela.findMany.mockImplementation(async ({ where, take }) => {
    const selecionadas = where.AND.find(filtro => filtro.id)?.id.in;
    return rows.filter(r => where.portalClientId.in.includes(r.portalClientId) && selecionadas.includes(r.id) && !(where.id?.notIn || []).includes(r.id)).slice(0, take);
  });
  prisma.parcela.findFirst.mockImplementation(async ({ where }) => item({ id: where.id, pagamentoStatus: "CONFIRMADO" }));
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds: ["p2", "p3", "p2"], limite: 600 });
  expect(r.total).toBe(2);
  expect(r.results[0]).toEqual({ parcelaId: "p2", status: "already_paid" });
  expect(r.results[1]).toMatchObject({ parcelaId: "p3", status: "nao_consultado", resultadoConsulta: { consultadoEm: null, cobertura: "NAO_CONSULTADA" } });
  expect(prisma.parcela.findFirst).toHaveBeenCalledTimes(1);
  expect(prisma.parcela.findFirst.mock.calls[0][0].where).toEqual({ id: "p2", portalClientId: "empresa" });
  const filtros = prisma.parcela.findMany.mock.calls[0][0].where;
  expect(filtros.AND).toContainEqual({ id: { in: ["p2", "p3"] } });
  expect(filtros.AND).toContainEqual({ OR: [{ pagamentoStatus: null }, { pagamentoStatus: { not: "CONFIRMADO" } }] });
  expect(filtros).toMatchObject({ portalClientId: { in: ["empresa"] }, origemBaixa: null, baixadaEm: null, anoMesParcela: { not: null, lte: "202609" }, parcelamento: { status: { not: "EXCLUIDO" } } });
});

test("seleção explícita preserva lease antes da consulta do lote", async () => {
  const assertActive = jest.fn(() => { throw Error("lease perdida"); });
  await expect(confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds: ["p1"], assertActive })).rejects.toThrow("lease perdida");
  expect(prisma.parcela.findMany).not.toHaveBeenCalled();
  expect(consultar).not.toHaveBeenCalled();
});

test("resposta divergente tem resultado comum e nunca pago falso", async () => {
  consultar.mockResolvedValueOnce({ raw: { ...raw, dados: { ...raw.dados, numeroParcela: 9 } } });
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, resultadoConsulta: {
    estado: "PARCIAL_OU_DIVERGENTE", fonte: "PARCELAMENTO_PARCSN", consultadoEm: "2026-09-24T15:00:00.000Z", cobertura: "PARCIAL", identidadeConferida: false,
  } });
  expect(prisma.parcela.updateMany.mock.calls.at(-1)[0].data).not.toHaveProperty("pagamentoEm");
});

test("confirmação conserva instante original embora consulta demore", async () => {
  consultar.mockImplementationOnce(async () => { jest.setSystemTime(new Date("2026-09-24T15:02:00Z")); return { raw }; });
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: true, resultadoConsulta: {
    estado: "CONFIRMADO", consultadoEm: "2026-09-24T15:00:00.000Z", identidadeConferida: true, cobertura: "COMPLETA",
  } });
});

test.each([
  { anoMesParcela: "202610" },
  { numeroParcela: 4 },
  { parcelamentoId: "outro" },
  { guiaId: "outra-guia" },
  { valorPrevisto: 200 },
  { parcelamento: { id: "contrato", portalClientId: "empresa", tipo: "PARCSN", numeroParcelamento: "456" } },
  { parcelamento: { id: "contrato", portalClientId: "empresa", tipo: "PARCSN", numeroParcelamento: "123", status: "EXCLUIDO" } },
])("referência alterada durante HTTP não recebe confirmação (%j)", async change => {
  prisma.parcela.findFirst.mockResolvedValueOnce(item({})).mockResolvedValueOnce(item(change));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, aplicada: false, motivo: "REFERENCIA_ALTERADA" });
  expect(prisma.parcela.updateMany).toHaveBeenCalledTimes(1);
  expect(prisma.guide.update).not.toHaveBeenCalled();
});

test("CNPJ alterado durante HTTP não recebe confirmação da empresa anterior", async () => {
  prisma.portalClient.findUnique.mockResolvedValueOnce({ cnpj: "22222222000191" }).mockResolvedValueOnce({ cnpj: "33333333000191" });
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, aplicada: false, motivo: "EMPRESA_ALTERADA" });
  expect(prisma.parcela.updateMany).toHaveBeenCalledTimes(1);
});

test.each([{ origemBaixa: "MANUAL" }, { baixadaEm: new Date("2026-09-20Z") }, { pagamentoStatus: "CONFIRMADO" }])("baixa concorrente preservada (%j)", async change => {
  prisma.parcela.findFirst.mockResolvedValueOnce(item({})).mockResolvedValueOnce(item(change));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, aplicada: false, motivo: "PAGAMENTO_JA_REGISTRADO" });
  expect(prisma.parcela.updateMany).toHaveBeenCalledTimes(1);
});

test.each(["depois_http", "dentro_tx"])("lease perdida %s impede gravar resposta fiscal", async local => {
  let ativa = true;
  if (local === "depois_http") consultar.mockImplementationOnce(async () => { ativa = false; return { raw }; });
  else prisma.$queryRaw.mockImplementationOnce(async () => { ativa = false; return []; });
  const assertActive = () => { if (!ativa) throw Error("lease perdida"); };
  await expect(confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p", assertActive })).rejects.toThrow("lease perdida");
  expect(prisma.parcela.updateMany).toHaveBeenCalledTimes(1);
});

test("guia vinculada usa observação append-only na mesma transação, sem lançamento", async () => {
  const guia = { id: "g", portalClientId: "empresa", cnpj: "22222222000191", parcelamentoId: "contrato", numeroParcela: 3,
    tipo: "SIMPLES", competencia: "2026-08", valor: 100, status: "PROCESSED", hash: "v1", extracted: {}, tributosParcela: [] };
  prisma.parcela.findFirst.mockResolvedValue(item({ guiaId: "g", guia }));
  prisma.guide.findUnique.mockResolvedValue(guia);
  const r = await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" });
  expect(r).toMatchObject({ pago: true, aplicada: true });
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(prisma.guidePaymentObservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guideId: "g", state: "CONFIRMADO" }) }));
  expect(prisma.guide.update.mock.calls[0][0].data).toMatchObject({ paymentStatus: "PAID", paymentConfirmedAt: new Date("2026-09-20Z"), extracted: { comprovante: { principal: 100, multa: 0, juros: 0 } } });
});

test("recálculo de PDF da guia durante HTTP invalida resultado da parcela", async () => {
  const guia = { id: "g", portalClientId: "empresa", cnpj: "22222222000191", hash: "v1", valor: 100, extracted: {} };
  prisma.parcela.findFirst.mockResolvedValueOnce(item({ guiaId: "g", guia })).mockResolvedValueOnce(item({ guiaId: "g", guia: { ...guia, hash: "v2", valor: 110 } }));
  expect(await confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).toMatchObject({ pago: null, aplicada: false, motivo: "REFERENCIA_ALTERADA" });
  expect(prisma.guidePaymentObservation.create).not.toHaveBeenCalled();
});

test("retomada bloqueada por intervalo não desaparece como sucesso de zero consultas", async () => {
  prisma.parcela.findMany.mockResolvedValue([]);
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds: ["p"] });
  expect(r).toEqual({ total: 1, results: [{ parcelaId: "p", status: "nao_consultado", motivo: "FORA_DO_ESCOPO_OU_INTERVALO_MINIMO",
    resultadoConsulta: { estado: "INDETERMINADO", fonte: "VALIDACAO_LOCAL", consultadoEm: null, cobertura: "NAO_CONSULTADA", identidadeConferida: false, motivo: "FORA_DO_ESCOPO_OU_INTERVALO_MINIMO" } }] });
  expect(consultar).not.toHaveBeenCalled();
});

test("lote conserva metadados da observação sem devolver retorno fiscal bruto", async () => {
  prisma.parcela.findMany.mockResolvedValueOnce([{ id: "p", portalClientId: "empresa" }]).mockResolvedValueOnce([]);
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds: ["p"] });
  expect(r.results[0]).toMatchObject({ status: "paid", aplicada: true, resultadoConsulta: { estado: "CONFIRMADO", consultadoEm: "2026-09-24T15:00:00.000Z", identidadeObrigacao: { tipo: "PARCELA", parcelamentoId: "contrato" } } });
  expect(r.results[0]).not.toHaveProperty("raw");
  expect(r.results[0].resultadoConsulta).not.toHaveProperty("raw");
});

test("snapshot explícito sem carteira autorizada permanece não consultado", async () => {
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: [], parcelaIds: ["p"] });
  expect(r).toMatchObject({ total: 1, results: [{ parcelaId: "p", status: "nao_consultado" }] });
  expect(prisma.parcela.findMany).not.toHaveBeenCalled();
});

test("guia vinculada a outro contrato não fornece valores para confirmar esta parcela", async () => {
  prisma.parcela.findFirst.mockResolvedValueOnce(item({ guiaId: "g", guia: { id: "g", parcelamentoId: "outro-contrato", valor: 50, extracted: { principal: 50 } } }));
  await expect(confirmarPagamentoParcela({ portalClientId: "empresa", parcelaId: "p" })).rejects.toMatchObject({ code: "PARCELA_EMPRESA_DIVERGENTE" });
  expect(consultar).not.toHaveBeenCalled();
});

test("lote distingue parcela divergente de consulta inconclusiva", async () => {
  prisma.parcela.findMany.mockResolvedValueOnce([{ id: "p", portalClientId: "empresa" }]).mockResolvedValueOnce([]);
  consultar.mockResolvedValueOnce({ raw: { ...raw, dados: { ...raw.dados, numeroParcela: 9 } } });
  const r = await confirmarPagamentosParcelasEmLote({ portalClientIds: ["empresa"], parcelaIds: ["p"] });
  expect(r.results[0]).toMatchObject({ status: "divergente", resultadoConsulta: { estado: "PARCIAL_OU_DIVERGENTE" } });
});
