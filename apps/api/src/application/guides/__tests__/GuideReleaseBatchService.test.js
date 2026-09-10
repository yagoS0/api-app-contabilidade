jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../GuideDueBatchService.js", () => ({ conferirGuiasVencimento: jest.fn() }));
jest.mock("../GuideCompanyEmailService.js", () => ({ sendCompanyGuidesEmail: jest.fn() }));
jest.mock("../../whatsapp/ContatoWhatsappService.js", () => ({ destinatariosDeEnvio: jest.fn(), destinatarioWhatsapp: jest.fn() }));
jest.mock("../../whatsapp/EnvioGuiaWhatsappService.js", () => ({ SELECT_GUIA_PARA_ENVIO: {}, carregarCanal: jest.fn(), enviarParaTodosOsDestinatarios: jest.fn() }));
import { createGuideReleaseBatchService } from "../GuideReleaseBatchService.js";
import { loteAlterado } from "../loteVencimento.js";

function montar() {
  const guia = { id: "g1", portalClientId: "c1", competencia: "2026-08", tipo: "SIMPLES", valor: 100,
    vencimento: new Date("2026-09-20T00:00:00Z"), status: "PROCESSED", paymentStatus: "OPEN", hash: "pdf-1", updatedAt: new Date(0), emailStatus: "PENDING" };
  let atual = { ...guia };
  const deps = {
    db: { guide: { findFirst: jest.fn(async () => ({ ...atual })), updateMany: jest.fn(async () => {
      atual = { ...atual, liberadaCliente: true, updatedAt: new Date() }; return { count: 1 };
    }) } },
    conferir: jest.fn(async () => { if (atual.emailStatus === "SENT") throw loteAlterado(); return { guias: [{ ...guia }] }; }),
    contatos: jest.fn(async () => ({ emails: ["financeiro@example.test"], telefones: [{ telefoneE164: "5511999990000" }] })),
    destinatario: jest.fn(async () => ({ contato: { telefoneE164: "5511999990000" } })),
    canal: jest.fn(async () => ({ disponivel: true })),
    email: jest.fn(async () => { atual = { ...atual, emailStatus: "SENT", updatedAt: new Date() }; return { status: "sent", sentNow: 1 }; }),
    whatsapp: jest.fn(async () => ({ ok: true, estado: "aceito", aceitas: 1, parcial: false })),
    aguardar: jest.fn(async () => {}),
  };
  const service = createGuideReleaseBatchService(deps);
  const input = { items: [{ portalClientId: "c1", mesVencimento: "2026-09", guideIds: ["g1"], assinatura: "documentos" }], permitidas: ["c1"], userId: "contador" };
  return { deps, service, input, mudar: (v) => { atual = { ...atual, ...v }; },
    executar: async () => service.executar({ ...input, assinatura: (await service.prever(input)).assinatura }) };
}

test("prévia não envia; liberação mantém e-mail agrupado, complementa WhatsApp e libera só os IDs conferidos", async () => {
  const { deps, service, input } = montar();
  const previa = await service.prever(input);
  expect(deps.email).not.toHaveBeenCalled(); expect(deps.whatsapp).not.toHaveBeenCalled();
  const out = await service.executar({ ...input, assinatura: previa.assinatura });
  expect(out.results[0]).toMatchObject({ ok: true, liberadas: 1, email: { ok: true }, whatsapp: [{ estado: "aceito" }] });
  expect(deps.email).toHaveBeenCalledWith({ portalClientId: "c1", mesVencimento: "2026-09", selectedGuideIds: ["g1"], assinatura: "documentos" });
  expect(deps.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ guide: expect.objectContaining({ emailStatus: "SENT" }), reenviar: false }));
  expect(deps.db.guide.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "g1", portalClientId: "c1" }), data: expect.objectContaining({ liberadaCliente: true, liberadaPor: "contador" }) }));
  // O mesmo pedido confirmado não pode reenviar depois da primeira execução.
  await expect(service.executar({ ...input, assinatura: previa.assinatura })).rejects.toMatchObject({ status: 409 });
  expect(deps.email).toHaveBeenCalledTimes(1); expect(deps.whatsapp).toHaveBeenCalledTimes(1);
});
test.each([{ items: [] }, { items: [{ portalClientId: "outra", guideIds: ["g1"], assinatura: "x" }] }])("não amplia seleção vazia/fora do escopo: %j", async ({ items }) => {
  const { service, input, deps } = montar();
  await expect(service.prever({ ...input, items })).rejects.toMatchObject({ status: 409 });
  expect(deps.conferir).not.toHaveBeenCalled();
});
test("confirmação ausente ou contatos alterados bloqueiam todos os atos", async () => {
  const { service, input, deps } = montar();
  await expect(service.executar(input)).rejects.toMatchObject({ status: 409 });
  const previa = await service.prever(input);
  deps.contatos.mockResolvedValue({ emails: ["novo@example.test"], telefones: [] });
  await expect(service.executar({ ...input, assinatura: previa.assinatura })).rejects.toMatchObject({ status: 409 });
  expect(deps.email).not.toHaveBeenCalled(); expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
});
test.each(["falha", "sem cadastro"])("e-mail %s não impede liberação e WhatsApp", async (caso) => {
  const { deps, executar } = montar();
  if (caso === "falha") deps.email.mockRejectedValue(new Error("E-mail recusado"));
  else deps.contatos.mockResolvedValue({ emails: [], telefones: [{ telefoneE164: "5511999990000" }] });
  const out = await executar();
  expect(out.results[0]).toMatchObject({ ok: false, liberadas: 1, email: { ok: false }, whatsapp: [{ ok: true }] });
  expect(deps.whatsapp).toHaveBeenCalledTimes(1);
});
test("sem opt-in não dispara WhatsApp e preserva e-mail enviado", async () => {
  const { deps, executar } = montar();
  deps.destinatario.mockResolvedValue({ contato: null, motivo: "sem opt-in" });
  deps.contatos.mockResolvedValue({ emails: ["financeiro@example.test"], telefones: [] });
  const out = await executar();
  expect(out.results[0]).toMatchObject({ ok: false, liberadas: 1, email: { ok: true }, whatsapp: [{ ok: false, message: expect.stringMatching(/opt-in/) }] });
  expect(deps.whatsapp).not.toHaveBeenCalled();
});
test("falha parcial de WhatsApp não vira sucesso total", async () => {
  const { deps, executar } = montar();
  deps.whatsapp.mockResolvedValue({ ok: true, parcial: true, aceitas: 1, falhas: 1 });
  expect((await executar()).results[0]).toMatchObject({ ok: false, email: { ok: true }, whatsapp: [{ parcial: true }] });
});
test.each([{ paymentStatus: "PAID" }, { hash: "outro-pdf" }, { valor: 900 }, { portalClientId: "outra" }])("documento alterado entre canais é bloqueado: %j", async (mudanca) => {
  const { deps, executar, mudar } = montar();
  deps.email.mockImplementation(async () => { mudar(mudanca); return { status: "sent" }; });
  const out = await executar();
  expect(out.results[0]).toMatchObject({ ok: false, email: { ok: true }, error: "CONFERENCIA_DIVERGENTE" });
  expect(deps.whatsapp).not.toHaveBeenCalled(); expect(deps.db.guide.updateMany).not.toHaveBeenCalled();
});
test("revogação de opt-in durante e-mail impede WhatsApp", async () => {
  const { deps, executar } = montar();
  deps.email.mockImplementation(async () => { deps.contatos.mockResolvedValue({ emails: [], telefones: [] }); return { status: "sent" }; });
  const out = await executar();
  expect(out.results[0]).toMatchObject({ ok: false, email: { ok: true }, whatsapp: [{ ok: false }] });
  expect(deps.whatsapp).not.toHaveBeenCalled();
});

test("duas guias da mesma empresa geram um e-mail agrupado e dois envios de WhatsApp", async () => {
  const { deps, input, executar } = montar();
  const primeira = (await deps.conferir()).guias[0];
  const guias = [primeira, { ...primeira, id: "g2", tipo: "INSS" }];
  input.items[0].guideIds = ["g1", "g2"];
  deps.conferir.mockResolvedValue({ guias });
  deps.db.guide.findFirst.mockImplementation(async ({ where }) => ({ ...guias.find((g) => g.id === where.id), emailStatus: "SENT" }));
  const out = await executar();
  expect(out.results[0]).toMatchObject({ ok: true, liberadas: 2 });
  expect(deps.email).toHaveBeenCalledTimes(1);
  expect(deps.email).toHaveBeenCalledWith(expect.objectContaining({ selectedGuideIds: ["g1", "g2"] }));
  expect(deps.whatsapp.mock.calls.map(([arg]) => arg.guide.id)).toEqual(["g1", "g2"]);
});
