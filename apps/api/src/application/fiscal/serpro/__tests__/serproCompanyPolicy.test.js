import { empresaDaChamada, lerPoliticaSerpro } from '../CompanySerproPolicy.js';
import { autorizarChamada, autorizarDespacho } from '../SerproCallGuard.js';
import { comContextoSerpro } from '../serproCallContext.js';

const payload = { contribuinte: { numero: '12345678000190' }, pedidoDados: { idSistema: 'PGDASD', idServico: 'GERARDAS12' } };
function banco() {
  const settings = new Map(), rows = [];
  const db = {
    settings, rows, $queryRaw: jest.fn(),
    portalClient: { findMany: jest.fn(async () => [{ id: 'company' }]), count: jest.fn(async () => 1) },
    appSetting: { findUnique: jest.fn(async ({ where }) => settings.get(where.key) || null), create: jest.fn(async ({ data }) => settings.set(data.key, data)) },
    serproChamada: {
      findUnique: jest.fn(async ({ where }) => rows.find(r => r.id === where.id)),
      findFirst: jest.fn(async () => null), count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }) => { const row = { id: String(rows.length + 1), ...data }; rows.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }) => { const row = rows.find(r => r.id === where.id && r.status === where.status); if (row) Object.assign(row, data); return { count: row ? 1 : 0 }; }),
    },
  };
  db.$transaction = jest.fn(fn => fn(db));
  return db;
}
const pause = db => db.settings.set('company_serpro_policy:company', { value: { paused: true, reason: 'Revisão' } });
const reserve = db => autorizarChamada({ payload, rota: '/Emitir' }, db);

test('pausa bloqueia antes da reserva e override de quota não passa', async () => {
  const db = banco(); pause(db);
  await expect(comContextoSerpro({ forcar: true, userId: 'admin' }, () => reserve(db))).rejects.toMatchObject({ code: 'SERPRO_EMPRESA_PAUSADA' });
  expect(db.rows).toEqual([expect.objectContaining({ status: 'recusada_politica', portalClientId: 'company' })]);
});
test('pausa entre reserva e despacho cancela sem orçamento e audita motivo', async () => {
  const db = banco(), auth = await reserve(db); pause(db);
  await expect(autorizarDespacho(auth, db)).rejects.toMatchObject({ code: 'SERPRO_EMPRESA_PAUSADA' });
  expect(db.rows[0]).toMatchObject({ status: 'abortada_politica', erroCodigo: 'SERPRO_EMPRESA_PAUSADA' });
  expect(db.settings.has(`serpro_dispatch:${auth.id}`)).toBe(false);
});
test('despacho autorizado persiste marca; replay não reenvia e falha DB não autoriza', async () => {
  const db = banco(), auth = await reserve(db);
  await autorizarDespacho(auth, db);
  expect(db.settings.has(`serpro_dispatch:${auth.id}`)).toBe(true);
  await expect(autorizarDespacho(auth, db)).rejects.toMatchObject({ code: 'SERPRO_CHAMADA_EM_ANDAMENTO' });
  const other = banco(), pending = await reserve(other);
  other.appSetting.findUnique.mockRejectedValue(new Error('offline'));
  await expect(autorizarDespacho(pending, other)).rejects.toMatchObject({ code: 'SERPRO_MEDICAO_INDISPONIVEL' });
  expect(other.rows[0].status).toBe('reservada');
});
test('identidade exige CNPJ completo exato, suporta máscara e recusa cadastro ambíguo', async () => {
  const db = banco();
  expect(await empresaDaChamada(db, { contribuinte: { numero: '12.345.678/0001-90' } })).toBe('company');
  expect(db.portalClient.findMany).toHaveBeenCalledWith({ where: { cnpj: { in: ['12345678000190', '12.345.678/0001-90'] } }, select: { id: true } });
  await expect(empresaDaChamada(db, { contribuinte: { numero: '123' } })).rejects.toMatchObject({ code: 'SERPRO_IDENTIDADE_INVALIDA' });
  db.portalClient.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  await expect(empresaDaChamada(db, payload)).rejects.toMatchObject({ code: 'SERPRO_IDENTIDADE_AMBIGUA' });
  expect(await empresaDaChamada(db, {})).toBe(null);
});
test('política corrompida não vira liberada silenciosamente', async () => {
  const db = banco(); db.settings.set('company_serpro_policy:company', { value: { paused: 'false' } });
  await expect(lerPoliticaSerpro(db, 'company')).rejects.toMatchObject({ code: 'SERPRO_POLITICA_INVALIDA' });
  await expect(reserve(db)).rejects.toMatchObject({ code: 'SERPRO_POLITICA_INVALIDA' });
});
