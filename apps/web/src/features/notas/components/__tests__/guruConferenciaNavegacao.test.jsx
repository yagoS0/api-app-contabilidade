import { render, screen, fireEvent } from '@testing-library/react';
import { NotasFiscaisTab } from '../renderNotasFiscaisTab';
import { createApiClient } from '../../../../api/client';
import { companyTabPath, SEGMENT_TO_TAB, TAB_TO_SEGMENT } from '../../../companies/detail/lib/rotasDaEmpresa';

test('rota de Integrações resolve nos dois sentidos no shell da empresa', () => {
  expect(SEGMENT_TO_TAB.integracoes).toBe('integracoes');
  expect(TAB_TO_SEGMENT.integracoes).toBe('integracoes');
  expect(companyTabPath('empresa-a', 'integracoes')).toBe('/companies/empresa-a/integracoes');
});

jest.mock('../../../../api/client', () => {
  const api = { mode: 'real', listarGuruConferencia: jest.fn(async () => ({ items: [], total: 0, pagina: 1, tamanhoPagina: 20, conexao: 'DESCONECTADA', ocupada: false })),
    importarGuruConferencia: jest.fn(), emitirNfse: jest.fn(),
    listarRecorrenciasNfse: jest.fn(async () => ({ items: [], workerAtivo: false })),
    getVerificacaoNfse: jest.fn(async () => ({ ok: true, verificacao: null })) };
  return { createApiClient: () => api };
});

const panel = companyId => ({ companyId, loading: false, error: null, notas: [], notasTotal: 0,
  notasFilters: { papel: 'EMIT', type: 'NFSE', competencia: '2026-10', search: '', limit: 100, offset: 0 },
  setNotasFilters: jest.fn(), notasSummary: { ano: 2026, totals: { totalNotas: 0, totalEmitido: 0, totalRecebido: 0, countNfe: 0, countNfse: 0 } },
  notasRecebidas: null, loadingNotas: false, importing: false, importNotas: jest.fn(), loadNotas: jest.fn(),
  dfeState: null, adnState: null, syncDfe: jest.fn(), syncAdn: jest.fn(), abrirNota: jest.fn(), fecharNota: jest.fn() });

test('atalho de Notas abre Integrações sem duplicar painel e preserva ferramentas/contexto', () => {
  const api = createApiClient(), abrir = jest.fn();
  const { rerender } = render(<NotasFiscaisTab notasPanel={panel('empresa-a')} hrefIntegracoes="/companies/empresa-a/integracoes" onAbrirIntegracoes={abrir} />);
  const entrada = screen.getByRole('link', { name: 'Guru em Integrações' });
  expect(entrada).toHaveAttribute('href', '/companies/empresa-a/integracoes');
  fireEvent.click(entrada);
  expect(abrir).toHaveBeenCalledTimes(1);
  expect(api.listarGuruConferencia).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Emitir nota/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Notas recorrentes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verificar conformidade' })).toBeInTheDocument();
  expect(api.importarGuruConferencia).not.toHaveBeenCalled(); expect(api.emitirNfse).not.toHaveBeenCalled();
  rerender(<NotasFiscaisTab notasPanel={panel('empresa-b')} hrefIntegracoes="/companies/empresa-b/integracoes" onAbrirIntegracoes={abrir} />);
  expect(screen.getByRole('link', { name: 'Guru em Integrações' })).toHaveAttribute('href', '/companies/empresa-b/integracoes');
  expect(screen.queryByText(/Conexão pendente/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Guru em Integrações' }), { ctrlKey: true });
  expect(abrir).toHaveBeenCalledTimes(1);
});
