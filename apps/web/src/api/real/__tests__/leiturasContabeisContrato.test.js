import { createRealApi } from '../realApi';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useParcelamentos } from '../../../features/accounting/parcelamento/hooks/useParcelamentos';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });
const responder = payload => global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

describe.each([
 ['getChartOfAccounts', '/firm/companies/empresa-teste/chart-of-accounts'],
 ['getGlobalChartOfAccounts', '/firm/chart-of-accounts/global'],
 ['listParcelamentos', '/firm/companies/empresa-teste/parcelamentos'],
])('%s valida o envelope real', (metodo, caminho) => {
 test.each([null, {}, [], { data: null }, { data: {} }, { data: 'inválido' }].map(payload => ({ payload })))('HTTP 200 inválido rejeita: %j', async ({ payload }) => {
  responder(payload);
  await expect(createRealApi()[metodo]('empresa-teste')).rejects.toThrow('Resposta inválida');
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(caminho), expect.any(Object));
 });
 test.each([{ data: [] }, { data: [{ id: 'registro-ficticio' }] }])('array válido é preservado: %j', async ({ data }) => {
  responder({ data });
  await expect(createRealApi()[metodo]('empresa-teste')).resolves.toEqual(data);
 });
 test('JSON ilegível não vira vazio legítimo', async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('JSON inválido'); } });
  await expect(createRealApi()[metodo]('empresa-teste')).rejects.toThrow('Resposta inválida');
 });
});

describe.each(['getChartOfAccounts', 'getGlobalChartOfAccounts', 'listParcelamentos', 'getConferenciaParcelas', 'getAnalisePlanejamento', 'getAnaliseClientes', 'getAnaliseLancamentos'])('%s propaga falhas do transporte', metodo => {
 test('recusa HTTP mantém status e código', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'LEITURA_INDISPONIVEL' }) });
  await expect(createRealApi()[metodo]('empresa-teste', {})).rejects.toMatchObject({ status: 503, code: 'LEITURA_INDISPONIVEL' });
 });
 test('erro de rede não vira lista vazia', async () => {
  global.fetch.mockRejectedValue(new Error('Rede indisponível'));
  await expect(createRealApi()[metodo]('empresa-teste', {})).rejects.toThrow('Rede indisponível');
 });
});

test.each(['getConferenciaParcelas', 'getAnalisePlanejamento', 'getAnaliseClientes', 'getAnaliseLancamentos'])('%s não normaliza objeto incompleto antes da validação do consumidor', async metodo => {
 responder({ incompleto: true });
 await expect(createRealApi()[metodo]('empresa-teste', {})).resolves.toEqual({ incompleto: true });
});

test('parcelamentos preserva lista na falha do adaptador real e recupera vazio válido', async () => {
 const contrato = { id: 'contrato-ficticio' };
 const retorno = payload => ({ ok: true, status: 200, json: async () => payload });
 global.fetch.mockResolvedValueOnce(retorno({ data: [contrato] }))
  .mockResolvedValueOnce(retorno({})).mockResolvedValueOnce(retorno({ data: [] }));
 const api = createRealApi();
 const { result } = renderHook(() => useParcelamentos({ api, companyId: 'empresa-teste' }));
 await waitFor(() => expect(result.current.parcelamentos).toEqual([contrato]));
 await act(async () => result.current.load());
 expect(result.current.error).toContain('Resposta inválida');
 expect(result.current.parcelamentos).toEqual([contrato]);
 await act(async () => result.current.load());
 expect(result.current.error).toBeNull();
 expect(result.current.parcelamentos).toEqual([]);
});

test('conferência rejeita objeto incompleto recebido pelo adaptador real', async () => {
 responder({});
 const api = createRealApi();
 const { result } = renderHook(() => useParcelamentos({ api, companyId: null }));
 await expect(result.current.listConferencia()).rejects.toThrow('Não foi possível ler a conferência');
 responder({ items: [] });
 await expect(result.current.listConferencia()).resolves.toEqual([]);
});
