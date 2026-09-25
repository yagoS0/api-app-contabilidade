import { comIntencaoEnvio, consultarIntencaoEnvio } from '../IntencaoEnvioAtendimentoService.js';
import { lerRascunhoAtendimento, salvarRascunhoAtendimento, excluirRascunhoAtendimento, expirarRascunhosAtendimento } from '../RascunhoAtendimentoService.js';
import { prepararRetomadaAtendimento } from '../RetomadaAtendimentoService.js';
import { enviarMensagemRastreada } from '../SaidaWhatsappService.js';

const conversa = { id:'conversa-a',telefoneE164:'5521999990000',portalClientId:'empresa-a' };
const usuario = 'usuario-a';
const duplicada = () => Object.assign(new Error('unique'),{code:'P2002'});
function banco() {
  const inten = [], mensagens = [], drafts = [];
  const client = {
    intencaoEnvioAtendimento:{
      create:jest.fn(async({data})=>{if(inten.some(r=>r.userId===data.userId && r.clientRequestId===data.clientRequestId)) throw duplicada(); const r={id:`i${inten.length}`,status:'RESERVADA',createdAt:new Date(),...data};inten.push(r);return {...r};}),
      findUnique:jest.fn(async({where})=>inten.find(r=>where.id ? r.id===where.id : r.userId===where.userId_clientRequestId.userId && r.clientRequestId===where.userId_clientRequestId.clientRequestId) || null),
      update:jest.fn(async({where,data})=>Object.assign(inten.find(r=>r.id===where.id),data)),
      updateMany:jest.fn(async({where,data})=>{const r=inten.find(r=>r.id===where.id);if(r)Object.assign(r,data);return{count:r?1:0};}),
    },
    mensagemWhatsapp:{
      create:jest.fn(async({data})=>{const m={id:`m${mensagens.length}`,...data};mensagens.push(m);return m;}),
      update:jest.fn(async({where,data})=>Object.assign(mensagens.find(m=>m.id===where.id),data)),
      updateMany:jest.fn(async({where,data})=>{const m=mensagens.find(m=>m.id===where.id && m.statusEnvio===where.statusEnvio);if(m)Object.assign(m,data);return{count:m?1:0};}),
      findUnique:jest.fn(async({where})=>mensagens.find(m=>m.intencaoEnvioId===where.intencaoEnvioId) || null),
    },
    conversaWhatsapp:{update:jest.fn(async()=>({}))},
    rascunhoAtendimento:{
      findUnique:jest.fn(async({where:{userId_chaveEscopo:k}})=>{const r=drafts.find(r=>r.userId===k.userId && r.chaveEscopo===k.chaveEscopo);return r?{...r}:null;}),
      create:jest.fn(async({data})=>{if(drafts.some(r=>r.userId===data.userId && r.chaveEscopo===data.chaveEscopo))throw duplicada(); const r={id:`d${drafts.length}`,...data};drafts.push(r);return {...r};}),
      updateMany:jest.fn(async({where,data})=>{let n=0; for(const r of drafts){
        if(where.userId && r.userId!==where.userId || where.chaveEscopo && r.chaveEscopo!==where.chaveEscopo || where.versao!==undefined && r.versao!==where.versao || where.expiraEm?.lte && r.expiraEm>where.expiraEm.lte || where.NOT && r.conteudo.apagado)continue;
        Object.assign(r,{...data,...(data.versao?.increment ? {versao:r.versao+data.versao.increment}:{})});n++;
      }return {count:n};}),
    },
  };
  client.$transaction=async fn=>fn(client);
  return {client,inten,mensagens,drafts};
}
function parametros(b,extra={}) {
  return {userId:usuario,clientRequestId:'request-0001',conversa,payload:{texto:'Oi'},client:b.client,...extra};
}
function transporte(b,rede) { return intencaoEnvioId=>enviarMensagemRastreada({intencaoEnvioId,conversa,corpo:'Oi',client:b.client,enviar:rede}); }

describe('intenção durável sem segunda chamada',()=>{
  it('clique repetido recupera uma mensagem aceita',async()=>{
    const b=banco(),rede=jest.fn(async()=>({wamid:'wamid.a'})),args=parametros(b,{enviar:transporte(b,rede)});
    const primeiro=await comIntencaoEnvio(args), segundo=await comIntencaoEnvio(args);
    expect(primeiro.wamid).toBe('wamid.a'); expect(segundo.repetida).toBe(true);
    expect(rede).toHaveBeenCalledTimes(1);expect(b.mensagens).toHaveLength(1);
  });
  it('duas requisições concorrentes reservam apenas uma saída',async()=>{
    const b=banco();let liberar;const pendente=new Promise(r=>liberar=r); const rede=jest.fn(()=>pendente),args=parametros(b,{enviar:transporte(b,rede)});
    const primeira=comIntencaoEnvio(args);await Promise.resolve();
    await expect(comIntencaoEnvio(args)).rejects.toMatchObject({code:'ENVIO_INDETERMINADO'});
    liberar({wamid:'wamid.a'});await primeira;expect(rede).toHaveBeenCalledTimes(1);
  });
  it.each([{payload:{texto:'Outro'}},{conversa:{...conversa,telefoneE164:'5521999991111'}},{conversa:{...conversa,canalId:'comercial'}}])('mesma chave não muda conteúdo ou destino %p',async extra=>{
    const b=banco(),rede=jest.fn(async()=>({wamid:'wamid.a'}));await comIntencaoEnvio(parametros(b,{enviar:transporte(b,rede)}));
    await expect(comIntencaoEnvio(parametros(b,{enviar:transporte(b,rede),...extra}))).rejects.toMatchObject({code:'INTENCAO_DIVERGENTE'});expect(rede).toHaveBeenCalledTimes(1);
  });
  it('timeout persiste INCERTA e consulta nunca envia novamente',async()=>{
    const b=banco(),rede=jest.fn(async()=>{throw new Error('timeout');}),args=parametros(b,{enviar:transporte(b,rede)});
    await expect(comIntencaoEnvio(args)).rejects.toMatchObject({indeterminado:true});
    expect(await consultarIntencaoEnvio(args)).toMatchObject({status:'INCERTA',mensagem:{statusEnvio:'indeterminado'}});
    await expect(comIntencaoEnvio(args)).rejects.toMatchObject({code:'ENVIO_INDETERMINADO'});expect(rede).toHaveBeenCalledTimes(1);
  });
  it('aceite após falha de persistência da intenção se recupera pela mensagem',async()=>{
    const b=banco(),rede=jest.fn(async()=>({wamid:'wamid.a'})),args=parametros(b,{enviar:transporte(b,rede)});
    b.client.intencaoEnvioAtendimento.update.mockRejectedValueOnce(new Error('db'));
    await expect(comIntencaoEnvio(args)).rejects.toThrow('db');
    expect(await consultarIntencaoEnvio(args)).toMatchObject({status:'ACEITA',mensagem:{providerMessageId:'wamid.a'}});
    expect((await comIntencaoEnvio(args)).wamid).toBe('wamid.a');expect(rede).toHaveBeenCalledTimes(1);
  });
  it('falha de guardar arquivo antes da rede nunca é aceite ou incerteza Meta',async()=>{
    const b=banco(),rede=jest.fn(),args=parametros(b,{enviar:id=>enviarMensagemRastreada({intencaoEnvioId:id,conversa,client:b.client,enviar:rede,aposRegistrar:async()=>{throw new Error('storage');}})});
    await expect(comIntencaoEnvio(args)).rejects.toThrow('storage');expect(rede).not.toHaveBeenCalled();
    expect(await consultarIntencaoEnvio(args)).toMatchObject({status:'FALHOU'});
  });
  it('intenção de outro usuário ou outro destino não é consultável',async()=>{
    const b=banco();await comIntencaoEnvio(parametros(b,{enviar:transporte(b,async()=>({wamid:'wamid.a'}))}));
    expect(await consultarIntencaoEnvio(parametros(b,{userId:'outro'}))).toBeNull();
    expect(await consultarIntencaoEnvio(parametros(b,{conversa:{...conversa,id:'outra'}}))).toBeNull();
  });
  it('duas intenções deliberadas de texto igual são diferentes',async()=>{
    const b=banco(),rede=jest.fn(async()=>({wamid:'wamid.a'}));
    await comIntencaoEnvio(parametros(b,{enviar:transporte(b,rede)}));await comIntencaoEnvio(parametros(b,{enviar:transporte(b,rede),clientRequestId:'request-0002'}));expect(rede).toHaveBeenCalledTimes(2);
  });
});

describe('rascunhos versionados e retenção',()=>{
  const args=b=>({userId:usuario,conversa,client:b.client});
  it('recupera depois de abrir em outro aparelho',async()=>{const b=banco();await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'Em revisão'}});expect(await lerRascunhoAtendimento(args(b))).toMatchObject({versao:1,conteudo:{texto:'Em revisão'}});});
  it('dois aparelhos não sobrescrevem a mesma versão',async()=>{const b=banco();await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'A'}});const r=await Promise.allSettled(['B','C'].map(texto=>salvarRascunhoAtendimento({...args(b),versao:1,conteudo:{texto}})));expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(r.find(x=>x.status==='rejected').reason.code).toBe('RASCUNHO_CONFLITO');});
  it.each([{userId:'outro'},{conversa:{...conversa,id:'outra'}},{conversa:{...conversa,canalId:'comercial'}}])('isola usuário/canal/destino %p',async extra=>{const b=banco();await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'privado'}});expect(await lerRascunhoAtendimento({...args(b),...extra})).toBeNull();});
  it('enviar/descartar versão antiga não apaga edição nova',async()=>{const b=banco();await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'A'}});await salvarRascunhoAtendimento({...args(b),versao:1,conteudo:{texto:'B'}});await expect(excluirRascunhoAtendimento({...args(b),versao:1})).rejects.toMatchObject({code:'RASCUNHO_CONFLITO'});expect((await lerRascunhoAtendimento(args(b))).conteudo.texto).toBe('B');});
  it('tombstone impede que aba antiga sobrescreva rascunho recriado',async()=>{const b=banco();await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'A'}});await excluirRascunhoAtendimento({...args(b),versao:1});await salvarRascunhoAtendimento({...args(b),versao:2,conteudo:{texto:'Novo'}});await expect(salvarRascunhoAtendimento({...args(b),versao:1,conteudo:{texto:'Antigo'}})).rejects.toMatchObject({code:'RASCUNHO_CONFLITO'});});
  it('sete dias apagam conteúdo, preservando apenas revisão contra cliente atrasado',async()=>{const b=banco();const inicio=new Date('2026-09-01T10:00Z');await salvarRascunhoAtendimento({...args(b),versao:0,conteudo:{texto:'privado'},agora:inicio});await expirarRascunhosAtendimento({client:b.client,agora:new Date('2026-09-09')});expect(b.drafts[0].conteudo).toEqual({texto:'',apagado:true});expect((await lerRascunhoAtendimento({...args(b),agora:new Date('2026-09-09')})).versao).toBe(2);});
});

describe('retomada por modelo realmente aprovado no canal',()=>{
  const local={nomeMeta:'retomar',statusAprovacao:'APROVADO',idioma:'pt_BR'};
  const modelo={id:'meta-1',name:'retomar',status:'APPROVED',language:'pt_BR',category:'UTILITY',components:[{type:'BODY',text:'Olá. Podemos retomar seu atendimento?'}]};
  const args=(l=local,m=modelo)=>({conversa,client:{templateWhatsapp:{findUnique:async()=>l}},consultarModelo:jest.fn(async()=>m)});
  it('prévia tem destinatário, corpo e hash sem alterar janela',async()=>{const a=args(),r=await prepararRetomadaAtendimento(a);expect(r).toMatchObject({disponivel:true,texto:modelo.components[0].text,destinatario:{telefone:conversa.telefoneE164}});expect(r.previaHash).toHaveLength(64);expect(r.aviso).toMatch(/cliente precisa responder/);});
  it.each([null,{...local,statusAprovacao:'DECLARADO'},{...local,statusAprovacao:'REJEITADO'}])('sem aprovação local não chama Meta',async local=>{const a=args(local);expect((await prepararRetomadaAtendimento(a)).disponivel).toBe(false);expect(a.consultarModelo).not.toHaveBeenCalled();});
  it.each([{...modelo,status:'PENDING'},{...modelo,language:'en_US'},{...modelo,name:'outro'},null])('não transfere aprovação de outra WABA/idioma',async m=>{expect((await prepararRetomadaAtendimento(args(local,m))).disponivel).toBe(false);});
  it('parâmetros não configurados não são inventados',async()=>{expect(await prepararRetomadaAtendimento(args(local,{...modelo,components:[{type:'BODY',text:'Olá {{1}}'}]}))).toMatchObject({disponivel:false,motivo:'MODELO_REQUER_PARAMETROS'});});
});
