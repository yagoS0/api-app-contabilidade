import { enviarDanfseWhatsapp } from '../EnvioDanfseWhatsappService.js';
import { aplicarStatusMensagem } from '../SaidaWhatsappService.js';
jest.mock('dotenv', () => ({config: jest.fn()}));
function fixture() {
  const settings = new Map(), messages = new Map(), files = new Map();
  const conversa = {id:'cv',portalClientId:'pc',telefoneE164:'5521999990000',escopoVerificado:true};
  messages.set('in1',{id:'in1',conversaId:'cv',direcao:'in'});
  messages.set('in2',{id:'in2',conversaId:'cv',direcao:'in'});
  const client = {
    portalInvoice:{findFirst:jest.fn(async()=>null)},
    portalClient:{findUnique:jest.fn(async()=>({companyId:'legacy'}))},
    serviceInvoice:{findFirst:jest.fn(async()=>({id:'nota',status:'issued',xml:'synthetic'}))},
    appSetting:{
      findUnique:jest.fn(async ({where})=>structuredClone(settings.get(where.key)||null)),
      create:jest.fn(async ({data})=>{if(settings.has(data.key))throw Object.assign(new Error('unique'),{code:'P2002'});settings.set(data.key,structuredClone(data));return data;}),
      updateMany:jest.fn(async ({where,data})=>{if(JSON.stringify(settings.get(where.key)?.value)!==JSON.stringify(where.value.equals))return {count:0};settings.set(where.key,{key:where.key,...structuredClone(data)});return {count:1};}),
      upsert:jest.fn(async ({where,create})=>{if(!settings.has(where.key))settings.set(where.key,structuredClone(create));return settings.get(where.key);}),
    },
    mensagemWhatsapp:{
      findUnique:jest.fn(async ({where})=>where.id?messages.get(where.id):[...messages.values()].find(m=>m.providerMessageId===where.providerMessageId)),
      create:jest.fn(async ({data})=>{const m={id:'out'+messages.size,...data};messages.set(m.id,m);return m;}),
      updateMany:jest.fn(async ({where,data})=>{const m=messages.get(where.id);if(!m||where.statusEnvio&&m.statusEnvio!==where.statusEnvio)return {count:0};Object.assign(m,data);return {count:1};}),
    },
    arquivoWhatsapp:{upsert:jest.fn(async ({where,create})=>{if(!files.has(where.mensagemId))files.set(where.mensagemId,create);return files.get(where.mensagemId);})},
    conversaWhatsapp:{update:jest.fn(async()=>conversa)},
    acaoPendenteWhatsapp:{findUnique:jest.fn(async()=>({id:'acao',conversaId:'cv',portalClientId:'pc',status:'executada',resultado:{status:'issued',nfseId:'nota'}}))},
  };
  const conferirAcesso=jest.fn(async()=>{}), gerar=jest.fn(async()=>({pdf:Buffer.from('%PDF-1.4\nsynthetic'),nomeArquivo:'danfse.pdf'}));
  const cloud={enviarDocumento:jest.fn(async args=>{await args.antesDeEnviar();expect(files.size).toBeGreaterThan(0);return {wamid:'wamid'+messages.size};})};
  const enviar=opcoes=>enviarDanfseWhatsapp({conversa,notaId:'nota',mensagemEntradaId:'in1',client,cloud,conferirAcesso,gerar,...opcoes});
  return {client,cloud,enviar,gerar,conferirAcesso,settings,messages,files,conversa};
}
it('persiste bytes antes do transporte, repete recibo e aceita novo pedido explícito',async()=>{
 const f=fixture();const primeiro=await f.enviar();expect(primeiro.wamid).toBeTruthy();
 await f.enviar();expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
 await f.enviar({mensagemEntradaId:'in2'});expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(2);
 await f.enviar();expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(2);
 expect([...f.files.values()][0]).toMatchObject({portalClientId:'pc',mimeType:'application/pdf',estado:'DISPONIVEL'});
});
it('replay de ação emitida e recuperada não entrega duas vezes',async()=>{
 const f=fixture();await f.enviar({acaoId:'acao'});await f.enviar({acaoId:'acao',mensagemEntradaId:'in2'});expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it('falha no PDF pode recuperar só a entrega',async()=>{
 const f=fixture();f.gerar.mockRejectedValueOnce(new Error('XML indisponível'));await expect(f.enviar()).rejects.toThrow();
 expect(f.cloud.enviarDocumento).not.toHaveBeenCalled();await f.enviar({mensagemEntradaId:'in2'});expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it.each(['timeout','sem wamid'])('resultado %s bloqueia inclusive outra entrada',async modo=>{
 const f=fixture();f.cloud.enviarDocumento.mockImplementation(async()=>{if(modo==='timeout')throw new Error('timeout');return {};});
 await expect(f.enviar()).rejects.toThrow();await expect(f.enviar({mensagemEntradaId:'in2'})).rejects.toMatchObject({codigo:'DANFSE_ENTREGA_A_CONFERIR'});expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it('nega origem de outro fio e ação fiscal não confirmada',async()=>{
 const f=fixture();f.messages.get('in1').conversaId='outro';await expect(f.enviar()).rejects.toMatchObject({codigo:'DANFSE_SEM_ORIGEM'});
 f.messages.get('in1').conversaId='cv';f.client.acaoPendenteWhatsapp.findUnique.mockResolvedValue({conversaId:'cv',portalClientId:'pc',status:'confirmada'});
 await expect(f.enviar({acaoId:'acao'})).rejects.toMatchObject({codigo:'DANFSE_ACAO_INVALIDA'});expect(f.gerar).not.toHaveBeenCalled();
});
it('reserva concorrente permite apenas uma saída',async()=>{
 const f=fixture();const r=await Promise.allSettled([f.enviar(),f.enviar()]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it('callbacks tardios não rebaixam entrega nem apagam histórico',async()=>{
 const f=fixture();const r=await f.enviar();await aplicarStatusMensagem({providerMessageId:r.wamid,status:'read',client:f.client});await aplicarStatusMensagem({providerMessageId:r.wamid,status:'sent',client:f.client});
 expect([...f.messages.values()].find(m=>m.providerMessageId===r.wamid).statusEnvio).toBe('lido');expect(f.files.size).toBe(1);
});
it('revogação na guarda pós-upload impede POST e não altera emissão',async()=>{
 const f=fixture();let posts=0;f.cloud.enviarDocumento.mockImplementation(async args=>{await args.antesDeEnviar();f.conferirAcesso.mockRejectedValue(new Error('revogado'));await args.antesDeEnviar();posts++;return {wamid:'x'};});
 await expect(f.enviar()).rejects.toThrow('revogado');expect(posts).toBe(0);expect(f.client.acaoPendenteWhatsapp.findUnique).not.toHaveBeenCalled();
});
import { WhatsappCloudClient } from '../WhatsappCloudClient.js';
jest.mock('../ConsentimentoWhatsappService.js', () => ({ conferirEnvioConsentido: jest.fn(async()=>{}) }));
it('Cloud real: revogação durante upload é falha conhecida e retomada não repete emissão',async()=>{
 const f=fixture();let autorizado=true;
 f.conferirAcesso.mockImplementation(async()=>{if(!autorizado)throw Object.assign(new Error('revogado'),{codigo:'ACESSO_REVOGADO'});});
 const fetchImpl=jest.fn(async url=>{if(String(url).endsWith('/media')){autorizado=false;return {ok:true,status:200,json:async()=>({id:'media-fixture'})};}throw new Error('POST proibido');});
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({mensagemNaoEnviada:true,indeterminado:false});
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect([...f.settings.values()][0].value.status).toBe('FALHOU_ANTES_ENVIO');
 expect([...f.messages.values()].find(m=>m.direcao==='out').statusEnvio).toBe('falhou');
 autorizado=true;await f.enviar({mensagemEntradaId:'in2'});expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it('cancelamento durante upload bloqueia PDF antigo e próxima entrada gera revisão atual',async()=>{
 const f=fixture();let status='issued';f.client.serviceInvoice.findFirst.mockImplementation(async()=>({id:'nota',status,xml:'synthetic'}));
 const fetchImpl=jest.fn(async url=>{if(String(url).endsWith('/media')){status='cancelled';return {ok:true,status:200,json:async()=>({id:'media-fixture'})};}throw new Error('POST proibido');});
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({codigo:'DANFSE_REVISAO_ALTERADA',mensagemNaoEnviada:true});
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect([...f.settings.values()][0].value.status).toBe('FALHOU_ANTES_ENVIO');
 await f.enviar({mensagemEntradaId:'in2'});expect(f.gerar).toHaveBeenCalledTimes(2);expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});
it('evento de substituição da PortalInvoice altera a revisão antes de enviar',async()=>{
 const f=fixture();let eventos=[];
 f.client.portalInvoice.findFirst.mockImplementation(async ({where})=>where.id?{id:'nota',chaveAcesso:'chave',status:'normal',xmlRaw:'synthetic'}:null);
 f.client.portalInvoiceEvent={findMany:jest.fn(async()=>eventos)};
 f.gerar.mockImplementation(async()=>{eventos=[{type:'canc_por_substituicao',chaveSubstituta:'nova'}];return {pdf:Buffer.from('%PDF-1.4\nsynthetic'),nomeArquivo:'danfse.pdf'};});
 await expect(f.enviar()).rejects.toMatchObject({codigo:'DANFSE_REVISAO_ALTERADA'});expect(f.cloud.enviarDocumento).not.toHaveBeenCalled();
});
it.each(['media', 'messages'])('Cloud real: HTTP 400 em %s permite novo pedido documental sem nova emissão', async etapa => {
 const f=fixture();let recusar=true;
 const fetchImpl=jest.fn(async url=>{
   const upload=String(url).endsWith('/media');
   if(recusar && (etapa==='media' ? upload : !upload)) return {ok:false,status:400,json:async()=>({error:{code:131047,message:'fixture refusal'}})};
   return {ok:true,status:200,json:async()=>upload ? {id:'media-fixture'} : {messages:[{id:'wamid-confirmado'}]}};
 });
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({indeterminado:false});
 expect([...f.settings.values()][0].value.status).toBe(etapa === 'media' ? 'FALHOU_ANTES_ENVIO' : 'RECUSADO');
 expect([...f.messages.values()].find(m=>m.direcao==='out').statusEnvio).toBe('falhou');
 recusar=false;const r=await f.enviar({cloud,mensagemEntradaId:'in2'});
 expect(r.wamid).toBe('wamid-confirmado');
 expect(fetchImpl.mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(etapa==='messages'?2:1);
 expect(f.client.acaoPendenteWhatsapp.findUnique).not.toHaveBeenCalled();
});
it('aceite seguido de falha ao gravar recibo continua bloqueado',async()=>{
 const f=fixture();f.client.appSetting.upsert.mockRejectedValue(new Error('persistência indisponível'));
 await expect(f.enviar()).rejects.toThrow('persistência indisponível');
 expect([...f.settings.values()][0].value.status).toBe('ACEITO');
 await expect(f.enviar({mensagemEntradaId:'in2'})).rejects.toMatchObject({codigo:'DANFSE_ENTREGA_A_CONFERIR'});
 expect(f.cloud.enviarDocumento).toHaveBeenCalledTimes(1);
});

it.each(['canal', 'identidade'])('Cloud real: revogação de %s durante upload impede POST usando guarda comum',async alvo=>{
 const f=fixture();let ativo=true;
 f.conversa.canalId='canal-suporte';f.conversa.vinculoNumeroId='vinculo';
 f.client.canalWhatsapp={findUnique:jest.fn(async()=>({id:'canal-suporte',ativo:alvo==='canal'?ativo:true}))};
 f.client.vinculoNumeroInterlocutor={findUnique:jest.fn(async()=>({id:'vinculo',telefoneE164:f.conversa.telefoneE164,encerrouEm:alvo==='identidade'&&!ativo?new Date():null,interlocutor:{estado:'ATIVO'}}))};
 const fetchImpl=jest.fn(async url=>{if(String(url).endsWith('/media')){ativo=false;return {ok:true,status:200,json:async()=>({id:'media-fixture'})};}throw new Error('POST proibido');});
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({mensagemNaoEnviada:true,indeterminado:false});
 expect(fetchImpl).toHaveBeenCalledTimes(1);expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/media$/);
 expect([...f.settings.values()][0].value.status).toBe('FALHOU_ANTES_ENVIO');
 expect([...f.messages.values()].find(m=>m.direcao==='out').statusEnvio).toBe('falhou');
 expect(await f.client.serviceInvoice.findFirst()).toMatchObject({status:'issued'});
});

it.each(['500 vazio','400 JSON inválido','400 código desconhecido'])('Cloud real: %s em messages conserva resultado incerto e bloqueia novo POST',async caso=>{
 const f=fixture();
 const fetchImpl=jest.fn(async url=>{
   if(String(url).endsWith('/media'))return {ok:true,status:200,json:async()=>({id:'media-fixture'})};
   return {ok:false,status:caso.startsWith('500')?500:400,json:async()=>{
     if(caso.includes('inválido'))throw new SyntaxError('JSON inválido');
     return caso.includes('desconhecido')?{error:{code:99999999,message:'unknown'}}:null;
   }};
 });
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({indeterminado:true});
 expect([...f.settings.values()][0].value.status).toBe('INDETERMINADO');
 expect([...f.messages.values()].find(m=>m.direcao==='out').statusEnvio).toBe('indeterminado');
 await expect(f.enviar({cloud,mensagemEntradaId:'in2'})).rejects.toMatchObject({codigo:'DANFSE_ENTREGA_A_CONFERIR'});
 expect(fetchImpl.mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(1);
});
it('upload com resposta desconhecida permite recuperar entrega pois messages não foi chamado',async()=>{
 const f=fixture();let falhar=true;
 const fetchImpl=jest.fn(async url=>{
   const upload=String(url).endsWith('/media');
   if(upload&&falhar)return {ok:false,status:500,json:async()=>null};
   return {ok:true,status:200,json:async()=>upload?{id:'media-fixture'}:{messages:[{id:'wamid-upload-retomado'}]}};
 });
 const cloud=new WhatsappCloudClient({fetchImpl,config:{habilitada:true,token:'synthetic',phoneNumberId:'fixture',versao:'v21.0',log:null}});
 await expect(f.enviar({cloud})).rejects.toMatchObject({mensagemNaoEnviada:true,indeterminado:false});
 expect([...f.settings.values()][0].value.status).toBe('FALHOU_ANTES_ENVIO');
 falhar=false;expect((await f.enviar({cloud,mensagemEntradaId:'in2'})).wamid).toBe('wamid-upload-retomado');
 expect(fetchImpl.mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(1);
});
