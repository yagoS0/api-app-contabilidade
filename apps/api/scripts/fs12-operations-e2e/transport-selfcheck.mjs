// Run only in the authorized window, via --import fiscal-http-preload.mjs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
const configBytes=await fs.readFile(process.env.FS12_E2E_CONFIG);
const configHash=createHash('sha256').update(configBytes).digest('hex');
const cfg=JSON.parse(configBytes.toString('utf8'));
const provider=JSON.parse(await fs.readFile(path.join(cfg.output,'provider.json'),'utf8'));
await axios.post(provider.origin+'/control/rules',{rules:[{service:'ADN_DFE',response:{StatusProcessamento:'NENHUM_DOCUMENTO_LOCALIZADO',LoteDFe:[]}}]},{headers:{'x-test-control':cfg.providerControlSecret}});
for(const client of [axios,axios.create()]){
 const result=await client.get('https://adn.nfse.gov.br/contribuintes/DFe/0',{params:{cnpjConsulta:'99000000000100',lote:true}});
 assert.equal(result.data.StatusProcessamento,'NENHUM_DOCUMENTO_LOCALIZADO');
 await assert.rejects(()=>client.get('https://example.com/not-allowed'),/Saída externa bloqueada/);
 await assert.rejects(()=>client.get('https://adn.nfse.gov.br/not-a-fiscal-route'),/Endpoint ADN/);
}
assert.throws(()=>http.get('http://example.com/not-allowed'),/externa bloqueada/);
assert.throws(()=>http.get('http://127.0.0.1/',{hostname:'example.com'}),/externa bloqueada/);
assert.throws(()=>http.request('http://127.0.0.1/',{host:'example.com'}),/externa bloqueada/);
assert.throws(()=>http.request({hostname:'127.0.0.1',createConnection:()=>{throw Error('Never called');}}),/indireto bloqueado/);
assert.throws(()=>fetch('https://example.com/not-allowed'),/externo bloqueado/);
const calls=(await axios.get(provider.origin+'/control/calls',{headers:{'x-test-control':cfg.providerControlSecret}})).data.calls;
assert.equal(calls.filter(c=>c.service==='ADN_DFE').length,2);
assert(calls.every(c=>c.service!=='ADN_DFE'||c.path==='/contribuintes/DFe/0'&&c.query.cnpjConsulta==='99000000000100'&&c.query.lote==='true'));
await fs.writeFile(path.join(cfg.output,'transport-selfcheck.json'),JSON.stringify({ok:true,runId:cfg.runId,configHash,providerOrigin:provider.origin,checked:['axios default','axios.create','path/query','external HTTP/fetch denial'],limitation:'HTTP local; no actual fiscal provider or mTLS'},null,2));
