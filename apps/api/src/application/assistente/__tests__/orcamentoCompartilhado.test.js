jest.mock('../../../config.js', () => ({ ...jest.requireActual('../../../config.js'), IA_OPENAI_TETO_COMPARTILHADO_CENTAVOS: 10 }));
import { autorizarChamadaIa } from '../GuardaIaService.js';
test.each(['assistente_whatsapp', 'comercial_whatsapp'])('teto conjunto inclui histórico comercial e suporte para %s', async finalidade => {
  const client = { chamadaIa: {
    aggregate: jest.fn(async ({ where }) => ({ _sum: { custoEstimadoCentavos: where.finalidade?.in ? 8 : 0 }, _count: { _all: 0 } })),
    create: jest.fn(async ({ data }) => ({ id: 'c', ...data })),
  } }; client.$transaction = fn => fn(client);
  const r = await autorizarChamadaIa({ finalidade, modelo: 'gpt-5.4-mini', chave: 'fake', reservaCentavos: 3, client });
  expect(r).toMatchObject({ ok: false, motivo: 'TETO_OPENAI_COMPARTILHADO' });
  expect(client.chamadaIa.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ modelo: 'gpt-5.4-mini', finalidade: { in: ['assistente_whatsapp', 'comercial_whatsapp'] } }) }));
  expect(client.chamadaIa.create.mock.calls.some(([a]) => a.data.status === 'reservada')).toBe(false);
});
