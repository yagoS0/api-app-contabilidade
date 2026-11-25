import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, fixture, command, reserve, reservationData, marker, responseData, insert, rejectsSql, uid } from './helpers.mjs';

test('T3a SECURITY INVOKER requires marker locking privilege; synthetic grant is not a runtime policy', async () => {
  const db = await connect();
  try {
    await db.query('BEGIN');
    const f = await fixture(db), c = await command(db, f), r = await reserve(db, c);
    await insert(db, 'fs12_comando_reservas', reservationData(c, r));
    const m = await marker(db, c, r);
    const role = 'fs12_custody_' + uid().replaceAll('-', '');
    await db.query(`CREATE ROLE ${role} NOLOGIN`);
    await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.query(`GRANT SELECT ON fs12_comandos, fs12_comando_reservas, serpro_chamadas, "AppSetting", fs12_comando_respostas TO ${role}`);
    await db.query(`GRANT INSERT ON fs12_comando_respostas TO ${role}`);
    await db.query(`SET LOCAL ROLE ${role}`);
    await rejectsSql(db, () => insert(db, 'fs12_comando_respostas', responseData(c, r, m)), '42501');
    await db.query('RESET ROLE');
    // PostgreSQL requires UPDATE on at least one column to take FOR SHARE.
    // This diagnostic demonstrates the capability gap, not approved production grants.
    await db.query(`GRANT UPDATE ("updatedAt") ON "AppSetting" TO ${role}`);
    await db.query(`SET LOCAL ROLE ${role}`);
    const response = await insert(db, 'fs12_comando_respostas', responseData(c, r, m));
    assert.equal(response.comandoId, c.id);
    await rejectsSql(db, () => db.query('UPDATE "AppSetting" SET value = $1 WHERE key = $2', [{ forged: true }, m.key]), '42501');
    await rejectsSql(db, () => db.query('TRUNCATE fs12_comando_respostas CASCADE'), '42501');
    await rejectsSql(db, () => db.query('DELETE FROM fs12_comando_respostas'), '42501');
    await db.query('RESET ROLE');
    const functions = await db.query("SELECT proname, prosecdef FROM pg_proc WHERE proname = ANY($1)", [['validar_fs12_comando', 'validar_fs12_reserva', 'validar_fs12_associacao', 'validar_fs12_resposta_cadeia']]);
    assert.equal(functions.rowCount, 4);
    assert.ok(functions.rows.every(row => !row.prosecdef));
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
