// Test-only preload. Real Axios HTTP adapter and app modules remain intact.
import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const configPath=process.env.FS12_E2E_CONFIG;
if(process.env.NODE_ENV!=='test'||!configPath)throw Error('Preload fiscal exclusivo do harness test');
const cfg=JSON.parse(await fs.readFile(configPath,'utf8'));
const provider=JSON.parse(await fs.readFile(path.join(path.resolve(cfg.output),'provider.json'),'utf8'));
const local=new URL(provider.origin);
if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||!local.port)throw Error('Provider não é loopback reservado');
const fiscalOrigins=new Set(['https://adn.nfse.gov.br','https://adn.producaorestrita.nfse.gov.br']);
const localHosts=new Set(['localhost','127.0.0.1','::1','[::1]']);
const originalAdapter=axios.getAdapter('http');
axios.defaults.adapter=async config=>{
 const original=new URL(axios.getUri(config));
 let target=original;
 if(fiscalOrigins.has(original.origin)) {
  if(!original.pathname.startsWith('/contribuintes/DFe/'))throw Error('Endpoint ADN não autorizado no ensaio');
  target=new URL(original.pathname+original.search,local.origin);
 } else if(!localHosts.has(original.hostname))throw Error(`Saída externa bloqueada: ${original.origin}`);
 if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('URL de transporte inválida');
 if(config.transport)throw Error('Transport customizado não permitido no ensaio');
 await fs.appendFile(path.join(cfg.output,'transport.jsonl'),JSON.stringify({at:new Date().toISOString(),originalOrigin:original.origin,originalPath:original.pathname,destinationOrigin:target.origin,destinationPath:target.pathname,method:config.method})+'\n');
 return originalAdapter({...config,url:target.href,baseURL:undefined,params:undefined,proxy:false,maxRedirects:0});
};
// Deny HTTP/fetch bypasses; these wrappers never fabricate a response.
function assertLocal(args){
 const first=args[0],u=typeof first==='string'||first instanceof URL?new URL(first):null;
 const options=u?(args[1]&&typeof args[1]==='object'?args[1]:{}):(first||{});
 const host=options.hostname||options.host||u?.hostname||'localhost';
 if(!localHosts.has(String(host).replace(/^\[|\]$/g,'')))throw Error('Saída HTTP externa bloqueada pelo harness');
 if(options.createConnection||options.socketPath||options.lookup)throw Error('Transporte indireto bloqueado pelo harness');
 const agent=options.agent;
 if(agent&&agent!==true&&(Object.hasOwn(agent,'createConnection')||![http.Agent,https.Agent].includes(agent.constructor)||agent.options?.socketPath||agent.options?.lookup||agent.options?.createConnection))throw Error('Agent customizado bloqueado pelo harness');
}
for(const module of [http,https]){const request=module.request.bind(module),get=module.get.bind(module);module.request=(...args)=>{assertLocal(args);return request(...args);};module.get=(...args)=>{assertLocal(args);return get(...args);};}
syncBuiltinESMExports();
const realFetch=globalThis.fetch;globalThis.fetch=(input,...args)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!localHosts.has(url.hostname))throw Error('Fetch externo bloqueado pelo harness');return realFetch(input,{...(args[0]||{}),redirect:'error'});};
