import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {CalendarioAgenda} from '../CalendarioAgenda';
import {MenuTarefaCalendario} from '../MenuTarefaCalendario';
import {criarMockTarefasCalendario} from '../../../../api/mock/tarefasCalendarioMock';
const ctx={referencia:'2026-10-15',visao:'dia'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('menu conserva teclado, retorno de foco e identidade da ocorrência', () => {
 const item={id:'ocorrencia',titulo:'Tarefa teste'}, duplicar=jest.fn(), excluir=jest.fn();
 render(<MenuTarefaCalendario item={item} onDuplicar={duplicar} onExcluir={excluir}/>);
 const gatilho=screen.getByRole('button',{name:'Ações de Tarefa teste'});
 fireEvent.click(gatilho);
 const primeira=screen.getByRole('menuitem',{name:'Duplicar ocorrência'});
 expect(primeira).toHaveFocus();
 fireEvent.keyDown(primeira,{key:'ArrowDown'});
 const ultima=screen.getByRole('menuitem',{name:'Excluir ocorrência'});
 expect(ultima).toHaveFocus();
 fireEvent.keyDown(ultima,{key:'Escape'});
 expect(gatilho).toHaveFocus();
 expect(screen.queryByRole('menu')).not.toBeInTheDocument();
 expect(excluir).not.toHaveBeenCalled();
 fireEvent.click(gatilho);
 fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 expect(duplicar).toHaveBeenCalledWith(item);
 expect(duplicar).toHaveBeenCalledTimes(1);
 expect(gatilho).toHaveFocus();
});
async function montar() {
 const api=criarMockTarefasCalendario([]);
 const one=await api.criarTarefaCalendario({titulo:'Original',config:{dataInicio:'2026-10-15',recorrencia:'MENSAL'}});
 await api.criarTarefaCalendario({titulo:'Outra tarefa',config:{dataInicio:'2026-10-15'}});
 return {api,one};
}
async function abrirMenu(titulo='Original'){
 await waitFor(()=>expect(screen.getByRole('button',{name:`Ações de ${titulo}`})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:`Ações de ${titulo}`}));
}
test('menu usa teclado, duplica pendente e exclusão afeta somente ocorrência com confirmação',async()=>{
 const {api,one}=await montar();
 await api.acaoTarefaCalendario(one.tarefa.id,{acao:'CONCLUIR',cicloChave:'2026-10'});
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();
 expect(screen.getByRole('menuitem',{name:'Duplicar ocorrência'})).toHaveFocus();
 fireEvent.keyDown(document.activeElement,{key:'ArrowDown'});
 expect(screen.getByRole('menuitem',{name:'Excluir ocorrência'})).toHaveFocus();
 fireEvent.keyDown(document.activeElement,{key:'Escape'});
 expect(screen.queryByRole('menu')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Ações de Original'})).toHaveFocus();
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 await screen.findByRole('button',{name:'Original (cópia)',exact:true});
 expect(screen.getByRole('checkbox',{name:'Concluir Original (cópia)'})).not.toBeChecked();
 expect(screen.getByRole('checkbox',{name:'Reabrir Original',exact:true})).toBeChecked();
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Excluir ocorrência'}));
 fireEvent.click(screen.getByRole('button',{name:'Cancelar',exact:true}));
 expect(screen.getByRole('button',{name:'Original',exact:true})).toBeInTheDocument();
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Excluir ocorrência'}));
 fireEvent.click(screen.getByRole('button',{name:'Excluir',exact:true}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Original',exact:true})).not.toBeInTheDocument();
 const november=await api.listarTarefasCalendario({inicio:'2026-11-01',fim:'2026-11-30'});
 expect(november.itens).toHaveLength(1);expect(november.itens[0].titulo).toBe('Original');
});
test('mutação lenta bloqueia outros menus e não desmonta grade nem perde rolagem',async()=>{
 const {api}=await montar(),pending=deferred(),action=api.acaoTarefaCalendario;
 api.acaoTarefaCalendario=jest.fn(async(...args)=>{await pending.promise;return action(...args);});
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();const grid=document.querySelector('.agenda-time-scroll');grid.scrollTop=600;
 fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 expect(screen.getByRole('button',{name:'Ações de Outra tarefa'})).toBeDisabled();
 expect(screen.getByRole('checkbox',{name:'Concluir Outra tarefa'})).toBeDisabled();
 expect(document.querySelector('.agenda-time-scroll')).toBe(grid);
 await act(async()=>pending.resolve());await screen.findByRole('button',{name:'Original (cópia)',exact:true});
 expect(document.querySelector('.agenda-time-scroll')).toBe(grid);expect(grid.scrollTop).toBe(600);
 expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(1);
});
test('resposta perdida da duplicação repete mesma intenção e não cria outra cópia',async()=>{
 const {api}=await montar(),action=api.acaoTarefaCalendario;let fail=true;
 api.acaoTarefaCalendario=jest.fn(async(...args)=>{const out=await action(...args);if(fail){fail=false;throw new Error('Resposta perdida');}return out;});
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 await screen.findByRole('alert');await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 await screen.findByRole('button',{name:'Original (cópia)',exact:true});
 const calls=api.acaoTarefaCalendario.mock.calls;
 expect(calls[0][1].intencaoId).toBe(calls[1][1].intencaoId);
 const out=await api.listarTarefasCalendario({inicio:'2026-10-15',fim:'2026-10-15'});
 expect(out.itens.filter(i=>i.titulo==='Original (cópia)')).toHaveLength(1);
});
test('troca de período ignora resposta anterior atrasada',async()=>{
 const {api}=await montar(),list=api.listarTarefasCalendario,pending=deferred();let delay=false;
 api.listarTarefasCalendario=jest.fn(async q=>{const out=await list(q);if(delay&&q.inicio==='2026-10-16'){await pending.promise;return {itens:[{...out.itens[0],titulo:'Resposta velha'}]};}return out;});
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await screen.findByRole('button',{name:'Original',exact:true});delay=true;
 fireEvent.click(screen.getByRole('button',{name:'Próximo período'}));
 await waitFor(()=>expect(api.listarTarefasCalendario).toHaveBeenCalledWith(expect.objectContaining({inicio:'2026-10-16'})));
 fireEvent.click(screen.getByRole('button',{name:'Período anterior'}));
 await screen.findByRole('button',{name:'Original',exact:true});
 await act(async()=>pending.resolve());expect(screen.queryByRole('button',{name:'Resposta velha',exact:true})).not.toBeInTheDocument();
});

test('remontagem após resposta perdida recupera mesma intenção guardada na aba',async()=>{
 sessionStorage.clear();const {api}=await montar(),action=api.acaoTarefaCalendario;let fail=true;
 api.acaoTarefaCalendario=jest.fn(async(...args)=>{const out=await action(...args);if(fail){fail=false;throw new Error('Resposta perdida');}return out;});
 const first=render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));await screen.findByRole('alert');
 first.unmount();render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 await waitFor(()=>expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(2));
 expect(api.acaoTarefaCalendario.mock.calls[0][1].intencaoId).toBe(api.acaoTarefaCalendario.mock.calls[1][1].intencaoId);
 const out=await api.listarTarefasCalendario({inicio:'2026-10-15',fim:'2026-10-15'});
 expect(out.itens.filter(i=>i.titulo==='Original (cópia)')).toHaveLength(1);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Ações de Original'})).toHaveFocus());
});
test('armazenamento indisponível bloqueia duplicação antes de enviar',async()=>{
 const {api}=await montar();api.acaoTarefaCalendario=jest.fn();
 const storage=jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});
 try {
  render(<CalendarioAgenda api={api} initialContext={ctx}/>);await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('duplicação não foi enviada');expect(api.acaoTarefaCalendario).not.toHaveBeenCalled();
 } finally{storage.mockRestore();}
});
test.each(['painel','editor'])('GET antigo não sobrescreve confirmação pelo %s',async modo=>{
 const api=criarMockTarefasCalendario([]);
 await api.criarTarefaCalendario({titulo:'Checklist',subtarefas:[{id:'s',titulo:'Conferir'}],config:{dataInicio:'2026-10-15'}});
 const list=api.listarTarefasCalendario,pending=deferred();
 const rendered=render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await screen.findByRole('button',{name:'Checklist',exact:true});
 const old=JSON.parse(JSON.stringify(await list({inicio:'2026-10-15',fim:'2026-10-15'})));let first=true;
 const changed={...api,listarTarefasCalendario:jest.fn(q=>{if(first){first=false;return pending.promise;}return list(q);})};
 rendered.rerender(<CalendarioAgenda api={changed} initialContext={ctx}/>);
 await waitFor(()=>expect(changed.listarTarefasCalendario).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:'Checklist',exact:true}));
 if(modo==='painel'){
  fireEvent.click(screen.getByRole('checkbox',{name:'Conferir',exact:true}));
  await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Conferir',exact:true})).toBeChecked());
  await waitFor(()=>expect(changed.listarTarefasCalendario).toHaveBeenCalledTimes(2));
 }else{
  fireEvent.click(screen.getByRole('button',{name:'Editar tarefa',exact:true}));
  fireEvent.change(screen.getByRole('textbox',{name:'Título',exact:true}),{target:{value:'Título confirmado'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar',exact:true}));
  await screen.findByRole('button',{name:'Título confirmado',exact:true});
 }
 await act(async()=>pending.resolve(old));
 if(modo==='painel')expect(screen.getByRole('checkbox',{name:'Conferir',exact:true})).toBeChecked();
 else expect(screen.queryByRole('button',{name:'Checklist',exact:true})).not.toBeInTheDocument();
});


test('cópia excluída após resposta perdida exige nova ação explícita com outra intenção',async()=>{
 sessionStorage.clear();const {api}=await montar(),action=api.acaoTarefaCalendario;let fail=true,copyId;
 api.acaoTarefaCalendario=jest.fn(async(...args)=>{const out=await action(...args);if(fail){copyId=out.tarefa.id;fail=false;throw new Error('Resposta perdida');}return out;});
 const first=render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));await screen.findByRole('alert');
 await action(copyId,{acao:'EXCLUIR',cicloChave:'2026-10-15'});
 first.unmount();render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 const newAction=await screen.findByRole('button',{name:'Iniciar nova duplicação'});
 expect(screen.getByRole('alert')).toHaveTextContent('cópia anterior continuará excluída');
 expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(2);
 expect(api.acaoTarefaCalendario.mock.calls[1][1].intencaoId).toBe(api.acaoTarefaCalendario.mock.calls[0][1].intencaoId);
 // Nenhuma tentativa automática: só esta nova decisão cria uma intenção diferente.
 fireEvent.click(newAction);fireEvent.click(newAction);
 await screen.findByRole('button',{name:'Original (cópia)',exact:true});
 expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(3);
 expect(api.acaoTarefaCalendario.mock.calls[2][1].intencaoId).not.toBe(api.acaoTarefaCalendario.mock.calls[0][1].intencaoId);
 const out=await api.listarTarefasCalendario({inicio:'2026-10-15',fim:'2026-10-15'});
 expect(out.itens.filter(i=>i.titulo==='Original (cópia)')).toHaveLength(1);
 expect(out.itens.find(i=>i.titulo==='Original (cópia)').tarefaId).not.toBe(copyId);
});
test('409 genérico conserva intenção e não oferece recuperação definitiva',async()=>{
 sessionStorage.clear();const {api}=await montar();
 api.acaoTarefaCalendario=jest.fn().mockRejectedValue(Object.assign(new Error('Conflito sem resultado definitivo'),{status:409,code:'OTHER_CONFLICT'}));
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Iniciar nova duplicação'})).not.toBeInTheDocument();
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));
 await waitFor(()=>expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(2));
 expect(api.acaoTarefaCalendario.mock.calls[0][1].intencaoId).toBe(api.acaoTarefaCalendario.mock.calls[1][1].intencaoId);
});
test('ação de recuperação desaparece ao trocar o contexto e não cria cópia em outra tela',async()=>{
 const {api}=await montar();api.acaoTarefaCalendario=jest.fn().mockRejectedValue(Object.assign(new Error('Cópia excluída'),{status:409,code:'CALENDAR_COPY_DELETED'}));
 render(<CalendarioAgenda api={api} initialContext={ctx}/>);
 await abrirMenu();fireEvent.click(screen.getByRole('menuitem',{name:'Duplicar ocorrência'}));await screen.findByRole('button',{name:'Iniciar nova duplicação'});
 fireEvent.click(screen.getByRole('button',{name:'Próximo período'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Iniciar nova duplicação'})).not.toBeInTheDocument());
 expect(api.acaoTarefaCalendario).toHaveBeenCalledTimes(1);
});
