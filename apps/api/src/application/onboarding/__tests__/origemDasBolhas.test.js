jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { registrarCampos, proximaPergunta } from "../LeadService.js";

function banco(entradas = ["m1", "m2"]) {
  const ficha = { id: "o1", origem: "ABERTURA", versao: 0, dados: {}, cnpj: null };
  const db = {
    onboarding: { findUnique: jest.fn(async () => ({ ...ficha })), updateMany: jest.fn(async ({ data }) => { Object.assign(ficha, data, { versao: 1 }); return { count: 1 }; }) },
    mensagemWhatsapp: { findFirst: jest.fn(async () => ({ id: "m1" })), findMany: jest.fn(async () => entradas.map(id => ({ id }))) },
    atendimentoLead: { updateMany: jest.fn() }, onboardingEvento: { create: jest.fn() },
  };
  db.$transaction = fn => fn(db);
  return db;
}
const args = { onboardingId: "o1", versao: 0, mensagemId: "m1", mensagensIds: ["m1", "m2"], operacoes: [{ campo: "responsavelNome", acao: "set", valor: "Ana" }] };
test("campo registra o conjunto de mensagens que compõe o pedido, sem perder a âncora", async () => {
  const db = banco();
  const r = await registrarCampos({ ...args, client: db });
  expect(r.fontesDados.responsavelNome).toMatchObject({ mensagemId: "m1", mensagensIds: ["m1", "m2"], conferido: false });
  expect(db.onboardingEvento.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dados: expect.objectContaining({ mensagensIds: ["m1", "m2"] }) }) }));
});
test("origem de outra conversa impede gravação dos campos", async () => {
  const db = banco(["m1"]);
  await expect(registrarCampos({ ...args, client: db })).rejects.toMatchObject({ code: "mensagem_fora_do_escopo" });
  expect(db.onboarding.updateMany).not.toHaveBeenCalled();
});
test.each([["m2"], ["m1", "m1"], [], Array.from({ length: 13 }, (_, i) => `m${i}`)].map(ids => [ids]))("conjunto inválido não é aceito: %j", async mensagensIds => {
  await expect(registrarCampos({ ...args, mensagensIds, client: banco() })).rejects.toMatchObject({ code: "mensagem_fora_do_escopo" });
});
test("abertura avulsa não exige volumes da contabilidade mensal", () => {
  const r = proximaPergunta({ origem: "ABERTURA", dados: { responsavelNome: "Ana", atividadePretendida: "Consultório", municipioAtendimento: "Rio de Janeiro", modalidadeServico: "AVULSO" } });
  expect(r.campo).toBe("enderecoPretendido");
});
