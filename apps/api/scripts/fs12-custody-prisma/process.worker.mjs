import { clients,adapter } from './fixture.mjs';
import http from 'node:http';
import https from 'node:https';
let calls=0;
const forbidden=()=>{calls++;throw Error('HTTP_FORBIDDEN');};
http.request=http.get=https.request=https.get=globalThis.fetch=forbidden;
const send=data=>new Promise(resolve=>process.send(data,resolve));
let release; const barrier=new Promise(resolve=>{release=resolve;});
process.on('message',message=>{
  if(message.type==='go')release();
  if(message.type==='start')run(message).catch(async e=>{await send({type:'failure',code:e.code||e.message,calls});process.exitCode=1;process.disconnect();});
});
async function run({keyBase64,input,crash}) {
  const c=await clients(),key=Buffer.from(keyBase64,'base64');
  try {
    const {custody}=adapter(c.db,key);
    await send({type:'ready',pid:process.pid}); await barrier;
    const receipt=await custody.importDurably({...input,corpo:Buffer.from(input.corpoBase64,'base64')});
    if(crash){await send({type:'committed',calls});process.exit(23);}
    await send({type:'result',receipt,calls});
  } finally {key.fill(0);await c.close();}
  process.disconnect();
}
