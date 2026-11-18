// Isolated SQL + synthetic crypto custody experiment; not production T3a or authorization.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect, fixture, command, reserve, marker, insert, reservationData, responseData, rejectsSql, uid } from './helpers.mjs';
import { cifrarFixture, decifrarFixture, criarCapacidadeFixture, validarCapacidadeFixture } from './seguranca-fixture.mjs';
async function prepared(db) {
  const f = await fixture(db), c = await command(db, f), r = await reserve(db, c);
  const context = { portalClientId: c.portalClientId, companyId: c.companyId, competencia: c.competencia, comandoId: c.id, tentativaId: c.tentativaId, reservaId: r.id, tipo: 'RESPOSTA' };
  const keys = new Map([['synthetic_ephemeral', randomBytes(32)]]), serviceSecret = randomBytes(32);
  const envelopeBytes = Buffer.from('{"fixture":true,"transmitir":false}');
  const encryptedEnvelope = cifrarFixture(envelopeBytes, { ...context, tipo: 'ENVELOPE' }, 'synthetic_ephemeral', keys);
  const a = await insert(db, 'fs12_comando_reservas', reservationData(c, r, { envelopeCifrado: encryptedEnvelope.envelope, envelopeHash: encryptedEnvelope.corpoHash }));
  const m = await marker(db, c, r);
  const expected = { context, envelopeHash: a.envelopeHash, assinatura: a.assinatura };
  const capability = criarCapacidadeFixture(context, a.envelopeHash, a.assinatura, serviceSecret, m);
  return { f, c, r, a, m, context, keys, serviceSecret, expected, capability, envelopeBytes };
}
function encryptedResponse(q, text = '{"fixture":true,"observacao":"sem prova fiscal"}') {
  const bytes = Buffer.from(text), encrypted = cifrarFixture(bytes, q.context, 'synthetic_ephemeral', q.keys);
  return { bytes, data: responseData(q.c, q.r, q.m, { corpoCifrado: encrypted.envelope, corpoHash: encrypted.corpoHash }) };
}
test('committed SQL custody recovers authenticated bytes in another connection after human revocation and remap', async () => {
  const db = await connect(); let reader;
  try {
    await db.query('BEGIN');
    const q = await prepared(db), other = await fixture(db);
    await db.query('UPDATE "User" SET status=$2 WHERE id=$1', [q.f.autorId, 'inactive']);
    await db.query('UPDATE "PortalClient" SET "companyId"=NULL WHERE id=$1', [other.portalClientId]);
    await db.query('UPDATE "PortalClient" SET "companyId"=$2 WHERE id=$1', [q.f.portalClientId, other.companyId]);
    assert.deepEqual(validarCapacidadeFixture(q.capability, q.expected, q.serviceSecret, q.m), { acao: 'custodiar_resposta_pgdas', autorizaNovoDespacho: false });
    const response = encryptedResponse(q);
    const saved = await insert(db, 'fs12_comando_respostas', response.data);
    await db.query('COMMIT');
    reader = await connect();
    const { rows: [row] } = await reader.query('SELECT * FROM fs12_comando_respostas WHERE id=$1', [saved.id]);
    assert.deepEqual(decifrarFixture(row.corpoCifrado, q.context, row.corpoHash, q.keys), response.bytes);
    const { rows: [association] } = await reader.query('SELECT "envelopeCifrado","envelopeHash" FROM fs12_comando_reservas WHERE "comandoId"=$1', [q.c.id]);
    assert.deepEqual(decifrarFixture(association.envelopeCifrado, { ...q.context, tipo: 'ENVELOPE' }, association.envelopeHash, q.keys), q.envelopeBytes);
    assert.throws(() => decifrarFixture(row.corpoCifrado, { ...q.context, companyId: other.companyId }, row.corpoHash, q.keys), /EVIDENCIA_INVALIDA/);
    assert.throws(() => validarCapacidadeFixture(q.capability, { ...q.expected, context: { ...q.context, companyId: other.companyId } }, q.serviceSecret, q.m), /EVIDENCIA_INVALIDA/);
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM fs12_comando_calculos WHERE "comandoId"=$1', [q.c.id])).rows[0].n, 0);
    // Privileged test read is not the unimplemented user-facing ACL. No transport is imported.
  } finally { await db.query('ROLLBACK'); await reader?.end(); await db.end(); }
});
test('SQL replay identity is command + plaintext hash + HTTP status, not randomized ciphertext', async () => {
  const db = await connect();
  try {
    await db.query('BEGIN'); const q = await prepared(db);
    const first = encryptedResponse(q), replay = encryptedResponse(q);
    assert.notEqual(first.data.corpoCifrado.nonce, replay.data.corpoCifrado.nonce);
    await insert(db, 'fs12_comando_respostas', first.data);
    await rejectsSql(db, () => insert(db, 'fs12_comando_respostas', replay.data), '23505');
    await insert(db, 'fs12_comando_respostas', { ...replay.data, id: uid(), httpStatus: 500 });
    await insert(db, 'fs12_comando_respostas', encryptedResponse(q, '{"fixture":true,"observacao":"divergente"}').data);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_respostas WHERE "comandoId"=$1', [q.c.id])).rows[0].n, 3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM fs12_comando_calculos WHERE "comandoId"=$1', [q.c.id])).rows[0].n, 0);
  } finally { await db.query('ROLLBACK'); await db.end(); }
});
test('response insertion rejects SQL ledger or marker divergence after reservation association', async () => {
  const db = await connect();
  try {
    await db.query('BEGIN'); const q = await prepared(db);
    for (const field of ['portalClientId', 'cnpj', 'competencia', 'acaoId', 'assinatura', 'rota', 'idSistema', 'idServico', 'status']) {
      await db.query('SAVEPOINT mutation');
      await db.query(`UPDATE serpro_chamadas SET "${field}"=$2 WHERE id=$1`, [q.r.id, field === 'status' ? 'abortada_auth' : 'other']);
      await rejectsSql(db, () => insert(db, 'fs12_comando_respostas', encryptedResponse(q).data), '23514');
      await db.query('ROLLBACK TO SAVEPOINT mutation'); await db.query('RELEASE SAVEPOINT mutation');
    }
    for (const value of [{}, { ...q.m.value, companyId: q.f.companyId }, { ...q.m.value, reservaId: 'other' }, { ...q.m.value, authorizedAt: '' }]) {
      await db.query('SAVEPOINT mutation');
      await db.query('UPDATE "AppSetting" SET value=$2 WHERE key=$1', [q.m.key, value]);
      await rejectsSql(db, () => insert(db, 'fs12_comando_respostas', encryptedResponse(q).data), '23514');
      await db.query('ROLLBACK TO SAVEPOINT mutation'); await db.query('RELEASE SAVEPOINT mutation');
    }
    await insert(db, 'fs12_comando_respostas', encryptedResponse(q).data);
  } finally { await db.query('ROLLBACK'); await db.end(); }
});
test('SQL accepts structurally valid tampering; GCM authentication is an additional mandatory boundary', async () => {
  const db = await connect();
  try {
    await db.query('BEGIN'); const q = await prepared(db), response = encryptedResponse(q);
    const tag = Buffer.from(response.data.corpoCifrado.tag, 'base64'); tag[0] ^= 1;
    response.data.corpoCifrado.tag = tag.toString('base64');
    const saved = await insert(db, 'fs12_comando_respostas', response.data);
    assert.throws(() => decifrarFixture(saved.corpoCifrado, q.context, saved.corpoHash, q.keys), /EVIDENCIA_INVALIDA/);
  } finally { await db.query('ROLLBACK'); await db.end(); }
});

