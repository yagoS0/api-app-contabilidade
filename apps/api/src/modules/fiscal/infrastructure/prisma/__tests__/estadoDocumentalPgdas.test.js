jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarRegistroIndiceDocumentalPgdas, criarLeituraEstadoDocumentalPgdas } from '../estadoDocumentalPgdas.js';
const entrada = { portalClientId: 'p1', competencia: '2026-10', cnpj: '12345678000199', numeroDeclaracao: 'oficial', atorId: 'u1' };
function fixture() {
  const rows = new Map();
  const db = { portalClient: { findUnique: jest.fn(async () => ({ id: 'p1', cnpj: entrada.cnpj })) },
    appSetting: { createMany: jest.fn(async ({ data, skipDuplicates }) => { expect(skipDuplicates).toBe(true); for (const row of data) if (!rows.has(row.key)) rows.set(row.key, row); return { count: data.length }; }),
      findUnique: jest.fn(async ({ where }) => rows.get(where.key)),
      findMany: jest.fn(async args => [...rows.values()].filter(r => r.key.startsWith(args.where.key.startsWith))) },
    companyMonthlyCircular: { findUnique: jest.fn(async () => null) }, apuracaoSnapshot: { findUnique: jest.fn(async () => null) },
    guide: { findFirst: jest.fn(async () => null) }, entregaObrigacaoArquivo: { findFirst: jest.fn(async () => null) } };
  return { db, rows };
}
test('replay preserva evidência e ator originais sem sobrescrever', async () => {
  const { db, rows } = fixture(); const gravar = criarRegistroIndiceDocumentalPgdas(db);
  const primeira = await gravar(entrada); const replay = await gravar({ ...entrada, atorId: 'u2' });
  expect(replay).toEqual(primeira); expect(replay.atorId).toBe('u1'); expect(rows.size).toBe(1);
  expect(db.appSetting.createMany).toHaveBeenLastCalledWith(expect.objectContaining({ skipDuplicates: true }));
});
test('empresa ou ator inválido não grava', async () => {
  const { db } = fixture(); const gravar = criarRegistroIndiceDocumentalPgdas(db);
  await expect(gravar({ ...entrada, cnpj: '99999999000199' })).rejects.toThrow();
  await expect(gravar({ ...entrada, atorId: null })).rejects.toThrow(); expect(db.appSetting.createMany).not.toHaveBeenCalled();
});
test('reabertura lê prova exata e ignora outro PA ou CNPJ alterado', async () => {
  const { db } = fixture(); await criarRegistroIndiceDocumentalPgdas(db)(entrada);
  const ler = criarLeituraEstadoDocumentalPgdas(db);
  expect((await ler(entrada)).consulta.numeroDeclaracao).toBe('oficial');
  expect((await ler({ ...entrada, competencia: '2026-11' })).consulta).toBeNull();
  db.portalClient.findUnique.mockResolvedValue({ id: 'p1', cnpj: '99999999000199' });
  expect((await ler(entrada)).consulta).toBeNull();
});
test('não persiste resposta bruta nem associação ao cálculo', async () => {
  const { db } = fixture(); const value = await criarRegistroIndiceDocumentalPgdas(db)({ ...entrada, calculoId: 'errado', raw: { segredo: true } });
  expect(value).not.toHaveProperty('calculoId'); expect(value).not.toHaveProperty('raw'); expect(value.servico).toBe('CONSDECLARACAO13');
});

test.each(['ERROR', 'RUNNING'])('sincronização %s não supera índice novo pelo timestamp', async serproSyncStatus => {
  const { db } = fixture(); await criarRegistroIndiceDocumentalPgdas(db)(entrada);
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ pgdasNumeroDeclaracao: 'antiga', pgdasDeclaracaoFileId: 'antigo', pgdasReciboFileId: 'antigo-r', serproSyncStatus, serproLastSyncAt: new Date('2099-01-01') });
  expect((await criarLeituraEstadoDocumentalPgdas(db)(entrada)).consulta.numeroDeclaracao).toBe('oficial');
});
