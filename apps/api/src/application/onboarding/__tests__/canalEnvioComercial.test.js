jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../whatsapp/CanalWhatsappService.js", () => ({ whatsappPorCanal: jest.fn(async () => { throw Object.assign(new Error("Transporte interceptado; nenhum envio"), { code: "TESTE_TRANSPORTE" }); }) }));
import { whatsappPorCanal } from "../../whatsapp/CanalWhatsappService.js";
import { criarJornadaLead } from "../JornadaLeadService.js";
import { enviarProposta } from "../EnvioPropostaService.js";
import { resolverConversaEnvioComercial } from "../CanalEnvioComercialService.js";

const user = { id: "contador", role: "contador" };
function setup({ cliente = false, comercial = true } = {}) {
  const principal = { id: "origem", canalId: "principal", telefoneE164: "5511999991111", vinculoNumeroId: "v1", portalClientId: null, excluidaEm: null };
  const destino = { ...principal, id: "comercial", canalId: "canal-comercial" };
  const conversas = [principal, ...(comercial ? [destino] : [])];
  const vinculos = [{ id: "v1", interlocutorId: "pessoa", telefoneE164: principal.telefoneE164, encerrouEm: null, interlocutor: { id: "pessoa", estado: "ATIVO" } }];
  const canais = [{ id: "principal", finalidade: "PRINCIPAL", ativo: true }, { id: "canal-comercial", finalidade: "COMERCIAL", ativo: true }];
  const caso = { id: "caso", onboardingId: "ficha", interlocutorId: "pessoa", conversaId: principal.id, conversa: principal, encerradoEm: null };
  const contatos = cliente ? [{ ativo: true, portalClientId: "empresa", vinculoNumeroId: "v1" }] : [];
  const db = {
    onboarding: { findUnique: jest.fn(async () => ({ id: "ficha", criadoPorId: user.id, versao: 1, status: "RASCUNHO" })) },
    propostaComercial: { findFirst: jest.fn(async () => ({ id: "proposta", fichaVersao: 1 })) },
    atendimentoLead: { findFirst: jest.fn(async () => caso) },
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => conversas.find(c => c.id === where.id) || null),
      findMany: jest.fn(async ({ where }) => conversas.filter(c => c.telefoneE164 === where.telefoneE164 && c.vinculoNumeroId === where.vinculoNumeroId
        && c.portalClientId === where.portalClientId && !c.excluidaEm && canais.some(k => k.id === c.canalId && k.ativo && k.finalidade === "COMERCIAL"))) },
    canalWhatsapp: { findUnique: jest.fn(async ({ where }) => canais.find(c => c.id === where.id) || null) },
    contatoWhatsapp: { findFirst: jest.fn(async ({ where }) => contatos.find(c => c.ativo && c.portalClientId && c.vinculoNumeroId === where.vinculoNumeroId) || null) },
    vinculoNumeroInterlocutor: { findUnique: jest.fn(async ({ where }) => vinculos.find(v => v.id === where.id) || null) },
    interlocutorComunicacao: { findUnique: jest.fn(async () => ({ id: "pessoa", versao: 1 })) },
  };
  return { db, caso, principal, destino, conversas, vinculos, canais, contatos };
}
const executar = (tipo, t, opcoes = {}) => tipo === "devolutiva"
  ? criarJornadaLead({ db: t.db }).enviarDevolutiva("ficha", user, { diagnosticoId: "d", ...opcoes })
  : enviarProposta("ficha", "proposta", user, { db: t.db, webUrl: "https://exemplo.test", ...opcoes });
beforeEach(() => jest.clearAllMocks());

describe.each(["devolutiva", "proposta"])("%s resolve canal no servidor antes de preparar transporte", tipo => {
  test.each([null, "", "   ", 12])("recusa destino explícito inválido %p sem fallback", async conversaId => {
    const t = setup();
    await expect(executar(tipo, t, { conversaId })).rejects.toMatchObject({ code: "canal_comercial_necessario" });
    expect(whatsappPorCanal).not.toHaveBeenCalled();
  });
  test("omissão resolve o comercial do mesmo número e vínculo", async () => {
    const t = setup();
    await expect(executar(tipo, t)).rejects.toMatchObject({ code: "TESTE_TRANSPORTE" });
    expect(whatsappPorCanal).toHaveBeenCalledWith(expect.objectContaining({ id: "comercial" }), expect.anything());
  });
  test("sem comercial existente recusa com caminho para abrir a conversa", async () => {
    const t = setup({ comercial: false });
    await expect(executar(tipo, t)).rejects.toMatchObject({ code: "canal_comercial_necessario", message: expect.stringMatching(/abra.*comercial/i) });
    expect(whatsappPorCanal).not.toHaveBeenCalled();
  });
  test("lead não pode forçar canal principal", async () => {
    const t = setup(); await expect(executar(tipo, t, { conversaId: "origem" })).rejects.toMatchObject({ code: "canal_comercial_necessario" });
    expect(whatsappPorCanal).not.toHaveBeenCalled();
  });
  test("cliente cadastrado conserva escolha explícita do principal", async () => {
    const t = setup({ cliente: true });
    await expect(executar(tipo, t, { conversaId: "origem" })).rejects.toMatchObject({ code: "TESTE_TRANSPORTE" });
    expect(whatsappPorCanal).toHaveBeenCalledWith(expect.objectContaining({ id: "origem" }), expect.anything());
  });
});

describe("vigência e política de canal não vêm do navegador", () => {
  const resolver = (t, conversaId) => resolverConversaEnvioComercial({ caso: t.caso, conversaId, db: t.db });
  test.each(["telefone", "vigencia", "pessoa", "excluida", "canal", "finalidade", "casoEncerrado"])("recusa destino comercial alterado: %s", async tipo => {
    const t = setup();
    if (tipo === "telefone") t.destino.telefoneE164 = "5511999992222";
    if (tipo === "vigencia") t.destino.vinculoNumeroId = "outro-vinculo";
    if (tipo === "pessoa") t.caso.interlocutorId = "outra-pessoa";
    if (tipo === "excluida") t.destino.excluidaEm = new Date();
    if (tipo === "canal") t.canais[1].ativo = false;
    if (tipo === "finalidade") t.canais[1].finalidade = "PRINCIPAL";
    if (tipo === "casoEncerrado") t.caso.encerradoEm = new Date();
    await expect(resolver(t, "comercial")).rejects.toMatchObject({ status: 409 });
    expect(whatsappPorCanal).not.toHaveBeenCalled();
  });
  test.each(["encerrouEm", "revisao"])("não envia para vínculo %s", async tipo => {
    const t = setup();
    if (tipo === "encerrouEm") t.vinculos[0].encerrouEm = new Date();
    else t.vinculos[0].interlocutor.estado = "EM_REVISAO";
    await expect(resolver(t, "comercial")).rejects.toMatchObject({ code: "identidade_alterada" });
  });
  test.each(["outro-vinculo", "inativo"])("contato %s não transforma lead em cliente", async tipo => {
    const t = setup({ cliente: true });
    if (tipo === "outro-vinculo") t.contatos[0].vinculoNumeroId = "outra-vigencia";
    else t.contatos[0].ativo = false;
    await expect(resolver(t, "origem")).rejects.toMatchObject({ code: "canal_comercial_necessario" });
  });
  test("não escolhe arbitrariamente entre dois canais comerciais", async () => {
    const t = setup(); t.conversas.push({ ...t.destino, id: "outro-comercial" });
    await expect(resolver(t)).rejects.toMatchObject({ code: "canal_comercial_necessario" });
  });
  test("seleção do cliente e omissão conservam o principal válido", async () => {
    const t = setup({ cliente: true }); expect((await resolver(t)).id).toBe("origem");
  });
  test("canal desativado entre preparação e envio é recusado na nova conferência", async () => {
    const t = setup(); const escolhido = await resolver(t);
    t.canais[1].ativo = false;
    await expect(resolver(t, escolhido.id)).rejects.toMatchObject({ code: "canal_comercial_necessario" });
  });
  test("consulta de omissão é estritamente limitada a número, vigência, contexto e canal ativo", async () => {
    const t = setup(); await resolver(t);
    expect(t.db.conversaWhatsapp.findMany).toHaveBeenCalledWith({ where: {
      telefoneE164: "5511999991111", vinculoNumeroId: "v1", portalClientId: null, excluidaEm: null,
      canalWhatsapp: { is: { ativo: true, finalidade: "COMERCIAL" } },
    }, take: 2 });
  });
});
