import { enviarMensagemRastreada, aplicarStatusMensagem } from "../SaidaWhatsappService.js";
function banco(status = "enviando") {
  const m = { id: "m", direcao: "out", statusEnvio: status };
  return { m, mensagemWhatsapp: {
    create: jest.fn(async ({data}) => Object.assign(m,data)),
    findUnique: jest.fn(async () => ({...m})),
    update: jest.fn(async ({data}) => Object.assign(m,data)),
    updateMany: jest.fn(async ({where,data}) => { if (where.statusEnvio!==m.statusEnvio) return {count:0}; Object.assign(m,data); return {count:1}; }),
  }, conversaWhatsapp:{update:jest.fn(async()=>({}))} };
}
const conversa={id:"c"};
it("rejeição explícita da Meta é falha conhecida",async()=>{
 const client=banco(); const e=Object.assign(new Error("recusa"),{codigo:"131026",traducao:{httpStatus:400}});
 await expect(enviarMensagemRastreada({conversa,client,enviar:async()=>{throw e;}})).rejects.toMatchObject({indeterminado:false});
 expect(client.m.statusEnvio).toBe("falhou");
});
it("timeout sem resposta fica indeterminado",async()=>{
 const client=banco();
 await expect(enviarMensagemRastreada({conversa,client,enviar:async()=>{throw new Error("timeout");}})).rejects.toMatchObject({indeterminado:true});
 expect(client.m.statusEnvio).toBe("indeterminado");
});
it("humano assume durante persistência: refaz guarda e não envia",async()=>{
 const client=banco(); const enviar=jest.fn();
 const antesDeEnviar=jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(Object.assign(new Error("assumida"),{codigo:"ASSUMIDA_POR_HUMANO"}));
 await expect(enviarMensagemRastreada({conversa,client,enviar,antesDeEnviar})).rejects.toMatchObject({indeterminado:false});
 expect(enviar).not.toHaveBeenCalled(); expect(client.m.statusEnvio).toBe("falhou");
});
it("preserva wamid se gravação pós-aceite falhar",async()=>{
 const client=banco(); client.mensagemWhatsapp.update.mockRejectedValueOnce(new Error("banco"));
 await expect(enviarMensagemRastreada({conversa,client,enviar:async()=>({wamid:"wamid.x"})})).rejects.toMatchObject({indeterminado:true});
 expect(client.m).toMatchObject({providerMessageId:"wamid.x",statusEnvio:"indeterminado"});
});
it("sent atrasado não apaga falha, read posterior confirma entrega",async()=>{
 const client=banco("falhou"); client.m.erroEnvioCodigo="131026";
 await aplicarStatusMensagem({providerMessageId:"w",status:"sent",client});
 expect(client.m).toMatchObject({statusEnvio:"falhou",erroEnvioCodigo:"131026"});
 await aplicarStatusMensagem({providerMessageId:"w",status:"read",client});
 expect(client.m).toMatchObject({statusEnvio:"lido",erroEnvioCodigo:null});
});
it("read seguido de failed/sent conserva leitura",async()=>{
 const client=banco("lido");
 for(const status of ["failed","sent"]) await aplicarStatusMensagem({providerMessageId:"w",status,client});
 expect(client.m.statusEnvio).toBe("lido");
});

it('correlaciona aceite da guia antes de persistir o recibo da mensagem', async () => {
  const client = banco(); const aoAceitar = jest.fn(async () => { expect(client.mensagemWhatsapp.update).not.toHaveBeenCalled(); });
  await enviarMensagemRastreada({ conversa, client, vinculoGuia: { envioGuiaId: 'e', envioGuiaTentativaId: 't' }, aoAceitar, enviar: async () => ({ wamid: 'w' }) });
  expect(aoAceitar).toHaveBeenCalledWith({ wamid: 'w' }); expect(client.m).toMatchObject({ envioGuiaId: 'e', envioGuiaTentativaId: 't' });
});
it('falha ao correlacionar aceite mantém wamid e resultado incerto', async () => {
  const client = banco();
  await expect(enviarMensagemRastreada({ conversa, client, aoAceitar: async () => { throw Error('banco'); }, enviar: async () => ({ wamid: 'w' }) })).rejects.toMatchObject({ indeterminado: true });
  expect(client.m).toMatchObject({ providerMessageId: 'w', statusEnvio: 'indeterminado' });
});
