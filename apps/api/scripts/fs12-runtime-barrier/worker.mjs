import {randomUUID} from 'node:crypto';
import {clients,seed,application,runtime} from '../fs12-runtime/fixture.mjs';
import {clienteLeituraFs12} from '../../src/composition/execucaoFs12.js';
import {envelopeDeclaracaoFs12,marcarSnapshotTransmitindoFs12} from '../../src/composition/criarRuntimeFiscalFs12.js';
import {criarCifraEnvelopeFs12} from '../../src/modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
import {criarPersistenciaComandoFs12} from '../../src/modules/fiscal/infrastructure/prisma/comandoFs12.js';
import {prepararComandoFs12} from '../../src/modules/fiscal/application/coordenarComandoFs12.js';
import {criarContextoComandoFs12,comComandoFs12} from '../../src/modules/fiscal/publicComandosFs12.js';
import {identificarChamada,autorizarChamada,autorizarDespacho,concluirChamada} from '../../src/application/fiscal/serpro/SerproCallGuard.js';
import {validarCalculoConfirmado} from '../../src/application/notas/apuracao/v2/CalculoConfirmado.js';

const send=value=>new Promise((resolve,reject)=>process.send(value,error=>error?reject(error):resolve()));
const barrier=async(value)=>{
  const resume=new Promise(resolve=>process.once('message',resolve));
  await send(value); const message=await resume;
  if(message?.event!=='RESUME') throw Error('BARRIER_PROTOCOL_ERROR');
};
process.once('message',async input=>{
  let connection;
  try {
    connection=await clients(); const {db,sql}=connection;
    if(input.role==='CLOSER') {
      const result=await runtime(db,Buffer.from(input.key,'base64')).recuperar({comandoId:input.comandoId,
        ...input.identidade,encerrarSemDespacho:true});
      await send({event:'CLOSED',result}); return;
    }
    const f=await seed(db,sql);
    const simulated=await application(db,f.key).aplicar({comandoId:f.c.id,autorId:f.identidade.autorId});
    const snapshot=await db.apuracaoSnapshot.update({where:{id:simulated.snapshot.id},data:{estado:'fechada'}});
    const prep={...f.c.esperado.preparacao,snapshotAnterior:{id:snapshot.id,estado:'fechada',idempotencyKey:snapshot.idempotencyKey}};
    const cifraEnvelope=criarCifraEnvelopeFs12({keyId:'synthetic-history',resolveKey:async id=>id==='synthetic-history'?f.key:null});
    const bytes=envelopeDeclaracaoFs12(prep.parametros,'TRANSMITIR');
    const persistencia=criarPersistenciaComandoFs12({db,cifraEnvelope,identificarEnvelope:identificarChamada,
      validarSnapshot:validarCalculoConfirmado,
      prepararNoServidor:async pedido=>({companyId:f.c.companyId,cnpj:f.c.cnpj,origem:'SYNTHETIC_BARRIER',
        envelope:bytes,provaPreparacao:prep}),
      lerResolucaoFiscal:(entrada,tx)=>application(clienteLeituraFs12(tx),f.key).lerResolucaoFiscal(entrada),
      alocarIdentidades:()=>({comandoId:randomUUID(),tentativaId:randomUUID(),respostaId:randomUUID(),
        custodianteId:'synthetic-custodian',capacidadeId:'synthetic-capability'})});
    const {comando}=await prepararComandoFs12({...f.identidade,intencao:'TRANSMITIR',calculoId:prep.calculoId,
      chaveIdempotencia:randomUUID(),revisaoEsperada:f.c.revisaoFs12,contextoHash:f.c.contextoHash},persistencia);
    const info={comandoId:comando.id,identidade:f.identidade,key:f.key.toString('base64'),snapshotId:snapshot.id};
    let countHttp=0;
    if(input.phase==='T1') await barrier({event:'READY',...info});
    try {
      await marcarSnapshotTransmitindoFs12({db,comando,autorId:f.identidade.autorId});
      const cap=criarContextoComandoFs12({comando,envelopeBytes:bytes,persistencia,
        observarResposta:async()=>{throw Error('NO_PROVIDER_RESPONSE_IN_TIMEOUT_FIXTURE');}});
      await comComandoFs12(cap,async()=>{
        const reserva=await autorizarChamada({payload:JSON.parse(bytes.toString('utf8')),rota:'/Declarar'},db);
        if(input.phase==='RESERVA') await barrier({event:'READY',...info,reservaId:reserva.id});
        await autorizarDespacho(reserva,db);
        // This is the single fake transport boundary. It is reached only after
        // real guard T2 has committed. No Axios/provider is invoked in this test.
        if(input.phase==='MARKER') await barrier({event:'READY',...info,reservaId:reserva.id});
        countHttp++;
        await concluirChamada(reserva,{erroCodigo:'SYNTHETIC_TIMEOUT',erroMensagem:'Synthetic timeout without response.'},db);
      });
      await send({event:'FINISHED',countHttp});
    }catch(error){await send({event:'FINISHED',countHttp,code:error.code,message:error.message});}
  }catch(error){await send({event:'FAILED',code:error.code,message:error.message});process.exitCode=1;}
  finally{await connection?.close();process.disconnect();}
});


