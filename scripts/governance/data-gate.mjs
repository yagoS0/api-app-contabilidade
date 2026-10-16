// Only a deliberately provisioned, local disposable PostgreSQL database is accepted.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const raw=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if(!raw) {
  console.error('Orquestrador: preparar PostgreSQL descartável local e definir ALTAN_GOVERNANCE_TEST_DATABASE_URL. Gate de dados não executado; não aprovar esta entrega.');
  process.exit(1);
}
const url=new URL(raw);
if(!['postgresql:','postgres:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)) {
  console.error('Gate de dados exige host loopback e banco exclusivo com sufixo _governance_test.');
  process.exit(1);
}
const env={...process.env,DATABASE_URL:raw,NODE_ENV:'test',INTEGRACAO_IA_COMERCIAL:'0',INTEGRACAO_FISCAL_LEADS:'0',INTEGRACAO_WHATSAPP:'0'};
const steps=[
  ['node_modules/prisma/build/index.js','validate','--schema','apps/api/prisma/schema.prisma'],
  ['apps/api/scripts/validate-migrations.js'],
  ['node_modules/prisma/build/index.js','migrate','deploy','--schema','apps/api/prisma/schema.prisma'],
  ['apps/api/scripts/verify-dre-postgres.js','--url',raw],
  ['apps/api/scripts/verify-cashflow-balance-postgres.js','--url',raw],
];
for(const args of steps) {
  const absoluteArgs=[resolve(args[0]),...args.slice(1)];
  const cwd=args[0].includes('validate-migrations') ? resolve('apps/api') : process.cwd();
  const result=spawnSync(process.execPath,absoluteArgs,{cwd,env,stdio:'inherit',shell:false,windowsHide:true,timeout:240000});
  if(result.error || result.status!==0) process.exit(1);
}
