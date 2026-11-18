import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { connect, fixture, calculation, commandData, reserve, marker, reservationData, responseData, associationData, uid } from './helpers.mjs';

async function withClients(run) {
  const sql=await connect(); // Same strict disposable destination guard as the SQL suite.
  const prisma=new PrismaClient({datasources:{db:{url:process.env.ALTAN_FS12_DDL_DATABASE_URL}}});
  try { await run(sql,prisma); } finally { await prisma.$disconnect(); await sql.end(); }
}
function prismaCommand(data) {
  const {intencao_congelada,...rest}=data;
  return {...rest,intencaoCongelada:intencao_congelada};
}
async function graph(sql,prisma,f) {
  const calc=await calculation(sql,f);
  const c=await prisma.fs12Comando.create({data:prismaCommand(commandData(f))});
  const r=await reserve(sql,c);
  await prisma.fs12ComandoReserva.create({data:reservationData(c,r)});
  const m=await marker(sql,c,r);
  const response=await prisma.fs12ComandoResposta.create({data:responseData(c,r,m)});
  await prisma.fs12ComandoCalculo.create({data:associationData(f,c,response,calc)});
  return {c,r,m,response,calc};
}

test('generated Prisma models create and read the complete scoped chain',()=>withClients(async(sql,prisma)=>{
  const f=await fixture(sql), q=await graph(sql,prisma,f);
  const loaded=await prisma.fs12Comando.findUnique({where:{id:q.c.id},include:{
    revisao:true,autor:true,reserva:{include:{reserva:true,respostas:{include:{marcador:true}}}},
    associacoes:{include:{vinculo:true,resposta:true}},
  }});
  assert.equal(loaded.revisao.id,f.revisaoId);
  assert.equal(loaded.autor.id,f.autorId);
  assert.equal(loaded.reserva.reserva.id,q.r.id);
  assert.equal(loaded.reserva.respostas[0].marcador.key,q.m.key);
  assert.equal(loaded.associacoes[0].vinculo.id,q.calc.id);
  assert.equal(loaded.associacoes[0].resposta.id,q.response.id);
  assert.deepEqual(loaded.intencaoCongelada,{synthetic:true});
  assert.equal(loaded.companyId,f.companyId);
  assert.equal(loaded.competencia,f.competencia);
}));

test('Prisma preserves idempotency and response replay uniqueness',()=>withClients(async(sql,prisma)=>{
  const f=await fixture(sql),q=await graph(sql,prisma,f);
  await assert.rejects(prisma.fs12Comando.create({data:prismaCommand(commandData(f,{chaveIdempotencia:q.c.chaveIdempotencia}))}),e=>e.code==='P2002');
  await assert.rejects(prisma.fs12ComandoResposta.create({data:responseData(q.c,q.r,q.m)}),e=>e.code==='P2002');
  assert.equal(await prisma.fs12Comando.count({where:{portalClientId:f.portalClientId}}),1);
  assert.equal(await prisma.fs12ComandoResposta.count({where:{comandoId:q.c.id}}),1);
}));

test('Prisma cannot mutate or remove the four historical facts',()=>withClients(async(sql,prisma)=>{
  const f=await fixture(sql),q=await graph(sql,prisma,f);
  for(const [model,where,data] of [
    ['fs12Comando',{id:q.c.id},{origem:'CHANGED'}],
    ['fs12ComandoReserva',{comandoId:q.c.id},{assinatura:'d'.repeat(64)}],
    ['fs12ComandoResposta',{id:q.response.id},{httpStatus:500}],
    ['fs12ComandoCalculo',{comandoId:q.c.id},{autorId:f.autorId}],
  ]) {
    await assert.rejects(prisma[model].update({where,data}),e=>String(e.message).includes('23514'));
    await assert.rejects(prisma[model].delete({where}),e=>String(e.message).includes('23514'));
    assert.ok(await prisma[model].findUnique({where}));
  }
}));

test('Prisma rollback removes only the candidate command, preserving existing FS12',()=>withClients(async(sql,prisma)=>{
  const f=await fixture(sql), data=prismaCommand(commandData(f));
  const rollback=Error('synthetic rollback');
  await assert.rejects(prisma.$transaction(async tx=>{
    await tx.fs12Comando.create({data});
    assert.ok(await tx.fs12Comando.findUnique({where:{id:data.id}}));
    throw rollback;
  },{isolationLevel:'Serializable'}),e=>e===rollback);
  assert.equal(await prisma.fs12Comando.findUnique({where:{id:data.id}}),null);
  assert.ok(await prisma.apuracaoFs12Revisao.findUnique({where:{id:f.revisaoId}}));
}));

test('Prisma cannot attach a declaration to another company calculation',()=>withClients(async(sql,prisma)=>{
  const f=await fixture(sql),g=await fixture(sql),foreign=await calculation(sql,g);
  await assert.rejects(prisma.fs12Comando.create({data:prismaCommand(commandData(f,{intencao:'TRANSMITIR',vinculoOrigemId:foreign.id}))}),e=>e.code==='P2003');
  await assert.rejects(prisma.fs12Comando.create({data:prismaCommand(commandData(f,{intencao:'TRANSMITIR',vinculoOrigemId:uid()}))}),e=>e.code==='P2003');
  assert.equal(await prisma.fs12Comando.count({where:{portalClientId:f.portalClientId}}),0);
}));
