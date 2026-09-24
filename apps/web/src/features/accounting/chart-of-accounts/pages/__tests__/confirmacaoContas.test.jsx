import { fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { ChartOfAccountsPage } from '../renderChartOfAccountsPage';
const accounts=[{codigo:'1',nome:'Caixa',tipo:'ATIVO',natureza:'DEVEDORA',status:'PENDENTE_ERP'},{codigo:'2',nome:'Banco',tipo:'ATIVO',natureza:'DEVEDORA',status:'PENDENTE_ERP'}];
test('personaliza 286 na empresa sem editar o global',async()=>{
 const create=jest.fn().mockResolvedValue({}), update=jest.fn();
 render(<ChartOfAccountsPage accounts={[{codigo:'286',nome:'Sócios padrão',tipo:'PASSIVO',natureza:'CREDORA',scope:'GLOBAL'}]} onCreateAccount={create} onUpdateAccount={update}/>);
 fireEvent.click(screen.getByRole('button',{name:'Personalizar na empresa'}));
 expect(screen.getByLabelText('Código',{exact:true})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Nome',{exact:true}),{target:{value:'Sócio da empresa A'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar conta'}));
 await waitFor(()=>expect(create).toHaveBeenCalledWith(expect.objectContaining({codigo:'286',nome:'Sócio da empresa A',tipo:'PASSIVO'})));
 expect(update).not.toHaveBeenCalled();
});
test('edita conta própria e mantém o código reduzido',async()=>{
 const update=jest.fn().mockResolvedValue({}),create=jest.fn();
 render(<ChartOfAccountsPage accounts={[{codigo:'286',nome:'Sócio antigo',tipo:'PASSIVO',natureza:'CREDORA',scope:'COMPANY'}]} onUpdateAccount={update} onCreateAccount={create}/>);
 fireEvent.click(screen.getByRole('button',{name:'Editar conta',exact:true}));
 fireEvent.change(screen.getByLabelText('Nome',{exact:true}),{target:{value:'Sócio atualizado'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar conta'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith('286',expect.objectContaining({nome:'Sócio atualizado'})));
 expect(update.mock.calls[0][1]).not.toHaveProperty('codigo');expect(create).not.toHaveBeenCalled();
});
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
