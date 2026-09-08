import { fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { ChartOfAccountsPage } from '../renderChartOfAccountsPage';
const accounts=[{codigo:'1',nome:'Caixa',tipo:'ATIVO',natureza:'DEVEDORA',status:'PENDENTE_ERP'},{codigo:'2',nome:'Banco',tipo:'ATIVO',natureza:'DEVEDORA',status:'PENDENTE_ERP'}];
test('exclusão identifica conta e cancelar não escreve',async()=>{
 const excluir=jest.fn();render(<ChartOfAccountsPage accounts={accounts} onDeleteAccount={excluir}/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Excluir'})[0]);
 expect(screen.getByRole('dialog')).toHaveTextContent('1 · Caixa');
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
 expect(excluir).not.toHaveBeenCalled();
});
test('lote exclui só após confirmar e preserva seleção das recusas',async()=>{
 const excluir=jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Em uso'));
 render(<ChartOfAccountsPage accounts={accounts} onDeleteAccount={excluir}/>);
 fireEvent.click(screen.getByLabelText('Selecionar 1'));fireEvent.click(screen.getByLabelText('Selecionar 2'));
 fireEvent.click(screen.getByRole('button',{name:'Excluir selecionadas'}));
 expect(excluir).not.toHaveBeenCalled();
 expect(screen.getByRole('dialog')).toHaveTextContent('2 · Banco');
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Excluir contas'}));
 await screen.findByText(/falharam: 2/);
 expect(screen.getByLabelText('Selecionar 1')).not.toBeChecked();expect(screen.getByLabelText('Selecionar 2')).toBeChecked();
});
