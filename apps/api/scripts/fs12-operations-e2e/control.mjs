import fs from 'node:fs/promises';
import path from 'node:path';
import {configuration,request,loopback,json} from './common.mjs';
const cfg=await configuration(process.argv[2]),action=process.argv[3],argument=process.argv[4];
const provider=JSON.parse(await fs.readFile(path.join(cfg.output,'provider.json'),'utf8'));loopback(provider.origin);
const headers={'content-type':'application/json','x-test-control':cfg.providerControlSecret};
let result;
if(action==='calls')result=await request(provider.origin+'/control/calls',{headers});
else if(action==='release')result=await request(provider.origin+'/control/release',{method:'POST',headers,body:JSON.stringify({id:argument})});
else if(action==='rules'){const rules=JSON.parse(await fs.readFile(path.resolve(argument),'utf8'));result=await request(provider.origin+'/control/rules',{method:'POST',headers,body:JSON.stringify(rules)});}
else throw Error('Uso: control.mjs config.json calls | release <holdId> | rules <rules.json>');
await json(path.join(cfg.output,`control-${Date.now()}.json`),result);console.log(JSON.stringify(result));
