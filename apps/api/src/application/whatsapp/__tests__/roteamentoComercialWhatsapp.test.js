jest.mock("../../../config.js", () => ({
  ...jest.requireActual("../../../config.js"),
  INTEGRACAO_IA_COMERCIAL: true,
  IA_COMERCIAL_TELEFONES_PILOTO: ["5511999999999"],
}));
jest.mock("../SaidaWhatsappService.js", () => ({ aplicarStatusMensagem: jest.fn() }));
jest.mock("../ConversaWhatsappService.js", () => ({ registrarMensagemRecebida: jest.fn() }));
jest.mock("../../guides/EnvioGuiaService.js", () => ({ aplicarStatusDoProvedor: jest.fn(), aplicarFalhaDoProvedor: jest.fn() }));

import { processarEventoWhatsapp, decidirRespostaDoMenu } from "../ProcessarEventoWhatsappService.js";
import { registrarMensagemRecebida } from "../ConversaWhatsappService.js";

const agora = new Date("2026-09-09T12:00:00Z");
const telefone = "5511999999999";
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const lead = () => ({
  duplicada: false,
  vinculo: { situacao: "DESCONHECIDO" },
  conversa: { id: "cv-lead", portalClientId: null, telefoneE164: telefone, chaveEscopo: `fila:${telefone}`, atendidaPor: null, atendidaDesde: null },
  mensagem: { id: "m-lead", registradaEm: agora, respondidaPelaIaEm: null },
});
const cliente = () => ({
  ...lead(),
  vinculo: { situacao: "VINCULADO" },
  conversa: { ...lead().conversa, id: "cv-cliente", portalClientId: "pc-1", escopoVerificado: true },
});
const evento = (texto = "Minha empresa está inativa, conseguem ajudar?", interacao = null) => ({
  entry: [{ changes: [{ field: "messages", value: { messages: [{
    id: "wamid.teste", from: telefone, timestamp: String(agora.getTime() / 1000),
    ...(interacao ? { type: "interactive", interactive: { button_reply: { id: interacao, title: "Título não decide" } } } : { type: "text", text: { body: texto } }),
  }] } }] }],
});
async function executar(registro, { interacao = null, falharFila = false } = {}) {
  registrarMensagemRecebida.mockResolvedValue(registro);
  const responder = jest.fn(async () => { if (falharFila) throw new Error("fila indisponível"); return { id: "turno" }; });
  const responderMenu = jest.fn(async ({ interacao }) => ({ tratado: Boolean(interacao) || !registro.conversa.portalClientId, motivo: interacao ? "MENU_INTERATIVO" : "INICIO_LIVRE" }));
  const resumo = await processarEventoWhatsapp(evento(undefined, interacao), {
    agora, logger, responder, responderMenu,
    ia: { flag: true, piloto: ["pc-1"] },
    menu: { flag: true, piloto: ["pc-1"], telefonesPiloto: [telefone], leads: false },
  });
  return { responder, responderMenu, resumo };
}
beforeEach(() => jest.clearAllMocks());

test("texto de lead do piloto segue coleta comercial sem o handoff genérico do menu", async () => {
  const r = await executar(lead());
  expect(r.responderMenu).not.toHaveBeenCalled();
  expect(r.responder).toHaveBeenCalledWith({ conversaId: "cv-lead", mensagemId: "m-lead", portalClientId: null, perfil: "LEAD" });
  expect(r.resumo.erros).toEqual([]);
});

test("cliente no mesmo telefone do piloto mantém apresentação inicial e fila de cliente", async () => {
  const r = await executar(cliente());
  expect(r.responderMenu).toHaveBeenCalledWith(expect.objectContaining({ textoLivreDisponivel: true }));
  expect(r.responder).toHaveBeenCalledWith({ conversaId: "cv-cliente", mensagemId: "m-lead", portalClientId: "pc-1" });
  expect(r.resumo.erros).toEqual([]);
});

test.each(["altan.lead.analyze.v1", "altan.lead.human.v1"])("clique comercial %s é resolvido pelo menu sem modelo", async interacao => {
  const r = await executar(lead(), { interacao });
  expect(r.responderMenu).toHaveBeenCalledWith(expect.objectContaining({ interacao: expect.objectContaining({ id: interacao }), textoLivreDisponivel: true }));
  expect(r.responder).not.toHaveBeenCalled();
});

test("reentrega de lead ainda sem resposta repara o job comercial", async () => {
  const r = await executar({ ...lead(), duplicada: true });
  expect(r.responder).toHaveBeenCalledWith(expect.objectContaining({ perfil: "LEAD" }));
  expect(r.resumo.mensagens.duplicadas).toBe(1);
});

test.each([["lead", lead], ["cliente", cliente]])("reentrega já respondida de %s não aciona menu nem fila", async (_nome, criar) => {
  const registro = criar();
  registro.duplicada = true;
  registro.mensagem.respondidaPelaIaEm = agora;
  const r = await executar(registro);
  expect(r.responderMenu).not.toHaveBeenCalled();
  expect(r.responder).not.toHaveBeenCalled();
  expect(r.resumo.mensagens.duplicadas).toBe(1);
});

test.each(["atendidaPor", "atendidaDesde"])("lead com %s interrompe menu e automação", async campo => {
  const registro = lead();
  registro.conversa[campo] = campo === "atendidaPor" ? "contador" : agora;
  expect(decidirRespostaDoMenu({ r: registro, flag: true, telefonesPiloto: [telefone] }).motivo).toBe("ASSUMIDA_POR_HUMANO");
  const r = await executar(registro);
  expect(r.responderMenu).not.toHaveBeenCalled();
  expect(r.responder).not.toHaveBeenCalled();
});

test.each(["AMBIGUO", "legado", "fora-piloto"])("%s não ganha perfil comercial por cair no menu público", async caso => {
  const registro = lead();
  if (caso === "AMBIGUO") registro.vinculo.situacao = caso;
  if (caso === "legado") registro.conversa.chaveEscopo = "legado:pc-antiga:telefone";
  if (caso === "fora-piloto") registro.conversa.telefoneE164 = "5511888888888";
  const r = await executar(registro);
  expect(r.responder).not.toHaveBeenCalled();
});

test("falha ao enfileirar lead conserva erro de inbox para a reentrega", async () => {
  const r = await executar(lead(), { falharFila: true });
  expect(r.resumo.erros).toEqual([expect.objectContaining({ onde: "mensagem", erro: "fila indisponível" })]);
  expect(r.responderMenu).not.toHaveBeenCalled();
});
