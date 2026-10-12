import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BaseApuracaoConsumo } from '../BaseApuracaoConsumo';
import { criarApuracaoConsumoMock } from '../../../api/mock/apuracaoConsumoMock';
const vinculo = { cnpjBase: '11111111', estabelecimentos: [{ id: 'a', razao: 'Empresa A', cnpj: '11111111000111' }] };
const base = ctx => ({ ok: true, ...ctx, podeEditar: true, contribuinte: vinculo, configuracao: null, revisao: null, capacidades: {} });
const criarApi = () => ({ getBaseApuracaoConsumo: jest.fn(async (id, ctx) => base(ctx)), salvarConfiguracaoConsumo: jest.fn(), prepararRevisaoConsumo: jest.fn(), vincularEstabelecimentosConsumo: jest.fn() });
function abrir() { const d = screen.getByText('Preparação da apuração IBS/CBS').closest('details'); d.open = true; fireEvent(d, new Event('toggle')); }
const preencher = (nome, value) => fireEvent.change(screen.getByLabelText(nome), { target: { value } });

test('carrega apenas ao abrir e separa CBS/IBS e ambientes no contrato', async () => {
  const api = criarApi(); render(<BaseApuracaoConsumo companyId="a" api={api} />);
  expect(api.getBaseApuracaoConsumo).not.toHaveBeenCalled(); abrir();
  await screen.findByText('Empresa A · 11111111000111');
  expect(api.getBaseApuracaoConsumo).toHaveBeenLastCalledWith('a', expect.objectContaining({ tributo: 'CBS', ambiente: 'HOMOLOGACAO' }));
  preencher('Tributo', 'IBS'); preencher('Ambiente', 'PRODUCAO'); preencher('Competência da preparação', '2027-02');
  await waitFor(() => expect(api.getBaseApuracaoConsumo).toHaveBeenLastCalledWith('a', { tributo: 'IBS', ambiente: 'PRODUCAO', competencia: '2027-02' }));
});

test('timeout preserva rascunho e UUID na repetição do mesmo intento', async () => {
  const api = criarApi(); api.salvarConfiguracaoConsumo.mockRejectedValue(new Error('Resultado incerto'));
  render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir(); await screen.findByLabelText('Motivo da configuração');
  preencher('Motivo da configuração', 'Revisão local'); preencher('Referência do contrato', 'Contrato teste'); preencher('Preparação local', 'sim');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar preparação local' }));
  await screen.findByText('Resultado incerto');
  expect(screen.getByLabelText('Motivo da configuração')).toHaveValue('Revisão local');
  const anterior = api.salvarConfiguracaoConsumo.mock.calls[0];
  fireEvent.click(screen.getByRole('button', { name: 'Salvar preparação local' }));
  await waitFor(() => expect(api.salvarConfiguracaoConsumo).toHaveBeenCalledTimes(2));
  expect(api.salvarConfiguracaoConsumo.mock.calls[1]).toEqual(anterior);
  expect(anterior[1]).toMatchObject({ versao: 0, tributo: 'CBS', ambiente: 'HOMOLOGACAO', habilitado: true, dados: { motivo: 'Revisão local', referenciaContrato: 'Contrato teste' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar preparação local' })).toBeEnabled());
  preencher('Motivo da configuração', 'Outro motivo'); fireEvent.click(screen.getByRole('button', { name: 'Salvar preparação local' }));
  await waitFor(() => expect(api.salvarConfiguracaoConsumo).toHaveBeenCalledTimes(3));
  expect(api.salvarConfiguracaoConsumo.mock.calls[2][1].id).not.toBe(anterior[1].id);
});

test('vincula somente a empresa atual e mostra o grupo relido', async () => {
  const api = criarApi(); let vinculado = false;
  api.getBaseApuracaoConsumo.mockImplementation(async (id, ctx) => ({ ...base(ctx), contribuinte: vinculado ? vinculo : null }));
  api.vincularEstabelecimentosConsumo.mockImplementation(async () => { vinculado = true; return { ok: true, contribuinte: vinculo }; });
  render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir();
  fireEvent.click(await screen.findByRole('button', { name: 'Vincular esta empresa' }));
  await screen.findByText('Empresa A · 11111111000111');
  expect(api.vincularEstabelecimentosConsumo).toHaveBeenCalledWith('a', { portalClientIds: ['a'] });
});

test('revisão versionada mostra pendências e desatualização sem alegar valores coletados', async () => {
  const api = criarApi(); let revisao = { versao: 2, estado: 'PREPARACAO', competencia: '2027-01', dados: { motivo: 'Anterior', pendencias: ['COLETA_OFICIAL_NAO_IMPLEMENTADA'] } };
  api.getBaseApuracaoConsumo.mockImplementation(async (id, ctx) => ({ ...base(ctx), configuracao: { versao: 3, habilitado: true, dados: {} }, revisao, desatualizada: true }));
  api.prepararRevisaoConsumo.mockImplementation(async (id, p) => { revisao = { ...revisao, versao: 3, competencia: p.competencia, dados: { motivo: p.motivo, pendencias: ['COLETA_OFICIAL_NAO_IMPLEMENTADA'] } }; return { ok: true, revisao }; });
  render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir();
  await screen.findByText(/Preparação desatualizada:/);
  expect(screen.getByText('A coleta oficial ainda não está disponível.')).toBeInTheDocument();
  preencher('Motivo da preparação da competência', 'Conferi cadastro local');
  fireEvent.click(screen.getByRole('button', { name: 'Registrar preparação da competência' }));
  await screen.findByText(/Última revisão: 3/);
  expect(api.prepararRevisaoConsumo).toHaveBeenCalledWith('a', expect.objectContaining({ versao: 2, motivo: 'Conferi cadastro local', tributo: 'CBS', ambiente: 'HOMOLOGACAO' }));
  expect(screen.getByText(/Valores oficiais: ainda não coletados/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /emitir/i })).not.toBeInTheDocument();
});

test('troca contexto ignora resultado atrasado de gravação e não reaproveita rascunho', async () => {
  const api = criarApi(); let resolver;
  api.salvarConfiguracaoConsumo.mockImplementation(() => new Promise(r => { resolver = r; }));
  render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir(); await screen.findByLabelText('Motivo da configuração');
  preencher('Motivo da configuração', 'CBS'); fireEvent.click(screen.getByRole('button', { name: 'Salvar preparação local' }));
  preencher('Tributo', 'IBS'); await screen.findByLabelText('Motivo da configuração');
  await act(async () => resolver({ ok: true, configuracao: { versao: 8 } }));
  expect(screen.getByLabelText('Motivo da configuração')).toHaveValue('');
  expect(screen.queryByText(/Preparação local registrada/)).not.toBeInTheDocument();
  expect(screen.getByText('Configuração local · versão 0')).toBeInTheDocument();
});

test('leitura antiga não atravessa empresa e leitura falha não vira base inexistente', async () => {
  const api = criarApi(); let resolver;
  api.getBaseApuracaoConsumo.mockImplementation((id, ctx) => id === 'a' ? new Promise(r => { resolver = () => r(base(ctx)); }) : Promise.reject(new Error('Acesso recusado')));
  const { rerender } = render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir();
  await waitFor(() => expect(api.getBaseApuracaoConsumo).toHaveBeenCalled());
  rerender(<BaseApuracaoConsumo companyId="b" api={api} />); abrir();
  await screen.findByText('Acesso recusado'); await act(async () => resolver());
  expect(screen.queryByText('Empresa A · 11111111000111')).not.toBeInTheDocument();
  expect(screen.queryByText('Esta empresa ainda não está vinculada à base de apuração.')).not.toBeInTheDocument();
});

test('STAFF e demonstração não oferecem escrita nem disponibilidade oficial', async () => {
  const api = criarApi(); api.getBaseApuracaoConsumo.mockImplementation(async (id, ctx) => ({ ...base(ctx), podeEditar: false }));
  const { unmount } = render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir();
  expect(await screen.findByLabelText('Motivo da configuração')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Salvar preparação local' })).not.toBeInTheDocument(); unmount();
  render(<BaseApuracaoConsumo companyId="a" api={criarApuracaoConsumoMock()} />); abrir();
  await screen.findByText(/Demonstração: a preparação/);
  expect(screen.queryByRole('button', { name: 'Vincular esta empresa' })).not.toBeInTheDocument();
  await expect(criarApuracaoConsumoMock().prepararRevisaoConsumo()).rejects.toThrow('Nenhum registro foi salvo');
});

test('IBS apresenta limitações do contrato e fonte oficial sem habilitar operações', async () => {
  const api = criarApi(); api.getBaseApuracaoConsumo.mockImplementation(async (id, ctx) => ({ ...base(ctx), integracaoIbs: ctx.tributo === 'IBS' ? { versaoContrato: 'MOC1.10', verificadoEm: '2026-10-12', fonte: 'https://cgibs.gov.br/manual.pdf', runtimeHabilitado: false } : null }));
  render(<BaseApuracaoConsumo companyId="a" api={api} />); abrir(); await screen.findByText('Empresa A · 11111111000111'); preencher('Tributo', 'IBS'); await screen.findByText('Integração IBS indisponível'); expect(screen.getByRole('link', { name: 'Consultar manual oficial do CGIBS' })).toHaveAttribute('href', 'https://cgibs.gov.br/manual.pdf'); expect(screen.getByText(/Saldo, guias e confirmação de pagamento aguardam especificação/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /emitir/i })).not.toBeInTheDocument();
});

test('alteração cadastral desmonta status mensal antigo até nova leitura', async () => {
  const api = criarApi(); let estado = 'CONFERIDA_LOCAL'; api.getMensalConsumo = jest.fn(async (id, ctx) => ({ ok: true, ...ctx, contextoHash: 'a'.repeat(64), versao: 1, estado, capacidades: {}, estabelecimentos: [], pendenciasCalculadas: [], dados: { pendencias: [], guias: [], pagamentos: [], alocacoes: [] } }));
  const view = render(<BaseApuracaoConsumo companyId="a" api={api} cadastroVersao={1} />); abrir(); await screen.findByText('Empresa A · 11111111000111');
  const abrirMensal = () => { const el = screen.getByText('Conferência e pagamentos da competência').closest('details'); el.open = true; fireEvent(el, new Event('toggle')); };
  abrirMensal(); await screen.findByText(/Conferida pelo escritório/); estado = 'EM_CONFERENCIA'; view.rerender(<BaseApuracaoConsumo companyId="a" api={api} cadastroVersao={2} />); expect(screen.queryByText(/Conferida pelo escritório/)).not.toBeInTheDocument(); abrirMensal(); await screen.findByText(/Em conferência local/); expect(api.getMensalConsumo).toHaveBeenCalledTimes(2);
});
