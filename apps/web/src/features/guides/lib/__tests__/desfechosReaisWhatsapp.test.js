import { liberarComCanais } from "../liberarComCanais";
import { resumirWhatsapp } from "../canalDeEnvio";
import { mapKnownError } from "../../../../api/real/realApi";
const base = () => ({
  listarContatosWhatsapp: jest.fn(async () => ({canalPadraoEnvio:"WHATSAPP"})),
  liberarGuiaCliente: jest.fn(async () => ({sent:false,envio:{naoSeAplica:true}})),
  enviarGuiaWhatsapp: jest.fn(async () => ({ok:true,estado:"aceito",aceitas:1})),
});
const liberar = api => liberarComCanais({api,companyId:"empresa",guideId:"guia"});
test.each([false,true])("falha parcial é visível com qualquer ordem dos destinatários (%s)", async inverter => {
  const api = base();
  const resultados = [{ok:true,destino:"5521000000001",estado:"aceito"},{ok:false,destino:"5521000000002",mensagem:"Recusa da Meta",estado:"falhou"}];
  if(inverter) resultados.reverse();
  api.enviarGuiaWhatsapp.mockResolvedValue({ok:true,parcial:true,aceitas:1,falhas:1,resultados});
  const r = await liberar(api);
  expect(r.ok).toBe(false); expect(r.tom).toBe("erro");
  expect(r.texto).toMatch(/parcialmente aceito/); expect(r.texto).toContain("5521000000002: Recusa da Meta");
  expect(r.whatsapp.resultados).toEqual(resultados);
});
test("sem confirmação de entrega o feedback permanece neutro", async () => {
  const r = await liberar(base()); expect(r.tom).toBe("pendente"); expect(r.texto).toMatch(/aguardando confirmação de entrega/);
});
test("transporte do email não cancela o canal WhatsApp nem repete email", async () => {
  const api = base(); api.liberarGuiaCliente.mockRejectedValue(new Error("Conexão caiu"));
  const r=await liberar(api); expect(api.enviarGuiaWhatsapp).toHaveBeenCalledTimes(1); expect(api.liberarGuiaCliente).toHaveBeenCalledTimes(1);
  expect(r.texto).toMatch(/Não foi possível confirmar a liberação/); expect(r.ok).toBe(false);
});
test.each([400,401,403,404,409,422])("recusa HTTP %s bloqueia WhatsApp", async status => {
  const api=base();api.liberarGuiaCliente.mockRejectedValue(Object.assign(new Error("Recusado"),{status}));
  await liberar(api); expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
});
test("configuração ilegível não inicia email ou WhatsApp e não manda cadastrar contato", async () => {
  const api=base(); api.listarContatosWhatsapp.mockRejectedValue(new Error("503"));
  const r=await liberar(api); expect(api.liberarGuiaCliente).not.toHaveBeenCalled(); expect(api.enviarGuiaWhatsapp).not.toHaveBeenCalled();
  expect(r.texto).toMatch(/configuração/); expect(r.texto).not.toMatch(/cadastre/);
});
test("contrato legado mensagem é traduzido pelo adaptador e preserva código", () => {
  expect(mapKnownError({error:"META_TESTE",mensagem:"Motivo legível"},422)).toBe("Motivo legível");
});
test("indeterminado não é interpretado como enviado nem falha definitiva",()=>{
  const r=resumirWhatsapp({ok:false,estado:"indeterminado",indeterminadas:1});
  expect(r.tom).toBe("pendente"); expect(r.texto).toMatch(/indeterminado/);
});
