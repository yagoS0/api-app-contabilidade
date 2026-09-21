jest.mock("../../../config.js", () => ({
  ...jest.requireActual("../../../config.js"),
  WHATSAPP_COLETA_COMERCIAL: true,
  WHATSAPP_IDENTIDADE_V2: true,
  WHATSAPP_MULTICANAL: true,
  IA_COMERCIAL_TELEFONES_PILOTO: ["5511999999999"],
  // Mantida ligada de propósito: o fluxo novo deve ganhar prioridade.
  INTEGRACAO_IA_COMERCIAL: true,
}));
jest.mock("../ConversaWhatsappService.js", () => ({ registrarMensagemRecebida: jest.fn() }));
jest.mock("../RespostaColetaComercialWhatsappService.js", () => ({ responderColetaComercial: jest.fn() }));
jest.mock("../SaidaWhatsappService.js", () => ({ aplicarStatusMensagem: jest.fn() }));
jest.mock("../CanalWhatsappService.js", () => ({ resolverCanalEntrada: jest.fn() }));
jest.mock("../../guides/EnvioGuiaService.js", () => ({ aplicarStatusDoProvedor: jest.fn(), aplicarFalhaDoProvedor: jest.fn() }));
import { registrarMensagemRecebida } from "../ConversaWhatsappService.js";
import { responderColetaComercial } from "../RespostaColetaComercialWhatsappService.js";
import { processarEventoWhatsapp, decidirRespostaDoMenu } from "../ProcessarEventoWhatsappService.js";
import { decidirRespostaComercial } from "../../assistente/politicaComercialWhatsapp.js";
import { resolverCanalEntrada } from "../CanalWhatsappService.js";

const telefone = "5511999999999", agora = new Date("2026-09-17T13:00:00Z");
const registro = () => ({
  conversa: { id: "conversa", telefoneE164: telefone, portalClientId: null, chaveEscopo: "sem-empresa:" + telefone },
  mensagem: { id: "entrada", registradaEm: agora },
  vinculo: { situacao: "DESCONHECIDO", empresas: [] },
});
const menu = { flag: true, piloto: [], telefonesPiloto: [], leads: false };
async function enviar(texto, { coleta = { tratado: false }, interacao, entrada = registro(), reaction = false, atenderContexto } = {}) {
  registrarMensagemRecebida.mockResolvedValue(entrada);
  responderColetaComercial.mockResolvedValue(coleta);
  const responder = jest.fn(), responderMenu = jest.fn(async () => ({ tratado: true }));
  const message = { id: "wamid.sintetico", from: telefone, timestamp: String(agora.getTime() / 1000),
    ...(reaction ? { type: "reaction", reaction: { message_id: "wamid.anterior", emoji: "👍" } }
      : interacao ? { type: "interactive", interactive: { list_reply: { id: interacao, title: "Seleção" } } }
      : { type: "text", text: { body: texto } }) };
  const resultado = await processarEventoWhatsapp({ entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }] },
    { agora, responder, responderMenu, atenderContexto, menu, ia: { flag: true, piloto: [] }, logger: { info() {}, error() {}, warn() {} } });
  expect(resultado.erros).toEqual([]);
  return { responder, responderMenu };
}
beforeEach(() => {
  jest.clearAllMocks();
  resolverCanalEntrada.mockResolvedValue({ id: "principal", legado: true });
});
test("Olá usa o piloto comercial para abrir o menu, sem depender do piloto operacional nem chamar IA", async () => {
  expect(decidirRespostaDoMenu({ r: registro(), ...menu })).toEqual({ responde: true, motivo: null });
  expect(decidirRespostaComercial({ r: registro() })).toEqual({ responde: false, motivo: "COLETA_SEM_IA" });
  const r = await enviar("Olá");
  expect(r.responderMenu).toHaveBeenCalledWith(expect.objectContaining({ texto: "Olá", textoLivreDisponivel: false }));
  expect(r.responder).not.toHaveBeenCalled();
});
test.each(["Sou médico e quero abrir uma empresa", "Quero trocar de contador", "Minha empresa está parada"])("pedido direto %s segue a coleta e não envia menu duplicado", async texto => {
  const r = await enviar(texto, { coleta: { tratado: true, motivo: "COLETA_COMERCIAL" } });
  expect(responderColetaComercial).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ corpo: texto }) }));
  expect(r.responderMenu).not.toHaveBeenCalled(); expect(r.responder).not.toHaveBeenCalled();
});
test.each(["abertura", "transferencia", "inativa"])("clique %s chega ao coletor pelo ID nativo", async tipo => {
  const id = `altan.comercial.${tipo}.v1`;
  const r = await enviar("", { interacao: id, coleta: { tratado: true } });
  expect(responderColetaComercial).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ interacao: expect.objectContaining({ id }) }) }));
  expect(r.responderMenu).not.toHaveBeenCalled(); expect(r.responder).not.toHaveBeenCalled();
});
test.each(["atendidaPor", "atendidaDesde"])("atendimento humano %s não reabre o menu", async campo => {
  const entrada = registro(); entrada.conversa[campo] = campo === "atendidaPor" ? "contador" : agora;
  const r = await enviar("Olá", { entrada });
  expect(r.responderMenu).not.toHaveBeenCalled(); expect(r.responder).not.toHaveBeenCalled();
});
test("o piloto comercial não amplia o menu a outro telefone nem a um cadastro ambíguo", () => {
  const fora = registro(); fora.conversa.telefoneE164 = "5511888888888";
  expect(decidirRespostaDoMenu({ r: fora, ...menu }).responde).toBe(false);
  const ambiguo = registro(); ambiguo.vinculo.situacao = "AMBIGUO";
  expect(decidirRespostaDoMenu({ r: ambiguo, ...menu }).responde).toBe(false);
});

const entradaComercial = () => ({ ...registro(),
  conversa: { ...registro().conversa, telefoneE164: "5511888888888", canalId: "comercial" },
  canal: { id: "comercial", finalidade: "COMERCIAL", ativo: true },
});
test("novo remetente do comercial recebe menu e não enfileira IA", async () => {
  const entrada = entradaComercial();
  resolverCanalEntrada.mockResolvedValue(entrada.canal);
  expect(decidirRespostaDoMenu({ r: entrada, ...menu }).responde).toBe(true);
  expect(decidirRespostaComercial({ r: entrada }).motivo).toBe("COLETA_SEM_IA");
  const r = await enviar("Olá", { entrada });
  expect(r.responderMenu).toHaveBeenCalledWith(expect.objectContaining({ registro: expect.objectContaining({ canal: entrada.canal }) }));
  expect(r.responder).not.toHaveBeenCalled();
});
test.each(["atendidaPor", "atendidaDesde", "excluidaEm"])("canal comercial não ignora %s", campo => {
  const r = entradaComercial(); r.conversa[campo] = agora;
  expect(decidirRespostaDoMenu({ r, ...menu }).responde).toBe(false);
});
test("canal comercial acolhe cadastro cliente ou ambíguo sem conceder escopo fiscal", () => {
  const r = entradaComercial(); r.vinculo.situacao = "AMBIGUO";
  expect(decidirRespostaDoMenu({ r, ...menu }).responde).toBe(true);
  r.vinculo.situacao = "VINCULADO"; r.conversa.portalClientId = "empresa"; r.conversa.escopoVerificado = true;
  expect(decidirRespostaDoMenu({ r, ...menu }).responde).toBe(true);
});

test.each(["VINCULADO", "AMBIGUO"])("saudação comercial de cadastro %s não exige seletor de empresa nem usa IA", async situacao => {
  const entrada = entradaComercial();
  entrada.vinculo = { situacao, empresas: [{ portalClientId: "empresa-fora-piloto" }] };
  entrada.conversa.portalClientId = situacao === "VINCULADO" ? "empresa-fora-piloto" : null;
  entrada.conversa.atendimentoId = "contexto-fiscal-antigo";
  resolverCanalEntrada.mockResolvedValue(entrada.canal);
  const atenderContexto = jest.fn();
  const r = await enviar("Olá", { entrada, atenderContexto });
  expect(r.responderMenu).toHaveBeenCalledWith(expect.objectContaining({ texto: "Olá", textoLivreDisponivel: false }));
  expect(atenderContexto).not.toHaveBeenCalled();
  expect(r.responder).not.toHaveBeenCalled();
});

test("reação é preservada sem passar pelo coletor, menu, seleção ou IA", async () => {
  const entrada = entradaComercial(); resolverCanalEntrada.mockResolvedValue(entrada.canal);
  const atenderContexto = jest.fn();
  const r = await enviar("", { entrada, reaction: true, atenderContexto });
  expect(registrarMensagemRecebida).toHaveBeenCalledWith(expect.objectContaining({ tipo: "reaction" }));
  expect(responderColetaComercial).not.toHaveBeenCalled();
  expect(r.responderMenu).not.toHaveBeenCalled();
  expect(atenderContexto).not.toHaveBeenCalled();
  expect(r.responder).not.toHaveBeenCalled();
});

test("cliente fora do piloto permanece sem automação no principal", () => {
  const r = entradaComercial();
  r.canal = { id: "principal", finalidade: "PRINCIPAL", ativo: true };
  r.conversa.canalId = "principal";
  r.conversa.portalClientId = "empresa-fora-piloto";
  r.conversa.escopoVerificado = true;
  r.vinculo = { situacao: "VINCULADO", empresas: [{ portalClientId: r.conversa.portalClientId }] };
  expect(decidirRespostaDoMenu({ r, ...menu }).responde).toBe(false);
});
