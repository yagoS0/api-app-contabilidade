import { coordenarEscopoFs12, transacaoCoordenadaFs12 } from '../modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
import { clienteLeituraFs12 } from './execucaoFs12.js';
import { randomUUID } from 'node:crypto';
import { prepararComandoFs12 } from '../modules/fiscal/application/coordenarComandoFs12.js';
import { criarPersistenciaComandoFs12, comPortasB31NaTransacao } from '../modules/fiscal/infrastructure/prisma/comandoFs12.js';
import { criarCustodiaRespostaFs12Prisma, hashMarcadorCustodiaFs12 } from '../modules/fiscal/infrastructure/prisma/custodiaRespostaFs12.js';
import { criarAplicacaoRespostaFs12 } from '../modules/fiscal/infrastructure/prisma/aplicacaoRespostaFs12.js';
import { hashBytes } from '../modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarContextoComandoFs12, comComandoFs12 } from '../modules/fiscal/publicComandosFs12.js';
import { criarPersistenciaFs12 } from '../modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import { buildDeclaracaoPayload, parseRetornoSimulacao } from '../application/fiscal/serpro/PgdasSimulacaoService.js';
import { contextoOrigemCalculo } from '../application/notas/apuracao/v2/RecuperacaoCalculo.js';
import { hashCalculo, validarCalculoConfirmado } from '../application/notas/apuracao/v2/CalculoConfirmado.js';
import { erroFs12 } from '../modules/fiscal/domain/serieManualFs12.js';

const fail=()=>{throw erroFs12('FS12_PREPARO_DIVERGENTE','O preparo mudou. A tentativa anterior foi preservada.',409);};
const scope=c=>({portalClientId:c.portalClientId,competencia:c.competencia});
const copiar=v=>JSON.parse(JSON.stringify(v));
export function envelopeDeclaracaoFs12(parametros,intencao) {
  const declaracao=buildDeclaracaoPayload({...parametros,indicadorTransmissao:intencao!=='SIMULAR',tipoDeclaracao:intencao==='RETIFICAR'?2:1});
  const cnpj=parametros.contratanteCnpj;
  return Buffer.from(JSON.stringify({contratante:{numero:cnpj,tipo:2},autorPedidoDados:{numero:cnpj,tipo:2},
    contribuinte:{numero:parametros.contribuinteCnpj,tipo:2},pedidoDados:{idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',versaoSistema:'1.0',dados:JSON.stringify(declaracao)}}));
}

export async function validarEnvelopeCongeladoFs12({comando,reserva,cifraEnvelope}) {
    if(hashCalculo(comando.intencaoCongelada)!==comando.comandoHash
      || hashCalculo(comando.esperado.preparacao)!==comando.esperado.preparoHash
      || reserva.envelopeHash!==comando.esperado.envelopeHash) fail();
    const bytes=await cifraEnvelope.decifrar({envelope:reserva.envelopeCifrado,comando,reservaId:reserva.reservaId});
    const reconstructed=envelopeDeclaracaoFs12(comando.esperado.preparacao.parametros,comando.intencao);
    try {if(hashBytes(bytes)!==reserva.envelopeHash || !bytes.equals(reconstructed)) fail();}
    finally{bytes.fill(0);reconstructed.fill(0);}
  }

// Serializes the local predispatch projection with explicit technical closure.
// No network work belongs in this transaction or its serialization retry.
export async function marcarSnapshotTransmitindoFs12({db,comando,autorId}) {
  return transacaoCoordenadaFs12(db,{...scope(comando),autorId},async tx=>{
    await comPortasB31NaTransacao(tx,p=>p.autorizar({...scope(comando),autorId}));
    const original=await tx.fs12Comando.findUnique({where:{id:comando.id}});
    if(!original || original.autorId!==autorId || original.comandoHash!==comando.comandoHash
      || original.portalClientId!==comando.portalClientId || original.competencia!==comando.competencia) fail();
    if(await tx.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+comando.id}}))
      throw erroFs12('FS12_COMANDO_ENCERRADO_SEM_DESPACHO','O comando foi encerrado antes do despacho. Nenhuma transmissão foi iniciada.',409);
    const prep=original.esperado.preparacao, anterior=prep?.snapshotAnterior;
    if(!anterior || original.intencao==='SIMULAR') fail();
    const snapshot=await tx.apuracaoSnapshot.findUnique({where:{id:anterior.id}});
    if(!snapshot || snapshot.portalClientId!==original.portalClientId || snapshot.competencia!==original.competencia) fail();
    const updated=await tx.apuracaoSnapshot.updateMany({where:{id:anterior.id,estado:anterior.estado,idempotencyKey:anterior.idempotencyKey},
      data:{estado:'transmitindo',simulacaoSerpro:{...snapshot.simulacaoSerpro,_portalTransmissao:{comandoId:original.id,
        calculoId:prep.calculoId,retificar:original.intencao==='RETIFICAR'}}}});
    if(updated.count!==1) fail();
  });
}
// Composition receives already constructed durable storage/keyring capabilities.
// No production defaults, plaintext fallback, automatic network replay, or secrets.
export function criarRuntimeFiscalFs12({db,cifraResposta,cifraEnvelope,stageResposta,custodianteId,capacidadeId,keyIdAtivo,identificarEnvelope,garantiaCustodia = 'DIRECTORY_SYNC_REQUIRED'}) {
  if (!['DIRECTORY_SYNC_REQUIRED','PROCESS_RESTART_ONLY'].includes(garantiaCustodia)) fail();
  if (!db || !cifraResposta || !cifraEnvelope || !stageResposta || !custodianteId || !capacidadeId || !keyIdAtivo || typeof identificarEnvelope!=='function') fail();
  const custodia=criarCustodiaRespostaFs12Prisma({db,cifra:cifraResposta,custodianteId,capacidadeId});
  const validarEnvelope=(comando,reserva)=>validarEnvelopeCongeladoFs12({comando,reserva,cifraEnvelope});
  const aplicacaoPara=leitor=>criarAplicacaoRespostaFs12({db:leitor,
    custodia:leitor===db?custodia:criarCustodiaRespostaFs12Prisma({db:leitor,cifra:cifraResposta,custodianteId,capacidadeId}),
    cifra:cifraResposta,hash:hashCalculo,validarSnapshot:validarCalculoConfirmado,
    lerContextoOrigem:contextoOrigemCalculo,parseRetorno:parseRetornoSimulacao,validarEnvelope});
  const aplicacao=aplicacaoPara(db);
  const autorizar=entrada=>criarPersistenciaFs12(db).transacionar(p=>p.autorizar(entrada),{escrita:false});
  async function importar(comando) {
    const respostaId=comando.esperado.custodia.respostaId;
    const existente=await db.fs12ComandoResposta.findUnique({where:{id:respostaId}});
    if (existente) return existente;
    return stageResposta.recuperar({id:hashBytes(Buffer.from(respostaId)),resolveOrigin:custodia.resolveOrigin,importDurably:custodia.importDurably});
  }
  async function encerrarSemDespacho(comando,autorId) {
    return db.$transaction(async tx=>{
      // Same order as guard: serializes both reservation and T2 commit. An old
      // process cannot acquire a later reservation after this cancellation fact.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(73517001)`;
      await coordenarEscopoFs12(tx,{...scope(comando),autorId});
      await comPortasB31NaTransacao(tx,p=>p.autorizar({...scope(comando),autorId}));
      const original=await tx.fs12Comando.findUnique({where:{id:comando.id}});
      if(!original || original.companyId!==comando.companyId) fail();
      const reserva=await tx.fs12ComandoReserva.findUnique({where:{comandoId:comando.id}});
      if(reserva && await tx.appSetting.findUnique({where:{key:'serpro_dispatch:'+reserva.reservaId}})) return null;
      const key='fs12_comando_sem_despacho:'+comando.id;
      const prior=await tx.appSetting.findUnique({where:{key}});

      if(reserva) {
        const ledger=await tx.serproChamada.findUnique({where:{id:reserva.reservaId}});
        if(!ledger || ledger.acaoId!==comando.id || !['reservada','abortada_auth','abortada_politica'].includes(ledger.status)) return null;
        if(ledger.status==='reservada') await tx.serproChamada.update({where:{id:ledger.id},data:{status:'abortada_politica',erroCodigo:'FS12_CONFERENCIA_SEM_DESPACHO',erroMensagem:'Encerrada explicitamente antes do marcador de despacho.'}});
      }
      const value={versao:1,evento:'COMANDO_ENCERRADO_ANTES_DESPACHO',comandoId:comando.id,tentativaId:comando.tentativaId,
        ...scope(comando),companyId:comando.companyId,autorId,encerradoEm:new Date().toISOString(),
        motivo:'CONFERENCIA_EXPLICITA_SEM_MARCADOR',reservaId:reserva?.reservaId||null};
      if(!prior) await tx.appSetting.create({data:{key,value}});
      const snapshot=await tx.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:scope(comando)}});
      const prep=comando.esperado.preparacao;
      if(snapshot?.estado==='transmitindo' && snapshot.simulacaoSerpro?._portalTransmissao?.comandoId===comando.id
        && snapshot.idempotencyKey===prep?.calculoId) {
        const changed=await tx.apuracaoSnapshot.updateMany({where:{id:snapshot.id,estado:'transmitindo',idempotencyKey:prep.calculoId,
          simulacaoSerpro:{path:['_portalTransmissao','comandoId'],equals:comando.id}},data:{estado:prep.snapshotAnterior.estado,erroMensagem:null}});
        if(changed.count!==1) fail();
      }
      return {ok:true,encerradaSemDespacho:true,replay:Boolean(prior),estado:'NAO_TRANSMITIDA',comandoId:comando.id,tentativaId:comando.tentativaId,
        mensagem:'Comando encerrado antes de qualquer despacho. Uma nova ação explícita exige uma nova chave.'};
    },{isolationLevel:'ReadCommitted',maxWait:10000,timeout:15000});
  }
  async function recuperar(entrada) {
    await autorizar(entrada);
    const comandos=await db.fs12Comando.findMany({where:{...scope(entrada),...(entrada.comandoId?{id:entrada.comandoId}:{})},orderBy:{criadoEm:'desc'}});
    if (!comandos.length) return {ok:true,confirmada:false,estado:'DESCONHECIDA',mensagem:'Não há resposta local correlacionada. A consulta documental não libera reenvio.'};
    const comando=comandos[0];
    const encerrado=entrada.encerrarSemDespacho===true?await encerrarSemDespacho(comando,entrada.autorId):null;
    if(encerrado) return encerrado;
    try { await importar(comando); }
    catch(error) { if (!['ENOENT','FS12_STAGE_PENDENTE'].includes(error.code)) throw error;
      return {ok:true,confirmada:false,estado:'DESCONHECIDA',mensagem:'Sem resposta recuperável. A tentativa permanece bloqueada; não houve reenvio.'}; }
    const result=await aplicacao.aplicar({comandoId:comando.id,autorId:entrada.autorId});
    return {...result,comandoId:comando.id,tentativaId:comando.tentativaId,operationsRequestId:comando.esperado.preparacao?.operationsRequestId||null};
  }
  async function buscarReplay(entrada) {
    if(!entrada.chaveIdempotencia) return null;
    await autorizar(entrada);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(entrada.chaveIdempotencia)) fail();
    const comando=await db.fs12Comando.findUnique({where:{portalClientId_competencia_chaveIdempotencia:{...scope(entrada),chaveIdempotencia:entrada.chaveIdempotencia}}});
    if(!comando) return null;
    if(comando.autorId!==entrada.autorId || comando.intencao!==entrada.intencao || comando.esperado.preparacao?.pedidoHash!==entrada.pedidoHash) fail();
    const result=await recuperar({...scope(entrada),autorId:entrada.autorId,comandoId:comando.id,encerrarSemDespacho:false});
    if(!result.calculoId && !result.confirmada) throw Object.assign(erroFs12('FS12_TENTATIVA_PENDENTE','A tentativa original permanece sem conclusão. Use a conciliação; nenhum reenvio foi realizado.',409),{comandoId:comando.id,tentativaId:comando.tentativaId});
    return {...result,comandoId:comando.id,tentativaId:comando.tentativaId};
  }
  async function executar(entrada) {
    const anterior=await buscarReplay({...entrada,pedidoHash:entrada.provaPreparacao?.pedidoHash});
    if(anterior) return anterior;
    await autorizar(entrada);
    if (!['2026-11','2026-12'].includes(entrada.competencia)) fail();
    const congelado=copiar(entrada.provaPreparacao);
    const prepararNoServidor=async (pedido,tx)=>{
      const prep=pedido.preparacaoOriginal || congelado;
      if (!prep || hashCalculo(await contextoOrigemCalculo(scope(pedido),tx))!==hashCalculo(prep.contextoOrigem)) fail();
      if (pedido.prova.revisaoFs12!==prep.fs12.revisao || pedido.prova.contextoHash!==prep.fs12.contextoHash
        || hashCalculo(pedido.prova.serie.map(m=>({pa:m.mes,valor:m.valorCentavos/100})))!==hashCalculo(prep.parametros.folhasSalario)) fail();
      const current=await tx.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:scope(pedido)}});
      const original=prep.snapshotAnterior;
      const propria=pedido.comandoId && current?.simulacaoSerpro?._portalTransmissao?.comandoId===pedido.comandoId
        && current?.idempotencyKey===prep.calculoId;
      if (!propria && (original ? !current || current.id!==original.id || current.estado!==original.estado || current.idempotencyKey!==original.idempotencyKey : current)) fail();
      return {companyId:pedido.prova.companyId,cnpj:prep.parametros.contribuinteCnpj,origem:'MANUAL_APURACAO',
        envelope:envelopeDeclaracaoFs12(prep.parametros,pedido.intencao),provaPreparacao:prep};
    };
    const persistencia=criarPersistenciaComandoFs12({db,prepararNoServidor,identificarEnvelope,cifraEnvelope,validarSnapshot:validarCalculoConfirmado,
      lerResolucaoFiscal:(entrada,tx)=>aplicacaoPara(clienteLeituraFs12(tx)).lerResolucaoFiscal(entrada),
      alocarIdentidades:()=>({comandoId:randomUUID(),tentativaId:randomUUID(),respostaId:randomUUID(),custodianteId,capacidadeId})});
    const {comando,replay}=await prepararComandoFs12({...scope(entrada),autorId:entrada.autorId,intencao:entrada.intencao,
      revisaoEsperada:entrada.fs12RevisaoEsperada,contextoHash:entrada.fs12ContextoRevisao,
      chaveIdempotencia:entrada.chaveIdempotencia || randomUUID(),...(entrada.intencao==='SIMULAR'?{}:{calculoId:congelado.calculoId})},persistencia);
    if (replay) return recuperar({...scope(entrada),autorId:entrada.autorId,comandoId:comando.id,encerrarSemDespacho:false});
    if (entrada.intencao!=='SIMULAR') await marcarSnapshotTransmitindoFs12({db,comando,autorId:entrada.autorId});
    const observarResposta=async ({comando:c,reservaId,marcador,corpo,httpStatus,recebidoEm})=>{
      const contexto={respostaId:c.esperado.custodia.respostaId,comandoId:c.id,tentativaId:c.tentativaId,reservaId,
        ...scope(c),companyId:c.companyId,custodianteId,capacidadeId,envelopeHash:c.esperado.envelopeHash,
        marcadorHash:hashMarcadorCustodiaFs12(marcador),cnpj:c.cnpj,revisaoFs12:c.revisaoFs12,intencao:c.intencao,
        corpoHash:hashBytes(corpo),httpStatus,recebidoEm:new Date(recebidoEm).toISOString()};
      const stage=await stageResposta.guardar({corpo,contexto,keyId:keyIdAtivo}); // before ANY database access after receipt
      if(stage.directorySynced!==true && garantiaCustodia !== 'PROCESS_RESTART_ONLY') throw erroFs12('FS12_STAGE_DURABILIDADE_INDISPONIVEL','Resposta preservada; durabilidade não confirmada.',503);
      const receipt=await stageResposta.recuperar({id:stage.id,resolveOrigin:custodia.resolveOrigin,importDurably:custodia.importDurably});
      return {respostaId:contexto.respostaId,custodiaId:receipt.custodiaId,stageId:stage.id,corpoHash:contexto.corpoHash};
    };
    const cap=criarContextoComandoFs12({comando,persistencia,envelopeBytes:envelopeDeclaracaoFs12(congelado.parametros,entrada.intencao),observarResposta});
    let transportError;
    try {await comComandoFs12(cap,()=>entrada.despachar(congelado.parametros));} catch(error) {transportError=error;}
    // Custodied refusals and successful responses use exactly the same local path.
    const resposta=await db.fs12ComandoResposta.findUnique({where:{id:comando.esperado.custodia.respostaId}});
    if (!resposta) { if (transportError) throw Object.assign(transportError,{comandoId:comando.id,tentativaId:comando.tentativaId}); fail(); }
    const out=await aplicacao.aplicar({comandoId:comando.id,autorId:entrada.autorId});
    if (!out.ok || out.estado==='DESCONHECIDA') throw erroFs12(out.estado==='REJEITADA'?'SERPRO_BUSINESS_ERROR':'FS12_RESULTADO_INCERTO',out.motivo || 'Concilie a resposta preservada antes de continuar.',409);
    return {...out,comandoId:comando.id,tentativaId:comando.tentativaId};
  }
  const projetar=(entrada,{db:leitor=db}={})=>aplicacaoPara(clienteLeituraFs12(leitor)).projetar(entrada);
  return Object.freeze({executar,recuperar,projetar,buscarReplay});
}










