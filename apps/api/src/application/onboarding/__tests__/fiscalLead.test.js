jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { criarFiscalLead } from "../FiscalLeadService.js";
import { procuracaoHabilitaSitfis } from "../ComercialService.js";
const user = { id: "gestor", role: "contador" }, cnpj = "11222333000181";
const prova = { status: "ATIVA", validUntil: "2099-01-01", systems: ["TODOS"], checkedAt: "2026-09-15", procuradorCnpj: "12345678000199" };
function setup() {
  const r = { id: "o", cnpj, versao: 2, status: "RASCUNHO" }, a = { id: "a", representanteVerificadoEm: new Date(), autorizacao: { cnpj, estado: "ATIVA", prova } };
  const db = { onboarding: { findUnique: jest.fn(async () => r), update: jest.fn(async () => r) }, atendimentoLead: { findFirst: jest.fn(async () => a), updateMany: jest.fn(async ({ data }) => { Object.assign(a, data); return { count: 1 }; }) }, trabalhoFiscalLead: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: "j", ...data })), updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => [{ id: "j", onboardingId: "o", cnpj, tipo: "PROCURACAO", status: "PENDENTE", tentativas: 0, criadoPor: user.id }]) }, user: { findUnique: async () => user } };
  db.$transaction = fn => fn(db);
  const procura = jest.fn(async () => prova), comercial = { analisar: jest.fn() };
  return { r, a, db, procura, service: criarFiscalLead({ db, procura, comercial, flag: true }) };
}
test.each(["TODOS", " todos ", "00002", "Situação Fiscal do Contribuinte"])("reconhece autorização oficial %s vigente", nome => {
  expect(procuracaoHabilitaSitfis({ ...prova, systems: [nome] })).toBe(true);
  expect(procuracaoHabilitaSitfis({ ...prova, systems: [nome], status: "REVOGADA" })).toBe(false);
  expect(procuracaoHabilitaSitfis({ ...prova, systems: [nome], validUntil: null })).toBe(false);
});
test("reconferir representante preserva prova ativa e libera a fila SITFIS", async () => {
  const t = setup(); await t.service.verificarRepresentante("o", user, "Representante conferido com documentação");
  expect(t.a.autorizacao.prova).toEqual(prova); await t.service.enfileirar("o", user, "SITFIS");
  expect(t.db.trabalhoFiscalLead.create).toHaveBeenCalledWith({ data: { onboardingId: "o", cnpj, tipo: "SITFIS", criadoPor: user.id } });
});
test("flag desligada explica bloqueio e não cria consulta", async () => {
  const t = setup(); await expect(criarFiscalLead({ db: t.db, flag: false }).enfileirar("o", user, "PROCURACAO")).rejects.toMatchObject({ code: "FISCAL_LEADS_OFF" });
  expect(t.db.trabalhoFiscalLead.create).not.toHaveBeenCalled();
});
test("worker reconhece TODOS, mantém recibo da orientação e não faz SITFIS sem solicitação", async () => {
  const t = setup(); t.a.autorizacao.mensagemId = "m";
  await t.service.processarUmaVez(); expect(t.a.autorizacao).toMatchObject({ estado: "ATIVA", cnpj, mensagemId: "m" });
  expect(t.procura).toHaveBeenCalledTimes(1);
  expect(t.db.trabalhoFiscalLead.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CONCLUIDO" }) }));
});
test("troca do representante durante a rede não conclui autorização antiga", async () => {
  const t = setup(); t.db.atendimentoLead.updateMany.mockResolvedValue({ count: 0 });
  await t.service.processarUmaVez();
  expect(t.db.trabalhoFiscalLead.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FALHOU", resultado: expect.objectContaining({ codigo: "escopo_alterado" }) }) }));
});
