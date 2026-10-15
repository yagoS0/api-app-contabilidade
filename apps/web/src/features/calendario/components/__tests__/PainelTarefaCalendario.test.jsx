import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PainelTarefaCalendario } from '../PainelTarefaCalendario';
import { AtividadeAgenda } from '../AtividadeAgenda';
const item = { id:'t1:2026-10', tarefaId:'t1', unificada:true, tipo:'tarefa', cicloChave:'2026-10', titulo:'Apuração', descricao:'Conferir empresas', dataInicio:'2026-10-15', dataFim:'2026-10-15', dataVencimento:'2026-10-20', alertaVencimento:'AMANHA', horarioModo:'ATE', horaLimite:'18:00', empresas:[{ companyId:'a', nome:'Empresa A', subtarefas:[{id:'mit',titulo:'MIT',concluida:false},{id:'efd',titulo:'EFD',concluida:false}] }, { companyId:'b', nome:'Empresa B', subtarefas:[{id:'mit',titulo:'MIT',concluida:false},{id:'efd',titulo:'EFD',concluida:false}] }] };
function montar(props = {}) { const api={acaoTarefaCalendario:jest.fn().mockResolvedValue({ok:true})}; const onChanged=jest.fn(); render(<PainelTarefaCalendario item={item} api={api} onChanged={onChanged} onFechar={jest.fn()} onEditar={jest.fn()} {...props}/>); return {api,onChanged}; }
test('checklists pertencem a cada empresa; conclusão risca somente a empresa correspondente', async () => {
 const {api,onChanged}=montar();
 const a=screen.getByRole('region',{name:'Empresa A'}), b=screen.getByRole('region',{name:'Empresa B'});
 expect(screen.queryByRole('checkbox',{name:'Concluir empresa'})).not.toBeInTheDocument();
 fireEvent.click(within(a).getByRole('checkbox',{name:'MIT'}));
 await waitFor(()=>expect(within(a).getByRole('checkbox',{name:'EFD'})).toBeEnabled());
 fireEvent.click(within(a).getByRole('checkbox',{name:'EFD'}));
 await waitFor(()=>expect(onChanged).toHaveBeenCalledTimes(2));
 expect(a).toHaveClass('is-complete'); expect(b).not.toHaveClass('is-complete');
 expect(within(b).getByRole('checkbox',{name:'MIT'})).not.toBeChecked();
 expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();
 expect(api.acaoTarefaCalendario).toHaveBeenLastCalledWith('t1',{acao:'SUBTAREFA',cicloChave:'2026-10',companyId:'a',subtarefaId:'efd',concluida:true});
 fireEvent.click(screen.getByRole('button',{name:'Pendentes'}));
 expect(screen.queryByRole('region',{name:'Empresa A'})).not.toBeInTheDocument(); expect(b).toBeInTheDocument();
});
test('gravações em empresas diferentes são independentes e falha reverte apenas a linha afetada', async () => {
 let rejeitar, terminar;
 const api={acaoTarefaCalendario:jest.fn().mockImplementationOnce(()=>new Promise((_,reject)=>{rejeitar=reject;})).mockImplementationOnce(()=>new Promise(resolve=>{terminar=resolve;}))};
 montar({api});
 const a=within(screen.getByRole('region',{name:'Empresa A'})), b=within(screen.getByRole('region',{name:'Empresa B'}));
 fireEvent.click(a.getByRole('checkbox',{name:'MIT'}));
 expect(a.getByRole('checkbox',{name:'MIT'})).toBeChecked();
 expect(a.getByRole('checkbox',{name:'EFD'})).toBeDisabled();
 expect(b.getByRole('checkbox',{name:'MIT'})).toBeEnabled();
 fireEvent.click(b.getByRole('checkbox',{name:'MIT'}));
 expect(screen.getByRole('button',{name:'Editar tarefa'})).toBeDisabled();
 await act(async()=>{terminar({ok:true});});
 await act(async()=>{rejeitar(new Error('Sem permissão'));});
 expect(a.getByRole('checkbox',{name:'MIT'})).not.toBeChecked(); expect(b.getByRole('checkbox',{name:'MIT'})).toBeChecked();
 expect(a.getByRole('alert')).toHaveTextContent('Sem permissão');
});
test('pessoal sem checklist pode concluir, reabrir e mantém companyId null', async () => {
 const pessoal={...item,empresas:[],subtarefas:[],alertaVencimento:'HOJE'};
 const {api}=montar({item:pessoal});
 fireEvent.click(screen.getByRole('checkbox',{name:'Concluir tarefa'}));
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Reabrir tarefa'})).toBeEnabled());
 expect(api.acaoTarefaCalendario).toHaveBeenCalledWith('t1',{acao:'CONCLUIR',cicloChave:'2026-10',companyId:null});
 expect(screen.queryByText(/Vence hoje/)).not.toBeInTheDocument();
});
test('cartão unificado abre checklist sem conclusão coletiva e sinaliza prazo por texto',()=>{
 const abrir=jest.fn(), onConcluir=jest.fn();
 const {container}=render(<AtividadeAgenda item={item} abrir={abrir} onConcluir={onConcluir}/>);
 fireEvent.click(screen.getByRole('checkbox'));
 expect(abrir).toHaveBeenCalledWith(item); expect(onConcluir).not.toHaveBeenCalled();
 expect(container.querySelector('.agenda-event')).toHaveClass('is-urgent');
 expect(screen.getByText('Vence amanhã')).toBeInTheDocument(); expect(screen.getByText('Até 18:00')).toBeInTheDocument();
});
