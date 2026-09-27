jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../InboxWhatsappService.js',()=>({carregarGrupoIdentidade:jest.fn()}));
import { carregarGrupoIdentidade } from '../InboxWhatsappService.js';
import { podeNotificarInscricao, payloadPush } from '../AtendimentoPushService.js';

function cenario() {
 const original={id:'neutra',portalClientId:null,chaveEscopo:'sem-empresa:numero',vinculoNumeroId:'vigencia-1',canalId:'principal',telefoneE164:'5511000000000',atendimentoId:'atendimento-1'};
 const efetiva={...original,id:'empresa-a',portalClientId:'empresa-1',chaveEscopo:'empresa:empresa-1'};
 const inscricao={id:'i1',userId:'u1',ativa:true,minhas:true,fila:true,vinculo:'nonce'};
 const evento={id:'m1',conversaId:original.id,expiraEm:new Date(Date.now()+3600000)};
 const mensagem={id:'m1',conversaId:original.id,direcao:'in',registradaEm:new Date(),contexto:{estado:'RESOLVIDA',conversaId:efetiva.id,portalClientId:efetiva.portalClientId,atendimentoId:efetiva.atendimentoId}};
 const client={user:{findUnique:jest.fn(async()=>({id:'u1',status:'active',role:'contador',accountType:'FIRM'}))},portalClient:{findMany:jest.fn(async()=>[{id:'empresa-1'}])},mensagemWhatsapp:{findUnique:jest.fn(async()=>mensagem)},conversaWhatsapp:{findUnique:jest.fn(async({where})=>where.id===original.id ? original : where.id===efetiva.id ? efetiva : null)}};
 carregarGrupoIdentidade.mockImplementation(async({conversaId,visiveis})=>{
   if(conversaId!==efetiva.id || !visiveis.includes(efetiva.portalClientId)) throw Object.assign(new Error('fora'),{status:404});
   return {origem:{...efetiva,vinculoNumero:{encerrouEm:null,interlocutor:{atendidaPor:null}},canalWhatsapp:{ativo:true}}};
 });
 return {original,efetiva,inscricao,evento,mensagem,client};
}
beforeEach(()=>jest.clearAllMocks());
it('notifica recibo resolvido na empresa selecionada da mesma pessoa/canal',async()=>{const s=cenario();expect(await podeNotificarInscricao(s,s)).toBe(true);expect(carregarGrupoIdentidade).toHaveBeenCalledWith(expect.objectContaining({conversaId:s.efetiva.id,visiveis:['empresa-1']}));expect(payloadPush(s).url).toContain('conversa=neutra');});
it.each(['vigencia','canal','telefone','empresa','atendimento','excluida','legado','pendente','semIdentidade'])('recusa resolução divergente: %s',async caso=>{const s=cenario();
 if(caso==='vigencia')s.efetiva.vinculoNumeroId='outra-vigencia';
 if(caso==='canal')s.efetiva.canalId='comercial';
 if(caso==='telefone')s.efetiva.telefoneE164='5511999999999';
 if(caso==='empresa')s.efetiva.portalClientId='outra-empresa';
 if(caso==='atendimento')s.efetiva.atendimentoId='outro';
 if(caso==='excluida')s.efetiva.excluidaEm=new Date();
 if(caso==='legado')s.efetiva.chaveEscopo='legado:empresa';
 if(caso==='pendente')s.mensagem.contexto.estado='PENDENTE';
 if(caso==='semIdentidade')s.original.vinculoNumeroId=null;
 expect(await podeNotificarInscricao(s,s)).toBe(false);
});
it('leitura do segmento efetivo suprime notificação mesmo origem não lida',async()=>{const s=cenario();s.efetiva.lidaAteEm=new Date(Date.now()+1000);expect(await podeNotificarInscricao(s,s)).toBe(false);});
it('empresa resolvida fora da carteira não notifica',async()=>{const s=cenario();s.client.portalClient.findMany.mockResolvedValue([]);expect(await podeNotificarInscricao(s,s)).toBe(false);});
it('atribuição e vigência atual do segmento resolvido continuam conferidas',async()=>{const s=cenario();carregarGrupoIdentidade.mockResolvedValue({origem:{...s.efetiva,vinculoNumero:{encerrouEm:null,interlocutor:{atendidaPor:'outro'}},canalWhatsapp:{ativo:true}}});expect(await podeNotificarInscricao(s,s)).toBe(false);});
