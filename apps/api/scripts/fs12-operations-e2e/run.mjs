import { spawn, fork } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configuration, json, request, loopback } from './common.mjs';
const file=path.resolve(process.argv[2]),cfg=await configuration(file),here=path.dirname(fileURLToPath(import.meta.url));
const apiRoot=path.resolve(here,'../..');
const allowedEnv=['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
const env=Object.fromEntries(allowedEnv.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,cfg.env);
for(const k of ['SERPRO_PGDASD_WORKER_ENABLED','SERPRO_DCTFWEB_WORKER_ENABLED','SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED','CONFERENCIA_ADN_WORKER_ENABLED','SIMPLES_COLETA_CALCULO_WORKER_ENABLED','SIMPLES_ENVIO_GUIAS_WORKER_ENABLED'])env[k]='0';
if(env.AWS_KMS_CERT_KEY_ID)throw Error('KMS remoto não pertence ao ensaio');
if(env.FS12_CUSTODY_DURABILITY!=='PROCESS_RESTART_ONLY')throw Error('Durabilidade de processo explícita obrigatória neste harness Windows');
if(new URL(cfg.apiUrl).port!==String(env.PORT))throw Error('apiUrl/PORT divergem');
env.FS12_E2E_CONFIG=file;
let api,provider,stopping=false;
async function abort(error){stopping=true;try{await stopApi();}finally{provider?.kill();await json(path.join(cfg.output,'runner-failure.json'),{message:error.message});process.exit(1);}}
process.on('uncaughtException',abort);process.on('unhandledRejection',abort);
function launched(script,label,extra=[],preload=false){const out=fs.openSync(path.join(cfg.output,`${label}.log`),'a');return spawn(process.execPath,[...(preload?['--import',pathToFileURL(path.join(here,'fiscal-http-preload.mjs')).href]:[]),script,...extra],{cwd:apiRoot,env,windowsHide:true,stdio:['ignore',out,out]});}
async function waitApi(){for(let n=0;n<100;n++){if(api.exitCode!==null)throw Error('API encerrou; veja log');try{const response=await fetch(cfg.apiUrl+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(500)});if(response.status===400)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('API não ficou pronta');}
async function startApi(){api=launched(path.join(apiRoot,'src/server.js'),'api',[],true);await waitApi();await json(path.join(cfg.output,'api-process.json'),{pid:api.pid,startedAt:new Date().toISOString()});}
async function stopApi(){if(!api||api.exitCode!==null)return;const owned=api;const stopped=new Promise(resolve=>owned.once('exit',resolve));owned.kill();const timer=setTimeout(()=>{if(owned.exitCode===null)owned.kill('SIGKILL');},5000);await stopped;clearTimeout(timer);}
provider=fork(path.join(here,'provider.mjs'),[file],{cwd:apiRoot,env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{provider.kill();reject(Error('Provider timeout'));},15000);provider.once('message',message=>{try{if(message?.ready!==true)throw Error('Provider não confirmou prontidão');const u=loopback(message.origin);if(!u.port)throw Error('Provider sem porta');clearTimeout(timer);resolve();}catch(error){clearTimeout(timer);provider.kill();reject(error);}});provider.once('exit',()=>{clearTimeout(timer);reject(Error('Provider não iniciou'));});});
if(process.argv.includes('--seed')){const seed=launched(path.join(here,'seed.mjs'),'seed',[file]);await new Promise((resolve,reject)=>seed.once('exit',code=>code===0?resolve():reject(Error('Seed falhou'))));}
const configure=launched(path.join(here,'configure-provider.mjs'),'configure-provider',[file]);await new Promise((resolve,reject)=>configure.once('exit',code=>code===0?resolve():reject(Error('Configuração provider recusada'))));
await startApi();
// Commands come from this runner's stdin. Only its own API child is terminated/restarted.
let commands=Promise.resolve();
process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{commands=commands.then(async()=>{if(stopping)return;const command=text.trim();try{
 if(command==='restart'){const previous=api.pid;await stopApi();await startApi();await fsp.appendFile(path.join(cfg.output,'restarts.jsonl'),JSON.stringify({previous,current:api.pid,at:new Date().toISOString(),scope:'PROCESS_RESTART_ONLY'})+'\n');}
 if(command==='stop'){stopping=true;await stopApi();provider.kill();process.exitCode=0;process.stdin.pause();}
}catch(error){await json(path.join(cfg.output,'runner-error.json'),{message:error.message});}});});
console.log(JSON.stringify({ready:true,apiUrl:cfg.apiUrl,webUrl:cfg.webUrl,commands:['restart','stop'],note:'Frontend real deve ser iniciado separadamente com configuração revisada. Nenhum ato fiscal é executado automaticamente.'}));

process.on('SIGINT',async()=>{stopping=true;await stopApi();provider?.kill();process.exit(0);});
process.on('SIGTERM',async()=>{stopping=true;await stopApi();provider?.kill();process.exit(0);});
