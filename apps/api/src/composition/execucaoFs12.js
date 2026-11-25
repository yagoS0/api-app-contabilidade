import { consultarDocumentosPgdas } from '../modules/fiscal/publicPgdas.js';
import { hashCalculo } from '../application/notas/apuracao/v2/CalculoConfirmado.js';
import { transacaoCoordenadaFs12 } from '../modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
import { comPortasB31NaTransacao } from '../modules/fiscal/infrastructure/prisma/comandoFs12.js';
import { prisma } from '../infrastructure/db/prisma.js';
import { consultarFs12DaApuracao } from '../modules/fiscal/publicFs12.js';
import { criarPersistenciaFs12 } from '../modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import { criarLeituraEstadoDocumentalPgdas } from '../modules/fiscal/infrastructure/prisma/estadoDocumentalPgdas.js';
import { validarFs12ParaNovoCalculo, validarUsoFs12DoCalculo } from './fs12DoCalculo.js';
import { erroFs12 } from '../modules/fiscal/domain/serieManualFs12.js';

// Registered exclusively by server composition. No environment lookup or HTTP
// endpoint can supply a capability. An unavailable durable volume fails closed.
let runtime = null;
let indisponibilidade = {codigo:'FS12_CUSTODIA_INDISPONIVEL',motivo:'A custódia fiscal recuperável está indisponível. Nenhum envio foi iniciado.'};
export function registrarIndisponibilidadeFs12({codigo,motivo,acao}) {
  if (runtime) throw new Error('FS12_RUNTIME_JA_CONFIGURADO');
  indisponibilidade={codigo,motivo,acao};
}
export function registrarRuntimeFs12(capacidade) {
  if (runtime || !capacidade || ['executar', 'recuperar', 'projetar', 'buscarReplay'].some(k => typeof capacidade[k] !== 'function'))
    throw erroFs12('FS12_RUNTIME_CONFIG_INVALIDA', 'Configuração fiscal indisponível.', 503);
  runtime = Object.freeze(capacidade);
}
export function exigirRuntimeFs12() {
  if (!runtime) throw erroFs12(indisponibilidade.codigo, indisponibilidade.motivo, 503);
  return runtime;
}
export const recuperarPedidoFiscalFs12 = entrada => exigirRuntimeFs12().buscarReplay(entrada);
export const executarFiscalFs12 = entrada => exigirRuntimeFs12().executar(entrada);
export const recuperarFiscalFs12 = entrada => exigirRuntimeFs12().recuperar(entrada);

// An existing interactive transaction is the authority for this read. The bridge
// does not create a nested transaction, retry an aborted transaction or escape to
// the global client. B31 receives the same snapshot/connection as its consumer.
export function clienteLeituraFs12(db) {
  if (typeof db?.$transaction === 'function') return db;
  if (!db?.portalClient || !db?.$queryRaw) throw erroFs12('FS12_LEITURA_INVALIDA','Leitura fiscal indisponível.',503);
  return new Proxy(db,{get(target,key){
    if(key==='$transaction') return async callback=>{
      try{return await callback(target);}catch(cause){
        if(['P2034','P2002','40001'].includes(cause?.code) || (cause?.code==='P2010' && cause?.meta?.code==='40001')) throw Object.assign(new Error('FS12_LEITURA_TRANSACAO_ABORTADA',{cause}),{code:'FS12_LEITURA_TRANSACAO_ABORTADA'});
        throw cause;
      }
    };
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
}
export async function avaliarAptidaoFiscalOperacoes(entrada, { db = prisma, capacidade = runtime } = {}) {
  const tx = typeof db.$transaction === 'function' ? undefined : db;
  db = clienteLeituraFs12(db);
  const consulta = await consultarFs12DaApuracao(entrada, criarPersistenciaFs12(db)); // ACL first, even on legacy PA.
  const impedimentos = [];
  let prova = null;
  if (entrada.competencia >= '2026-11') {
    try { prova = await validarFs12ParaNovoCalculo(entrada, { db, tx }); }
    catch (error) {
      if (!['FS12_CONFIRMACAO_AUSENTE','FS12_CALCULO_CONFLITO','FS12_CONTEXTO_PENDENTE','FS12_SERIE_INCOMPLETA','FS12_SERIE_INVALIDA'].includes(error.code)) throw error;
      impedimentos.push({ code: error.code, mensagem: error.message });
    }
    if (!['2026-11','2026-12'].includes(entrada.competencia)) impedimentos.push({ code: 'FS12_POLITICA_NAO_HOMOLOGADA', mensagem: 'Competência ainda não homologada.' });
    if (!capacidade) impedimentos.push({ code: indisponibilidade.codigo, mensagem: indisponibilidade.motivo });
  }
  const documental = await criarLeituraEstadoDocumentalPgdas(db)(entrada);
  const documentos = await consultarDocumentosPgdas(entrada,{autorizar:async()=>{},ler:async()=>documental});
  const declaracao = {confirmada:documentos.transmissao.confirmada,numeroDeclaracao:documentos.numeroDeclaracao,
    origem:documentos.origem || 'DESCONHECIDA',declaradaExternaManualmente:documentos.transmissao.declaradaExternaManualmente};
  const fiscal = capacidade ? await capacidade.projetar(entrada, { db }) : {
    estado: ['transmitindo','erro_transmissao'].includes(documental.snapshot?.estado) ? 'DESCONHECIDA' : 'NAO_TRANSMITIDA',
    motivo: 'A leitura documental não identifica a autoria de uma tentativa.', origem: 'DESCONHECIDA' };
  if (['DESCONHECIDA','EM_PROCESSAMENTO'].includes(fiscal.estado)) impedimentos.push({ code:'FS12_TENTATIVA_PENDENTE', mensagem:'Concilie a tentativa anterior antes de novo despacho.' });
  // A declaration without causal linkage is independent from the local attempt.

  let vinculoValido = false;
  const calculoId = entrada.calculoId || documental.snapshot?.idempotencyKey;
  if (calculoId && prova) {
    try { await validarUsoFs12DoCalculo({...entrada,calculoId}, { db, tx }); vinculoValido = true; }
    catch (error) { if (error.code !== 'FS12_CALCULO_CONFLITO') throw error; }
  }

  const snapshot = documental.snapshot;
  const revisaoReabertura = snapshot?.estado === 'aberta' ? snapshot.idempotencyKey : snapshot?.simulacaoSerpro?._portalCalculo?.reaberturaReferencia;
  const eventos = revisaoReabertura ? await db.appSetting.findMany({where:{key:{startsWith:'apuracao_reabertura:'},
    AND:[{value:{path:['portalClientId'],equals:entrada.portalClientId}},{value:{path:['competencia'],equals:entrada.competencia}},
      {value:{path:['novaRevisao'],equals:revisaoReabertura}}]},select:{value:true}}) : [];
  const reaberta = eventos.some(({value})=>value.evento==='APURACAO_REABERTA' && value.snapshotId===snapshot?.id && value.estadoAnterior==='transmitida');
  if ((declaracao.confirmada || declaracao.declaradaExternaManualmente) && fiscal.estado !== 'CONFIRMADA' && !reaberta) impedimentos.push({code:'PGDAS_DECLARACAO_EXISTENTE',mensagem:'Declaração existente. Recupere os documentos e confira a origem.'});
  const apta = impedimentos.length === 0;
  return { portalClientId: entrada.portalClientId, competencia: entrada.competencia,
    fs12: { exigida: entrada.competencia >= '2026-11', situacao: prova ? 'CONFIRMADA' : consulta.situacao,
      revisao: prova?.revisaoFs12 ?? consulta.revisaoVigente, contextoRevisao: prova?.contextoHash ?? consulta.contextoRevisao,
      serie: prova?.serie ?? [] }, fiscal, declaracao, impedimentos,
    capacidades: { calcular: apta && (fiscal.estado !== 'CONFIRMADA' || reaberta), transmitir: apta && vinculoValido && (fiscal.estado !== 'CONFIRMADA' || (reaberta && documental.snapshot?.estado === 'fechada')),
      retificar: apta && fiscal.estado === 'CONFIRMADA' && documental.snapshot?.estado === 'transmitida', reconciliar: Boolean(capacidade) && ['DESCONHECIDA','EM_PROCESSAMENTO'].includes(fiscal.estado) },
    pendencias: fiscal.estado === 'CONFIRMADA' ? ['Conferir recuperação documental e contabilização separadamente.'] : [] };
}




// Records an authorized analysis, not a manufactured causal resolution. Only
// evidence already retrieved by the official-document flow is referenceable.
export async function registrarIntervencaoFiscalFs12(entrada, {db=prisma}={}) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(entrada.chaveIdempotencia||'') || typeof entrada.motivo!=='string'
    || entrada.motivo.trim().length<20 || entrada.motivo.length>2000
    || !['DOCUMENTACAO_LOCALIZADA_SEM_CAUSALIDADE','ESCALONAMENTO_OFICIAL'].includes(entrada.resultado))
    throw erroFs12('FS12_INTERVENCAO_INVALIDA','Informe a análise e o resultado da intervenção.',422);
  await criarPersistenciaFs12(db).transacionar(p=>p.autorizar(entrada),{escrita:false});
  const observado=await exigirRuntimeFs12().projetar(entrada,{db});
  if(!['DESCONHECIDA','EM_PROCESSAMENTO'].includes(observado.estado) || observado.comandoId!==entrada.comandoId) throw erroFs12('FS12_INTERVENCAO_ESTADO_INVALIDO','A tentativa não está pendente de conciliação.',409);
  return transacaoCoordenadaFs12(db,entrada,async tx=>{
    await comPortasB31NaTransacao(tx,p=>p.autorizar(entrada));
    const comando=await tx.fs12Comando.findUnique({where:{id:entrada.comandoId}});
    if(!comando || comando.portalClientId!==entrada.portalClientId || comando.competencia!==entrada.competencia
      || comando.revisaoFs12!==entrada.revisaoFs12) throw erroFs12('FS12_INTERVENCAO_CONTEXTO_INVALIDO','A tentativa ou a revisão mudou.',409);
    const documental=await criarLeituraEstadoDocumentalPgdas(tx)(entrada);
    const evidencia=documental.consulta;
    if(entrada.resultado==='DOCUMENTACAO_LOCALIZADA_SEM_CAUSALIDADE'
      && (!evidencia?.confirmada || evidencia.numeroDeclaracao!==entrada.numeroDeclaracao))
      throw erroFs12('FS12_EVIDENCIA_AUSENTE','Recupere a evidência oficial antes de registrar a análise.',409);
    const dados={versao:1,portalClientId:comando.portalClientId,companyId:comando.companyId,competencia:comando.competencia,
      comandoId:comando.id,tentativaId:comando.tentativaId,revisaoFs12:comando.revisaoFs12,autorId:entrada.autorId,
      motivo:entrada.motivo.trim(),resultado:entrada.resultado,evidencia:evidencia?{servico:evidencia.servico,
        numeroDeclaracao:evidencia.numeroDeclaracao,consultadoEm:evidencia.consultadoEm,atorId:evidencia.atorId}:null,
      estadoObservado:observado.estado,origemDeclaracao:'DESCONHECIDA',autorizaReenvio:false};
    const key='fs12_intervencao:'+hashCalculo([entrada.portalClientId,entrada.competencia,entrada.chaveIdempotencia]);
    const prior=await tx.appSetting.findUnique({where:{key}});
    if(prior){if(prior.value.hash!==hashCalculo(dados)) throw erroFs12('FS12_INTERVENCAO_CONFLITO','Chave já utilizada em outra análise.',409);return {ok:true,registro:prior.value,replay:true};}
    const value={...dados,hash:hashCalculo(dados),registradoEm:new Date().toISOString()};
    await tx.appSetting.create({data:{key,value}});
    return {ok:true,registro:value,replay:false};
  });
}






