jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarLeituraHistoricoDas448 } from '../leituraHistoricoDas448.js';
const args = { companyId: 'empresa', competencia: '2026-10', limit: 5 };
const event = (patch = {}) => ({ key: 'contabil:cliente:confirmacao:empresa:evento', value: { id: 'evento', companyId: 'empresa', guideId: 'guia', documento: { tipo: 'SIMPLES', competencia: '2026-10', hash: 'a'.repeat(64) }, ...patch } });
const db = rows => ({ appSetting: { findMany: jest.fn(async () => rows) }, guide: { findMany: jest.fn(async () => []) } });
test('confirmação órfã preservada sem associar por competência de pagamento', async () => {
  const d = db([event({ competenciaPagamento: '2026-11', secret: 'SECRET' })]); const r = await criarLeituraHistoricoDas448(d)(args);
  expect(r.items[0].guiaLocalizada).toBe(false); expect(JSON.stringify(r)).not.toContain('SECRET');
  expect(d.appSetting.findMany.mock.calls[0][0].where.AND[1]).toEqual({ value: { path: ['documento','competencia'], equals: '2026-10' } });
  expect(d.guide.findMany.mock.calls[0][0].where).toEqual({ portalClientId: 'empresa', id: { in: ['guia'] } });
});
test.each([event({ companyId: 'outra' }), event({ id: 'outro' }), event({ documento: { tipo: 'SIMPLES', competencia: '2026-11' } })])('identidade inconsistente não vaza', async row => {
  const d = db([row]); const r = await criarLeituraHistoricoDas448(d)(args); expect(r.items).toEqual([]); expect(r.lacunas).toContain('IDENTIDADE_HISTORICA_INCONSISTENTE'); expect(d.guide.findMany).toHaveBeenCalledTimes(1);
});
test('vazio não comprova ausência histórica e truncamento não desaparece no filtro', async () => {
  expect((await criarLeituraHistoricoDas448(db([]))(args)).lacunas).toContain('HISTORICO_NAO_POSSUI_TOMBSTONE_GERAL');
  expect((await criarLeituraHistoricoDas448(db(Array(6).fill(event({ id: 'invalido' }))))(args)).truncated).toBe(true);
});


test.each(['DARF','INSS'])('confirmação %s não é atribuída ao DAS', tipo => {
  return criarLeituraHistoricoDas448(db([event({ documento: { tipo, competencia: args.competencia } })]))(args)
    .then(r => expect(r.items).toEqual([]));
});
test('tipo histórico ausente permanece lacuna, não confirmação DAS', async () => {
  const r = await criarLeituraHistoricoDas448(db([event({ documento: { competencia: args.competencia } })]))(args);
  expect(r.items).toEqual([]); expect(r.lacunas).toContain('TIPO_HISTORICO_NAO_ASSOCIAVEL_A_DAS');
});
