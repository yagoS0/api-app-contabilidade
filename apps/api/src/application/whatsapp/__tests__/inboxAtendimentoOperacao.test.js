import { buscarMensagensIdentidade, registrarLeituraIdentidade } from '../InboxWhatsappService.js';
import { alterarAtendimentoHumano } from '../AtendimentoResponsavelWhatsappService.js';

function base() {
 const conversa={id:'c1',portalClientId:'e1',chaveEscopo:'empresa:e1',portalClient:{id:'e1',razao:'Empresa sintética',cnpj:'11222333000181'}};
 return {conversa,client:{conversaWhatsapp:{findUnique:jest.fn(async()=>conversa),updateMany:jest.fn(async()=>({count:1}))},mensagemWhatsapp:{findFirst:jest.fn(async()=>null),findMany:jest.fn(async()=>[])}}};
}
it('busca paginada sempre inclui carteira, contexto e arquivo autorizado',async()=>{
 const b=base();b.client.mensagemWhatsapp.findMany.mockResolvedValue([{id:'a',conversaId:'c1',corpo:'guia',tipo:'text',direcao:'out',registradaEm:new Date(),envioGuiaTentativa:{snapshot:{telefone:'não exportar'}}},{id:'b',conversaId:'c1'}]);
 const r=await buscarMensagensIdentidade({conversaId:'c1',visiveis:['e1'],q:'guia',limite:1,client:b.client});
 expect(r.temMais).toBe(true);expect(r.proximoCursor).toBe('a');expect(r.resultados[0]).not.toHaveProperty('envioGuiaTentativa');expect(r.resultados[0].empresa.id).toBe('e1');
 const q=b.client.mensagemWhatsapp.findMany.mock.calls[0][0];expect(q.take).toBe(2);expect(q.where.AND[0].OR[0].conversaId.in).toEqual(['c1']);
 expect(q.where.AND[1].OR[1].arquivoWhatsapp.is.OR).toContainEqual({portalClientId:{in:['e1']}});
});
it('busca de empresa de fora não consulta mensagens',async()=>{const b=base();await expect(buscarMensagensIdentidade({conversaId:'c1',visiveis:['e9'],q:'guia',client:b.client})).rejects.toMatchObject({status:404});expect(b.client.mensagemWhatsapp.findMany).not.toHaveBeenCalled();});
it('cursor de mensagem fora da busca não inicia página',async()=>{const b=base();await expect(buscarMensagensIdentidade({conversaId:'c1',visiveis:['e1'],q:'guia',cursor:'outra',client:b.client})).rejects.toMatchObject({code:'cursor_invalido'});expect(b.client.mensagemWhatsapp.findMany).not.toHaveBeenCalled();});
it('POST leitura só aceita entrada e nunca avança além da mensagem observada',async()=>{const b=base(),quando=new Date('2026-09-20T12:00Z');b.client.mensagemWhatsapp.findFirst.mockResolvedValue({id:'m',direcao:'in',registradaEm:quando});await registrarLeituraIdentidade({conversaId:'c1',mensagemId:'m',visiveis:['e1'],client:b.client});expect(b.client.mensagemWhatsapp.findFirst.mock.calls[0][0].where.AND[1]).toEqual({id:'m',direcao:'in'});expect(b.client.conversaWhatsapp.updateMany.mock.calls[0][0]).toMatchObject({where:{OR:[{lidaAteEm:null},{lidaAteEm:{lt:quando}}]},data:{lidaAteEm:quando}});});

function humano() {
 const atendimento={id:'a1',versao:5,conversaId:'c1',portalClientId:'e1',aguardandoSelecao:false,expiraEm:new Date(Date.now()+600000)};
 const conversa={id:'c1',portalClientId:'e1',atendidaPor:null,vinculoNumeroId:'v1',atendimentoId:'a1',atendimento};
 const client={
  atendimentoResponsavelWhatsapp:{findUnique:jest.fn(async()=>atendimento),updateMany:jest.fn(async()=>({count:1})),update:jest.fn(async()=>atendimento)},
  vinculoNumeroInterlocutor:{findUnique:jest.fn(async()=>({id:'v1',interlocutorId:'p1',encerrouEm:null}))},
  interlocutorComunicacao:{updateMany:jest.fn(async()=>({count:1}))},
  conversaWhatsapp:{updateMany:jest.fn(async()=>({count:1})),findMany:jest.fn(async()=>[{id:'c1'}]),findUnique:jest.fn(async()=>conversa)},
  acaoPendenteWhatsapp:{updateMany:jest.fn(async()=>({count:1}))},turnoIaWhatsapp:{updateMany:jest.fn(async()=>({count:1}))},rascunhoEmissaoWhatsapp:{findUnique:jest.fn(async()=>null)},
 };
 client.$transaction=async fn=>fn(client);
 return {conversa,client,atendimento};
}
it('CAS não substitui atendente concorrente da identidade',async()=>{const b=humano();b.client.interlocutorComunicacao.updateMany.mockResolvedValue({count:0});await expect(alterarAtendimentoHumano({...b,atendidaPor:'u1',preservarResponsavel:true})).rejects.toMatchObject({codigo:'ATENDIMENTO_OCUPADO'});expect(b.client.conversaWhatsapp.updateMany).not.toHaveBeenCalled();});
it('devolução recusa versão antiga mesmo quando o atendente continua sendo o mesmo', async () => {
 const b=humano();b.conversa.atendidaPor='u1';b.conversa.atendimentoHumanoVersao=7;
 b.client.interlocutorComunicacao.updateMany.mockImplementation(async({where})=>({count:where.versao===8?1:0}));
 await expect(alterarAtendimentoHumano({...b,preservarResponsavel:true})).rejects.toMatchObject({codigo:'ATENDIMENTO_OCUPADO'});
 expect(b.client.conversaWhatsapp.updateMany).not.toHaveBeenCalled();
 expect(b.client.acaoPendenteWhatsapp.updateMany).not.toHaveBeenCalled();
});
it('devolve identidade e segmentos quando a conversa comercial ainda não tem atendimento', async () => {
 const b=humano();b.conversa.atendimentoId=null;b.conversa.canalId='comercial';b.conversa.atendidaPor='u1';b.conversa.atendimentoHumanoVersao=7;
 const pessoa={id:'p1',versao:7,atendidaPor:'u1',atendidaDesde:new Date()};
 const segmentos=[{id:'c1',atendidaPor:null,atendidaDesde:null},{id:'suporte',atendidaPor:'u1',atendidaDesde:pessoa.atendidaDesde}];
 b.client.conversaWhatsapp.findFirst=jest.fn(async()=>segmentos[1]);
 b.client.conversaWhatsapp.findMany.mockImplementation(async()=>segmentos);
 b.client.atendimentoResponsavelWhatsapp.upsert=jest.fn(async()=>b.atendimento);
 b.client.interlocutorComunicacao.updateMany.mockImplementation(async({where,data})=>{
   if(where.versao!==pessoa.versao||where.atendidaPor!==pessoa.atendidaPor)return{count:0};
   Object.assign(pessoa,{atendidaPor:data.atendidaPor,atendidaDesde:data.atendidaDesde,versao:pessoa.versao+1});return{count:1};
 });
 b.client.conversaWhatsapp.updateMany.mockImplementation(async({data})=>{
   if(Object.hasOwn(data,'atendidaPor'))for(const c of segmentos)Object.assign(c,data);
   return{count:segmentos.length};
 });
 await alterarAtendimentoHumano({...b,preservarResponsavel:true});
 expect(pessoa).toMatchObject({atendidaPor:null,atendidaDesde:null,versao:8});
 expect(segmentos.every(c=>!c.atendidaPor&&!c.atendidaDesde&&c.automacaoInvalidadaEm)).toBe(true);
 expect(b.client.turnoIaWhatsapp.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({conversaId:{in:['c1','suporte']}})}));
});
it('assumir documento preserva só contexto previamente validado e invalida automação',async()=>{const b=humano();await alterarAtendimentoHumano({...b,atendidaPor:'u1',preservarResponsavel:true,preservarContextoOperacional:true});expect(b.client.atendimentoResponsavelWhatsapp.updateMany.mock.calls[0][0].where).toMatchObject({id:'a1',versao:5,aguardandoSelecao:false,conversaId:'c1',portalClientId:'e1'});expect(b.client.atendimentoResponsavelWhatsapp.update).toHaveBeenCalledWith({where:{id:'a1'},data:{aguardandoSelecao:false,conversaId:'c1',portalClientId:'e1',expiraEm:b.atendimento.expiraEm}});expect(b.client.turnoIaWhatsapp.updateMany).toHaveBeenCalled();});
it('contexto alterado concorrentemente impede assumir e enviar documento',async()=>{const b=humano();b.client.atendimentoResponsavelWhatsapp.updateMany.mockResolvedValueOnce({count:0});await expect(alterarAtendimentoHumano({...b,atendidaPor:'u1',preservarResponsavel:true,preservarContextoOperacional:true})).rejects.toMatchObject({codigo:'CONTEXTO_ALTERADO'});expect(b.client.interlocutorComunicacao.updateMany).not.toHaveBeenCalled();});
