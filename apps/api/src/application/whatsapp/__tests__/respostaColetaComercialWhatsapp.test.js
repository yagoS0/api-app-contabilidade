import { responderColetaComercial } from "../RespostaColetaComercialWhatsappService.js";
import { enviarMensagemRastreada } from "../SaidaWhatsappService.js";
jest.mock("../AtendimentoResponsavelWhatsappService.js", () => ({
  comLeaseDoAtendimento: jest.fn(async (_, executar) => executar(async () => {})),
}));
jest.mock("../SaidaWhatsappService.js", () => ({ enviarMensagemRastreada: jest.fn(async args => {
  await args.antesDeEnviar();
  return args.enviar();
}) }));
jest.mock("../CanalWhatsappService.js", () => ({ whatsappPorCanal: jest.fn(async ({ canalId }, { cloud }) => {
  if (canalId !== "comercial") throw new Error("Canal errado");
  return cloud;
}) }));
const registro = { conversa: { id: "c", telefoneE164: "5521999999999", canalId: "comercial" }, mensagem: { id: "entrada1" } };
function cenario() {
  const client = { mensagemWhatsapp: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 1 })) } };
  const cloud = { enviarTexto: jest.fn(async () => ({ wamid: "saida-ficticia" })) };
  const guarda = jest.fn(async () => {});
  const coletar = async ({ deps }) => {
    await deps.enviar({ conversa: registro.conversa, texto: "Qual o seu nome?", antesDeEnviar: guarda,
      referenciaComercial: { tipo: "COLETA_COMERCIAL", atendimentoId: "caso1" } });
    return { tratado: true };
  };
  return { registro, client, cloud, guarda, coletar, flag: true, conferirJanela: jest.fn(async () => ({ situacao: "ABERTA" })) };
}
beforeEach(() => jest.clearAllMocks());
it("responde no canal comercial com saída rastreada e marca a entrada concluída", async () => {
  const c = cenario();
  expect(await responderColetaComercial(c)).toEqual({ tratado: true });
  expect(c.cloud.enviarTexto).toHaveBeenCalledTimes(1);
  expect(enviarMensagemRastreada).toHaveBeenCalledWith(expect.objectContaining({ autor: "SISTEMA", turnoIaId: "coleta-comercial:entrada1", referenciaComercial: expect.objectContaining({ atendimentoId: "caso1" }) }));
  expect(c.client.mensagemWhatsapp.updateMany).toHaveBeenCalled();
});
it("reentrega com uma saída já reservada não envia outra mensagem", async () => {
  const c = cenario(); c.client.mensagemWhatsapp.findFirst.mockResolvedValue({ id: "reservada", statusEnvio: "indeterminado" });
  await responderColetaComercial(c);
  expect(c.cloud.enviarTexto).not.toHaveBeenCalled();
  expect(enviarMensagemRastreada).not.toHaveBeenCalled();
});
it("fechamento da janela bloqueia o envio mesmo com coleta concluída", async () => {
  const c = cenario(); c.conferirJanela.mockResolvedValue({ situacao: "EXPIRADA" });
  await expect(responderColetaComercial(c)).rejects.toMatchObject({ codigo: "FORA_DA_JANELA" });
  expect(c.cloud.enviarTexto).not.toHaveBeenCalled();
});
it("intervenção humana entre preparo e envio bloqueia a resposta automática", async () => {
  const c = cenario();
  c.guarda.mockResolvedValueOnce().mockRejectedValueOnce(Object.assign(new Error("Assumida"), { codigo: "ASSUMIDA_POR_HUMANO" }));
  await expect(responderColetaComercial(c)).rejects.toMatchObject({ codigo: "ASSUMIDA_POR_HUMANO" });
  expect(c.cloud.enviarTexto).not.toHaveBeenCalled();
  expect(c.client.mensagemWhatsapp.updateMany).not.toHaveBeenCalled();
});
it("flag desligada não inicia coleta nem transporte", async () => {
  const c = cenario(); c.coletar = jest.fn();
  expect(await responderColetaComercial({ ...c, flag: false })).toMatchObject({ tratado: false });
  expect(c.coletar).not.toHaveBeenCalled();
});
