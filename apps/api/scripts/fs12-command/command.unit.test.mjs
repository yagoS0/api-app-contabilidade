import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {prepararComandoFs12,associarReservaComandoFs12,conferirComandoAntesMarcadorFs12} from '../../src/modules/fiscal/application/coordenarComandoFs12.js';
import {validarSerieManualFs12} from '../../src/modules/fiscal/domain/serieManualFs12.js';
import {serializacaoFs12,transacaoCoordenadaFs12} from '../../src/modules/fiscal/infrastructure/prisma/coordenacaoFs12.js';
import {criarCifraEnvelopeFs12} from '../../src/modules/fiscal/infrastructure/custody/cifraEnvelopeFs12.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const hashBytes=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
  const ctx={empresaId:'company',competenciaApuracao:'2026-11',inicioAtividade:'2026-11',
    regimeDoPeriodo:{empresaId:'company',competencia:'2026-11',tipo:'SIMPLES_NACIONAL',referencia:'RegimeHistorico:synthetic'}};
  const serie=[{mes:'2026-11',valorCentavos:0}],{politica}=validarSerieManualFs12(ctx,serie);
  const revision={id:'revision',revisao:1,serie,serieHash:hash(serie),contextoRevisao:hash(ctx),politicaVersao:politica.versao};
  const entrada={autorId:'actor',portalClientId:'portal',competencia:'2026-11',intencao:'SIMULAR',
    chaveIdempotencia:'synthetic_key_000001',revisaoEsperada:1,contextoHash:hash(ctx)};
  const state={commands:new Map(),assoc:null,pending:false,allowed:true,marker:null,seq:[],revision};
  const p={hash,autorizar:async()=>{state.seq.push('acl');if(!state.allowed)throw Error('ACL_DENIED');},
    lerContexto:async()=>ctx,lerUltima:async()=>state.revision,
    prepararNoServidor:async()=>({companyId:'company',cnpj:'00000000000000',envelopeHash:'a'.repeat(64),preparoHash:hash({synthetic:true}),provaPreparacao:{synthetic:true},origem:'TEST_INTERNAL'}),
    validarVinculoOrigem:async()=>{throw Error('NO_CALCULATION');},
    lerPorChave:async e=>state.commands.get(e.chaveIdempotencia),
    exigirEscopoSemTentativaPendente:async()=>{if(state.pending)throw Error('UNKNOWN_ATTEMPT');},
    alocarIdentidades:async()=>({comandoId:'cmd'+state.commands.size,tentativaId:'attempt'+state.commands.size,
      respostaId:'response'+state.commands.size,custodianteId:'writer',capacidadeId:'capability'}),
    inserirComando:async c=>{state.commands.set(c.chaveIdempotencia,c);return c;},
    lerComando:async id=>[...state.commands.values()].find(c=>c.id===id),
    validarReservaExistente:async()=>({id:'reserve',assinatura:'c'.repeat(64)}),
    lerMarcador:async()=>state.marker,lerAssociacao:async()=>state.assoc,
    cifrarEnvelope:async()=>({synthetic:true}),inserirAssociacao:async a=>{state.assoc=a;return a;},
    conferirEnvelopeAssociado:async()=>{},
  };
  const persistence={transacionar:async(e,fn)=>{
    state.seq.push('coord');const before=new Map(state.commands);
    try{return await fn(p);}catch(error){state.commands=before;throw error;}
  }};
  return {entrada,state,p,persistence};
}
test('T1 congela SIMULAR sem B32, replay reautoriza e conflito nao cria comando',async()=>{
  const f=fixture(),first=await prepararComandoFs12(f.entrada,f.persistence);
  assert.equal(first.comando.vinculoOrigemId,null);
  assert.deepEqual(Object.keys(first.comando.esperado.custodia).sort(),['capacidadeId','custodianteId','respostaId']);
  assert.equal(first.autorizaEfeitoFiscal,false);
  assert.deepEqual(f.state.seq.slice(0,2),['coord','acl']);
  assert.equal((await prepararComandoFs12(f.entrada,f.persistence)).replay,true);
  f.state.allowed=false;
  await assert.rejects(prepararComandoFs12(f.entrada,f.persistence),/ACL_DENIED/);
  assert.equal(f.state.commands.size,1);
});
test('chave nova e revisao nova nao superam tentativa desconhecida do mesmo escopo',async()=>{
  const f=fixture();f.state.pending=true;
  await assert.rejects(prepararComandoFs12(f.entrada,f.persistence),/UNKNOWN_ATTEMPT/);
  f.state.revision={...f.state.revision,revisao:2};
  await assert.rejects(prepararComandoFs12({...f.entrada,revisaoEsperada:2,chaveIdempotencia:'another_key_000001'},f.persistence),/UNKNOWN_ATTEMPT/);
  assert.equal(f.state.commands.size,0);
});
test('mudanca FS12/ACL antes T2 recusa; marcador existente nunca vira novo despacho',async()=>{
  const f=fixture(),{comando}=await prepararComandoFs12(f.entrada,f.persistence);
  const args={comandoId:comando.id,reservaId:'reserve'};
  await associarReservaComandoFs12(args,f.p);
  assert.equal((await conferirComandoAntesMarcadorFs12(args,f.p)).autorizaEfeitoFiscal,false);
  f.state.revision={...f.state.revision,revisao:2};
  await assert.rejects(conferirComandoAntesMarcadorFs12(args,f.p),{code:'FS12_COMANDO_REVISAO_OBSOLETA'});
  f.state.revision.revisao=1;f.state.allowed=false;
  await assert.rejects(conferirComandoAntesMarcadorFs12(args,f.p),/ACL_DENIED/);
  f.state.allowed=true;f.state.marker={key:'serpro_dispatch:reserve'};
  await assert.rejects(conferirComandoAntesMarcadorFs12(args,f.p));
});
test('TRANSMITIR/RETIFICAR nao fabricam vinculo ou aceitam calculo ausente',async()=>{
  for(const intencao of ['TRANSMITIR','RETIFICAR']){
    const f=fixture();
    await assert.rejects(prepararComandoFs12({...f.entrada,intencao,calculoId:'missing'},f.persistence),/NO_CALCULATION/);
    assert.equal(f.state.commands.size,0);
  }
});
test('retry local reinicia transacao inteira somente P2034 e P2010 meta40001',async()=>{
  const f=fixture();let transactions=0,callbacks=0,coordinations=0;
  const db={$transaction:async fn=>{
    transactions++;
    return fn({$queryRaw:async()=>{coordinations++;return [{value:{v:1,revision:coordinations}}];}});
  }};
  const result=await transacaoCoordenadaFs12(db,f.entrada,async()=>{
    callbacks++;if(callbacks===1)throw Object.assign(Error('retry'),{code:'P2010',meta:{code:'40001'}});
    return 'done';
  });
  assert.equal(result,'done');assert.equal(transactions,2);assert.equal(coordinations,2);assert.equal(callbacks,2);
  assert.equal(serializacaoFs12({code:'P2010',meta:{code:'23514'}}),false);
  assert.equal(serializacaoFs12({code:'P2034'}),true);
});
test('ENVELOPE AAD independente da resposta, sem status/receivedAt ficticios; chave historica',async()=>{
  const key=randomBytes(32),bytes=Buffer.from('synthetic request');
  const c=criarCifraEnvelopeFs12({keyId:'old',resolveKey:async id=>id==='old'?key:null});
  const f=fixture(),{comando}=await prepararComandoFs12(f.entrada,f.persistence);
  comando.esperado.envelopeHash=hashBytes(bytes);
  const envelope=await c.cifrar({bytes,comando,reservaId:'r1'});
  assert.deepEqual(await c.decifrar({envelope,comando,reservaId:'r1'}),bytes);
  await assert.rejects(c.decifrar({envelope,comando,reservaId:'r2'}));
  await assert.rejects(c.decifrar({envelope,comando:{...comando,revisaoFs12:2},reservaId:'r1'}));
  assert.equal(Object.keys(envelope).length,7);
});
