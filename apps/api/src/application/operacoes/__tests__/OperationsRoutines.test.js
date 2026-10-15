jest.mock('../../fiscal/serpro/SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss'] }));
jest.mock('../../fiscal/serpro/CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS' } }));
import { listarRotinasOperacoes } from '../OperationsRoutines.js';

test('projeta somente escolhas salvas e escopo autorizado sem executar ou criar rotinas', async () => {
  const db = { companyRotina: { findMany: jest.fn(async () => [{ portalClientId: 'a', rotina: 'das', enabled: true }, { portalClientId: 'a', rotina: 'inss', enabled: false }, { portalClientId: 'fora', rotina: 'das', enabled: true }]) } };
  const result = await listarRotinasOperacoes(db, ['a', 'b']);
  expect(db.companyRotina.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: { in: ['a', 'b'] }, rotina: { in: ['das', 'inss'] } } }));
  expect(result.items).toEqual([{ companyId: 'a', enabledKeys: ['das'] }, { companyId: 'b', enabledKeys: [] }]);
  expect(result.routines).toEqual([{ key: 'das', label: 'DAS' }, { key: 'inss', label: 'INSS' }]);
});
