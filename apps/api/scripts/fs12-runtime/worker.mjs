import {clients,application,runtime} from './fixture.mjs';
process.once('message',async({comandoId,autorId,key,portalClientId,competencia,mode})=>{
  const {db,close}=await clients();
  try{
    const result=mode==='RECOVER'
      ?await runtime(db,Buffer.from(key,'base64')).recuperar({comandoId,autorId,portalClientId,competencia,encerrarSemDespacho:true})
      :await application(db,Buffer.from(key,'base64')).aplicar({comandoId,autorId});
    process.send({ok:result.ok,recuperado:result.recuperado,encerradaSemDespacho:result.encerradaSemDespacho});
  }catch(e){process.send({ok:false,code:e.code});process.exitCode=1;}
  finally{await close();process.disconnect();}
});

