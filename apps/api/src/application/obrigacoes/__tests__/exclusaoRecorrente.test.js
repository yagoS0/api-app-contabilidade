jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { excluirOcorrencia } from '../ObrigacoesService.js';
const date = s => new Date(`${s}T00:00:00Z`);
function banco() {
  const serie = { id: 's', portalClientId: 'e', periodicidade: 'MENSAL', defasagemMeses: 1, agendaVersoes: [] };
  const rows = ['09', '10', '11'].map(m => ({ id: `o${m}`, obrigacaoId: 's', cicloChave: `2026-${m}`, status: m === '11' ? 'CONCLUIDA' : 'PENDENTE', dataVencimento: date(`2026-${m}-20`), obrigacao: serie }));
  const db = {
    $transaction: fn => fn(db),
    obrigacao: { findUnique: async () => serie, update: async ({ data }) => Object.assign(serie, data) },
    ocorrenciaObrigacao: {
      findFirst: async ({ where }) => where.obrigacao.portalClientId.in.includes('e') ? rows.find(o => o.id === where.id) : null,
      findUnique: async ({ where }) => rows.find(o => o.id === where.id),
      findMany: async () => rows,
      update: async ({ where, data }) => Object.assign(rows.find(o => o.id === where.id), data),
    },
  };
  return { db, serie, rows };
}
test('somente esta cancela um ciclo e conserva os próximos, inclusive concluída', async () => {
  const { db, serie, rows } = banco();
  expect(await excluirOcorrencia({ portalIds: ['e'], ocorrenciaId: 'o09' }, db)).toMatchObject({ canceladas: 1 });
  expect(rows[0].canceladaEm).toBeInstanceOf(Date); expect(rows[1].canceladaEm).toBeUndefined();
  expect(rows[2].status).toBe('CONCLUIDA'); expect(serie.encerradaAPartirDe).toBeUndefined();
});
test('esta e próximas deixa corte durável e mantém concluídas futuras', async () => {
  const { db, serie, rows } = banco();
  expect(await excluirOcorrencia({ portalIds: ['e'], ocorrenciaId: 'o10', alcance: 'ESTA_E_PROXIMAS' }, db)).toMatchObject({ canceladas: 1, concluidasPreservadas: 1 });
  expect(serie.encerradaAPartirDe).toBe('2026-10'); expect(serie.sobrescritaLocal).toBe(true);
  expect(rows[0].canceladaEm).toBeUndefined(); expect(rows[2].canceladaEm).toBeUndefined();
});
test('recusa empresa fora do escopo sem tocar série', async () => {
  const { db, serie } = banco();
  await expect(excluirOcorrencia({ portalIds: ['outra'], ocorrenciaId: 'o09' }, db)).rejects.toMatchObject({ status: 404 });
  expect(serie.agendaVersoes).toEqual([]);
});
