import { prisma } from "../../../../infrastructure/db/prisma.js";
import { confirmarPagamentoGuia, runPaymentConfirmationOnce } from "../SerproPaymentConfirmationService.js";
import { consultarDasIndexPorCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { confirmarPagamento } from "../SerproPagtoWebService.js";
import { registrarConsultaPagamentoGuia } from "../../../guides/ConsultaPagamentoGuiaService.js";
import { gerarPagamentoInssFromGuide } from "../../../accounting/InssPagamentoService.js";
import { confirmarPagamentoParcela } from "../SerproParcelaPagamentoService.js";

jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  guide: { findUnique: jest.fn(), findMany: jest.fn() }, companyMonthlyCircular: { findFirst: jest.fn() }, parcela: { findFirst: jest.fn() },
} }));
jest.mock("../SerproPgdasDeclaracaoService.js", () => ({ consultarDasIndexPorCompetencia: jest.fn() }));
jest.mock("../SerproPagtoWebService.js", () => ({ confirmarPagamento: jest.fn() }));
jest.mock("../../../guides/ConsultaPagamentoGuiaService.js", () => ({ registrarConsultaPagamentoGuia: jest.fn() }));
jest.mock("../../../guides/GuideStorageService.js", () => ({ GuideStorageService: { create: jest.fn(() => ({ upload: jest.fn(async () => ({ key: "comprovante.pdf" })) })) } }));
jest.mock("../../../accounting/InssPagamentoService.js", () => ({ gerarPagamentoInssFromGuide: jest.fn(async () => ({ ok: true })) }));
jest.mock("../../../accounting/parcelamento/ParcelamentoV2Service.js", () => ({ gerarPagamentoParcelaFromGuide: jest.fn(), recalcularEstadosParcelasEmAberto: jest.fn(async () => ({})) }));
jest.mock("../CompanyRotinasService.js", () => ({ idsComRotinaAtiva: jest.fn(async () => new Set(["empresa"])) }));
jest.mock("../SerproParcelaPagamentoService.js", () => ({ confirmarPagamentoParcela: jest.fn(), confirmarPagamentosParcelasEmLote: jest.fn(async () => ({ total: 0, results: [] })) }));
jest.mock("../../../../config.js", () => ({ INTEGRACAO_SERPRO_PAGTOWEB: true, INTEGRACAO_SERPRO_PARCELAMENTO: false }));

const DOC = "07202600000000001";
const guia = { id: "guia", tipo: "SIMPLES", portalClientId: "empresa", cnpj: "12345678000199", competencia: "08/2026",
  paymentStatus: "OPEN", extracted: { numeroDocumento: DOC }, portalClient: { id: "empresa", cnpj: "12345678000199" } };
const resultado = (estado, extra = {}) => ({ estado, fonte: "PGDASD_CONSDECLARACAO13", consultadoEm: "2026-09-25T12:00:00.000Z",
  numeroDocumento: DOC, identidadeConferida: true, cobertura: "COMPLETA", ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.guide.findUnique.mockResolvedValue(guia);
  prisma.guide.findMany.mockResolvedValue([guia]);
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue({ dasPago: false, dasNumeroDocumento: DOC });
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: true, numeroDocumento: DOC, resultadoConsulta: resultado("CONFIRMADO") });
  confirmarPagamento.mockResolvedValue({ pago: null, resultadoConsulta: resultado("INDETERMINADO", { fonte: "PAGTOWEB" }) });
  registrarConsultaPagamentoGuia.mockImplementation(async ({ guide, resultadoConsulta }) => ({ guia: guide, resultadoConsulta, aplicada: true }));
});

test("consulta fresca substitui negativo antigo da circular, sem fabricar comprovante", async () => {
  const r = await confirmarPagamentoGuia({ guideId: guia.id });
  expect(r.pago).toBe(true);
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledWith(expect.objectContaining({ numeroDocumento: DOC, competencia: "08/2026" }));
  expect(prisma.companyMonthlyCircular.findFirst).not.toHaveBeenCalled();
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ resultadoConsulta: expect.objectContaining({ fonte: "PGDASD_CONSDECLARACAO13" }), comprovante: null }));
  expect(gerarPagamentoInssFromGuide).not.toHaveBeenCalled();
});

test("booleano false válido registra não localizado e não busca comprovante", async () => {
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: false, resultadoConsulta: resultado("NAO_LOCALIZADO") });
  const r = await confirmarPagamentoGuia({ guideId: guia.id });
  expect(r.pago).toBe(false);
  expect(r.mensagem).toContain("até o momento desta consulta");
  expect(confirmarPagamento).not.toHaveBeenCalled();
});

test("índice incompleto é inconclusivo e separado do não localizado no resumo", async () => {
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: null, resultadoConsulta: resultado("INDETERMINADO", { motivo: "SINAL_PAGAMENTO_AUSENTE_OU_INVALIDO" }) });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(r).toMatchObject({ paid: 0, naoLocalizado: 0, indeterminados: 1, cobertura: "PARCIAL" });
  expect(r.mensagem).toContain("inconclusiva");
  expect(confirmarPagamento).not.toHaveBeenCalled();
});

test("erro de API/orçamento persiste tentativa e permanece erro, nunca guia em aberto consultada", async () => {
  const err = Object.assign(new Error("limite atingido"), { code: "SERPRO_TETO_MENSAL" });
  consultarDasIndexPorCompetencia.mockRejectedValue(err);
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(r).toMatchObject({ errors: 1, naoLocalizado: 0, firstError: "SERPRO_TETO_MENSAL" });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ resultadoConsulta: expect.objectContaining({ estado: "INDETERMINADO", motivo: "SERPRO_TETO_MENSAL" }) }));
});

test("guia já paga não consulta nem baixa outra vez", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, paymentStatus: "PAID" });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ skipped: "already_paid" });
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
  expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});

test.each(["MANUAL", "SERPRO", null])("confirmação existente de origem %s permanece preservada", async paymentStatusSource => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, paymentStatus: "PAID", paymentStatusSource });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ skipped: "already_paid" });
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});

test("afirmação do cliente é conferida na Receita e mantém seu registro separado", async () => {
  const cliente = { ...guia, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: "2026-09-21T12:00:00Z", clienteConfirmouPorUserId: "usuario", baixada: false };
  prisma.guide.findUnique.mockResolvedValue(cliente);
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(r.paid).toBe(1);
  expect(consultarDasIndexPorCompetencia).toHaveBeenCalledTimes(1);
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ guide: cliente, resultadoConsulta: expect.objectContaining({ estado: "CONFIRMADO" }) }));
  const filtro = prisma.guide.findMany.mock.calls[0][0].where;
  expect(filtro.AND).toEqual([{ OR: [{ paymentStatus: { in: ["OPEN", "OVERDUE"] } }, { paymentStatus: "PAID", paymentStatusSource: "CLIENTE", baixada: false }] }]);
  expect(filtro.OR).toEqual(expect.arrayContaining([{ tipo: { in: ["SIMPLES", "INSS"] } }]));
});

test("resultado negativo da Receita não manda reabrir uma declaração do cliente", async () => {
  const cliente = { ...guia, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", baixada: false };
  prisma.guide.findUnique.mockResolvedValue(cliente);
  consultarDasIndexPorCompetencia.mockResolvedValue({ resultadoConsulta: resultado("NAO_LOCALIZADO") });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: false });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ guide: cliente, resultadoConsulta: expect.objectContaining({ estado: "NAO_LOCALIZADO" }) }));
  expect(confirmarPagamento).not.toHaveBeenCalled();
  expect(gerarPagamentoInssFromGuide).not.toHaveBeenCalled();
});

test("guia declarada pelo cliente com baixa registrada não consulta novamente", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, paymentStatus: "PAID", paymentStatusSource: "CLIENTE", baixada: true });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ skipped: "already_paid" });
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});

test("parcela consulta seu contrato, nunca índice mensal PGDAS", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, parcelamentoId: "contrato" });
  prisma.parcela.findFirst.mockResolvedValue({ id: "parcela" });
  confirmarPagamentoParcela.mockResolvedValue({ pago: false });
  await confirmarPagamentoGuia({ guideId: guia.id });
  expect(confirmarPagamentoParcela).toHaveBeenCalled();
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});

test("CNPJ divergente entre guia e empresa recusa antes do provedor", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, cnpj: "99999999000199" });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: null, resultadoConsulta: { motivo: "CNPJ_DIVERGENTE" } });
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
  expect(confirmarPagamento).not.toHaveBeenCalled();
});

test("resposta após perda de lease não é persistida", async () => {
  let ativa = true;
  consultarDasIndexPorCompetencia.mockImplementation(async () => { ativa = false; return { resultadoConsulta: resultado("NAO_LOCALIZADO") }; });
  await expect(confirmarPagamentoGuia({ guideId: guia.id, assertActive: () => { if (!ativa) throw new Error("LEASE_PERDIDA"); } })).rejects.toThrow("LEASE_PERDIDA");
  expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});

test("registro recusado por mudança de documento nunca gera baixa de INSS", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, tipo: "INSS" });
  confirmarPagamento.mockResolvedValue({ pago: true, resultadoConsulta: resultado("CONFIRMADO", { fonte: "PAGTOWEB" }) });
  registrarConsultaPagamentoGuia.mockImplementation(async () => ({ resultadoConsulta: resultado("INDETERMINADO", { motivo: "DOCUMENTO_ALTERADO" }), aplicada: false }));
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: null, aplicada: false });
  expect(gerarPagamentoInssFromGuide).not.toHaveBeenCalled();
});

test("PAGTOWEB sem classificação explícita nunca interpreta ausência de pago como não localizado", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, tipo: "INSS" });
  confirmarPagamento.mockResolvedValue({ pago: false, mensagem: "resposta ilegível" });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: null, resultadoConsulta: { estado: "INDETERMINADO" } });
  expect(gerarPagamentoInssFromGuide).not.toHaveBeenCalled();
});

test("confirmação INSS só baixa depois do registro e preserva composição e data", async () => {
  prisma.guide.findUnique.mockResolvedValue({ ...guia, tipo: "INSS" });
  const comprovante = { confiavel: true, dataArrecadacao: "2026-09-21", principal: 100, juros: 2, multa: 3, total: 105 };
  confirmarPagamento.mockResolvedValue({ pago: true, resultadoConsulta: resultado("CONFIRMADO", { fonte: "PAGTOWEB" }), comprovante });
  expect(await confirmarPagamentoGuia({ guideId: guia.id })).toMatchObject({ pago: true });
  expect(gerarPagamentoInssFromGuide).toHaveBeenCalledWith(expect.objectContaining({ rateio: { principal: 100, juros: 2, multa: 3, total: 105 } }));
  expect(registrarConsultaPagamentoGuia.mock.invocationCallOrder[0]).toBeLessThan(gerarPagamentoInssFromGuide.mock.invocationCallOrder[0]);
});

test("rodada transmite o mesmo mapa a todas guias e outra rodada começa vazia", async () => {
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: false, resultadoConsulta: resultado("NAO_LOCALIZADO") });
  prisma.guide.findMany.mockResolvedValue([guia, { ...guia, id: "guia2" }]);
  await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  const primeira = consultarDasIndexPorCompetencia.mock.calls[0][0].consultasDaRodada;
  expect(primeira).toBeInstanceOf(Map);
  expect(consultarDasIndexPorCompetencia.mock.calls[1][0].consultasDaRodada).toBe(primeira);
  await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(consultarDasIndexPorCompetencia.mock.calls[2][0].consultasDaRodada).not.toBe(primeira);
});

test("retomada de lote misto só consulta a guia com erro e conserva observação anterior", async () => {
  const concluido = { guideId: "guia-inconclusiva", status: "indeterminado", resultadoConsulta: resultado("INDETERMINADO") };
  prisma.guide.findMany.mockImplementation(async ({ where }) => where.id.in.includes(guia.id) ? [guia] : []);
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: false, resultadoConsulta: resultado("NAO_LOCALIZADO") });
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa", retomadaPagamento: {
    guideIds: [guia.id], parcelaIds: [], concluidos: [concluido],
  } });
  expect(prisma.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    portalClientId: "empresa", id: { in: [guia.id] }, parcelamentoId: null,
  }) }));
  expect(prisma.guide.findUnique).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ total: 2, naoLocalizado: 1, indeterminados: 1, cobertura: "PARCIAL", retomados: 1, concluidosAnteriores: 1 });
  expect(r.results[0]).toEqual(concluido);
  expect(r.results[0].resultadoConsulta.consultadoEm).toBe("2026-09-25T12:00:00.000Z");
});

test("lista vazia na retomada não expande para toda a carteira", async () => {
  prisma.guide.findMany.mockImplementation(async ({ where }) => where.id.in.length ? [guia] : []);
  await runPaymentConfirmationOnce({ portalClientId: "empresa", retomadaPagamento: { guideIds: [], parcelaIds: [], concluidos: [] } });
  expect(prisma.guide.findUnique).not.toHaveBeenCalled();
  expect(consultarDasIndexPorCompetencia).not.toHaveBeenCalled();
});

test.each([["PARCIAL_OU_DIVERGENTE", "divergentes"], ["NAO_APLICAVEL", "naoAplicavel"]])("classificação %s aparece separada no resumo", async (estado, campo) => {
  consultarDasIndexPorCompetencia.mockResolvedValue({ dasPago: null, resultadoConsulta: resultado(estado) });
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa" });
  expect(r[campo]).toBe(1); expect(r.naoLocalizado).toBe(0); expect(r.cobertura).toBe("PARCIAL");
});

test("parcela confirmada sem aplicar à guia vinculada mantém cobertura parcial", async () => {
  prisma.guide.findMany.mockResolvedValue([]);
  const r = await runPaymentConfirmationOnce({ portalClientId: "empresa", retomadaPagamento: {
    guideIds: [], parcelaIds: [], concluidos: [{ parcelaId: "p", status: "paid", aplicadaGuia: false,
      resultadoConsulta: resultado("CONFIRMADO"), resultadoConsultaGuia: resultado("INDETERMINADO") }],
  } });
  expect(r).toMatchObject({ paid: 1, cobertura: "PARCIAL" });
});
