jest.mock('../../fiscal/serpro/SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss', 'presumido', 'parcelamento'] }));
jest.mock('../../fiscal/serpro/CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS', presumido: 'Presumido', parcelamento: 'Parcelamento' } }));
import { listarRotinasOperacoes } from '../OperationsRoutines.js';

function database() {
  return {
    portalClient: { findMany: jest.fn(async () => [{ id: 'a', companyId: 'legacy-a' }, { id: 'b', companyId: 'legacy-b' }, { id: 'c', companyId: null }]) },
    company: { findMany: jest.fn(async () => [{ id: 'legacy-a', regimeTributario: 'SIMPLES' }, { id: 'legacy-b', regimeTributario: 'LUCRO_PRESUMIDO' }]) },
    companyRotina: { findMany: jest.fn(async () => [
      { portalClientId: 'a', rotina: 'das', enabled: true },
      { portalClientId: 'a', rotina: 'presumido', enabled: true },
      { portalClientId: 'b', rotina: 'das', enabled: true },
      { portalClientId: 'b', rotina: 'inss', enabled: false },
      { portalClientId: 'c', rotina: 'inss', enabled: true },
      { portalClientId: 'fora', rotina: 'das', enabled: true },
    ]) },
  };
}

test('projeta escolhas aplicáveis no escopo autorizado sem executar ou alterar escolhas históricas', async () => {
  const db = database();
  const result = await listarRotinasOperacoes(db, ['a', 'b', 'c']);
  expect(db.companyRotina.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: { in: ['a', 'b', 'c'] }, rotina: { in: ['das', 'inss', 'presumido', 'parcelamento'] } } }));
  expect(db.portalClient.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['a', 'b', 'c'] } });
  expect(db.company.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['legacy-a', 'legacy-b'] } });
  expect(result.items[0]).toMatchObject({ companyId: 'a', regime: 'SIMPLES', enabledKeys: ['das'], storedEnabledKeys: ['das', 'presumido'] });
  expect(result.items[1]).toMatchObject({ companyId: 'b', regime: 'LUCRO_PRESUMIDO', enabledKeys: [], storedEnabledKeys: ['das'] });
  expect(result.items[1].applicableKeys).toContain('presumido');
  expect(result.items[1].applicableKeys).not.toContain('das');
  expect(result.items[2]).toMatchObject({ companyId: 'c', regime: null, applicableKeys: [], enabledKeys: [], storedEnabledKeys: ['inss'], unavailableReason: expect.any(String) });
  expect(result.routines.find(row => row.key === 'parcelamento').label).toBe('Parcelamento do Simples');
});

test('não consulta cadastro legado quando nenhuma empresa tem vínculo', async () => {
  const db = database();
  db.portalClient.findMany.mockResolvedValue([]);
  const result = await listarRotinasOperacoes(db, ['missing']);
  expect(db.company.findMany).not.toHaveBeenCalled();
  expect(result.items[0]).toMatchObject({ companyId: 'missing', regime: null, applicableKeys: [], unavailableReason: expect.any(String) });
});
