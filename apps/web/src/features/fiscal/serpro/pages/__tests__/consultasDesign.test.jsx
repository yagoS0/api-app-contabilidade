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

test('filtro limita seleção e marcador muda após regularização', async () => {
 const checkedAt=new Date().toISOString();
 const companies=[{companyId:'a',razao:'Regularizar',serproStatus:{procurationStatus:'AUSENTE',checkedAt,vinculoConfirmado:true}},{companyId:'b',razao:'Autorizada',serproStatus:{procurationStatus:'ATIVA',checkedAt,validUntil:'2099-12-31',vinculoConfirmado:true}}];
 const onRunOp=jest.fn(async()=>({ok:true,procuracao:{status:'ATIVA',checkedAt,validUntil:'2099-12-31'}}));
 render(<MemoryRouter><SerproFuncoesPage settingsStatus="ready" settings={{enabled:true,certificate:{hasCertificate:true}}} companies={companies} onRunOp={onRunOp}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:'regularizar'}});
 expect(screen.queryByRole('checkbox',{name:'Selecionar Autorizada'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar todas'}));fireEvent.click(screen.getByRole('checkbox',{name:'Testar procuração'}));fireEvent.click(screen.getByRole('button',{name:'Rodar'}));
 await waitFor(()=>expect(onRunOp).toHaveBeenCalledWith('procuracao','a',null));
 await waitFor(()=>expect(screen.queryByRole('checkbox',{name:'Selecionar Regularizar'})).not.toBeInTheDocument());
 fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:'ativa'}});
 expect(screen.getAllByText('Ativa')).toHaveLength(2);expect(screen.getByRole('button',{name:'Rodar'})).toBeDisabled();
});
