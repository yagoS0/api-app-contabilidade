import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CompanyAutomation, CompanySimplesCycle } from '../CompanyAutomation';
import { criarCompanyAutomationMock } from '../../../api/mock/companyAutomationMock';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SEGMENT_TO_TAB, companyTabPath } from '../../companies/detail/lib/rotasDaEmpresa';
jest.mock('../OperationsManualInss', () => ({ CompanyManualInss: () => null }));
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });
const config = { companyId: 'a', revision: 'r1', regime: 'SIMPLES', rotinas: [], cicloSimples: { enabled: false, fontes: [] } };
const state = (period, extra = {}) => ({ portalClientId: 'a', competencia: period, revision: 1, status: 'REVISAO_NECESSARIA', reason: 'Confira as receitas.', coleta: null, calculo: null, canRevise: true, ...extra });
const apiFor = (extra = {}) => ({ getCompanyAutomation: jest.fn(async () => config), getCompanySimplesCycle: jest.fn(async (_, period) => state(period)), reviseCompanySimplesCycle: jest.fn(async (_, period) => state(period, { revision: 2, status: 'AGUARDANDO_COLETA_FINAL', canRevise: false })), saveCompanyAutomation: jest.fn(async (_, body) => ({ ...config, revision: 'r2', cicloSimples: body.cicloSimples })), ...extra });
beforeEach(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'ciclo-request' }));
function Destination() { const location = useLocation(); return <output aria-label="Destino da empresa">{SEGMENT_TO_TAB[location.pathname.split('/')[3]] || 'anotacoes'} · {location.pathname}{location.search}</output>; }
test('Abrir Apuração usa o mapa real da empresa sem cair em Anotações', async () => {
  const api = apiFor();
  render(<MemoryRouter initialEntries={['/companies/a/automacao']}><CompanySimplesCycle api={api} companyId="a" canEdit /><Destination /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir Apuração' }));
  expect(screen.getByLabelText('Destino da empresa')).toHaveTextContent(`cadastroFiscal · ${companyTabPath('a', 'cadastroFiscal')}`);
  expect(screen.getByLabelText('Destino da empresa')).not.toHaveTextContent('?competencia=');
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('opt-in exige fontes e prévia; salva somente a configuração sem cálculo ou transmissão', async () => {
  const api = apiFor(); render(<CompanyAutomation api={api} companyId="a" canEdit />);
  const opt = await screen.findByLabelText('Selecionar empresa para coleta e cálculo');
  expect(opt).not.toBeChecked(); fireEvent.click(opt);
  expect(screen.getByRole('button', { name: 'Conferir alterações' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('NFS-e'));
  fireEvent.click(screen.getByRole('button', { name: 'Conferir alterações' }));
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar configuração' }));
  await screen.findByText(/Configuração salva/);
  expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a', { expectedRevision: 'r1', requestId: 'ciclo-request', cicloSimples: { enabled: true, fontes: ['NFSE'] } });
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('seleção histórica fora do Simples atual permanece visível e permite desativar com prévia', async () => {
  const oldConfig = { ...config, regime: 'LUCRO_PRESUMIDO', cicloSimples: { enabled: true, fontes: ['NFSE'], applicableCurrentRegime: false, configurationValid: true } };
  const api = apiFor({ getCompanyAutomation: async () => oldConfig, saveCompanyAutomation: jest.fn(async (_, body) => ({ ...oldConfig, revision: 'r2', cicloSimples: { ...oldConfig.cicloSimples, ...body.cicloSimples } })) });
  render(<CompanyAutomation api={api} companyId="a" canEdit />);
  const selection = await screen.findByLabelText('Selecionar empresa para coleta e cálculo');
  expect(selection).toBeChecked(); expect(selection).toBeEnabled();
  expect(screen.getByLabelText('NFS-e')).toBeChecked(); expect(screen.getByLabelText('NFS-e')).toBeDisabled(); expect(screen.getByLabelText('NF-e')).toBeDisabled();
  expect(await screen.findByText('Confira as receitas.')).toBeVisible();
  fireEvent.click(selection); fireEvent.click(screen.getByText('Conferir alterações'));
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Salvar configuração'));
  await screen.findByText(/Configuração salva/);
  expect(api.saveCompanyAutomation).toHaveBeenCalledWith('a', { expectedRevision: 'r1', requestId: 'ciclo-request', cicloSimples: { enabled: false, fontes: ['NFSE'] } });
  expect(screen.getByLabelText('Selecionar empresa para coleta e cálculo')).toBeDisabled();
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('fora do Simples atual não permite nova ativação nem ampliar fontes, mas conserva diagnóstico', async () => {
  const api = apiFor({ getCompanyAutomation: async () => ({ ...config, regime: 'LUCRO_PRESUMIDO', cicloSimples: { enabled: false, fontes: [], applicableCurrentRegime: false, configurationValid: true } }) });
  render(<CompanyAutomation api={api} companyId="a" canEdit />);
  expect(await screen.findByLabelText('Selecionar empresa para coleta e cálculo')).toBeDisabled();
  expect(screen.getByLabelText('NF-e')).toBeDisabled(); expect(screen.getByLabelText('NFS-e')).toBeDisabled();
  expect(await screen.findByText('Confira as receitas.')).toBeVisible();
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled();
});
test('cancelar prévia fora do Simples preserva seleção original e rascunho sem reativação fiscal', async () => {
  const api = apiFor({ getCompanyAutomation: async () => ({ ...config, regime: 'LUCRO_PRESUMIDO', cicloSimples: { enabled: true, fontes: ['NFSE'], applicableCurrentRegime: false, configurationValid: true } }) });
  render(<CompanyAutomation api={api} companyId="a" canEdit />);
  fireEvent.click(await screen.findByLabelText('Selecionar empresa para coleta e cálculo'));
  fireEvent.click(screen.getByText('Conferir alterações')); fireEvent.click(screen.getByText('Voltar à edição'));
  expect(screen.getByText('Conferir alterações')).toHaveFocus();
  expect(screen.getByLabelText('Selecionar empresa para coleta e cálculo')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Selecionar empresa para coleta e cálculo'));
  expect(screen.getByText('Conferir alterações')).toBeDisabled();
  expect(api.saveCompanyAutomation).not.toHaveBeenCalled(); expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('revisão exige motivo e confirmação, conserva revisão e não calcula imediatamente', async () => {
  const api = apiFor(); render(<CompanySimplesCycle api={api} companyId="a" canEdit />);
  await screen.findByText('Revisão necessária');
  expect(screen.getByText('Conferir nova revisão')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da nova revisão'), { target: { value: 'ok' } });
  expect(screen.getByText('Conferir nova revisão')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Motivo da nova revisão'), { target: { value: '  Receitas corrigidas  ' } });
  fireEvent.click(screen.getByText('Conferir nova revisão'));
  expect(screen.getByText(/Registrar uma nova revisão após a correção/)).toHaveFocus();
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Registrar nova revisão'));
  await screen.findByText(/Revisão registrada/);
  expect(api.reviseCompanySimplesCycle).toHaveBeenCalledWith('a', expect.stringMatching(/^\d{4}-\d{2}$/), { expectedRevision: 1, motivo: 'Receitas corrigidas' });
  expect(screen.queryByText('Registrar nova revisão')).not.toBeInTheDocument();
});
test.each(['INCERTO', 'CALCULANDO', 'COLETANDO'])('estado %s não oferece repetição mesmo com canRevise incoerente', async status => {
  const api = apiFor({ getCompanySimplesCycle: async (_, period) => state(period, { status }) });
  render(<CompanySimplesCycle api={api} companyId="a" canEdit />);
  await waitFor(() => expect(screen.queryByText('Carregando ciclo…')).not.toBeInTheDocument());
  expect(screen.queryByLabelText('Motivo da nova revisão')).not.toBeInTheDocument();
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('falha de revisão conserva motivo e exige recarga antes de outro comando', async () => {
  const api = apiFor({ reviseCompanySimplesCycle: jest.fn(async () => { throw new Error('A revisão mudou.'); }) });
  render(<CompanySimplesCycle api={api} companyId="a" canEdit />);
  fireEvent.change(await screen.findByLabelText('Motivo da nova revisão'), { target: { value: 'Correção fiscal' } });
  fireEvent.click(screen.getByText('Conferir nova revisão')); fireEvent.click(screen.getByText('Registrar nova revisão'));
  expect(await screen.findByRole('alert')).toHaveTextContent('A revisão mudou.');
  expect(screen.getByLabelText('Motivo da nova revisão')).toHaveValue('Correção fiscal');
  expect(screen.getByText('Registrar nova revisão')).toBeDisabled();
  expect(api.reviseCompanySimplesCycle).toHaveBeenCalledTimes(1);
});
test('resposta tardia de outra empresa é descartada', async () => {
  let resolve; const api = apiFor({ getCompanySimplesCycle: jest.fn((id, period) => id === 'a' ? new Promise(r => { resolve = r; }) : Promise.resolve(state(period, { reason: 'Empresa B', portalClientId: 'b' }))) });
  const view = render(<CompanySimplesCycle api={api} companyId="a" canEdit />);
  view.rerender(<CompanySimplesCycle api={api} companyId="b" canEdit />);
  await screen.findByText('Empresa B');
  await act(async () => resolve(state(api.getCompanySimplesCycle.mock.calls[0][1], { reason: 'Empresa A' })));
  expect(screen.queryByText('Empresa A')).not.toBeInTheDocument();
});
test('consulta com competência divergente não libera revisão', async () => {
  render(<CompanySimplesCycle api={apiFor({ getCompanySimplesCycle: async () => state('1900-01') })} companyId="a" canEdit />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o ciclo');
  expect(screen.queryByLabelText('Motivo da nova revisão')).not.toBeInTheDocument();
});
test('consulta de outra empresa não revela dados nem libera revisão', async () => {
  render(<CompanySimplesCycle api={apiFor({ getCompanySimplesCycle: async (_, period) => state(period, { portalClientId: 'outra', reason: 'Dado sigiloso' }) })} companyId="a" canEdit />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar o ciclo');
  expect(screen.queryByText('Dado sigiloso')).not.toBeInTheDocument();
});
test('somente leitura conserva diagnóstico sem comando', async () => {
  const api = apiFor(); render(<CompanySimplesCycle api={api} companyId="a" canEdit={false} />);
  await screen.findByText('Confira as receitas.');
  expect(screen.queryByLabelText('Motivo da nova revisão')).not.toBeInTheDocument();
  expect(api.reviseCompanySimplesCycle).not.toHaveBeenCalled();
});
test('cálculo exibe valor exato e data brasileira sem expor identificador como resultado', async () => {
  render(<CompanySimplesCycle api={apiFor({ getCompanySimplesCycle: async (_, period) => state(period, { status: 'CALCULADO', calculo: { calculoId: 'id-interno', dasValor: '9007199254740993.01', completedAt: '2026-11-08T10:00:00Z' } }) })} companyId="a" canEdit={false} />);
  expect(await screen.findByText('R$ 9.007.199.254.740.993,01')).toBeVisible();
  expect(screen.getByText(/08\/11\/2026/)).toBeVisible();
  expect(screen.queryByText('id-interno')).not.toBeInTheDocument();
});
test('mock preserva fontes e revision; rejeita duplicidade, regime incompatível e revisão sem tentativa', async () => {
  const api = criarCompanyAutomationMock([{ companyId: 'mock-simples-r2a', regimeTributario: 'SIMPLES' }, { companyId: 'mock-lp-r2a', regimeTributario: 'LUCRO_PRESUMIDO' }]);
  const before = await api.getCompanyAutomation('mock-simples-r2a');
  expect(before.cicloSimples).toEqual({ enabled: false, fontes: [] });
  await expect(api.saveCompanyAutomation('mock-simples-r2a', { expectedRevision: before.revision, requestId: 'bad', cicloSimples: { enabled: true, fontes: ['NFE', 'NFE'] } })).rejects.toThrow();
  const saved = await api.saveCompanyAutomation('mock-simples-r2a', { expectedRevision: before.revision, requestId: 'r2a', cicloSimples: { enabled: true, fontes: ['NFSE'] } });
  expect(saved.cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'] }); expect(saved.revision).not.toBe(before.revision);
  const lp = await api.getCompanyAutomation('mock-lp-r2a');
  await expect(api.saveCompanyAutomation('mock-lp-r2a', { expectedRevision: lp.revision, requestId: 'lp', cicloSimples: { enabled: true, fontes: ['NFE'] } })).rejects.toThrow();
  await expect(api.reviseCompanySimplesCycle('mock-simples-r2a', '2026-10', { expectedRevision: 0, motivo: 'Sem tentativa' })).rejects.toThrow();
});
