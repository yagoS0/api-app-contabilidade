import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SerproFuncoesPage } from '../renderSerproFuncoesPage';
import { NotasCapturaContent } from '../../../../notas/captura/pages/renderNotasCapturaPage';

test('seleção precede execução e montar Consultas não dispara operação fiscal', () => {
  const onRunOp = jest.fn();
  render(<MemoryRouter><SerproFuncoesPage settingsStatus="ready" settings={{enabled:true,certificate:{hasCertificate:true}}} companies={[{companyId:'c',razao:'Empresa'}]} onRunOp={onRunOp}/></MemoryRouter>);
  const executar = screen.getByRole('button',{name:'Rodar'});
  expect(executar).toBeDisabled();
  const empresa = screen.getByRole('checkbox',{name:'Selecionar Empresa'});
  expect(empresa.compareDocumentPosition(executar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(empresa); fireEvent.click(screen.getByRole('checkbox',{name:'Testar procuração'}));
  expect(executar).toBeEnabled();
  expect(onRunOp).not.toHaveBeenCalled();
});

test('falha do histórico tem recuperação que somente relê registros, sem nova captura', async () => {
  const api={listNotasCapturas:jest.fn().mockRejectedValueOnce(Error('Acesso indisponível.')).mockResolvedValue({jobs:[]}),createNotasCaptura:jest.fn()};
  render(<NotasCapturaContent api={api} companies={[]}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Acesso indisponível.');
  fireEvent.click(screen.getByRole('button',{name:'Reler histórico'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(api.listNotasCapturas).toHaveBeenCalledTimes(2);
  expect(api.createNotasCaptura).not.toHaveBeenCalled();
});
