import { createHash } from 'node:crypto';
import { criarPersistenciaFs12 } from './fs12DaApuracao.js';
import { coordenarEscopoFs12, transacaoCoordenadaFs12 } from './coordenacaoFs12.js';
import { erroFs12 } from '../../domain/serieManualFs12.js';
const hashBytes=v=>createHash('sha256').update(v).digest('hex');
const fail=(code='FS12_COMANDO_CONFLITO')=>{
  const messages={FS12_TENTATIVA_PENDENTE:'Há uma tentativa em andamento ou com resultado desconhecido nesta competência. Confira a entrega antes de repetir.',
    FS12_COMANDO_VINCULO_INVALIDO:'O cálculo conferido não corresponde à revisão atual. Recalcule e confira antes de transmitir.',
    FS12_COMANDO_ENCERRADO_SEM_DESPACHO:'Este comando foi encerrado antes do despacho. Confira o estado atual e prepare uma nova ação explícita; o comando anterior não será enviado.'};
  throw erroFs12(code,messages[code]||'O comando ou sua reserva não corresponde aos dados atuais. Reabra a apuração para conferir.',409);
};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>hashBytes(JSON.stringify(canonical(v)));
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
// Reuses B31 ports on supplied tx, WITHOUT its inner retry (aborted tx must not
// execute another query). No actual nested transaction is opened.
export function comPortasB31NaTransacao(tx,executar) {
  return criarPersistenciaFs12({$transaction:async callback=>{
    try{return await callback(tx);}
    catch(cause){throw Object.assign(new Error('FS12_TX_ABORTADA',{cause}),{code:'FS12_TX_ABORTADA'});}
  }},{coordenacaoExterna:true}).transacionar(executar,{escrita:true}).catch(error=>{
    if(error.code==='FS12_TX_ABORTADA') throw error.cause;
    throw error;
  });
}
export function criarPersistenciaComandoFs12({db,prepararNoServidor,identificarEnvelope,
  alocarIdentidades,cifraEnvelope,validarSnapshot,lerResolucaoFiscal=async()=>null}) {
  if(!db || [prepararNoServidor,identificarEnvelope,alocarIdentidades,validarSnapshot].some(fn=>typeof fn!=='function') || !cifraEnvelope) fail();
  const ports=(tx,base,scope)=>({
    ...base,hash,
    prepararNoServidor:async entrada=>{
      const preparo=await prepararNoServidor(entrada,tx);
      if(!preparo || !Buffer.isBuffer(preparo.envelope) || preparo.envelope.length>16777216
        || !text(preparo.origem) || !preparo.provaPreparacao) fail();
      const envelope=Buffer.from(preparo.envelope);
      let payload;try{payload=JSON.parse(envelope.toString('utf8'));}catch{fail();}
      const identified=identificarEnvelope(payload,'/Declarar');
      if(identified.cnpj!==preparo.cnpj || identified.competencia!==entrada.competencia
        || identified.idSistema!=='PGDASD'||identified.idServico!=='TRANSDECLARACAO11'
        || identified.rota!=='/Declarar'||!/^[a-f0-9]{64}$/.test(identified.assinatura||'')) fail();
      // Dedicated server preparation must also validate intention/selector using
      // the officially reviewed contract. This adapter does not invent payload policy.
      return {...preparo,envelope,envelopeHash:hashBytes(envelope),
        preparoHash:hash(preparo.provaPreparacao),assinatura:identified.assinatura};
    },
    alocarIdentidades,
    lerPorChave:entrada=>tx.fs12Comando.findUnique({where:{portalClientId_competencia_chaveIdempotencia:{
      portalClientId:entrada.portalClientId,competencia:entrada.competencia,chaveIdempotencia:entrada.chaveIdempotencia}}}),
    lerComando:async id=>{
      const c=await tx.fs12Comando.findUnique({where:{id}});
      if(c && (c.portalClientId!==scope.portalClientId || c.competencia!==scope.competencia || c.autorId!==scope.autorId)) fail();
      // Technical closure is checked under the shared FS12 coordination before
      // association and T2. Presence fails closed; it is not a fiscal outcome.
      if(c && await tx.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+id}}))
        fail('FS12_COMANDO_ENCERRADO_SEM_DESPACHO');
      return c;
    },
    inserirComando:data=>tx.fs12Comando.create({data}),
    lerAssociacao:comandoId=>tx.fs12ComandoReserva.findUnique({where:{comandoId}}),
    inserirAssociacao:data=>tx.fs12ComandoReserva.create({data}),
    lerMarcador:reservaId=>tx.appSetting.findUnique({where:{key:'serpro_dispatch:'+reservaId}}),
    validarVinculoOrigem:async entrada=>{
      await tx.$queryRaw`SELECT id FROM apuracao_snapshots WHERE "portalClientId"=${entrada.portalClientId} AND competencia=${entrada.competencia} FOR UPDATE`;
      const snapshot=await tx.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{
        portalClientId:entrada.portalClientId,competencia:entrada.competencia}}});
      const own=snapshot?.estado==='transmitindo' && entrada.comandoId
        && snapshot.simulacaoSerpro?._portalTransmissao?.comandoId===entrada.comandoId
        && snapshot.idempotencyKey===entrada.calculoId;
      if(!snapshot || (snapshot.estado!=='fechada'&&!own)) fail('FS12_COMANDO_VINCULO_INVALIDO');
      const calculo=validarSnapshot(snapshot,entrada);
      const vinculo=await tx.apuracaoFs12Calculo.findFirst({where:{portalClientId:entrada.portalClientId,
        companyId:entrada.companyId,competencia:entrada.competencia,calculoId:entrada.calculoId}});
      if(!vinculo || hash(calculo)!==vinculo.calculoHash || hash(vinculo.calculoConfirmado)!==vinculo.calculoHash
        || calculo.fs12?.revisaoId!==entrada.prova.revisaoFs12Id
        || calculo.fs12?.revisao!==entrada.prova.revisaoFs12
        || vinculo.politicaVersao!==entrada.prova.politicaVersao) fail('FS12_COMANDO_VINCULO_INVALIDO');
      return vinculo;
    },
    exigirEscopoSemTentativaPendente:async entrada=>{
      const snapshot=await tx.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{
        portalClientId:entrada.portalClientId,competencia:entrada.competencia}},select:{estado:true,idempotencyKey:true,simulacaoSerpro:true}});
      const own=snapshot?.estado==='transmitindo'&&entrada.comandoId&&entrada.calculoId
        &&snapshot.simulacaoSerpro?._portalTransmissao?.comandoId===entrada.comandoId
        &&snapshot.idempotencyKey===entrada.calculoId;
      if(snapshot?.estado==='erro_transmissao'||(snapshot?.estado==='transmitindo'&&!own))fail('FS12_TENTATIVA_PENDENTE');
      const rows=await tx.serproChamada.findMany({where:{portalClientId:entrada.portalClientId,
        competencia:entrada.competencia,idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',
        ...(entrada.excluirReservaId?{id:{not:entrada.excluirReservaId}}:{})}});
      for(const reserva of rows) {
        if(['reservada','incerta'].includes(reserva.status)) fail('FS12_TENTATIVA_PENDENTE');
        const marcador=await tx.appSetting.findUnique({where:{key:'serpro_dispatch:'+reserva.id}});
        if(!marcador) continue;
        // Without trusted causal resolution even HTTP ok/erro remains blocking.
        // No signature, date, revision or fresh idempotency key bypass.
        const resolved=await lerResolucaoFiscal({reserva,marcador},tx);
        if(!resolved || resolved.reservaId!==reserva.id
          || !['RECUSA_COMPROVADA','RESULTADO_CONFIRMADO'].includes(resolved.tipo)
          || !text(resolved.evidenciaReferencia)) fail('FS12_TENTATIVA_PENDENTE');
      }
    },
    validarReservaExistente:async({comando,reservaId})=>{
      const reserva=await tx.serproChamada.findUnique({where:{id:reservaId}});
      if(!reserva || reserva.status!=='reservada' || reserva.acaoId!==comando.id
        || reserva.portalClientId!==comando.portalClientId || reserva.cnpj!==comando.cnpj
        || reserva.competencia!==comando.competencia || reserva.rota!=='/Declarar'
        || reserva.idSistema!=='PGDASD'||reserva.idServico!=='TRANSDECLARACAO11') fail();
      return reserva;
    },
    cifrarEnvelope:async({comando,reserva,preparo})=>{
      if(reserva.assinatura!==preparo.assinatura) fail();
      return cifraEnvelope.cifrar({bytes:preparo.envelope,comando,reservaId:reserva.id});
    },
    conferirEnvelopeAssociado:async(assoc,comando,preparo)=>{
      if(assoc.assinatura!==preparo.assinatura) fail();
      const bytes=await cifraEnvelope.decifrar({envelope:assoc.envelopeCifrado,comando,reservaId:assoc.reservaId});
      try{if(!bytes.equals(preparo.envelope)) fail();}finally{bytes.fill(0);}
    },
  });
  return {
    transacionar:(entrada,executar)=>transacaoCoordenadaFs12(db,entrada,
      tx=>comPortasB31NaTransacao(tx,base=>executar(ports(tx,base,entrada)))),
    // Caller must already hold SERPRO global then company-policy locks. Use scope
    // from trusted guard context; command identity is checked after coordination.
    naTransacaoDoGuard:async(tx,escopo,executar)=>{
      if(!tx || typeof tx.$transaction==='function') fail();
      const [isolation]=await tx.$queryRaw`SELECT current_setting('transaction_isolation') AS nivel`;
      if(!['read committed','serializable'].includes(isolation?.nivel)) fail();
      await coordenarEscopoFs12(tx,escopo);
      return comPortasB31NaTransacao(tx,base=>executar(ports(tx,base,escopo)));
    },
  };
}
