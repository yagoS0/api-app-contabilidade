import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { CalendarioAgenda } from '../CalendarioAgenda';
import { criarMockTarefasCalendario } from '../../../../api/mock/tarefasCalendarioMock';
const empresas=[{companyId:'a',razaoSocial:'Aurora',regime:'LUCRO_PRESUMIDO'},{companyId:'b',razaoSocial:'Horizonte',regime:'LUCRO_PRESUMIDO'}];
beforeAll(()=>{if(!global.crypto.randomUUID)global.crypto.randomUUID=()=>`t-${Math.random().toString(36).slice(2)}`;});
test('calendário usa apenas tarefas unificadas e abre o editor compacto a partir do dia',async()=>{
 const api={...criarMockTarefasCalendario(empresas),listObrigacoes:jest.fn(),getTarefasAgenda:jest.fn(),listRegrasObrigacao:jest.fn()};
 render(<CalendarioAgenda api={api} empresas={empresas} initialContext={{referencia:'2026-10-15',visao:'mes'}}/>);
 await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Tarefas anteriores'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa em 15/10/2026'}));
 expect(screen.getByRole('dialog')).toHaveTextContent('Nova tarefa');
 expect(screen.getByRole('button',{name:'Data e repetição'})).toHaveTextContent('15');
 expect(api.listObrigacoes).not.toHaveBeenCalled();
 expect(api.getTarefasAgenda).not.toHaveBeenCalled();
 expect(api.listRegrasObrigacao).not.toHaveBeenCalled();
});
test('checklist por empresa salva, risca empresa, e não conclui o próximo mês',async()=>{
 const api=criarMockTarefasCalendario(empresas);
 await api.criarTarefaCalendario({titulo:'Apuração',empresasIds:['a','b'],subtarefas:[{id:'mit',titulo:'MIT'},{id:'efd',titulo:'EFD'}],config:{dataInicio:'2026-10-15',dataFim:'2026-10-15',recorrencia:'MENSAL',diaVencimento:31}});
 render(<CalendarioAgenda api={api} empresas={empresas} initialContext={{referencia:'2026-10-15',visao:'mes'}}/>);
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'Apuração'}).length).toBeGreaterThan(0));
 fireEvent.click(screen.getAllByRole('button',{name:'Apuração'})[0]);
 fireEvent.click(screen.getAllByRole('checkbox',{name:'MIT'})[0]);
 await waitFor(()=>expect(screen.getAllByRole('checkbox',{name:'MIT'})[0]).toBeEnabled());
 fireEvent.click(screen.getAllByRole('checkbox',{name:'EFD'})[0]);
 await waitFor(()=>expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument());
 expect(screen.getByRole('region',{name:'Aurora'})).toHaveClass('is-complete');
 const novembro=await api.listarTarefasCalendario({inicio:'2026-11-01',fim:'2026-11-30'});
 expect(novembro.itens[0].empresas.every(e=>!e.concluida)).toBe(true);
});
test('aba de uma empresa carrega a carteira e já vincula a empresa da página',async()=>{
 const api={...criarMockTarefasCalendario(empresas),listCompanies:jest.fn().mockResolvedValue(empresas)};
 render(<CalendarioAgenda api={api} companyIdFixo="a" initialContext={{referencia:'2026-10-15',visao:'mes'}}/>);
 await waitFor(()=>expect(api.listCompanies).toHaveBeenCalledTimes(1));
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa em 15/10/2026'}));
 fireEvent.click(screen.getByRole('button',{name:'Empresas 1'}));
 expect(screen.getByRole('checkbox',{name:/Aurora/})).toBeChecked();
 expect(screen.getByRole('checkbox',{name:/Horizonte/})).not.toBeChecked();
});

test('célula semanal cria com data, início e término da hora escolhida',async()=>{
 const api=criarMockTarefasCalendario(empresas);
 render(<CalendarioAgenda api={api} empresas={empresas} initialContext={{referencia:'2026-10-15',visao:'semana'}}/>);
 await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa em 16/10/2026 às 10:00'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Título'}),{target:{value:'Criada pela célula'}});
 fireEvent.click(screen.getByRole('button',{name:'Criar tarefa',exact:true}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 const out=await api.listarTarefasCalendario({inicio:'2026-10-16',fim:'2026-10-16'});
 expect(out.itens[0].config).toMatchObject({horaInicio:'10:00',horaFim:'11:00',horarioModo:'FIXO'});
 expect(out.itens[0].dataInicio).toBe('2026-10-16');
});

test('redimensiona e move a ocorrência mantendo prazo e empresas',async()=>{
 const api=criarMockTarefasCalendario(empresas);
 await api.criarTarefaCalendario({titulo:'Bloco',empresasIds:['a','b'],subtarefas:[{id:'mit',titulo:'MIT'}],config:{dataInicio:'2026-10-15',dataFim:'2026-10-16',horarioModo:'FIXO',horaInicio:'09:00',horaFim:'10:00',recorrencia:'MENSAL',diaVencimento:31}});
 render(<CalendarioAgenda api={api} empresas={empresas} initialContext={{referencia:'2026-10-15',visao:'semana'}}/>);
 await screen.findAllByRole('button',{name:'Bloco',exact:true});
 fireEvent.keyDown(screen.getAllByRole('button',{name:'Bloco',exact:true})[0],{key:'ArrowDown',altKey:true,shiftKey:true});
 await waitFor(async()=>{const out=await api.listarTarefasCalendario({inicio:'2026-10-12',fim:'2026-10-18'});expect(out.itens[0].config.horaFim).toBe('10:15');});
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'Bloco',exact:true})[0]).toHaveAttribute('title',expect.stringContaining('10:15')));
 fireEvent.keyDown(screen.getAllByRole('button',{name:'Bloco',exact:true})[0],{key:'ArrowRight',altKey:true});
 await waitFor(async()=>{const out=await api.listarTarefasCalendario({inicio:'2026-10-12',fim:'2026-10-18'});expect(out.itens[0]).toMatchObject({dataInicio:'2026-10-16',dataFim:'2026-10-17'});expect(out.itens[0].config).toMatchObject({horaInicio:'09:00',horaFim:'10:15',diaVencimento:31});expect(out.itens[0].empresas).toHaveLength(2);});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
