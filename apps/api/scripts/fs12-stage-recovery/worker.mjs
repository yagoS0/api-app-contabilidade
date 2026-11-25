import { clients, adapter } from '../fs12-custody-prisma/fixture.mjs';
import { criarStageRespostaFs12 } from '../../src/modules/fiscal/infrastructure/custody/stageRespostaFs12.js';
import { criarSincronizacaoDiretorioFs12 } from '../../src/modules/fiscal/infrastructure/custody/configuracaoCustodiaFs12.js';
import http from 'node:http';
import https from 'node:https';
let httpCalls=0;
const forbidden=()=>{httpCalls++;throw Error('HTTP_FORBIDDEN');};
http.request=http.get=https.request=https.get=globalThis.fetch=forbidden;
const send=value=>new Promise(resolve=>process.send(value,resolve));
process.once('message',input=>run(input).catch(async error=>{
  await send({type:'failure',code:error.code||error.name,httpCalls});process.exitCode=1;process.disconnect();
}));
async function run({root,id,mode,keyBase64,corpoBase64,contexto}) {
  const c=await clients(),key=Buffer.from(keyBase64,'base64');
  const {cifra,custody}=adapter(c.db,key);
  const stage=criarStageRespostaFs12({root,cifra,syncDirectory:criarSincronizacaoDiretorioFs12({modo:'PROCESS_RESTART_ONLY',ambiente:'test'})});
  let inserted=false;
  try {
    if(mode==='stage-and-fail') {
      const saved=await stage.guardar({corpo:Buffer.from(corpoBase64,'base64'),contexto,keyId:'synthetic-history'});
      if(saved.id!==id) throw Error('STAGE_ID_MISMATCH');
      // Real SQL failure AFTER the adapter INSERT; the entire real PG transaction
      // rolls back. This is deliberate fault injection, not a DB availability proof.
      const faultDb={$transaction:(fn,options)=>c.db.$transaction(async tx=>{
        const result=await fn(tx);inserted=true;await tx.$executeRaw`SELECT 1/0`;return result;
      },options)};
      const fault=adapter(faultDb,key).custody;
      try {
        await stage.recuperar({id,resolveOrigin:custody.resolveOrigin,importDurably:fault.importDurably});
        throw Error('EXPECTED_SQL_FAILURE');
      } catch(error) {
        if(!inserted || error.meta?.code!=='22012') throw error;
        await send({type:'preserved-after-rollback',id,pid:process.pid,httpCalls,sqlState:error.meta.code,directorySynced:saved.directorySynced});
        process.exit(24); // Actual process termination before any successful import.
      }
    } else if(mode==='recover') {
      const receipt=await stage.recuperar({id,resolveOrigin:custody.resolveOrigin,importDurably:custody.importDurably});
      await send({type:'recovered',receipt,pid:process.pid,httpCalls});
    } else throw Error('UNKNOWN_MODE');
  } finally {key.fill(0);await c.close();}
  process.disconnect();
}
