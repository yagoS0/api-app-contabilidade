// Written before the 4.4.5 readers/projection: selection contracts, not writer behavior.
import { criarLeiturasFiscais445 } from '../../modules/fiscal/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasGuias445 } from '../../modules/guides/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasContabeis445 } from '../../modules/accounting/infrastructure/prisma/leituraConciliacaoDas445.js';
import { criarLeiturasOperacionais445 } from '../../modules/operations/infrastructure/prisma/leituraConciliacaoDas445.js';

const input = { companyId: 'empresa-a', competencia: '2026-10', limit: 50, agora: new Date('2026-11-14T12:00:00Z') };
const model = (rows = []) => ({ findMany: jest.fn(async () => rows), findUnique: jest.fn(async () => null) });
function fixture() {
  return Object.fromEntries(['serproChamada','serproRespostaCache','appSetting','guide','companyMonthlyCircular','accountingEntry','fiscalExecutionLog'].map(k => [k, model()]));
}
test('ledger uses company, period and only the two DAS services; cache has no global scan', async () => {
  const db = fixture(); const p = criarLeiturasFiscais445(db);
  await p.chamadas(input);
  expect(db.serproChamada.findMany.mock.calls[0][0]).toMatchObject({ where: { portalClientId: input.companyId, competencia: input.competencia, idServico: { in: ['GERARDAS12','GERARDASCOBRANCA17'] } }, take: 51 });
  await p.cache({ ...input, chamadas: [] });
  expect(db.serproRespostaCache.findMany).not.toHaveBeenCalled();
  await p.cache({ ...input, chamadas: [{ id: 'r', assinatura: 'a'.repeat(64) }] });
  expect(db.serproRespostaCache.findMany.mock.calls[0][0].where).toEqual({ chave: { in: ['a'.repeat(64)] } });
});
test('dispatch requires the exact reservation key and both payload identities', async () => {
  const db = fixture(); db.appSetting.findMany.mockResolvedValue([{ key: 'serpro_dispatch:r', value: { reservaId: 'r', companyId: 'other' } }]);
  const r = await criarLeiturasFiscais445(db).despachos({ ...input, chamadas: [{ id: 'r' }] });
  expect(db.appSetting.findMany.mock.calls[0][0].where).toEqual({ key: { in: ['serpro_dispatch:r'] } });
  expect(r.items).toEqual([]); expect(r.lacunas).toContain('IDENTIDADE_DESPACHO_DIVERGENTE');
});
test('document filter never falls back to another company, period or parcel', async () => {
  const db = fixture(); await criarLeiturasGuias445(db).guias({ ...input, documentoId: 'g' });
  expect(db.guide.findMany.mock.calls[0][0].where).toMatchObject({ id: 'g', portalClientId: input.companyId, competencia: input.competencia, parcelamentoId: null, parcela: { is: null } });
});
test('accounting stays scoped and never assumes circular implies provision', async () => {
  const db = fixture(); const p = criarLeiturasContabeis445(db);
  await p.circular(input); await p.lancamentos({ ...input, guias: [{ id: 'g' }] });
  expect(db.companyMonthlyCircular.findUnique.mock.calls[0][0].where).toEqual({ portalClientId_competencia: { portalClientId: input.companyId, competencia: input.competencia } });
  expect(db.accountingEntry.findMany.mock.calls[0][0].where).toMatchObject({ portalClientId: input.companyId, competencia: input.competencia });
});
test('payment history requires company prefix AND verified guide IDs', async () => {
  const db = fixture(); const p = criarLeiturasGuias445(db);
  await p.pagamentos({ ...input, guias: [] }); expect(db.appSetting.findMany).not.toHaveBeenCalled();
  await p.pagamentos({ ...input, guias: [{ id: 'g' }] });
  expect(db.appSetting.findMany.mock.calls[0][0].where).toMatchObject({ key: { startsWith: 'contabil:cliente:confirmacao:empresa-a:' } });
});
test('worker strips other companies, summary, names and free-text errors', async () => {
  const db = fixture(); db.appSetting.findMany.mockResolvedValue([{ key: 'serpro_pgdasd_log:1', value: { summary: { segredo: 'SECRET', results: [
    { companyId: 'other', competencia: input.competencia, status: 'captured', cnpj: 'SECRET' },
    { companyId: input.companyId, competencia: input.competencia, status: 'captured', error: 'SECRET' },
  ] } } }]);
  const r = await criarLeiturasOperacionais445(db).worker(input);
  expect(r.items).toHaveLength(1); expect(JSON.stringify(r)).not.toContain('SECRET');
});
test('truncation is explicit and stable order is requested', async () => {
  const db = fixture(); db.serproChamada.findMany.mockResolvedValue(Array.from({length: 51}, (_, i) => ({ id: String(i) })));
  const r = await criarLeiturasFiscais445(db).chamadas(input);
  expect(r.items).toHaveLength(50); expect(r.truncated).toBe(true);
  expect(db.serproChamada.findMany.mock.calls[0][0].orderBy).toBeDefined();
});
