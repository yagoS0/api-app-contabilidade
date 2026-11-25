import { hashBytes } from '../custody/cifraRespostaFs12.js';
import { transacaoCoordenadaFs12 } from './coordenacaoFs12.js';
import { comPortasB31NaTransacao } from './comandoFs12.js';
import { prepararFs12ParaNovoCalculo, vincularFs12AoCalculo } from '../../application/vincularFs12AoCalculo.js';
import { criarPersistenciaFs12DoCalculo } from './fs12DoCalculo.js';
import { erroFs12 } from '../../domain/serieManualFs12.js';
import { classificarResultadoPgdas } from '../../domain/resultadoPgdas.js';
const fail = () => { throw erroFs12('FS12_RESULTADO_NAO_PROMOVIVEL', 'Resposta preservada. A revisão ou os dados mudaram; nenhuma nova chamada foi realizada.', 409); };
const scope = c => ({ portalClientId:c.portalClientId, competencia:c.competencia });
const whereSnapshot = c => ({ portalClientId_competencia:scope(c) });

// T3b operates ONLY on an authenticated T3a record. All retries are local DB
// transactions; there is no transport or key allocation in this adapter.
export function criarAplicacaoRespostaFs12({ db, custodia, cifra, hash, validarSnapshot, lerContextoOrigem, parseRetorno, validarEnvelope }) {
  async function lerResposta(comando) {
    const resposta = await db.fs12ComandoResposta.findUnique({ where:{ id:comando.esperado.custodia.respostaId } });
    if (!resposta) return null;
    const reserva=await db.fs12ComandoReserva.findUnique({where:{comandoId:comando.id}});
    if(!reserva || reserva.reservaId!==resposta.reservaId || typeof validarEnvelope!=='function') fail();
    await validarEnvelope(comando,reserva);
    const origin = await custodia.resolveOrigin({ stageId:hashBytes(Buffer.from(resposta.id)), respostaId:resposta.id,
      comandoId:comando.id, tentativaId:comando.tentativaId, reservaId:resposta.reservaId });
    const contexto = { ...origin, corpoHash:resposta.corpoHash, httpStatus:resposta.httpStatus, recebidoEm:resposta.recebidoEm.toISOString() };
    const bytes = await cifra.decifrar({ envelope:resposta.corpoCifrado, contexto });
    try {
      let raw; try { raw = JSON.parse(bytes.toString('utf8')); } catch { return { resposta, desfecho:{estado:'RESULTADO_INCERTO',confirmada:false}, raw:null }; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { resposta, desfecho:{estado:'RESULTADO_INCERTO',confirmada:false}, raw:null };
      // Authenticated HTTP status cannot be hidden by a conflicting body status.
      const desfecho = raw.status != null && Number(raw.status) !== resposta.httpStatus
        ? { estado:'RESULTADO_INCERTO', confirmada:false }
        : classificarResultadoPgdas({ ...raw, status:resposta.httpStatus }, { indicadorTransmissao:comando.intencao !== 'SIMULAR', contribuinteCnpj:comando.cnpj, competencia:comando.competencia });
      return { resposta, raw, desfecho };
    } finally { bytes.fill(0); }
  }
  async function conciliarLedger(tx,comando,resposta,status) {
    const updated=await tx.serproChamada.updateMany({where:{id:resposta.reservaId,acaoId:comando.id,
      portalClientId:comando.portalClientId,competencia:comando.competencia,status:{in:['reservada','incerta',status]}},data:{status}});
    if(updated.count!==1) fail();
  }
  async function aplicar({ comandoId, autorId }) {
    const comando = await db.fs12Comando.findUnique({ where:{id:comandoId} });
    if (!comando) fail();
    await db.$transaction(tx=>comPortasB31NaTransacao(tx,p=>p.autorizar({...scope(comando),autorId})),{isolationLevel:'Serializable'});
    const portal=await db.portalClient.findUnique({where:{id:comando.portalClientId},select:{companyId:true}});
    if(portal?.companyId!==comando.companyId) fail();
    const recebido = await lerResposta(comando);
    if (!recebido) return { ok:true, confirmada:false, estado:'DESCONHECIDA', motivo:'Resposta ainda não recuperada; não reenviar.' };
    const prep = comando.esperado.preparacao;
    if (!prep || hash(prep) !== comando.esperado.preparoHash) fail();
    return transacaoCoordenadaFs12(db,{...scope(comando),autorId},async tx => {
      await comPortasB31NaTransacao(tx,p=>p.autorizar({...scope(comando),autorId}));
      const prior = await tx.fs12ComandoCalculo.findUnique({where:{comandoId}});
      if (prior) {
        if (prior.respostaId !== recebido.resposta.id) fail();
        const snapshot=await tx.apuracaoSnapshot.findUnique({where:whereSnapshot(comando)});
        return { ok:true, recuperado:true, confirmada:recebido.desfecho.confirmada, calculoId:prep.calculoId, dasValor:parseRetorno(recebido.raw).dasValor, rbt12:prep.snapshotDados?.rbt12,
          mensagens:recebido.desfecho.mensagens||[], transmissao:recebido.desfecho, snapshot:snapshot?.idempotencyKey===prep.calculoId?snapshot:null,
          historico: snapshot?.idempotencyKey!==prep.calculoId };
      }
      if (recebido.desfecho.estado === 'ERRO_VALIDACAO') {
        await conciliarLedger(tx,comando,recebido.resposta,'erro');
        const atual=await tx.apuracaoSnapshot.findUnique({where:whereSnapshot(comando)});
        if (comando.intencao !== 'SIMULAR' && atual?.simulacaoSerpro?._portalTransmissao?.comandoId===comando.id
          && atual?.idempotencyKey===prep.calculoId) await tx.apuracaoSnapshot.update({where:{id:atual.id},data:{estado:'fechada',erroMensagem:recebido.desfecho.mensagem}});
        return {ok:false, estado:'REJEITADA', confirmada:false, motivo:recebido.desfecho.mensagem,
          code:recebido.desfecho.code,mensagens:recebido.desfecho.mensagens||[],respostaId:recebido.resposta.id,
          revisaoFs12:comando.revisaoFs12,portalClientId:comando.portalClientId,competencia:comando.competencia};
      }
      const prova = await comPortasB31NaTransacao(tx,p=>prepararFs12ParaNovoCalculo({...scope(comando),autorId},{transacionar:fn=>fn(p)}));
      if (prova.revisaoFs12 !== comando.revisaoFs12 || prova.contextoHash !== comando.contextoHash
        || hash(await lerContextoOrigem(scope(comando),tx)) !== hash(prep.contextoOrigem)) fail();
      const current = await tx.apuracaoSnapshot.findUnique({where:whereSnapshot(comando)});
      const original = prep.snapshotAnterior;
      if (comando.intencao === 'SIMULAR') {
        if (original ? !current || current.id !== original.id || current.estado !== original.estado || current.idempotencyKey !== original.idempotencyKey : current) fail();
      } else if (!current || current.idempotencyKey !== prep.calculoId || current.simulacaoSerpro?._portalTransmissao?.comandoId !== comando.id) fail();
      if (!['SIMULACAO_CONCLUIDA','TRANSMITIDA'].includes(recebido.desfecho.estado))
        return {ok:true, estado:'DESCONHECIDA', confirmada:false, motivo:'Retorno preservado sem prova fiscal suficiente.'};
      const parsed = parseRetorno(recebido.raw);
      if (typeof parsed.dasValor !== 'number' || !Number.isFinite(parsed.dasValor) || parsed.dasValor < 0) fail();
      let vinculo, snapshot;
      if (comando.intencao === 'SIMULAR') {
        const calculo = prep.calculoConfirmado;
        if (!calculo || calculo.calculoId !== prep.calculoId || calculo.fs12?.revisao !== comando.revisaoFs12) fail();
        const data = {...prep.snapshotDados, estado:'calculada', idempotencyKey:prep.calculoId,
          dasSimuladoSerpro:parsed.dasValor, simulacaoSerpro:{raw:recebido.raw,_portalCalculo:calculo},erroMensagem:null};
        snapshot = current ? await tx.apuracaoSnapshot.update({where:{id:current.id},data})
          : await tx.apuracaoSnapshot.create({data:{...data,...scope(comando)}});
        const out = await vincularFs12AoCalculo({...scope(comando),autorId,calculoId:prep.calculoId,
          revisaoEsperada:comando.revisaoFs12,contextoHash:comando.contextoHash},
          criarPersistenciaFs12DoCalculo({db,tx,validarSnapshot}));
        vinculo = out.vinculo;
      } else {
        vinculo = await tx.apuracaoFs12Calculo.findUnique({where:{id:comando.vinculoOrigemId}});
        if (!vinculo || vinculo.calculoId !== prep.calculoId) fail();
        snapshot = await tx.apuracaoSnapshot.update({where:{id:current.id},data:{estado:'transmitida',
          numeroDeclaracao:recebido.desfecho.evidencia.numeroDeclaracao, transmitidoEm:recebido.resposta.recebidoEm,
          dasRetornadoSerpro:parsed.dasValor, erroMensagem:null}});
      }
      await conciliarLedger(tx,comando,recebido.resposta,'ok');
      await tx.fs12ComandoCalculo.create({data:{comandoId,respostaId:recebido.resposta.id,vinculoId:vinculo.id,
        ...scope(comando),companyId:comando.companyId,revisaoFs12:comando.revisaoFs12,intencao:comando.intencao,autorId}});
      return {ok:true,confirmada:recebido.desfecho.confirmada,calculoId:prep.calculoId,dasValor:parsed.dasValor,
        rbt12:prep.snapshotDados?.rbt12, snapshot, mensagens:recebido.desfecho.mensagens||[], transmissao:recebido.desfecho,
        pendencias:comando.intencao==='SIMULAR'?[]:['DOCUMENTOS','CONTABILIZACAO']};
    });
  }
  // Historical presentation only. No dispatch capability or state promotion.
  async function historicoConfirmado(comando, recebido) {
    const prep = comando.esperado.preparacao;
    if (!prep || hash(prep) !== comando.esperado.preparoHash) return null;
    const association = await db.fs12ComandoCalculo.findUnique({where:{comandoId:comando.id}});
    if (!association || association.respostaId !== recebido.resposta.id || association.vinculoId !== comando.vinculoOrigemId) return null;
    const vinculo = await db.apuracaoFs12Calculo.findUnique({where:{id:association.vinculoId}});
    const snapshot = await db.apuracaoSnapshot.findUnique({where:whereSnapshot(comando)});
    if (!vinculo || !snapshot || snapshot.estado !== 'transmitida' || snapshot.idempotencyKey !== prep.calculoId
      || snapshot.simulacaoSerpro?._portalTransmissao?.comandoId !== comando.id
      || snapshot.numeroDeclaracao !== recebido.desfecho.evidencia.numeroDeclaracao || vinculo.calculoId !== prep.calculoId) return null;
    for (const field of ['portalClientId','companyId','competencia','revisaoFs12']) {
      if (association[field] !== comando[field] || vinculo[field] !== comando[field]) return null;
    }
    if (association.intencao !== comando.intencao || vinculo.contextoHash !== comando.contextoHash) return null;
    let calculo;
    try { calculo = validarSnapshot(snapshot,{...scope(comando),calculoId:prep.calculoId}); } catch { return null; }
    if (calculo.calculoId !== prep.calculoId || calculo.fs12?.revisao !== comando.revisaoFs12
      || hash(vinculo.calculoConfirmado) !== vinculo.calculoHash || hash(calculo) !== vinculo.calculoHash) return null;
    const valor = parseRetorno(recebido.raw).dasValor;
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0
      || snapshot.dasRetornadoSerpro == null || snapshot.dasRetornadoSerpro === '' || Number(snapshot.dasRetornadoSerpro) !== valor) return null;
    return {portalClientId:comando.portalClientId,competencia:comando.competencia,comandoId:comando.id,
      calculoId:prep.calculoId,vinculoId:vinculo.id,respostaId:recebido.resposta.id,dasValor:valor,
      estado:'transmitida',somenteLeitura:true,autorizaEfeitoFiscal:false};
  }
  async function projetar(entrada) {
    const portal=await db.portalClient.findUnique({where:{id:entrada.portalClientId},select:{companyId:true}});
    const comandos = await db.fs12Comando.findMany({where:scope(entrada),orderBy:{criadoEm:'desc'}});
    for (const comando of comandos) {
      if(await db.appSetting.findUnique({where:{key:'fs12_comando_sem_despacho:'+comando.id}})) continue;
      if(comando.companyId!==portal?.companyId) return {estado:'DESCONHECIDA',origem:'DESCONHECIDA',motivo:'Vínculo empresarial mudou. Conciliação autorizada necessária.'};
      const r = await lerResposta(comando);
      const reserva = await db.fs12ComandoReserva.findUnique({where:{comandoId:comando.id}});
      const base={tentativaId:comando.tentativaId,comandoId:comando.id,revisaoFs12:comando.revisaoFs12,origem:'ALTAN'};
      if (!r) {
        if(!reserva) return {...base,estado:'EM_PROCESSAMENTO',motivo:'Preparo ainda sem reserva. Confira para encerrar com segurança antes de nova ação.'};
        const marcador=await db.appSetting.findUnique({where:{key:'serpro_dispatch:'+reserva.reservaId}});
        const ledger=await db.serproChamada.findUnique({where:{id:reserva.reservaId}});
        if(!marcador && ledger?.status==='erro') continue;
        return {...base,estado:marcador?'DESCONHECIDA':'EM_PROCESSAMENTO',motivo:'Tentativa ainda sem resposta fiscal comprovada.'};
      }
      if (r.desfecho.confirmada) return {...base,estado:'CONFIRMADA',numeroDeclaracao:r.desfecho.evidencia.numeroDeclaracao,motivo:'Resposta causal preservada.',calculoHistorico:await historicoConfirmado(comando,r)};
      if (r.desfecho.estado==='ERRO_VALIDACAO') return {...base,estado:'REJEITADA',motivo:r.desfecho.mensagem};
      if (r.desfecho.estado!=='SIMULACAO_CONCLUIDA') return {...base,estado:'DESCONHECIDA',motivo:'Resposta inconclusiva preservada.'};
      if (!await db.fs12ComandoCalculo.findUnique({where:{comandoId:comando.id}})) return {...base,estado:'DESCONHECIDA',motivo:'Resultado recebido ainda não aplicado. Concilie localmente.'};
    }
    return {estado:'NAO_TRANSMITIDA',origem:'DESCONHECIDA',motivo:'Não há transmissão causal confirmada.'};
  }
  async function lerResolucaoFiscal({reserva}) {
    const c=await db.fs12Comando.findUnique({where:{id:reserva.acaoId}});
    if (!c) return null;
    const r=await lerResposta(c);
    if (!r) return null;
    if (r.desfecho.estado==='ERRO_VALIDACAO') return {reservaId:reserva.id,tipo:'RECUSA_COMPROVADA',evidenciaReferencia:r.resposta.id};
    if (await db.fs12ComandoCalculo.findUnique({where:{comandoId:c.id}})) return {reservaId:reserva.id,tipo:'RESULTADO_CONFIRMADO',evidenciaReferencia:r.resposta.id};
    return null;
  }
  return {aplicar,projetar,lerResolucaoFiscal};
}








