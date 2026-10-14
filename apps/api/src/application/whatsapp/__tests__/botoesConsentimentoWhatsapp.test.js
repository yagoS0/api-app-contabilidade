import { processarConsentimentoWhatsapp } from '../ConsentimentoWhatsappService.js';
import { BOTOES_CONSENTIMENTO, parametrosTemplateConsentimento, TEMPLATE_CONSENTIMENTO } from '../templateConsentimentoWhatsapp.js';

function fixture(tipo='button', id=BOTOES_CONSENTIMENTO[0].id) {
 const pergunta={direcao:'out',tipo:'template',statusEnvio:'entregue',corpo:TEMPLATE_CONSENTIMENTO.components[0].text};
 const conversa={id:'c',telefoneE164:'5521999998888',canalId:'principal'};
 const mensagem={id:'m',direcao:'in',tipo,corpo:'Título alterado',registradaEm:new Date('2026-10-14T12:00Z'),respostaAProviderMessageId:'wamid-pergunta'};
 const records=new Map();
 const client={contatoWhatsapp:{findMany:jest.fn(async()=>[]),updateMany:jest.fn(async()=>({count:2}))},
  mensagemWhatsapp:{findFirst:jest.fn(async()=>pergunta)},
  appSetting:{findUnique:jest.fn(async({where})=>records.get(where.key)),upsert:jest.fn(async({where,create})=>{records.set(where.key,create);return create;}),create:jest.fn(async({data})=>{records.set(data.key,data);return data;})}};
 client.$transaction=async fn=>fn(client);
 return {pergunta,client,mensagem,run:()=>processarConsentimentoWhatsapp({conversa,mensagem,interacao:{id}},{client})};
}
test.each(['button','interactive'])('botão de %s autoriza pelo payload e pela pergunta enviada',async tipo=>{
 const f=fixture(tipo);expect(await f.run()).toMatchObject({status:'AUTORIZADO',aplicado:true});
 expect(f.client.contatoWhatsapp.updateMany).toHaveBeenCalledTimes(1);
 expect(f.client.mensagemWhatsapp.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({providerMessageId:'wamid-pergunta',conversa:{telefoneE164:'5521999998888',canalId:'principal'}})}));
 await f.run();expect(f.client.contatoWhatsapp.updateMany).toHaveBeenCalledTimes(1);
});
test('Não quero receber revoga o envio para os vínculos do número',async()=>{
 const f=fixture('button',BOTOES_CONSENTIMENTO[1].id);expect(await f.run()).toMatchObject({status:'REVOGADO'});
 expect(f.client.contatoWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{optInEm:null,optInOrigem:'Revogado pelo cliente via WhatsApp'}}));
});
test.each(['outro_botao','sem_pergunta','falhou','rotulo_falso'])('não altera consentimento por %s',async caso=>{
 const f=fixture('button',caso==='outro_botao'||caso==='rotulo_falso'?'altan.payment.confirm.outro':BOTOES_CONSENTIMENTO[0].id);
 if(caso==='sem_pergunta')f.client.mensagemWhatsapp.findFirst.mockResolvedValue(null);
 if(caso==='falhou')f.pergunta.statusEnvio='falhou';
 if(caso==='rotulo_falso')f.mensagem.corpo='Autorizar envios';
 expect(await f.run()).toBeNull();expect(f.client.contatoWhatsapp.updateMany).not.toHaveBeenCalled();
});
test('modelo e envio preservam a ordem e os IDs dos dois botões',()=>{
 const p=parametrosTemplateConsentimento({telefone:'5521999998888',nome:'Maria',empresas:'Exemplo'});
 expect(p.botoesResposta).toEqual(['altan.consent.authorize.v1','altan.consent.decline.v1']);
 expect(TEMPLATE_CONSENTIMENTO.components[1].buttons.map(b=>b.text)).toEqual(['Autorizar envios','Não quero receber']);
});
