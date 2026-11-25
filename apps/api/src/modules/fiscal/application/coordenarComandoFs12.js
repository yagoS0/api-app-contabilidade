import { erroFs12, validarIdentidadeFs12 } from '../domain/serieManualFs12.js';
import { prepararFs12ParaNovoCalculo } from './vincularFs12AoCalculo.js';
const mensagens={
 FS12_COMANDO_REVISAO_OBSOLETA:'A folha, a receita ou o cadastro mudou desde o preparo. Recarregue a apuração e confira a nova revisão.',
 FS12_COMANDO_VINCULO_INVALIDO:'Não há cálculo conferido correspondente a esta revisão. Calcule e confira antes de transmitir.',
 FS12_COMANDO_REPLAY_CONFLITANTE:'Esta confirmação já foi usada com outros dados. Reabra a apuração sem repetir a tentativa anterior.',
 FS12_PREPARO_INDISPONIVEL:'Não foi possível preparar os dados fiscais com segurança. Confira os dados pendentes antes de calcular.',
 FS12_COMANDO_JA_DESPACHADO:'Esta tentativa já foi autorizada para envio. Confira seu resultado antes de solicitar outra.',
 FS12_RESERVA_CONFLITANTE:'A reserva não corresponde ao comando atual. Confira a tentativa em andamento.',
 FS12_COMANDO_INEXISTENTE:'O comando fiscal não está disponível neste contexto. Reabra a apuração.',
 FS12_COMANDO_INVALIDO:'Dados de confirmação inválidos. Reabra a apuração e confirme a revisão exibida.',
 FS12_COMANDO_IDENTIDADE_INVALIDA:'Não foi possível identificar esta tentativa. Reabra a apuração antes de continuar.'
};
const fail = code => { throw erroFs12(code,mensagens[code]||'Não foi possível validar o comando fiscal. Reabra a apuração.',409); };
const same = (p,a,b) => p.hash(a) === p.hash(b);
const copy = value => JSON.parse(JSON.stringify(value));
const identity = c => ({ autorId:c.autorId, portalClientId:c.portalClientId, competencia:c.competencia });
async function conferir(entrada,p) {
  await p.autorizar(entrada);
  const prova = await prepararFs12ParaNovoCalculo(entrada,{ transacionar:fn=>fn(p) });
  if (prova.revisaoFs12 !== entrada.revisaoEsperada || prova.contextoHash !== entrada.contextoHash) fail('FS12_COMANDO_REVISAO_OBSOLETA');
  let vinculo=null;
  if (entrada.intencao !== 'SIMULAR') {
    vinculo=await p.validarVinculoOrigem({...entrada,companyId:prova.companyId,prova});
    if (!vinculo || vinculo.revisaoFs12 !== prova.revisaoFs12 || vinculo.contextoHash !== prova.contextoHash) fail('FS12_COMANDO_VINCULO_INVALIDO');
  } else if (entrada.calculoId) fail('FS12_COMANDO_VINCULO_INVALIDO');
  // Trusted composition prepares bytes from server state. No browser envelope.
  const preparo=await p.prepararNoServidor({...entrada,prova,vinculo});
  if (!preparo || preparo.companyId!==prova.companyId || !/^[0-9]{14}$/.test(preparo.cnpj)
    || !/^[a-f0-9]{64}$/.test(preparo.envelopeHash||'') || !/^[a-f0-9]{64}$/.test(preparo.preparoHash||'')) fail('FS12_PREPARO_INDISPONIVEL');
  return {prova,vinculo,preparo};
}
function validar(entrada) {
  validarIdentidadeFs12(entrada);
  if (!['SIMULAR','TRANSMITIR','RETIFICAR'].includes(entrada.intencao)
    || !/^[a-zA-Z0-9_-]{16,100}$/.test(entrada.chaveIdempotencia||'')
    || !Number.isInteger(entrada.revisaoEsperada) || entrada.revisaoEsperada<1
    || !/^[a-f0-9]{64}$/.test(entrada.contextoHash||'')) fail('FS12_COMANDO_INVALIDO');
}
// T1 only. transacionar must acquire coordination BEFORE any domain/ACL read.
// No ledger/reservation, snapshot mutation or fiscal authorization is created.
export async function prepararComandoFs12(entrada,{transacionar}) {
  validar(entrada);
  return transacionar(entrada,async p=>{
    const {prova,vinculo,preparo}=await conferir(entrada,p);
    const congelado={...identity(entrada),companyId:prova.companyId,cnpj:preparo.cnpj,
      intencao:entrada.intencao,revisaoEsperada:prova.revisaoFs12,contextoHash:prova.contextoHash,
      calculoId:entrada.calculoId||null,vinculoOrigemId:vinculo?.id||null,
      serieHash:p.hash(prova.serie),politicaVersao:prova.politicaVersao,
      envelopeHash:preparo.envelopeHash,preparoHash:preparo.preparoHash,origem:preparo.origem};
    const comandoHash=p.hash(congelado);
    const prior=await p.lerPorChave(entrada);
    if (prior) {
      if (prior.comandoHash!==comandoHash || !same(p,prior.intencaoCongelada,congelado)) fail('FS12_COMANDO_REPLAY_CONFLITANTE');
      return {comando:prior,replay:true,autorizaEfeitoFiscal:false};
    }
    await p.exigirEscopoSemTentativaPendente(entrada);
    const ids=await p.alocarIdentidades();
    if (!ids || ['comandoId','tentativaId','respostaId','custodianteId','capacidadeId'].some(k=>typeof ids[k]!=='string'||!ids[k].trim()||ids[k].length>200)) fail('FS12_COMANDO_IDENTIDADE_INVALIDA');
    const data={id:ids.comandoId,tentativaId:ids.tentativaId,...identity(entrada),
      companyId:prova.companyId,cnpj:preparo.cnpj,intencao:entrada.intencao,
      revisaoFs12:prova.revisaoFs12,vinculoOrigemId:vinculo?.id||null,
      serieHash:congelado.serieHash,contextoHash:prova.contextoHash,politicaVersao:prova.politicaVersao,
      chaveIdempotencia:entrada.chaveIdempotencia,comandoHash,hashVersao:'FS12_COMANDO_V1',
      intencaoCongelada:copy(congelado),esperado:{envelopeHash:preparo.envelopeHash,preparoHash:preparo.preparoHash,preparacao:copy(preparo.provaPreparacao),
        custodia:{respostaId:ids.respostaId,custodianteId:ids.custodianteId,capacidadeId:ids.capacidadeId}},
      origem:preparo.origem};
    return {comando:await p.inserirComando(data),replay:false,autorizaEfeitoFiscal:false};
  });
}
async function revalidar(comando,p) {
  const entrada={...comando.intencaoCongelada,chaveIdempotencia:comando.chaveIdempotencia,comandoId:comando.id,preparacaoOriginal:comando.esperado.preparacao};
  const current=await conferir(entrada,p);
  if (p.hash(comando.esperado.preparacao)!==comando.esperado.preparoHash || current.prova.companyId!==comando.companyId || current.preparo.cnpj!==comando.cnpj
    || current.preparo.envelopeHash!==comando.esperado.envelopeHash
    || current.preparo.preparoHash!==comando.esperado.preparoHash
    || p.hash(current.prova.serie)!==comando.serieHash
    || (current.vinculo?.id||null)!==comando.vinculoOrigemId
    || p.hash(comando.intencaoCongelada)!==comando.comandoHash) fail('FS12_COMANDO_REVISAO_OBSOLETA');
  return current;
}
// Invoked WITHIN guard transaction after global/company-policy locks; ports
// already acquire FS12 coordination before supplying command/ACL/context reads.
export async function associarReservaComandoFs12({comandoId,reservaId},p) {
  const comando=await p.lerComando(comandoId);
  if (!comando) fail('FS12_COMANDO_INEXISTENTE');
  const {preparo}=await revalidar(comando,p);
  await p.exigirEscopoSemTentativaPendente({...identity(comando),comandoId:comando.id,calculoId:comando.intencaoCongelada.calculoId,excluirReservaId:reservaId});
  const reserva=await p.validarReservaExistente({comando,reservaId});
  if (await p.lerMarcador(reservaId)) fail('FS12_COMANDO_JA_DESPACHADO');
  const prior=await p.lerAssociacao(comandoId);
  if (prior) {
    if (prior.reservaId!==reservaId || prior.envelopeHash!==preparo.envelopeHash
      || prior.assinatura!==reserva.assinatura) fail('FS12_RESERVA_CONFLITANTE');
    await p.conferirEnvelopeAssociado(prior,comando,preparo);
    return {associacao:prior,replay:true,autorizaEfeitoFiscal:false};
  }
  const envelopeCifrado=await p.cifrarEnvelope({comando,reserva,preparo});
  return {associacao:await p.inserirAssociacao({comandoId,reservaId,assinatura:reserva.assinatura,
    envelopeCifrado,envelopeHash:preparo.envelopeHash,rota:'/Declarar',idSistema:'PGDASD',idServico:'TRANSDECLARACAO11'}),
    replay:false,autorizaEfeitoFiscal:false};
}
export async function conferirComandoAntesMarcadorFs12({comandoId,reservaId},p) {
  const comando=await p.lerComando(comandoId);
  if (!comando) fail('FS12_COMANDO_INEXISTENTE');
  const {preparo}=await revalidar(comando,p);
  await p.exigirEscopoSemTentativaPendente({...identity(comando),comandoId:comando.id,calculoId:comando.intencaoCongelada.calculoId,excluirReservaId:reservaId});
  await p.validarReservaExistente({comando,reservaId});
  const assoc=await p.lerAssociacao(comandoId);
  if (!assoc || assoc.reservaId!==reservaId || assoc.envelopeHash!==preparo.envelopeHash
    || await p.lerMarcador(reservaId)) fail('FS12_RESERVA_CONFLITANTE');
  await p.conferirEnvelopeAssociado(assoc,comando,preparo);
  return {comandoId,reservaId,verificado:true,autorizaEfeitoFiscal:false};
}
