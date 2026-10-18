jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import { criarTesteIaWhatsapp, RESERVA_CUSTO_CENTAVOS } from '../TesteIaWhatsappService.js';
const user={id:'admin-interno',role:'admin'};
function preparar(){
  let tempo=new Date('2026-10-18T12:00:00Z');
  const sessoes=new Map(),recibos=new Map(),saidas=new Map();let fila=Promise.resolve();
  const repo={criar:async s=>sessoes.set(s.id,structuredClone(s)),ler:async id=>structuredClone(sessoes.get(id)),listar:async()=>[...sessoes.values()].map(s=>structuredClone(s)),
    autorAtivo:jest.fn(async()=>true),
    indexarSaida:async(w,id)=>saidas.set(w,id),sessaoDaSaida:async w=>saidas.get(w),
    sessaoComSaidaIncerta:async(m,conhecida=false)=>[...sessoes.values()].find(s=>s.telefone===m.telefone&&s.canalProvedorId===m.canalProvedorId&&s.wabaProvedorId===m.wabaProvedorId&&s.eventos.some(e=>e.wamid===m.respostaAProviderMessageId||!conhecida&&['enviando','incerto'].includes(e.estado)&&e.tokenSaida&&!e.wamid))?.id,
    citacaoOperacional:jest.fn(async()=>false),
    quarentenar:async(m,id)=>Object.assign(recibos.get(m.providerMessageId),{id,estado:'resposta_citada_isolada',quarentena:{texto:m.corpo}}),
    listarQuarentenas:async id=>[...recibos.values()].filter(r=>r.id===id&&r.quarentena),
    desfechoEntrada:async(m,estado)=>Object.assign(recibos.get(m.providerMessageId),{estado}),
    classificacao:async m=>recibos.get(m.providerMessageId),classificar:async(m,id)=>{if(!recibos.has(m.providerMessageId))recibos.set(m.providerMessageId,{id,isolado:true});},
    alterar:(id,fn)=>{const job=fila.then(async()=>{const s=structuredClone(sessoes.get(id));if(!s)throw new Error('Ausente');const r=await fn(s);sessoes.set(id,s);return r;});fila=job.catch(()=>{});return job;}};
  const responder=jest.fn(async()=>({texto:'Resposta fictícia',estado:'concluido'}));
  const enviar=jest.fn(async({revalidar})=>{await revalidar();return {wamid:'saida-1'};});
  const servico=criarTesteIaWhatsapp({repo,agora:()=>tempo,habilitado:()=>true,envioHabilitado:()=>true,responder,enviar,resolverCanal:async()=>({phoneNumberId:'123',wabaId:'456'})});
  const ativar=(patch={})=>servico.ativar({user,telefone:'5500000000000',canalId:'comercial',confirmacao:'TESTE_ISOLADO_SEM_ENVIO',...patch});
  const mensagem=(id,patch={})=>({providerMessageId:'evento-1',telefone:'5500000000000',canalProvedorId:'123',wabaProvedorId:'456',tipo:'text',corpo:`/teste-ia ${id} Olá`,ocorridaEmProvedor:tempo.toISOString(),...patch});
  return {servico,ativar,mensagem,responder,enviar,sessoes,repo,avancar:(ms=3600000)=>{tempo=new Date(+tempo+ms);}};
}
test('normal segue normal; marcador inválido fica classificado inclusive replay sem marcador',async()=>{
 const f=preparar();await f.ativar();
 expect(await f.servico.interceptar(f.mensagem('',{corpo:'Paguei a guia'}))).toEqual({isolado:false});
 await f.servico.interceptar(f.mensagem('',{corpo:'/teste-ia inválido'}));
 expect(await f.servico.interceptar(f.mensagem('',{corpo:'Paguei a guia'}))).toMatchObject({isolado:true});
 expect(f.responder).not.toHaveBeenCalled();
});
test('ingestão não chama modelo; duplicatas concorrentes são uma entrada, nova mensagem não se perde',async()=>{
 const f=preparar(),s=await f.ativar(),m=f.mensagem(s.id,{companyId:'real',atendimentoHumano:true});
 await Promise.all([f.servico.interceptar(m),f.servico.interceptar(m),f.servico.interceptar({...m,providerMessageId:'evento-2'})]);
 expect(f.responder).not.toHaveBeenCalled();expect(f.sessoes.get(s.id).eventos).toHaveLength(2);
 await Promise.all([f.servico.processarSessao(s.id),f.servico.processarSessao(s.id)]);
 await f.servico.processarSessao(s.id);
 expect(f.responder).toHaveBeenCalledTimes(2);expect(f.enviar).not.toHaveBeenCalled();
 expect(f.responder.mock.calls[0][0]).not.toHaveProperty('companyId');
});
test.each([{telefone:'5500000000001'},{canalProvedorId:'999'},{wabaProvedorId:'999'}])('origem errada falha fechado %j',async patch=>{
 const f=preparar(),s=await f.ativar();expect(await f.servico.interceptar(f.mensagem(s.id,patch))).toMatchObject({estado:'origem_invalida'});
 await f.servico.processarSessao(s.id);expect(f.responder).not.toHaveBeenCalled();
});
test('expiração e revogação durante inferência descartam resposta sem envio',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 f.responder.mockImplementation(async()=>{await f.servico.encerrar({user,id:s.id});return {texto:'Tardia'};});
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);
 expect(f.sessoes.get(s.id).eventos[0].estado).toBe('descartado');expect(f.enviar).not.toHaveBeenCalled();
 f.avancar();expect(await f.servico.interceptar(f.mensagem(s.id,{providerMessageId:'evento-2'}))).toMatchObject({estado:'expirado'});
});
test('crash com lease vencido preserva custo, marca incerto e processa próxima entrada sem repetir anterior',async()=>{
 const f=preparar(),s=await f.ativar({duracaoMinutos:60});
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.interceptar(f.mensagem(s.id,{providerMessageId:'evento-2'}));
 await f.repo.alterar(s.id,x=>Object.assign(x.eventos[0],{estado:'processando',leaseAte:'2026-10-18T11:59:00Z'}));
 await f.servico.processarSessao(s.id);expect(f.sessoes.get(s.id).eventos[0].estado).toBe('incerto');expect(f.responder).toHaveBeenCalledTimes(1);
});
test('saída incerta não é repetida e callback precoce só atualiza namespace de teste',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 f.enviar.mockImplementation(async({correlacao})=>{
   expect(await f.servico.interceptarStatus({correlacaoTeste:correlacao,providerMessageId:'early',status:'read',canalProvedorId:'123',wabaProvedorId:'456'})).toEqual({isolado:true});
   throw new Error('timeout');
 });
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);await f.servico.processarSessao(s.id);
 expect(f.enviar).toHaveBeenCalledTimes(1);expect(f.sessoes.get(s.id).eventos[0]).toMatchObject({estado:'enviado',wamid:'early',recibos:[{status:'read'}]});
});
test('limites, autenticação e dono são validados',async()=>{
 const f=preparar();await expect(f.ativar({user:{id:'staff',role:'user'}})).rejects.toMatchObject({status:403});
 const s=await f.ativar({limiteCustoCentavos:RESERVA_CUSTO_CENTAVOS});
 await expect(f.servico.consultar({user:{id:'outro',role:'admin'},id:s.id})).rejects.toMatchObject({status:404});
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.interceptar(f.mensagem(s.id,{providerMessageId:'evento-2'}));
 await f.servico.processarSessao(s.id);await f.servico.processarSessao(s.id);
 expect(f.responder).toHaveBeenCalledTimes(1);expect(f.sessoes.get(s.id).eventos[1].estado).toBe('limite_custo');
});
test('handoff local pausa próximas entradas exclusivamente sandbox',async()=>{
 const f=preparar(),s=await f.ativar();f.responder.mockResolvedValue({texto:'Contador fictício',contexto:{humano:true},origem:'automatica'});
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.interceptar(f.mensagem(s.id,{providerMessageId:'evento-2'}));
 await f.servico.processarSessao(s.id);await f.servico.processarSessao(s.id);
 expect(f.sessoes.get(s.id).eventos[1].estado).toBe('pausa_local');expect(f.responder).toHaveBeenCalledTimes(1);
});
test('entradas de origem inválida não consomem capacidade da sessão autorizada',async()=>{
 const f=preparar(),s=await f.ativar();
 for(let i=0;i<105;i++)await f.servico.interceptar(f.mensagem(s.id,{providerMessageId:`invalida-${i}`,telefone:'5500000000001'}));
 expect(f.sessoes.get(s.id).eventos).toHaveLength(0);
 expect(await f.servico.interceptar(f.mensagem(s.id))).toMatchObject({estado:'pendente'});
 expect(f.sessoes.get(s.id).eventos).toHaveLength(1);
});
test('resposta citada de teste sem marcador fica isolada após encerramento',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);await f.servico.encerrar({user,id:s.id});
 expect(await f.servico.interceptar(f.mensagem('',{providerMessageId:'citada',corpo:'Paguei',respostaAProviderMessageId:'saida-1'}))).toMatchObject({isolado:true,estado:'resposta_citada_isolada'});
});
test('revogação do administrador antes e durante inferência impede novas saídas',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 await f.servico.interceptar(f.mensagem(s.id));f.repo.autorAtivo.mockResolvedValue(false);
 await f.servico.processarSessao(s.id);expect(f.responder).not.toHaveBeenCalled();
 f.repo.autorAtivo.mockResolvedValue(true);const outra=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 await f.servico.interceptar(f.mensagem(outra.id,{providerMessageId:'nova'}));
 f.responder.mockImplementation(async()=>{f.repo.autorAtivo.mockResolvedValue(false);return {texto:'Tardia'};});
 await f.servico.processarSessao(outra.id);expect(f.enviar).not.toHaveBeenCalled();expect(f.sessoes.get(outra.id).eventos[0].estado).toBe('descartado');
});
test('citação desconhecida antes ACK/callback é quarentenada; replay continua isolado após confirmação',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 const citada=f.mensagem(s.id,{providerMessageId:'citada-antes-ack',corpo:'Paguei',respostaAProviderMessageId:'wamid-ainda-desconhecido'});
 f.enviar.mockImplementation(async()=>{
   expect(await f.servico.interceptar(citada)).toMatchObject({isolado:true,estado:'resposta_citada_isolada'});
   expect(await f.servico.interceptar({...citada,providerMessageId:'comum',respostaAProviderMessageId:null})).toEqual({isolado:false});
   expect(await f.servico.interceptar({...citada,providerMessageId:'outro-canal',canalProvedorId:'999'})).toEqual({isolado:false});
   return {wamid:'wamid-ainda-desconhecido'};
 });
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);
 await f.servico.encerrar({user,id:s.id});
 expect(await f.servico.interceptar({...citada,respostaAProviderMessageId:null})).toMatchObject({isolado:true});
 expect(await f.servico.interceptar({...citada,providerMessageId:'quote-real-apos-ack',respostaAProviderMessageId:'outra-mensagem-real'})).toEqual({isolado:false});
 expect(f.enviar).toHaveBeenCalledTimes(1);
});
test('callback confirmado sem índice persistido ainda isola resposta citada',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 f.enviar.mockImplementation(async({correlacao})=>{
   const indexar=f.repo.indexarSaida;f.repo.indexarSaida=async()=>{throw Error('crash índice');};
   await expect(f.servico.interceptarStatus({correlacaoTeste:correlacao,providerMessageId:'wamid-sem-indice',canalProvedorId:'123',wabaProvedorId:'456',status:'read'})).rejects.toThrow('crash índice');
   expect(await f.repo.sessaoDaSaida('wamid-sem-indice')).toBeUndefined();
   expect(await f.servico.interceptar(f.mensagem('',{providerMessageId:'resposta-sem-indice',corpo:'Paguei',respostaAProviderMessageId:'wamid-sem-indice'}))).toMatchObject({isolado:true});
   f.repo.indexarSaida=indexar;throw Error('timeout HTTP');
 });
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);
 expect(f.sessoes.get(s.id).eventos[0]).toMatchObject({estado:'enviado',wamid:'wamid-sem-indice'});
 await f.servico.encerrar({user,id:s.id});
 expect(await f.servico.interceptar(f.mensagem('',{providerMessageId:'resposta-sem-indice',corpo:'Paguei',respostaAProviderMessageId:null}))).toMatchObject({isolado:true});
});
test('citação comprovadamente operacional prevalece sobre incerteza e quarentena conserva texto',async()=>{
 const f=preparar(),s=await f.ativar({envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});
 f.enviar.mockImplementation(async()=>{
   f.repo.citacaoOperacional.mockImplementation(async m=>m.respostaAProviderMessageId==='operacional');
   expect(await f.servico.interceptar(f.mensagem('',{providerMessageId:'citacao-real',respostaAProviderMessageId:'operacional',corpo:'Paguei guia real'}))).toEqual({isolado:false});
   expect(await f.servico.interceptar(f.mensagem('',{providerMessageId:'citacao-ambigua',respostaAProviderMessageId:'desconhecida',corpo:'Texto a conferir'}))).toMatchObject({isolado:true});
   expect((await f.servico.consultar({user,id:s.id})).quarentenas[0].quarentena.texto).toBe('Texto a conferir');
   throw Error('timeout');
 });
 await f.servico.interceptar(f.mensagem(s.id));await f.servico.processarSessao(s.id);
 expect(f.enviar).toHaveBeenCalledTimes(1);
});
