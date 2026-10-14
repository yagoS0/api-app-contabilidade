import { fireEvent, render, screen, within } from '@testing-library/react';
import { SitfisTab } from '../renderSitfisTab';

test('documento salvo fica separado da consulta paga e datas adicionais são recolhidas', () => {
  const consultar = jest.fn();
  render(<SitfisTab sitfisPanel={{consultar, status:{situacao:'COM_PENDENCIA',ultimoRelatorioEm:'2026-10-14T12:00:00Z',checkedAt:'2026-10-14T14:00:00Z',relatorioPdfFileId:'pdf',relatorio:{diagnosticos:[]}},pdfUrl:'blob:fixture'}} />);
  expect(screen.getByText(/Consulta ao SERPRO com custo/)).toBeVisible();
  expect(screen.getByText('Datas da consulta').closest('details')).not.toHaveAttribute('open');
  const documentos = document.querySelector('.sitfis-document-actions');
  fireEvent.click(within(documentos).getByRole('button',{name:'Ver PDF oficial'}));
  expect(screen.getByTitle('Relatório de situação fiscal (SITFIS)')).toBeVisible();
  expect(consultar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Consultar situação fiscal agora'}));
  expect(consultar).toHaveBeenCalledTimes(1);
});

test('falha de leitura permanece visível e tentar novamente relê somente salvo', () => {
  const reload=jest.fn(), consultar=jest.fn();
  render(<SitfisTab sitfisPanel={{error:'Falha simulada',reload,consultar,podeConsultar:false,proximaConsultaEm:'2026-10-14T18:00:00Z'}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Falha simulada');
  expect(screen.getByRole('button',{name:'Consultar situação fiscal agora'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Tentar ler o relatório salvo novamente'}));
  expect(reload).toHaveBeenCalledTimes(1);expect(consultar).not.toHaveBeenCalled();
});
