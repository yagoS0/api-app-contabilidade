jest.mock("../../../application/fiscal/serpro/SerproPagtoWebService.js", () => ({ confirmarPagamento: jest.fn() }));
jest.mock("../../../application/guides/ConsultaPagamentoGuiaService.js", () => ({ registrarConsultaPagamentoGuia: jest.fn() }));
import express from "express";
import request from "supertest";
import { confirmarPagamento } from "../../../application/fiscal/serpro/SerproPagtoWebService.js";
import { registrarConsultaPagamentoGuia } from "../../../application/guides/ConsultaPagamentoGuiaService.js";
import { contextoSerproAtual } from "../../../application/fiscal/serpro/serproCallContext.js";
import { createBuscarPagamentoHandler, leituraComprovanteConfirmada } from "../guidePaymentLookup.js";

const guide = { id: "g-a", portalClientId: "empresa-a", cnpj: "12345678000190", status: "PROCESSED",
  paymentStatus: "OPEN", extracted: { numeroDocumento: "07.162.619.4444123-36" }, updatedAt: new Date("2026-09-20T10:00:00Z") };
const prova = { estado: "CONFIRMADO", fonte: "PAGTOWEB", consultadoEm: "2026-09-25T12:00:00Z",
  numeroDocumento: "07162619444412336", cobertura: "COMPLETA", identidadeConferida: true };
const getGuideWithFirmAccess = jest.fn();
const log = { error: jest.fn() };
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.auth = { user: { id: "contador-a" } }; next(); });
  a.post("/guides/:guideId/buscar-pagamento", createBuscarPagamentoHandler({ getGuideWithFirmAccess, log }));
  return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  getGuideWithFirmAccess.mockResolvedValue({ guide });
  confirmarPagamento.mockResolvedValue({ pago: true, resultadoConsulta: prova,
    comprovante: { dataArrecadacaoBR: "21/09/2026", principal: 490, juros: 0, multa: 0, total: 490, confiavel: true } });
  registrarConsultaPagamentoGuia.mockImplementation(async ({ resultadoConsulta }) => ({ resultadoConsulta, aplicada: true }));
});
test("usa escopo/autoria do servidor, normaliza documento e registra a versão consultada", async () => {
  let contexto;
  const response = await confirmarPagamento(); confirmarPagamento.mockClear();
  confirmarPagamento.mockImplementation(async () => { contexto = contextoSerproAtual(); return response; });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento").send({ cnpj: "99999999000199", portalClientId: "empresa-b", userId: "intruso" });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ encontrado: true, resultadoConsulta: prova, comprovante: { total: 490 } });
  expect(getGuideWithFirmAccess).toHaveBeenCalledWith({ guideId: "g-a", user: { id: "contador-a" } });
  expect(confirmarPagamento).toHaveBeenCalledWith(expect.objectContaining({ contribuinteCnpj: guide.cnpj, numeroDocumento: "07162619444412336" }));
  expect(contexto).toMatchObject({ origem: "guias:buscar_pagamento", userId: "contador-a" });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ guide, resultadoConsulta: prova }));
});
test.each([403, 404])("guarda de acesso %s impede consulta e gravação", async (status) => {
  getGuideWithFirmAccess.mockResolvedValue({ guide: null, status, error: "forbidden" });
  expect((await request(app()).post("/guides/g-a/buscar-pagamento")).status).toBe(status);
  expect(confirmarPagamento).not.toHaveBeenCalled(); expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});
test("marcador vazio e guia sem documento não viram pagamento não localizado", async () => {
  getGuideWithFirmAccess.mockResolvedValueOnce({ guide: { ...guide, status: "VAZIO" } });
  expect((await request(app()).post("/guides/g-a/buscar-pagamento")).status).toBe(400);
  getGuideWithFirmAccess.mockResolvedValueOnce({ guide: { ...guide, extracted: {} } });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.body).toMatchObject({ encontrado: null, resultadoConsulta: { estado: "NAO_APLICAVEL", consultadoEm: null } });
  expect(confirmarPagamento).not.toHaveBeenCalled(); expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});
test.each(["INDETERMINADO", "PARCIAL_OU_DIVERGENTE"])("%s não é afirmado como negativo nem usa valores do comprovante", async (estado) => {
  confirmarPagamento.mockResolvedValue({ pago: null, comprovante: { total: 490 }, resultadoConsulta: { ...prova, estado, identidadeConferida: false } });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.body).toMatchObject({ encontrado: null, comprovante: null, resultadoConsulta: { estado } });
  expect(r.body.motivo).not.toMatch(/não localizado/i);
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith(expect.objectContaining({ comprovante: null }));
});
test("resposta negativa expressa conserva a ressalva temporal", async () => {
  confirmarPagamento.mockResolvedValue({ pago: false, resultadoConsulta: { ...prova, estado: "NAO_LOCALIZADO" } });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.body.encontrado).toBe(false); expect(r.body.motivo).toMatch(/até o momento/i);
});
test("resposta confirmada que perde a versão da guia é apresentada como inconclusiva", async () => {
  registrarConsultaPagamentoGuia.mockResolvedValue({ aplicada: false,
    resultadoConsulta: { ...prova, estado: "INDETERMINADO", motivo: "GUIA_ALTERADA" } });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.body).toMatchObject({ encontrado: null, aplicada: false, comprovante: null });
});
test("provedor indisponível é falha técnica e nunca conclusão negativa", async () => {
  const antes = Date.now();
  confirmarPagamento.mockRejectedValue(Object.assign(new Error("Serviço indisponível"), { code: "SERPRO_PAGTOWEB_INDISPONIVEL" }));
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.status).toBe(502); expect(r.body.encontrado).toBeUndefined();
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledTimes(1);
  const tentativa = registrarConsultaPagamentoGuia.mock.calls[0][0];
  expect(tentativa).toMatchObject({ guide, resultadoConsulta: { estado: "INDETERMINADO", motivo: "SERPRO_PAGTOWEB_INDISPONIVEL" } });
  expect(new Date(tentativa.resultadoConsulta.consultadoEm).getTime()).toBeGreaterThanOrEqual(antes);
  expect(r.body.historicoRegistrado).toBe(true);
});
test.each([
  { pago: true },
  { pago: true, resultadoConsulta: { ...prova, identidadeConferida: false } },
  { pago: true, resultadoConsulta: { ...prova, cobertura: "PARCIAL" } },
  { pago: false, resultadoConsulta: prova },
])("confirmação manual não aproveita dados não comprovados: %j", (r) => {
  expect(leituraComprovanteConfirmada(r)).toBe(false);
});

test.each(["numeroDoc", "numeroDas"])("guia antiga com %s usa a leitura canônica", async (campo) => {
  getGuideWithFirmAccess.mockResolvedValue({ guide: { ...guide, extracted: { [campo]: "07.162.619.4444123-36" } } });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.status).toBe(200);
  expect(confirmarPagamento).toHaveBeenCalledWith(expect.objectContaining({ numeroDocumento: "07162619444412336" }));
});
test.each([
  [{ ...guide, portalClient: { cnpj: "99999999000199" } }, "CNPJ_DIVERGENTE"],
  [{ ...guide, cnpj: " -- ", portalClient: { cnpj: "" } }, "CNPJ_AUSENTE"],
  [{ ...guide, cnpj: "123", portalClient: null }, "CNPJ_INVALIDO"],
])("identificação empresarial inválida impede consulta: %j", async (g, motivo) => {
  getGuideWithFirmAccess.mockResolvedValue({ guide: g });
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.body).toMatchObject({ encontrado: null, resultadoConsulta: { motivo, cobertura: "NAO_CONSULTADA", consultadoEm: null } });
  expect(confirmarPagamento).not.toHaveBeenCalled(); expect(registrarConsultaPagamentoGuia).not.toHaveBeenCalled();
});
test("CNPJ mascarado equivalente usa número normalizado do cadastro", async () => {
  getGuideWithFirmAccess.mockResolvedValue({ guide: { ...guide, cnpj: "12.345.678/0001-90", portalClient: { cnpj: guide.cnpj } } });
  await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(confirmarPagamento).toHaveBeenCalledWith(expect.objectContaining({ contribuinteCnpj: guide.cnpj }));
});
test("falha do provedor conserva o instante e diagnóstico originais da tentativa", async () => {
  const resultadoConsulta = { ...prova, estado: "INDETERMINADO", cobertura: "PARCIAL", motivo: "HTTP_500" };
  confirmarPagamento.mockRejectedValue(Object.assign(new Error("Indisponível"), { code: "HTTP_500", details: { resultadoConsulta } }));
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.status).toBe(502);
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledTimes(1);
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledWith({ guide, resultadoConsulta });
  expect(r.body).toMatchObject({ resultadoConsulta, historicoRegistrado: true, error: "HTTP_500" });
});
test("falha no próprio registrador não é registrada uma segunda vez como falha fiscal", async () => {
  registrarConsultaPagamentoGuia.mockRejectedValue(Object.assign(new Error("Banco indisponível"), { code: "DB_ERROR" }));
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.status).toBe(502); expect(r.body).toMatchObject({ error: "DB_ERROR", historicoRegistrado: false });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledTimes(1);
});

test.each([null, { pago: false }, { pago: true }])("retorno sem classificação não é decisão fiscal: %j", async (retorno) => {
  confirmarPagamento.mockResolvedValue(retorno);
  const r = await request(app()).post("/guides/g-a/buscar-pagamento");
  expect(r.status).toBe(200); expect(r.body.encontrado).toBeNull();
  expect(r.body.resultadoConsulta).toMatchObject({ estado: "INDETERMINADO", motivo: "RESPOSTA_SEM_CLASSIFICACAO" });
  expect(registrarConsultaPagamentoGuia).toHaveBeenCalledTimes(1);
});