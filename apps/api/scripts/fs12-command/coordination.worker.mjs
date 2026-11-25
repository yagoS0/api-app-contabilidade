import {PrismaClient} from '@prisma/client';
import {coordenarEscopoFs12,chaveCoordenacaoFs12} from '../../src/modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
let release;
const barrier=new Promise(resolve=>{release=resolve;});
const send=data=>new Promise(resolve=>process.send(data,resolve));
process.on('message',message=>{
  if(message.type==='release')release();
  if(message.type==='start')run(message).catch(async error=>{
    await send({type:'failure',code:error.code||'ERROR'});process.exitCode=1;if(process.connected)process.disconnect();
  });
});
async function run({url,scope,isolationLevel,hold}){
  const parsed=new URL(url);
  if(parsed.hostname!=='127.0.0.1'||!parsed.pathname.endsWith('_governance_test')||parsed.search||parsed.hash)throw Error('ISOLATED_PG_REQUIRED');
  const db=new PrismaClient({datasources:{db:{url}}});
  try{
    await db.$connect();
    await db.$transaction(async tx=>{
      const [{pid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await send({type:'entering',pid});
      await coordenarEscopoFs12(tx,scope);
      await send({type:'acquired',pid});
      if(hold)await barrier;
      const row=await tx.appSetting.findUnique({where:{key:chaveCoordenacaoFs12(scope)}});
      await send({type:'observed',revision:row.value.revision});
    },{isolationLevel,timeout:20000});
    await send({type:'committed'});
  }finally{await db.$disconnect();}
  process.disconnect();
}
