import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {criarPersistenciaFs12} from '../../src/modules/fiscal/infrastructure/prisma/fs12DaApuracao.js';
import {criarPersistenciaComandoFs12} from '../../src/modules/fiscal/infrastructure/prisma/comandoFs12.js';
import {criarCifraEnvelopeFs12} from '../../src/modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
import {consultarFs12DaApuracao} from '../../src/modules/fiscal/application/consultarFs12DaApuracao.js';
import {confirmarFs12DaApuracao} from '../../src/modules/fiscal/application/confirmarFs12DaApuracao.js';
import {prepararComandoFs12} from '../../src/modules/fiscal/application/coordenarComandoFs12.js';
import {criarContextoComandoFs12,comComandoFs12} from '../../src/modules/fiscal/publicComandosFs12.js';
import {autorizarChamada,autorizarDespacho,identificarChamada} from '../../src/application/fiscal/serpro/SerproCallGuard.js';
import {validarCalculoConfirmado} from '../../src/application/notas/apuracao/v2/CalculoConfirmado.js';
async function fixture(t,{cipherFails=false}={}){
  const url=process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL,p=new URL(url);
  if(process.env.NODE_ENV!=='test'||url!==process.env.DATABASE_URL||p.hostname!=='127.0.0.1'
    ||!['postgres:','postgresql:'].includes(p.protocol)||!p.pathname.endsWith('_governance_test')||p.search||p.hash)throw Error('ISOLATED_PG_REQUIRED');
  const db=new PrismaClient({datasources:{db:{url}}});await db.$connect();t.after(()=>db.$disconnect());
  const [{version}]=await db.$queryRaw`SELECT current_setting('server_version_num')::int AS version`;
  assert.ok(version>=160000&&version<170000);
  const uuid=randomUUID(),cnpj=(BigInt('0x'+randomBytes(7).toString('hex'))%100000000000000n).toString().padStart(14,'0');
  const client=await db.client.create({data:{name:'SYNTHETIC FS12 TRANSPORT',login:uuid,email:uuid+'@example.test',passwordHash:'not-login'}});
  const company=await db.company.create({data:{clientId:client.id,razaoSocial:'SYNTHETIC FS12 TRANSPORT',cnpj,atividades:[],dataAbertura:new Date('2026-11-01T00:00:00Z')}});
  const portal=await db.portalClient.create({data:{companyId:company.id,razao:'SYNTHETIC FS12 TRANSPORT',cnpj}});
  const user=await db.user.create({data:{name:'Synthetic actor',email:randomUUID()+'@example.test',passwordHash:'not-login',role:'contador',accountType:'FIRM',status:'active'}});
  await db.companyFirmAccess.create({data:{companyId:portal.id,userId:user.id,role:'ACCOUNTANT',status:'ACTIVE'}});
  await db.regimeHistorico.create({data:{companyId:company.id,regime:'SIMPLES',vigenciaInicio:new Date('2026-11-01T00:00:00Z')}});
  const entrada={portalClientId:portal.id,competencia:'2026-11',autorId:user.id};
  const b31=criarPersistenciaFs12(db),context=await consultarFs12DaApuracao(entrada,b31);
  const revision=(await confirmarFs12DaApuracao({...entrada,revisaoEsperada:0,chaveIdempotencia:randomUUID(),
    contextoRevisao:context.contextoRevisao,serie:[{mes:'2026-11',valorCentavos:0}]},b31)).confirmacao;
  const revenueKey='synthetic_fs12_revenue:'+uuid;
  await db.appSetting.create({data:{key:revenueKey,value:{revision:1}}});
  const payload={contratante:{numero:'00000000000000',tipo:2},autorPedidoDados:{numero:'00000000000000',tipo:2},
    contribuinte:{numero:cnpj,tipo:2},pedidoDados:{idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',versaoSistema:'1.0',
      dados:JSON.stringify({cnpjCompleto:cnpj,pa:'202611',indicadorTransmissao:false,declaracao:{tipoDeclaracao:1}})}};
  const key=randomBytes(32),cipher=criarCifraEnvelopeFs12({keyId:'synthetic',resolveKey:async()=>key});
  const persistence=criarPersistenciaComandoFs12({db,validarSnapshot:validarCalculoConfirmado,identificarEnvelope:identificarChamada,
    prepararNoServidor:async(_e,tx)=>({companyId:company.id,cnpj,envelope:Buffer.from(JSON.stringify(payload)),origem:'SYNTHETIC_FS12',
      provaPreparacao:{syntheticRevenue:(await tx.appSetting.findUnique({where:{key:revenueKey}})).value}}),
    alocarIdentidades:async()=>({comandoId:randomUUID(),tentativaId:randomUUID(),respostaId:randomUUID(),custodianteId:'synthetic',capacidadeId:'synthetic'}),
    cifraEnvelope:cipherFails?{...cipher,cifrar:async()=>{throw Object.assign(Error('synthetic crypto failure'),{code:'FS12_TEST_FAILURE'});}}:cipher});
  const command=(await prepararComandoFs12({...entrada,intencao:'SIMULAR',chaveIdempotencia:randomUUID(),
    revisaoEsperada:1,contextoHash:revision.contextoRevisao},persistence)).comando;
  const cap=criarContextoComandoFs12({comando:command,envelopeBytes:Buffer.from(JSON.stringify(payload)),persistencia:persistence,
    observarResposta:async()=>{throw Error('NO_HTTP_OBSERVATION_PERMITTED');}});
  return {db,portal,user,entrada,b31,revision,command,cap,payload,revenueKey};
}
test('PG real T1 e reserva+associacao atomicas, T2 cria marcador sem HTTP nem B32 ficticio',async t=>{
  const f=await fixture(t);
  await comComandoFs12(f.cap,async()=>{
    const a=await autorizarChamada({payload:f.payload,rota:'/Declarar'},f.db);
    const assoc=await f.db.fs12ComandoReserva.findUnique({where:{comandoId:f.command.id}});
    assert.equal(assoc.reservaId,a.id);
    assert.equal((await f.db.serproChamada.findUnique({where:{id:a.id}})).competencia,'2026-11');
    await autorizarDespacho(a,f.db);
    assert.ok(await f.db.appSetting.findUnique({where:{key:'serpro_dispatch:'+a.id}}));
    assert.equal(await f.db.apuracaoFs12Calculo.count({where:{portalClientId:f.portal.id}}),0);
  });
});
test('PG real falha associacao reverte reserva criada na mesma TX',async t=>{
  const f=await fixture(t,{cipherFails:true});
  await assert.rejects(comComandoFs12(f.cap,()=>autorizarChamada({payload:f.payload,rota:'/Declarar'},f.db)),{code:'FS12_TEST_FAILURE'});
  assert.equal(await f.db.serproChamada.count({where:{acaoId:f.command.id}}),0);
  assert.equal(await f.db.fs12ComandoReserva.count({where:{comandoId:f.command.id}}),0);
});
test('PG real ACL revogada entre reserva e T2 aborta antes do marcador',async t=>{
  const f=await fixture(t);
  await comComandoFs12(f.cap,async()=>{
    const a=await autorizarChamada({payload:f.payload,rota:'/Declarar'},f.db);
    await f.db.user.update({where:{id:f.user.id},data:{status:'inactive'}});
    await assert.rejects(autorizarDespacho(a,f.db),{code:'FS12_ACESSO_NEGADO'});
    assert.equal(await f.db.appSetting.findUnique({where:{key:'serpro_dispatch:'+a.id}}),null);
    assert.equal((await f.db.serproChamada.findUnique({where:{id:a.id}})).status,'abortada_politica');
  });
});
test('PG real B31 nova revisao entre reserva/T2 invalida comando anterior',async t=>{
  const f=await fixture(t);
  await comComandoFs12(f.cap,async()=>{
    const a=await autorizarChamada({payload:f.payload,rota:'/Declarar'},f.db);
    await confirmarFs12DaApuracao({...f.entrada,revisaoEsperada:1,chaveIdempotencia:randomUUID(),motivo:'synthetic correction',
      contextoRevisao:f.revision.contextoRevisao,serie:[{mes:'2026-11',valorCentavos:1}]},f.b31);
    await assert.rejects(autorizarDespacho(a,f.db),{code:'FS12_COMANDO_REVISAO_OBSOLETA'});
    assert.equal(await f.db.appSetting.findUnique({where:{key:'serpro_dispatch:'+a.id}}),null);
  });
});
test('PG real alteracao da porta de receita/preparo entre reserva/T2 nao promove revisao antiga',async t=>{
  const f=await fixture(t);
  await comComandoFs12(f.cap,async()=>{
    const a=await autorizarChamada({payload:f.payload,rota:'/Declarar'},f.db);
    await f.db.appSetting.update({where:{key:f.revenueKey},data:{value:{revision:2}}});
    await assert.rejects(autorizarDespacho(a,f.db),{code:'FS12_COMANDO_REVISAO_OBSOLETA'});
    assert.equal(await f.db.appSetting.findUnique({where:{key:'serpro_dispatch:'+a.id}}),null);
  });
});

// This fixture writes the technical tombstone directly to isolate guard consumption.
// The production closure transaction/race belongs to runtime's separate tests.
for (const phase of ['before-association', 'before-T2']) {
  test(`PG real technical closure prevents delayed command at ${phase}`, async t => {
    const f = await fixture(t);
    await comComandoFs12(f.cap, async () => {
      const reservation = phase === 'before-T2'
        ? await autorizarChamada({ payload: f.payload, rota: '/Declarar' }, f.db) : null;
      await f.db.appSetting.create({ data: {
        key: 'fs12_comando_sem_despacho:' + f.command.id,
        value: { versao: 1, evento: 'COMANDO_ENCERRADO_ANTES_DESPACHO', comandoId: f.command.id,
          tentativaId: f.command.tentativaId, ...f.entrada, companyId: f.command.companyId,
          encerradoEm: new Date().toISOString(), motivo: 'CONFERENCIA_EXPLICITA_SEM_MARCADOR',
          reservaId: reservation?.id || null },
      } });
      await assert.rejects(reservation ? autorizarDespacho(reservation, f.db)
        : autorizarChamada({ payload: f.payload, rota: '/Declarar' }, f.db),
        { code: 'FS12_COMANDO_ENCERRADO_SEM_DESPACHO' });
      if (reservation) {
        assert.equal(await f.db.appSetting.findUnique({ where: { key: 'serpro_dispatch:' + reservation.id } }), null);
        assert.equal((await f.db.serproChamada.findUnique({ where: { id: reservation.id } })).status, 'abortada_politica');
      } else {
        assert.equal(await f.db.serproChamada.count({ where: { acaoId: f.command.id } }), 0);
        assert.equal(await f.db.fs12ComandoReserva.count({ where: { comandoId: f.command.id } }), 0);
      }
    });
  });
}