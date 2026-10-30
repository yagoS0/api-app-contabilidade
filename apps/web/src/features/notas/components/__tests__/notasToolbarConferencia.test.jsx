import { render, screen, fireEvent, within } from '@testing-library/react';
import { NotasFiscaisTab } from '../renderNotasFiscaisTab';
jest.mock('../../../../api/client', () => ({ createApiClient: () => ({ listarRecorrenciasNfse: async () => ({ items: [] }) }) }));
function montar(extra = {}, props = {}) {
  const panel = { companyId: 'a', notas: [], notasTotal: 2671, notasFilters: { papel: 'EMIT', type: '', competencia: '2026-10', offset: 100, situacao: 'autorizada', search: 'cliente', dataInicio: '2026-10-01', dataFim: '2026-10-25' }, notasSummary: { lista: { EMIT: { count: 2671, valor: 100 } } }, notasRecebidas: { lista: { DEST: { count: 0, valor: 0 } } }, setNotasFilters: jest.fn(), loadNotas: jest.fn(), syncAdn: jest.fn(), syncDfe: jest.fn(), importNotas: jest.fn(), datasIndeterminadas: 9, adnState: { adnLastAttemptAt: '2026-10-01T12:00:00Z', adnLastError: 'falha' }, ...extra };
  const view = render(<NotasFiscaisTab notasPanel={panel} {...props} />); return { panel, ...view };
}
test('duas áreas e captura somente leitura; trocar ação não altera a lista nem consulta', () => {
  const { panel } = montar();
  const acoes = screen.getByRole('group', { name: 'Ações das notas' });
  expect(within(acoes).getByRole('button', { name: 'Buscar NFS-e' })).toHaveTextContent('Buscar');
  expect(within(acoes).getByRole('button', { name: 'Importar' })).toBeInTheDocument();
  const config = screen.getByRole('group', { name: 'Configuração das notas' });
  expect(within(config).getByRole('button', { name: 'Notas recorrentes' })).toBeInTheDocument();
  const card = screen.getByRole('button', { name: /^Emitidas/ });
  expect(card).toHaveTextContent('2671 notas no filtro'); expect(card).toHaveTextContent('tentativa com erro');
  expect(card.querySelector('button,a,input,select')).toBeNull();
  expect(screen.queryByText(/Buscar \/ importar|última nota nova/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tipo para buscar ou importar'), { target: { value: 'NFE' } });
  expect(screen.getByLabelText('Importar XML ou ZIP de NF-e')).toHaveAttribute('accept', expect.stringContaining('.zip'));
  expect(panel.setNotasFilters).not.toHaveBeenCalled(); expect(panel.syncAdn).not.toHaveBeenCalled(); expect(panel.syncDfe).not.toHaveBeenCalled(); expect(panel.importNotas).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^Emitidas/ })).toHaveTextContent('Captura NF-e: indisponível');
});
test('espécie fixada no filtro prevalece e recebida não oferece emissão', () => {
  montar({ notasFilters: { papel: 'DEST', type: 'NFE', competencia: '2026-10' } });
  expect(screen.getByLabelText('Tipo para buscar ou importar')).toHaveValue('NFE');
  expect(screen.getByLabelText('Tipo para buscar ou importar')).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Emitir nota/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Importar XML ou ZIP de NF-e')).toHaveAttribute('multiple');
});
test('disclosure de datas conserva motivo e limpa somente intervalo/página', () => {
  const { panel } = montar();
  const info = screen.getByLabelText('9 notas com data de emissão a verificar');
  const disclosure = info.closest('details'); disclosure.open = true;
  expect(disclosure).toHaveTextContent('Confira a origem no detalhe');
  expect(disclosure).toHaveTextContent('não são incluídas no intervalo');
  fireEvent.click(within(disclosure).getByRole('button', { name: 'Limpar intervalo para conferir' }));
  expect(panel.setNotasFilters).toHaveBeenLastCalledWith({ ...panel.notasFilters, dataInicio: '', dataFim: '', offset: 0 });
});
test('sem intervalo mantém acesso à informação; desconhecido não é zero', () => {
  montar({ datasIndeterminadas: undefined, notasFilters: { papel: 'EMIT', competencia: '2026-10' } });
  const info = screen.getByLabelText('Contagem de datas indeterminadas indisponível');
  info.closest('details').open = true;
  expect(info.closest('details')).toHaveTextContent('Confira a origem no detalhe');
  expect(screen.queryByRole('button', { name: 'Limpar intervalo para conferir' })).not.toBeInTheDocument();
});
test.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('modificadores preservam links reais (%j)', modificador => {
  const integrar = jest.fn(), configurar = jest.fn();
  montar({}, { hrefIntegracoes: '/companies/a/integracoes', onAbrirIntegracoes: integrar, hrefConfiguracaoEmissao: '/companies/a/emissao-nfse', onAbrirConfiguracaoEmissao: configurar });
  const integracoes = screen.getByRole('link', { name: 'Integrações' }), config = screen.getByTestId('engrenagem-emissao-nfse');
  expect(integracoes).toHaveAttribute('href', '/companies/a/integracoes'); expect(config).toHaveAttribute('href', '/companies/a/emissao-nfse');
  fireEvent.click(integracoes, modificador); fireEvent.click(config, modificador);
  expect(integrar).not.toHaveBeenCalled(); expect(configurar).not.toHaveBeenCalled();
  fireEvent.click(integracoes); fireEvent.click(config); expect(integrar).toHaveBeenCalledTimes(1); expect(configurar).toHaveBeenCalledTimes(1);
});
