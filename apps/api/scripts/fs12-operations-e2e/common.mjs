import fs from 'node:fs/promises';
import path from 'node:path';
const systemKeys=['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
const configKeys=new Set(['NODE_ENV','DATABASE_URL','DIRECT_URL','PORT','HOST','JWT_SECRET','CERT_SECRET_KEY','SERPRO_ENABLE_PGDASD','SERPRO_BASE_URL','SERPRO_AUTH_URL','SERPRO_CONSUMER_KEY','SERPRO_CONSUMER_SECRET','LOG_LEVEL','FS12_CUSTODY_ROOT','FS12_CUSTODY_ACTIVE_KEY_ID','FS12_CUSTODY_KEYRING_JSON','FS12_CUSTODIAN_ID','FS12_CAPABILITY_ID','FS12_CUSTODY_DURABILITY']);
export function loopback(value,protocols=['http:']) {const u=new URL(value);if(!protocols.includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('URL HTTP loopback sem credenciais obrigatória');return u;}
const comparablePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
async function prepareOutput(directory) {
 const absolute=path.resolve(directory),root=path.parse(absolute).root;
 let current=root;
 // Inspect each existing ancestor before creating a child: mkdir recursive would
 // otherwise follow a junction and write outside the configured synthetic path.
 for(const segment of path.relative(root,absolute).split(path.sep).filter(Boolean)) {
  current=path.join(current,segment);
  const stat=await fs.lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stat && (!stat.isDirectory() || stat.isSymbolicLink()))throw Error('Output sintético não admite arquivo, symlink ou junction em sua cadeia');
  if(!stat)await fs.mkdir(current);
  const resolved=await fs.realpath(current);
  if(comparablePath(resolved)!==comparablePath(current))throw Error('Output sintético possui ancestral redirecionado');
 }
 const stat=await fs.lstat(absolute);
 if(!stat.isDirectory() || stat.isSymbolicLink() || comparablePath(await fs.realpath(absolute))!==comparablePath(absolute))throw Error('Raiz do output sintético inválida');
 return absolute;
}
async function isolatedStorage(output, leaf) {
 const root=await fs.realpath(output);
 let current=root;
 for(const segment of ['storage',leaf]) {
  const candidate=path.join(current,segment);
  const stat=await fs.lstat(candidate).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stat && (!stat.isDirectory() || stat.isSymbolicLink()))throw Error('Storage sintético não admite arquivo, symlink ou junction');
  if(!stat)await fs.mkdir(candidate);
  const resolved=await fs.realpath(candidate),relative=path.relative(root,resolved);
  if(!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))throw Error('Storage sintético deve permanecer dentro do output');
  current=resolved;
 }
 return current;
}
export async function configuration(file) {
 const cfg=JSON.parse(await fs.readFile(path.resolve(file),'utf8'));
 if(cfg.env?.NODE_ENV!=='test'||cfg.confirmSyntheticDatabase!==true)throw Error('Exige NODE_ENV=test e banco sintético explícito');
 const db=new URL(cfg.env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(db.protocol)||!['127.0.0.1','localhost','[::1]'].includes(db.hostname)||!/^\/altan_fs12_[a-z0-9_]*governance_test$/.test(db.pathname))throw Error('Exige banco PG loopback altan_fs12_*governance_test');
 if(cfg.env.DIRECT_URL&&cfg.env.DIRECT_URL!==cfg.env.DATABASE_URL)throw Error('DIRECT_URL deve usar mesmo banco isolado');
 loopback(cfg.apiUrl);loopback(cfg.webUrl);
 if(!['127.0.0.1','localhost','::1'].includes(cfg.env.HOST))throw Error('HOST loopback explícito obrigatório');
 for(const key of Object.keys(cfg.env))if(!configKeys.has(key))throw Error(`Env não revisada: ${key}`);
 for(const key of ['SERPRO_BASE_URL','SERPRO_AUTH_URL'])if(cfg.env[key])loopback(cfg.env[key]);
 if(!cfg.output||!cfg.runId||!/^[a-z0-9-]+$/i.test(cfg.runId))throw Error('output/runId obrigatórios');
 cfg.output=await prepareOutput(cfg.output);
 cfg.env.GUIDE_LOCAL_STORAGE_DIR=await isolatedStorage(cfg.output,'guides');
 cfg.env.CERT_STORAGE_PATH=await isolatedStorage(cfg.output,'certificates');
 const emptyEnv=path.join(cfg.output,'synthetic-empty.env');await fs.writeFile(emptyEnv,'# Synthetic test only. No inherited application environment.\n');
 cfg.env.DOTENV_CONFIG_PATH=emptyEnv;
 for(const key of ['SERPRO_PGDASD_WORKER_ENABLED','SERPRO_DCTFWEB_WORKER_ENABLED','SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED','APURACAO_BATCH_WORKER_ENABLED','DFE_NOTAS_WORKER_ENABLED','CONFERENCIA_ADN_WORKER_ENABLED','SIMPLES_COLETA_CALCULO_WORKER_ENABLED','SIMPLES_ENVIO_GUIAS_WORKER_ENABLED','INTEGRACAO_WHATSAPP','USE_GMAIL_API'])cfg.env[key]='0';
 cfg.env.SMTP_HOST='127.0.0.1';cfg.env.SMTP_PORT='1';cfg.env.SMTP_USER='';cfg.env.SMTP_PASS='';cfg.env.AWS_KMS_CERT_KEY_ID='';
 const system=Object.fromEntries(systemKeys.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,system,cfg.env);
 return cfg;
}
export async function json(file,value){await fs.writeFile(file,JSON.stringify(value,null,2));}
export async function request(url,options={}){loopback(url);const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||value.error||`HTTP ${response.status}`),{status:response.status,value});return value;}
