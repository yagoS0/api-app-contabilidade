// Isolated SQL evidence harness only; not imported by application code.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require(process.env.ALTAN_FS12_DDL_PG_MODULE || 'pg');
export const uid = () => randomUUID();
export const hashA = 'a'.repeat(64);
export const hashB = 'b'.repeat(64);
export const hashC = 'c'.repeat(64);
export async function connect() {
  const raw = process.env.ALTAN_FS12_DDL_DATABASE_URL;
  if (!raw) throw Error('Explicit ALTAN_FS12_DDL_DATABASE_URL required');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !['55491', '55492'].includes(url.port) || url.pathname !== '/altan_ddl_governance_test'
    || url.username !== 'altan_ddl_test' || url.search || url.hash)
    throw Error('Only the dedicated B33b1 disposable destination is permitted');
  const db = new pg.Client({ connectionString: raw });
  await db.connect();
  const { rows: [s] } = await db.query("SELECT current_setting('server_version_num')::int AS version, current_database() AS database");
  assert.ok(s.version >= 160000 && s.version < 170000);
  assert.equal(s.database, 'altan_ddl_governance_test');
  await db.query("SET statement_timeout='10s'; SET lock_timeout='5s'");
  return db;
}
const identifier = name => '"' + name.replaceAll('"', '""') + '"';
export async function insert(db, table, data) {
  const keys = Object.keys(data);
  return (await db.query(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`, keys.map(k => data[k]))).rows[0];
}
// Minimal valid SQL fixtures. No existing B31/B32 trigger is disabled or changed.
export async function fixture(db, { competencia = '2026-11', revisao = 1 } = {}) {
  const clientId = uid(), companyId = uid(), portalClientId = uid(), autorId = uid();
  const cnpj = (BigInt('0x' + randomBytes(7).toString('hex')) % 100000000000000n).toString().padStart(14, '0');
  const now = new Date();
  await insert(db, 'Client', { id: clientId, name:'SYNTHETIC DDL', email:clientId+'@example.test', login:clientId,passwordHash:'not-a-login',updatedAt:now });
  await insert(db, 'Company', { id:companyId, clientId, razaoSocial:'SYNTHETIC DDL', cnpj, atividades:[], updatedAt:now });
  await insert(db, 'PortalClient', { id:portalClientId, companyId, razao:'SYNTHETIC DDL', cnpj,updatedAt:now });
  await insert(db, 'User', { id:autorId,email:autorId+'@example.test',passwordHash:'not-a-login',role:'contador',accountType:'FIRM',status:'active',updatedAt:now });
  const f = { clientId, companyId, portalClientId, autorId, cnpj, competencia, revisao, revisaoFs12:revisao, politicaVersao:'SYNTHETIC_SQL_V1', contextoHash:hashA, serieHash:hashB };
  f.revisaoId = (await insert(db, 'apuracao_fs12_revisoes', { id:uid(),portalClientId,companyId,competencia,revisao,serie:JSON.stringify([{mes:competencia,valorCentavos:0}]),politicaVersao:f.politicaVersao,contexto:{synthetic:true},contextoRevisao:f.contextoHash,serieHash:f.serieHash,comandoHash:hashC,autorId,chaveIdempotencia:uid(),motivo:revisao>1?'Synthetic revision':null })).id;
  return f;
}
export async function calculation(db, f, overrides = {}) {
  const calculoId = uid();
  return insert(db, 'apuracao_fs12_calculos', { id:uid(),portalClientId:f.portalClientId,companyId:f.companyId,competencia:f.competencia,calculoId,revisaoFs12:f.revisao,contextoHash:f.contextoHash,politicaVersao:f.politicaVersao,calculoHash:hashC,
    calculoConfirmado:{calculoId,portalClientId:f.portalClientId,competencia:f.competencia,fs12:{revisaoId:f.revisaoId,revisao:f.revisao,contextoHash:f.contextoHash,politicaVersao:f.politicaVersao}},...overrides });
}
export function commandData(f, overrides = {}) {
  return { id:uid(),tentativaId:uid(),portalClientId:f.portalClientId,companyId:f.companyId,cnpj:f.cnpj,competencia:f.competencia,revisaoFs12:f.revisao,intencao:'SIMULAR',vinculoOrigemId:null,serieHash:f.serieHash,contextoHash:f.contextoHash,politicaVersao:f.politicaVersao,chaveIdempotencia:uid(),comandoHash:hashC,hashVersao:'FS12_COMANDO_V1',intencao_congelada:{synthetic:true},esperado:{snapshotId:null,snapshotEstado:null,snapshotChave:null,cicloRevisao:null,cicloToken:null},autorId:f.autorId,origem:'SYNTHETIC_SQL',...overrides };
}
export const command = (db,f,overrides={}) => insert(db,'fs12_comandos',commandData(f,overrides));
// Structurally valid opaque fixture, not a claim of valid cryptography.
export const opaque = () => ({v:1,alg:'AES-256-GCM',keyId:'synthetic-key',nonce:Buffer.alloc(12).toString('base64'),ciphertext:Buffer.from('fixture').toString('base64'),tag:Buffer.alloc(16).toString('base64'),aadVersion:1});
export async function reserve(db,c, overrides={}) {
  return insert(db,'serpro_chamadas',{id:uid(),portalClientId:c.portalClientId,cnpj:c.cnpj,competencia:c.competencia,acaoId:c.id,assinatura:hashA,rota:'/Declarar',idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',status:'reservada',...overrides});
}
export const reservationData = (c,r,overrides={}) => ({comandoId:c.id,reservaId:r.id,assinatura:r.assinatura,envelopeCifrado:opaque(),envelopeHash:hashB,rota:'/Declarar',idSistema:'PGDASD',idServico:'TRANSDECLARACAO11',...overrides});
export async function marker(db,c,r,overrides={}) {
  return insert(db,'AppSetting',{key:'serpro_dispatch:'+r.id,value:{reservaId:r.id,companyId:c.portalClientId,authorizedAt:new Date().toISOString()},updatedAt:new Date(),...overrides});
}
export const responseData = (c,r,m,overrides={}) => ({id:uid(),comandoId:c.id,reservaId:r.id,marcadorKey:m.key,httpStatus:200,corpoCifrado:opaque(),corpoHash:hashC,recebidoEm:new Date(),custodianteId:'synthetic-service',capacidadeId:uid(),marcadorObservado:m.value,...overrides});
export const associationData = (f,c,response,calc,overrides={}) => ({comandoId:c.id,respostaId:response.id,vinculoId:calc.id,portalClientId:f.portalClientId,companyId:f.companyId,competencia:f.competencia,revisaoFs12:f.revisao,intencao:c.intencao,autorId:f.autorId,...overrides});
export async function chain(db,f, { intencao='SIMULAR' }={}) {
  const calc = await calculation(db,f);
  const c=await command(db,f,{intencao,vinculoOrigemId:intencao==='SIMULAR'?null:calc.id});
  const r=await reserve(db,c); const a=await insert(db,'fs12_comando_reservas',reservationData(c,r));
  const m=await marker(db,c,r); const response=await insert(db,'fs12_comando_respostas',responseData(c,r,m));
  return {c,r,a,m,response,calc};
}
export async function rejectsSql(db, operation, codes) {
  await db.query('SAVEPOINT expected_rejection');
  let error;
  try { await operation(); } catch (caught) { error=caught; }
  await db.query('ROLLBACK TO SAVEPOINT expected_rejection');
  await db.query('RELEASE SAVEPOINT expected_rejection');
  assert.ok(error, 'Expected SQL rejection');
  assert.ok([].concat(codes).includes(error.code), `Expected ${codes}, received ${error.code}: ${error.message}`);
  return error;
}
