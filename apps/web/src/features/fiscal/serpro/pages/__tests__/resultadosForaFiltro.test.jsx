import {render,screen,fireEvent,waitFor,within,act} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {SerproFuncoesPage} from '../renderSerproFuncoesPage';

it('ativa histórica permanece em Revalidar com data e orientação sem consulta automática', () => {
 const run=jest.fn();
 render(<MemoryRouter><SerproFuncoesPage settingsStatus="ready" settings={{enabled:true,certificate:{hasCertificate:true}}} companies={[{companyId:'a',razao:'Empresa histórica',cnpj:'00.000.000/0001-00',serproStatus:{procurationStatus:'ATIVA',checkedAt:new Date(Date.now()-86400000).toISOString(),validUntil:'2099-10-13',vinculoConfirmado:true}}]} onRunOp={run}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:'revalidar'}});
 expect(within(screen.getByRole('row', { name: /Empresa histórica/ })).getByText('Revalidar')).toBeVisible();
 expect(screen.getByText('Atualize a verificação antes de operar.')).toBeVisible();
 expect(screen.getByText('Validade: 13/10/2099')).toBeVisible();
 fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:'ativa'}});
 expect(screen.queryByText('Empresa histórica')).not.toBeInTheDocument();
 expect(run).not.toHaveBeenCalled();
});
function montar(filtro,retorno){const checkedAt=new Date().toISOString();const onRunOp=jest.fn(async(op)=>op==='procuracao'?{ok:true,procuracao:{status:'ATIVA',checkedAt,validUntil:'2099-12-31'}}:retorno());render(<MemoryRouter><SerproFuncoesPage settingsStatus="ready" settings={{enabled:true,certificate:{hasCertificate:true}}} companies={[{companyId:'a',razao:'Empresa',cnpj:'00.000.000/0001-00',serproStatus:{procurationStatus:filtro==='regularizar'?'AUSENTE':'ATIVA',checkedAt,validUntil:null,vinculoConfirmado:true}}]} onRunOp={onRunOp}/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:filtro}});fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar todas'}));fireEvent.click(screen.getByRole('checkbox',{name:'Testar procuração'}));fireEvent.click(screen.getByRole('checkbox',{name:'Conciliar PGDAS-D — somente documentos'}));fireEvent.click(screen.getByRole('button',{name:'Rodar'}));return onRunOp;}
it.each(['regularizar','revalidar'])('mantém erro fora do filtro %s e não altera seleção/execução',async filtro=>{
 const run=montar(filtro,async()=>({ok:false,message:'Recibo indisponível.'}));const area=await screen.findByRole('region',{name:'Resultados fora do filtro'});await waitFor(()=>expect(within(area).getByRole('status')).toHaveTextContent('Recibo indisponível.'));expect(screen.getByText('Nenhuma empresa neste filtro.')).toBeVisible();expect(screen.queryByRole('region',{name:'Empresas para consulta'})).not.toBeInTheDocument();expect(within(area).queryByRole('checkbox')).not.toBeInTheDocument();expect(within(area).queryByRole('button')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Rodar'})).toBeDisabled();expect(run.mock.calls.map(c=>c[0])).toEqual(['procuracao','conciliar']);fireEvent.change(screen.getByLabelText('Filtrar por procuração'),{target:{value:'todas'}});expect(screen.queryByRole('region',{name:'Resultados fora do filtro'})).not.toBeInTheDocument();expect(screen.getAllByText(/Recibo indisponível/)).toHaveLength(1);expect(run).toHaveBeenCalledTimes(2);
});
it('mantém andamento e sucesso fora do filtro',async()=>{
 let concluir;const run=montar('regularizar',()=>new Promise(resolve=>{concluir=resolve;}));const area=await screen.findByRole('region',{name:'Resultados fora do filtro'});expect(within(area).getByRole('status')).toHaveTextContent('rodando');await act(async()=>concluir({ok:true,message:'Entrega confirmada.'}));expect(within(area).getByRole('status')).toHaveTextContent('Entrega confirmada.');expect(run).toHaveBeenCalledTimes(2);
});
