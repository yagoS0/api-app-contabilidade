import axios from 'axios';
import {createHash} from 'node:crypto';
import {SerproHttpClient} from '../SerproHttpClient.js';
import {concluirChamada} from '../SerproCallGuard.js';
import {lerResposta,guardarResposta} from '../SerproRespostaCache.js';
import {criarContextoComandoFs12,comComandoFs12,resultadoComandoFs12} from '../../../../modules/fiscal/publicComandosFs12.js';
jest.mock('axios',()=>({request:jest.fn(),isAxiosError:e=>Boolean(e?.isAxiosError)}));
jest.mock('../SerproRuntimeSettings.js',()=>({getResolvedSerproCredentials:jest.fn(async()=>({baseUrl:'https://invalid.test',timeoutMs:1000}))}));
jest.mock('../SerproRespostaCache.js',()=>({lerResposta:jest.fn(),guardarResposta:jest.fn()}));
jest.mock('../SerproCallGuard.js',()=>({
  autorizarChamada:jest.fn(async()=>{
    const {registrarReservaFs12}=jest.requireActual('../../../../modules/fiscal/publicComandosFs12.js');
    const authorization={id:'reservation',inicio:Date.now()};registrarReservaFs12(authorization);return authorization;
  }),
  autorizarDespacho:jest.fn(async a=>{
    const {registrarMarcadorFs12}=jest.requireActual('../../../../modules/fiscal/publicComandosFs12.js');
    registrarMarcadorFs12(a,{reservaId:a.id,companyId:'portal',authorizedAt:'2026-11-25T12:00:00.000Z'});
  }),
  concluirChamada:jest.fn(),
}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(observe){
  const payload={contratante:{numero:'00000000000000',tipo:2},autorPedidoDados:{numero:'00000000000000',tipo:2},
    contribuinte:{numero:'11111111111111',tipo:2},pedidoDados:{idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',versaoSistema:'1.0',
      dados:JSON.stringify({cnpjCompleto:'11111111111111',pa:'202611',indicadorTransmissao:true,declaracao:{tipoDeclaracao:1}})}};
  const bytes=Buffer.from(JSON.stringify(payload));
  const command={id:'command',tentativaId:'attempt',companyId:'company',portalClientId:'portal',autorId:'actor',
    competencia:'2026-11',cnpj:'11111111111111',intencao:'TRANSMITIR',esperado:{envelopeHash:hash(bytes),custodia:{respostaId:'response'}}};
  const observed=observe||jest.fn(async input=>({respostaId:'response',custodiaId:'row',stageId:hash(Buffer.from('response')),corpoHash:hash(input.corpo)}));
  const cap=criarContextoComandoFs12({comando:command,envelopeBytes:bytes,persistencia:{naTransacaoDoGuard:jest.fn()},observarResposta:observed});
  const client=new SerproHttpClient({authService:{authenticate:async()=>({accessToken:'synthetic',jwtToken:'synthetic'}),buildHttpsAgent:async()=>null}});
  return {payload,bytes,cap,observed,client};
}
beforeEach(()=>{jest.clearAllMocks();concluirChamada.mockResolvedValue();});
test.each([200,422])('FS12 HTTP %s guarda bytes antes de parse/finalizar sem cache legado',async status=>{
  const f=fixture(),body=Buffer.from(JSON.stringify({status,dados:{idDeclaracao:'synthetic'}}));
  axios.request.mockResolvedValueOnce({status,data:body,headers:{secret:'not-custodied'}});
  const result=await comComandoFs12(f.cap,()=>f.client.post('/Declarar',f.payload,{raw:true}));
  expect(result.status).toBe(status);
  expect(f.observed).toHaveBeenCalledWith(expect.objectContaining({corpo:body,httpStatus:status,marcador:expect.objectContaining({reservaId:'reservation'})}));
  expect(f.observed.mock.calls[0][0]).not.toHaveProperty('headers');
  expect(f.observed.mock.invocationCallOrder[0]).toBeLessThan(concluirChamada.mock.invocationCallOrder[0]);
  expect(axios.request.mock.calls[0][0]).toMatchObject({data:f.bytes,responseType:'arraybuffer',maxContentLength:16777216});
  expect(lerResposta).not.toHaveBeenCalled();expect(guardarResposta).not.toHaveBeenCalled();
  expect(resultadoComandoFs12(f.cap)).toMatchObject({comandoId:'command',reservaId:'reservation',respostaId:'response'});
});
test('error.response observado passa pela mesma custodia; raw nao escapa',async()=>{
  const f=fixture(),body=Buffer.from('{"erro":"recusa sintetica"}');
  axios.request.mockRejectedValueOnce({isAxiosError:true,response:{status:400,data:body,headers:{}}});
  expect((await comComandoFs12(f.cap,()=>f.client.post('/Declarar',f.payload,{raw:true}))).status).toBe(400);
  expect(f.observed).toHaveBeenCalledTimes(1);expect(concluirChamada).toHaveBeenCalledTimes(1);
});
test('falha stage/T3a conserva reserva sem finalizar; JSON invalido preserva custodia primeiro',async()=>{
  const failed=fixture(jest.fn(async()=>{throw Object.assign(Error('stage'),{code:'FS12_STAGE_ESCRITA_FALHOU'});}));
  axios.request.mockResolvedValueOnce({status:200,data:Buffer.from('{}')});
  await expect(comComandoFs12(failed.cap,()=>failed.client.post('/Declarar',failed.payload))).rejects.toMatchObject({code:'FS12_STAGE_ESCRITA_FALHOU'});
  expect(concluirChamada).not.toHaveBeenCalled();
  const bad=fixture();axios.request.mockResolvedValueOnce({status:200,data:Buffer.from('not-json')});
  await expect(comComandoFs12(bad.cap,()=>bad.client.post('/Declarar',bad.payload))).rejects.toMatchObject({code:'FS12_RESPOSTA_INVALIDA'});
  expect(bad.observed).toHaveBeenCalledTimes(1);expect(concluirChamada).not.toHaveBeenCalled();
});
test('timeout sem resposta nao fabrica custodia; ledger registra incerteza',async()=>{
  const f=fixture();axios.request.mockRejectedValueOnce({isAxiosError:true,code:'ECONNABORTED'});
  await expect(comComandoFs12(f.cap,()=>f.client.post('/Declarar',f.payload))).rejects.toMatchObject({code:'SERPRO_TIMEOUT'});
  expect(f.observed).not.toHaveBeenCalled();
  expect(concluirChamada).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({httpStatus:null,erroCodigo:'SERPRO_TIMEOUT'}));
});
test('semcap, capforjada, payloaddivergente e reutilizacao recusados antes HTTP',async()=>{
  const f=fixture();
  await expect(f.client.post('/Declarar',f.payload)).rejects.toMatchObject({code:'FS12_INTEGRACAO_B33_PENDENTE'});
  await expect(comComandoFs12({autoriza:true},()=>{})).rejects.toMatchObject({code:'FS12_CAPACIDADE_INVALIDA'});
  await expect(comComandoFs12(f.cap,()=>f.client.post('/Declarar',{...f.payload,extra:true}))).rejects.toMatchObject({code:'FS12_ENVELOPE_DIVERGENTE'});
  await expect(comComandoFs12(f.cap,()=>{})).rejects.toMatchObject({code:'FS12_CAPACIDADE_INVALIDA'});
  expect(axios.request).not.toHaveBeenCalled();
});
