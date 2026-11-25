import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { configuration, json } from './common.mjs';
const cfg=await configuration(process.argv[2]);
const secret=cfg.providerControlSecret;
if(typeof secret!=='string'||secret.length<24) throw Error('Segredo sintético de controle insuficiente');
let rules=[], calls=[], held=new Map();
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>2000000)throw Error('Body grande');}return text?JSON.parse(text):{};}
function send(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
async function record(value){calls.push(value);await fs.appendFile(path.join(cfg.output,'provider-calls.jsonl'),JSON.stringify(value)+'\n');}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/control/')) {
  if(req.headers['x-test-control']!==secret)return send(res,403,{error:'control_denied'});
  if(url.pathname==='/control/calls')return send(res,200,{calls,pending:[...held.keys()]});
  if(url.pathname==='/control/rules'&&req.method==='POST'){const input=await body(req);if(!Array.isArray(input.rules))throw Error('rules obrigatórias');rules=input.rules;return send(res,200,{ok:true});}
  if(url.pathname==='/control/release'&&req.method==='POST'){const input=await body(req),pending=held.get(input.id);if(!pending)return send(res,404,{error:'hold_absent'});held.delete(input.id);send(pending.res,pending.status,pending.response);return send(res,200,{ok:true});}
  return send(res,404,{error:'control_not_found'});
 }
 if(req.method==='GET' && url.pathname.startsWith('/contribuintes/DFe/')) {
  const cnpj=url.searchParams.get('cnpjConsulta'), index=rules.findIndex(r=>r.service==='ADN_DFE'&&(!r.cnpj||r.cnpj===cnpj)&&(!r.path||r.path===url.pathname));
  const rule=index<0?null:rules[index];if(rule?.once)rules.splice(index,1);
  await record({id:randomUUID(),at:new Date().toISOString(),path:url.pathname,query:Object.fromEntries(url.searchParams),service:'ADN_DFE',cnpj,rule:rule?.name||null});
  if(!rule)return send(res,503,{error:'SYNTHETIC_ADN_UNCONFIGURED'});
  return send(res,rule.status||200,rule.response);
 }
 if(url.pathname==='/token') {
  if(req.headers.authorization!==`Basic ${Buffer.from('synthetic-key:synthetic-secret').toString('base64')}`)return send(res,401,{error:'invalid_client'});
  return send(res,200,{access_token:'synthetic-access',jwt_token:'synthetic-jwt',expires_in:300});
 }
 if(req.method!=='POST'||!['/Declarar','/Consultar','/Emitir'].includes(url.pathname))return send(res,404,{error:'synthetic_route_unknown'});
 if(req.headers.authorization!=='Bearer synthetic-access')return send(res,401,{error:'synthetic_token_missing'});
 const payload=await body(req);let detail;try{detail=JSON.parse(payload.pedidoDados?.dados||'{}');}catch{ return send(res,400,{error:'dados_not_json_string'});}
 const service=payload.pedidoDados?.idServico,cnpj=payload.contribuinte?.numero;
 const index=rules.findIndex(r=>(!r.path||r.path===url.pathname)&&(!r.service||r.service===service)&&(!r.cnpj||r.cnpj===cnpj)&&(!r.periodoApuracao||String(r.periodoApuracao)===String(detail.periodoApuracao ?? detail.pa))&&(r.indicadorTransmissao===undefined||r.indicadorTransmissao===detail.indicadorTransmissao));
 const rule=index<0?null:rules[index];if(rule?.once)rules.splice(index,1);
 const id=randomUUID(), event={id,at:new Date().toISOString(),path:url.pathname,service,cnpj,payload,rule:rule?.name||null};await record(event);
 // Unconfigured fiscal operations fail closed; no invented generic success.
 if(!rule)return send(res,503,{mensagens:[{codigo:'SYNTHETIC_UNCONFIGURED',texto:'Resposta de ensaio não configurada para este contrato.'}]});
 const status=rule.status||200,response=rule.response;
 if(rule.drop){req.socket.destroy();return;}
 if(rule.hold){held.set(id,{res,status,response});req.on('close',()=>{});return;}
 if(rule.delayMs)await new Promise(resolve=>setTimeout(resolve,Math.min(rule.delayMs,60000)));
 return send(res,status,response);
}catch(error){send(res,500,{error:'synthetic_provider_error',message:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
await json(path.join(cfg.output,'provider.json'),{pid:process.pid,origin,tokenUrl:origin+'/token',limitation:'HTTP loopback; PFX é lido pelo cliente real, mTLS remoto não é homologado.'});
process.send?.({ready:true,origin});
