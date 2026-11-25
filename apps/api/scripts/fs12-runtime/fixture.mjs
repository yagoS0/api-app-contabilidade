import {criarCifraEnvelopeFs12} from '../../src/modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
import {envelopeDeclaracaoFs12,validarEnvelopeCongeladoFs12,criarRuntimeFiscalFs12} from '../../src/composition/criarRuntimeFiscalFs12.js';
import {randomUUID,randomBytes} from 'node:crypto';
import {clients,adapter,hashBytes,hashContexto} from '../fs12-custody-prisma/fixture.mjs';
import {command,reserve,marker,insert,reservationData} from '../fs12-b33b1-ddl/helpers.mjs';
import {criarPersistenciaFs12} from '../../src/modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import {consultarFs12DaApuracao,confirmarFs12DaApuracao} from '../../src/modules/fiscal/publicFs12.js';
import {criarAplicacaoRespostaFs12} from '../../src/modules/fiscal/infrastructure/prisma/aplicacaoRespostaFs12.js';
import {hashCalculo,validarCalculoConfirmado} from '../../src/application/notas/apuracao/v2/CalculoConfirmado.js';
import {contextoOrigemCalculo} from '../../src/application/notas/apuracao/v2/RecuperacaoCalculo.js';
import {parseRetornoSimulacao} from '../../src/application/fiscal/serpro/PgdasSimulacaoService.js';
export {clients};
export const application=(db,key)=>{
  const {cifra,custody}=adapter(db,key);
  const cifraEnvelope=criarCifraEnvelopeFs12({keyId:'synthetic-history',resolveKey:async id=>id==='synthetic-history'?key:null});
  return criarAplicacaoRespostaFs12({db,custodia:custody,cifra,hash:hashCalculo,validarSnapshot:validarCalculoConfirmado,
    validarEnvelope:(comando,reserva)=>validarEnvelopeCongeladoFs12({comando,reserva,cifraEnvelope}),
    lerContextoOrigem:contextoOrigemCalculo,parseRetorno:parseRetornoSimulacao});
};
export async function seed(db,sql,{phase='RESPONSE',response=null,httpStatus=200}={}) {
  const id=randomUUID(),cnpj=(BigInt('0x'+randomBytes(7).toString('hex'))%100000000000000n).toString().padStart(14,'0');
  const client=await db.client.create({data:{name:'SYNTHETIC T3B',login:id,email:id+'@example.test',passwordHash:'not-a-login'}});
  const company=await db.company.create({data:{clientId:client.id,cnpj,razaoSocial:'SYNTHETIC T3B',atividades:[],dataAbertura:new Date('2026-11-01T00:00:00Z')}});
  const portal=await db.portalClient.create({data:{companyId:company.id,razao:'SYNTHETIC T3B',cnpj}});
  const user=await db.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'not-a-login',role:'contador',accountType:'FIRM',status:'active'}});
  await db.companyFirmAccess.create({data:{companyId:portal.id,userId:user.id,role:'ACCOUNTANT',status:'ACTIVE'}});
  await db.regimeHistorico.create({data:{companyId:company.id,regime:'SIMPLES',vigenciaInicio:new Date('2026-11-01T00:00:00Z')}});
  const identidade={portalClientId:portal.id,competencia:'2026-11',autorId:user.id};
  const b31=criarPersistenciaFs12(db),consulta=await consultarFs12DaApuracao(identidade,b31);
  const revisao=(await confirmarFs12DaApuracao({...identidade,serie:[{mes:'2026-11',valorCentavos:0}],revisaoEsperada:0,
    contextoRevisao:consulta.contextoRevisao,chaveIdempotencia:randomUUID()},b31)).confirmacao;
  const fs12={revisaoId:revisao.id,revisao:1,contextoHash:revisao.contextoRevisao,politicaVersao:revisao.politicaVersao};
  const contextoOrigem=await contextoOrigemCalculo(identidade,db);
  const dados={...identidade,formulario:{atividades:[],folhaMensal12:[{pa:'2026-11',valor:0}],regimeApuracao:'COMPETENCIA'},
    receitasBrutasAnteriores:[],folhasSalario:[{pa:'2026-11',valor:0}],contextoOrigem,fs12};
  delete dados.autorId;
  const calculo={...dados,calculoId:`fech:v1:${randomUUID()}:${hashCalculo(dados)}`};
  const parametros={contratanteCnpj:cnpj,contribuinteCnpj:cnpj,competencia:'2026-11',atividades:[],folhasSalario:dados.folhasSalario,receitasBrutasAnteriores:[],permitirSemMovimento:true};
  const prep={versao:1,parametros,snapshotAnterior:null,contextoOrigem,fs12,calculoId:calculo.calculoId,calculoConfirmado:calculo,
    snapshotDados:{rbt12:0,rbt12Extrato:0,atividadesEscolhidas:[],folhaMensal12:dados.formulario.folhaMensal12,receitaInterna:0,receitaExterna:0,receitaPorTipo:{}}};
  const f={...identidade,companyId:company.id,cnpj,revisao:1,serieHash:revisao.serieHash,contextoHash:revisao.contextoRevisao,politicaVersao:revisao.politicaVersao};
  const respostaId=randomUUID(),key=randomBytes(32);
  const envelopeBytes=envelopeDeclaracaoFs12(parametros,'SIMULAR'),envelopeHash=hashBytes(envelopeBytes);
  const cifraEnvelope=criarCifraEnvelopeFs12({keyId:'synthetic-history',resolveKey:async id=>id==='synthetic-history'?key:null});
  const congelado={synthetic:true};
  const c=await command(sql,f,{intencao_congelada:congelado,comandoHash:hashCalculo(congelado),esperado:{envelopeHash,preparacao:prep,preparoHash:hashCalculo(prep),custodia:{respostaId,custodianteId:'synthetic-custodian',capacidadeId:'synthetic-capability'}}});
  if(phase==='T1') return {identidade,c,key,calculo,revisao,respostaId};
  const r=await reserve(sql,c);
  const envelopeCifrado=await cifraEnvelope.cifrar({bytes:envelopeBytes,comando:{...c,intencaoCongelada:congelado},reservaId:r.id});
  await insert(sql,'fs12_comando_reservas',reservationData(c,r,{envelopeHash,envelopeCifrado}));
  if(phase==='RESERVA') return {identidade,c,r,key,calculo,revisao,respostaId};
  await marker(sql,c,r);
  const {cifra,custody}=adapter(db,key);
  const origin=await custody.resolveOrigin({stageId:hashBytes(Buffer.from(respostaId)),respostaId,comandoId:c.id,tentativaId:c.tentativaId,reservaId:r.id});
  const corpo=Buffer.from(JSON.stringify(response||{status:200,dados:JSON.stringify({cnpjCompleto:cnpj,pa:202611,valoresDevidos:[{valor:0}]})}));
  const contexto={...origin,corpoHash:hashBytes(corpo),httpStatus,recebidoEm:'2026-11-25T12:00:00.000Z'};
  const envelope=await cifra.cifrar({corpo,contexto,keyId:'synthetic-history'});
  await custody.importDurably({id:hashBytes(Buffer.from(respostaId)),contexto,corpo,envelope,contextHash:hashContexto(contexto)});
  return {identidade,c,r,key,calculo,revisao,respostaId};
}

export function runtime(db,key) {
  const {cifra}=adapter(db,key);
  const cifraEnvelope=criarCifraEnvelopeFs12({keyId:'synthetic-history',resolveKey:async id=>id==='synthetic-history'?key:null});
  return criarRuntimeFiscalFs12({db,cifraResposta:cifra,cifraEnvelope,stageResposta:{recuperar:async()=>{throw Object.assign(Error('No staged response in this fixture'),{code:'ENOENT'});}},
    custodianteId:'synthetic-custodian',capacidadeId:'synthetic-capability',keyIdAtivo:'synthetic-history',
    identificarEnvelope:()=>{throw Error('NETWORK/DISPATCH FORBIDDEN IN RECOVERY TEST');}});
}

