import { render, screen, fireEvent, within } from '@testing-library/react';
import { NotasFiscaisTab } from '../renderNotasFiscaisTab';
jest.mock('../../../../api/client', () => ({ createApiClient: () => ({ getPerfilFiscal: async () => ({ candidatos: [{ tipoReceita: 'SERVICO_FATOR_R' }] }) }) }));
const compra = { id: 'nfe-1', type: 'NFE', papel: 'DEST', numero: '12345', serie: '1', status: 'EMITIDA', statusEfetivo: 'autorizada', emitenteNome: 'FORNECEDOR', total: '1500', issueDate: '2026-08-10T12:00:00Z' };
const servico = { ...compra, id: 'nfse-1', type: 'NFSE', numero: '77', emitenteNome: 'PRESTADOR' };
function montar(over = {}, props = {}) {
  const panel = { companyId: 'A', notas: [compra, servico], notasTotal: 282,
    notasFilters: { papel: 'EMIT', type: '', competencia: '2026-08', incluirCanceladas: '1', limit: 100, offset: 0 },
    setNotasFilters: jest.fn(), loadNotas: jest.fn(), reload: jest.fn(), syncDfe: jest.fn(), syncAdn: jest.fn(), importNotas: jest.fn(), marcarNotaStatus: jest.fn(), abrirNota: jest.fn(),
    notasSummary: { lista: { EMIT: { count: 150, valor: 3500 } } }, notasRecebidas: { lista: { DEST: { count: 282, valor: 2500 } } }, ...over };
  render(<NotasFiscaisTab notasPanel={panel} competencia="2026-08" {...props} />);
  return panel;
}
it('cartões mostram totais do servidor além da página e abrem as duas espécies recebidas', () => {
  const panel = montar();
  const resumo = screen.getByRole('region', { name: 'Indicadores das notas' });
  expect(within(resumo).getByText('282 notas no filtro')).toBeInTheDocument();
  expect(within(resumo).getByText(/2\.500,00/)).toBeInTheDocument();
  fireEvent.click(within(resumo).getByRole('button', { name: /Recebidas/ }));
  expect(panel.setNotasFilters).toHaveBeenLastCalledWith(expect.objectContaining({ papel: 'DEST', type: '', offset: 0 }));
  expect(screen.getByText('FORNECEDOR')).toBeInTheDocument();
  expect(screen.getByText('PRESTADOR')).toBeInTheDocument();
});
it.each([['', 'Ambas'], ['NFSE', 'NFS'], ['NFE', 'NF']])('recebidas filtra %s sem inferir inscrição estadual', (type, label) => {
  const panel = montar({ notasFilters: { papel: 'DEST', type: '', competencia: '2026-08' } }, { inscricaoEstadual: '' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Tipo de nota recebida' })).getByRole('button', { name: label, exact: true }));
  expect(panel.setNotasFilters).toHaveBeenLastCalledWith(expect.objectContaining({ papel: 'DEST', type, offset: 0 }));
  expect(screen.queryByRole('button', { name: /Emitir nota/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Marcar como cancelada|Reativar/ })).not.toBeInTheDocument();
});
it('direção limpa filtro NF que ficaria oculto e reseta a página', () => {
  const panel = montar({ notasFilters: { papel: 'DEST', type: 'NFE', competencia: '2026-08', offset: 100 } });
  fireEvent.change(screen.getByLabelText('Direção das notas'), { target: { value: 'EMIT' } });
  expect(panel.setNotasFilters).toHaveBeenLastCalledWith(expect.objectContaining({ papel: 'EMIT', type: '', offset: 0 }));
});
it('Emitidas abre ambas as espécies, sem deixar o filtro de compras oculto', () => {
  const panel = montar({ notasFilters: { papel: 'DEST', type: 'NFE', competencia: '2026-08' } });
  fireEvent.click(screen.getByRole('button', { name: /^Emitidas/ }));
  expect(panel.setNotasFilters).toHaveBeenLastCalledWith(expect.objectContaining({ papel: 'EMIT', type: '', offset: 0 }));
});
it('seleção de tipo para ação encaminha XML e ZIP para importação NF-e sem emitir', () => {
  const panel = montar();
  fireEvent.change(screen.getByLabelText('Tipo para buscar ou importar'), { target: { value: 'NFE' } });
  const files = [new File(['<NFe/>'], 'venda.xml'), new File(['zip'], 'vendas.zip')];
  fireEvent.change(screen.getByLabelText('Importar XML ou ZIP de NF-e'), { target: { files } });
  expect(panel.importNotas).toHaveBeenCalledWith(files, { type: 'NFE' });
  expect(screen.queryByRole('button', { name: /Emitir nota/ })).not.toBeInTheDocument();
});
it('nota de compra sem XML permanece visível e tem tipo explícito', () => {
  montar({ notas: [compra], notasFilters: { papel: 'DEST', type: 'NFE', competencia: '2026-08' } });
  expect(screen.getByText('FORNECEDOR')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('NF-e')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Estado de emissão' })).toBeInTheDocument();
});
it('ajuste local permanece individual e nunca é oferecido para recebida na lista mista', () => {
  montar({ notas: [compra, { ...servico, papel: 'EMIT' }], notasFilters: { papel: '', type: '', competencia: '2026-08' } });
  expect(screen.getAllByRole('button', { name: 'Marcar como cancelada' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
});
it('falha da lista e falha da captura têm recuperações separadas', () => {
  const panel = montar({ erroNotas: 'Lista indisponível', erroCaptura: 'Captura indisponível' });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar notas novamente' }));
  expect(panel.loadNotas).toHaveBeenCalledTimes(1); expect(panel.reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Recarregar estado da captura' }));
  expect(panel.reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Nenhuma nota encontrada.')).not.toBeInTheDocument();
  expect(screen.queryByText('FORNECEDOR')).not.toBeInTheDocument();
});
it('resultado parcial da importação preserva motivo e destino correto', () => {
  montar({ importResult: { type: 'NFSE', falhou: true, mensagem: '1 não importada.', problemas: [{ arquivo: 'venda.xml', mensagem: 'Este XML é de NF-e. Importe na área de NF-e.' }] } });
  expect(screen.getByRole('region', { name: 'Resultado da importação' })).toHaveTextContent('venda.xml');
  expect(screen.getByRole('region', { name: 'Resultado da importação' })).toHaveTextContent('Importe na área de NF-e');
});
