import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PendenciasFiscaisTabelas } from '../PendenciasFiscaisTabelas';
jest.mock('../../lib/pdfPendencias', () => ({ gerarPdfPendencias: jest.fn() }));
import { gerarPdfPendencias } from '../../lib/pdfPendencias';
const relatorio = { diagnosticos: [{ chave:'RFB', blocos:[{titulo:'Débito',registros:[{Receita:'IRPJ','Sdo. Dev. Cons.':'100,00'}, {Receita:'PIS','Sdo. Dev. Cons.':'20,00'}]}] }] };
beforeEach(() => { jest.clearAllMocks(); URL.createObjectURL=jest.fn().mockReturnValue('blob:pdf-teste'); URL.revokeObjectURL=jest.fn(); gerarPdfPendencias.mockResolvedValue(new Blob(['PDF'])); });
test('PDF usa empresa e filtro, oferece download e libera URL ao fechar', async () => {
  render(<PendenciasFiscaisTabelas relatorio={relatorio} empresa={{razao:'Empresa A',cnpj:'111'}} />);
  fireEvent.change(screen.getByLabelText('Buscar nas pendências'),{target:{value:'IRPJ'}});
  fireEvent.click(screen.getByRole('button',{name:'Exportar PDF'}));
  fireEvent.click(screen.getByRole('button',{name:'Gerar PDF'}));
  expect(await screen.findByRole('dialog',{name:'PDF de pendências fiscais'})).toBeInTheDocument();
  const payload=gerarPdfPendencias.mock.calls[0][0];
  expect(payload.empresa.razao).toBe('Empresa A');
  expect(payload.fontes.flatMap(f=>f.linhas).map(l=>l.tributo)).toEqual(['IRPJ']);
  expect(payload.escopo).toContain('Seleção personalizada');
  expect(screen.getByRole('link',{name:'Baixar PDF'})).toHaveAttribute('download','pendencias-fiscais-111.pdf');
  fireEvent.click(screen.getAllByRole('button',{name:'Fechar'})[0]);
  await waitFor(()=>expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-teste'));
});
test('seleção explícita prevalece sobre filtro e falha não abre PDF', async () => {
  gerarPdfPendencias.mockRejectedValue(new Error('Falha no PDF'));
  render(<PendenciasFiscaisTabelas relatorio={relatorio} />);
  fireEvent.click(screen.getByRole('checkbox',{name:/Selecionar PIS/}));
  fireEvent.change(screen.getByLabelText('Buscar nas pendências'),{target:{value:'IRPJ'}});
  fireEvent.click(screen.getByRole('button',{name:'PDF da seleção'}));
  fireEvent.click(screen.getByRole('button',{name:'Gerar PDF'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha no PDF');
  expect(gerarPdfPendencias.mock.calls[0][0].fontes.flatMap(f=>f.linhas).map(l=>l.tributo)).toEqual(['PIS']);
  expect(screen.getByRole('dialog',{name:'Escolher conteúdo do PDF'})).toBeInTheDocument();
});

test('origem contábil permanece separada na tabela e no PDF, sem botão de edição', async () => {
  const item = { id: 'contabil:1', origem: 'CONTABILIDADE', tipo: 'DEBITO', estado: 'VENCIDO', tributo: 'ISS', competencia: '2026-01', total: 60000, situacao: 'Pagamento pendente', evidencia: { registro: { Origem: 'Contabilidade' }, anotacoes: {}, descricao: [], anotacoesBloco: [] } };
  render(<PendenciasFiscaisTabelas relatorio={relatorio} contabeis={{ disponivel: true, itens: [item] }} />);
  expect(screen.getByRole('table', { name: 'Pendências — Contabilidade' })).toHaveTextContent('Pagamento pendente');
  fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
  fireEvent.click(screen.getByRole('button',{name:'Gerar PDF'}));
  await screen.findByRole('dialog', { name: 'PDF de pendências fiscais' });
  expect(gerarPdfPendencias.mock.calls[0][0].fontes[0]).toMatchObject({ id: 'CONTABILIDADE', linhas: [item] });
});


test('permite excluir uma fonte coincidente e registros individuais sem juntar origens', async () => {
  const item = { id:'contabil:pis', origem:'CONTABILIDADE', tipo:'DEBITO', tributo:'PIS', total:2000, competencia:'2026-09', evidencia:{registro:{}} };
  render(<PendenciasFiscaisTabelas relatorio={relatorio} contabeis={{disponivel:true,itens:[item]}} />);
  fireEvent.click(screen.getByRole('button',{name:'Exportar PDF'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Incluir tabela Contabilidade'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/Incluir IRPJ/}));
  fireEvent.click(screen.getByRole('button',{name:'Gerar PDF'}));
  await screen.findByRole('link',{name:'Baixar PDF'});
  const fontes=gerarPdfPendencias.mock.calls[0][0].fontes;
  expect(fontes.map(f=>f.id)).toEqual(['RFB']);
  expect(fontes[0].linhas.map(l=>l.tributo)).toEqual(['PIS']);
});

test('limpar seleção não exporta tudo e cancelar não gera arquivo', () => {
  render(<PendenciasFiscaisTabelas relatorio={relatorio} />);
  fireEvent.click(screen.getByRole('button',{name:'Exportar PDF'}));
  fireEvent.click(screen.getByRole('button',{name:'Limpar'}));
  expect(screen.getByRole('button',{name:'Gerar PDF'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  expect(gerarPdfPendencias).not.toHaveBeenCalled();
});
