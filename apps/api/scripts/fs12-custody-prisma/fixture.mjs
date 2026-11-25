import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { fixture, command, reserve, marker, insert, reservationData } from '../fs12-b33b1-ddl/helpers.mjs';
import { criarCifraFs12, hashBytes, hashContexto } from '../../src/modules/fiscal/infrastructure/custody/cifraRespostaFs12.js';
import { criarCustodiaRespostaFs12Prisma, hashMarcadorCustodiaFs12 } from '../../src/modules/fiscal/infrastructure/prisma/custodiaRespostaFs12.js';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
export function testUrl() {
  const raw = process.env.ALTAN_FS12_CUSTODY_TEST_URL;
  if (!raw || process.env.NODE_ENV !== 'test') throw Error('Explicit disposable custody test URL and NODE_ENV=test required');
  const u = new URL(raw);
  if (!['postgres:','postgresql:'].includes(u.protocol) || u.hostname !== '127.0.0.1'
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(u.pathname) || u.search || u.hash)
    throw Error('Only provisioned exclusive loopback governance database permitted');
  return raw;
}
export async function clients() {
  const url = testUrl();
  const sql = new Client({ connectionString:url }); await sql.connect();
  const version = (await sql.query("SELECT current_setting('server_version_num')::int AS v")).rows[0].v;
  if (version < 160000 || version >= 170000) { await sql.end(); throw Error('PostgreSQL16 required'); }
  const db = new PrismaClient({ datasources:{ db:{ url } } });
  return { sql,db, close:async()=>{ await db.$disconnect(); await sql.end(); } };
}
export function adapter(db,key) {
  const cifra = criarCifraFs12({ resolveKey:async id => id === 'synthetic-history' ? key : null });
  return { cifra, custody:criarCustodiaRespostaFs12Prisma({ db,cifra,custodianteId:'synthetic-custodian',capacidadeId:'synthetic-capability' }) };
}
export async function seed(sql,db) {
  const f=await fixture(sql), key=randomBytes(32);
  const c=await command(sql,f,{ esperado:{ custodia:{ respostaId:randomUUID(),custodianteId:'synthetic-custodian',capacidadeId:'synthetic-capability' } } });
  const r=await reserve(sql,c);
  await insert(sql,'fs12_comando_reservas',reservationData(c,r));
  const m=await marker(sql,c,r);
  const { cifra,custody }=adapter(db,key);
  const hints={stageId:hashBytes(Buffer.from(c.esperado.custodia.respostaId)),respostaId:c.esperado.custodia.respostaId,comandoId:c.id,tentativaId:c.tentativaId,reservaId:r.id};
  const origin=await custody.resolveOrigin(hints);
  const corpo=Buffer.from([0,255,42,10]);
  const contexto={...origin,corpoHash:hashBytes(corpo),httpStatus:200,recebidoEm:'2026-11-25T12:00:00.000Z'};
  const envelope=await cifra.cifrar({corpo,contexto,keyId:'synthetic-history'});
  return { f,c,r,m,key,hints,cifra,custody,input:{id:hints.stageId,contexto,corpo,envelope,contextHash:hashContexto(contexto)} };
}
export { hashBytes,hashContexto,hashMarcadorCustodiaFs12,insert,randomUUID };
