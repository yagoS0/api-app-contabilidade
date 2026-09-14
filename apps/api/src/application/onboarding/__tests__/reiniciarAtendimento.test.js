jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { iniciarAtendimento } from "../LeadService.js";

function setup() {
  const original = { id: "anterior", onboardingId: "ficha-anterior", onboarding: { origem: "ABERTURA", status: "RASCUNHO" } };
  const novaFicha = { id: "ficha-nova", origem: "TRANSFERENCIA", status: "RASCUNHO" };
  const tx = {
    conversaWhatsapp: { updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(async () => ({})), findUnique: async () => ({ id: "c", chaveEscopo: "sem-empresa:5511000000000", telefoneE164: "5511000000000" }) },
    mensagemWhatsapp: { findFirst: async () => ({ id: "entrada" }) },
    atendimentoLead: { findFirst: async () => original, create: jest.fn(async () => ({ id: "novo" })), update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data, ...(data.onboardingId ? { onboarding: novaFicha } : {}) })) },
    onboarding: { create: jest.fn(async () => novaFicha) }, onboardingEvento: { create: jest.fn(async () => ({})) }, turnoIaWhatsapp: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const client = { $transaction: fn => fn(tx) };
  return { client, tx, original };
}
test("recomeçar preserva ficha anterior e cria outra com contexto limpo", async () => {
  const { client, tx, original } = setup();
  const r = await iniciarAtendimento({ conversaId: "c", origem: "TRANSFERENCIA", reiniciarAtendimentoId: "anterior", motivoReinicio: "CORRIGIR_MOTIVO", atorId: "contador", client });
  expect(r.onboardingId).toBe("ficha-nova"); expect(original.onboarding.origem).toBe("ABERTURA");
  expect(tx.atendimentoLead.update).toHaveBeenCalledWith({ where: { id: "anterior" }, data: { encerradoEm: expect.any(Date) } });
  expect(tx.onboardingEvento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ onboardingId: "ficha-anterior", tipo: "ATENDIMENTO_REINICIADO" }) });
  expect(tx.turnoIaWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversaId: "c" }) }));
});
test("aba antiga não encerra uma solicitação diferente", async () => {
  const { client, tx } = setup();
  await expect(iniciarAtendimento({ conversaId: "c", origem: "TRANSFERENCIA", reiniciarAtendimentoId: "outro", motivoReinicio: "NOVA_SOLICITACAO", atorId: "contador", client })).rejects.toMatchObject({ code: "atendimento_alterado" });
  expect(tx.atendimentoLead.create).not.toHaveBeenCalled(); expect(tx.atendimentoLead.update).not.toHaveBeenCalled();
});
test("não troca a origem silenciosamente nem permite reinício da IA", async () => {
  const { client } = setup();
  await expect(iniciarAtendimento({ conversaId: "c", origem: "TRANSFERENCIA", client })).rejects.toMatchObject({ code: "origem_divergente" });
  await expect(iniciarAtendimento({ conversaId: "c", origem: "TRANSFERENCIA", reiniciarAtendimentoId: "anterior", motivoReinicio: "NOVA_SOLICITACAO", client })).rejects.toMatchObject({ code: "reinicio_invalido" });
});
