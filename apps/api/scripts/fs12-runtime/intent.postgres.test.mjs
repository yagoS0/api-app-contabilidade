import test from 'node:test';
import assert from 'node:assert/strict';
import {clients,seed,runtime} from './fixture.mjs';
test('ordinary recovery and original-key replay never cancel; explicit confirmed command does',{timeout:60000},async()=>{
  const {db,sql,close}=await clients();
  try{
    const f=await seed(db,sql,{phase:'T1'}),r=runtime(db,f.key);
    const entrada={...f.identidade,comandoId:f.c.id};
    const read=await r.recuperar(entrada);
    assert.equal(read.estado,'DESCONHECIDA');assert.equal(read.encerradaSemDespacho,undefined);
    assert.equal(await db.appSetting.count({where:{key:'fs12_comando_sem_despacho:'+f.c.id}}),0);
    await assert.rejects(r.buscarReplay({...entrada,chaveIdempotencia:f.c.chaveIdempotencia,intencao:'SIMULAR',pedidoHash:undefined}),{code:'FS12_TENTATIVA_PENDENTE'});
    assert.equal(await db.appSetting.count({where:{key:'fs12_comando_sem_despacho:'+f.c.id}}),0);
    assert.equal((await r.recuperar({...entrada,encerrarSemDespacho:'true'})).encerradaSemDespacho,undefined);
    assert.equal((await r.recuperar({...entrada,encerrarSemDespacho:true})).encerradaSemDespacho,true);
    assert.equal(await db.fs12ComandoReserva.count({where:{comandoId:f.c.id}}),0);
  }finally{await close();}
});
test('authenticated official rejection preserves messages and response identity without B33',{timeout:60000},async()=>{
  const {db,sql,close}=await clients();
  try{
    const mensagens=[{codigo:'[EntradaIncorreta-PGDASD-MSG_ISN_029]',texto:'Paráfrase sintética: informe a folha mensal exigida, inclusive o valor reenviado.'}];
    const f=await seed(db,sql,{httpStatus:400,response:{status:400,mensagens}});
    const result=await runtime(db,f.key).recuperar({...f.identidade,comandoId:f.c.id});
    assert.equal(result.ok,false);assert.equal(result.estado,'REJEITADA');assert.equal(result.confirmada,false);
    assert.deepEqual(result.mensagens,mensagens);assert.equal(result.code,'SERPRO_BUSINESS_ERROR');
    assert.equal(result.respostaId,f.respostaId);assert.equal(result.comandoId,f.c.id);assert.equal(result.tentativaId,f.c.tentativaId);
    assert.equal(result.portalClientId,f.identidade.portalClientId);assert.equal(result.competencia,'2026-11');assert.equal(result.revisaoFs12,1);
    assert.equal(await db.fs12ComandoCalculo.count({where:{comandoId:f.c.id}}),0);
    assert.equal(await db.fs12ComandoResposta.count({where:{id:f.respostaId}}),1);
  }finally{await close();}
});
