import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalendarioGrid } from '../renderCalendarioGrid';
import { criarMockAgenda } from '../../../../api/mock/agendaMock';
jest.setTimeout(20000);
configure({asyncUtilTimeout:5000});
const empresas = [{companyId:'a',razao:'Clínica Alfa',cnpj:'11222333000181'},{companyId:'b',razao:'Consultoria Beta',cnpj:'22333444000181'}];
const config = {dataInicio:'2026-09-10',dataFim:'2026-09-15',recorrencia:'MENSAL',prioridade:'ALTA'};
const obrigacoes = () => empresas.map(e=>({obrigacaoId:`ob-${e.companyId}`,companyId:e.companyId,empresa:e.razao,cnpj:e.cnpj,nome:'EFD-Contribuições',tipo:'OBRIGACAO',regraId:'regra-efd',periodicidade:'MENSAL',ativa:true,agendaConfig:config,ocorrencias:[{ocorrenciaId:`oc-${e.companyId}`,cicloChave:'2026-09',dataInicio:config.dataInicio,dataFim:config.dataFim,dataVencimento:'2026-09-21',situacao:'PENDENTE',status:'PENDENTE'}]}));
function montar({visao='semana',referencia='2026-09-10',obs=[],extras={}}={}) {
  const api={...criarMockAgenda(obs,[]),getCalendario:jest.fn(async()=>({ok:true,dias:[]})),listObrigacoes:jest.fn(async()=>({ok:true,obrigacoes:obs.map(o=>({...o,ocorrencias:o.ocorrencias.filter(oc=>!oc.canceladaEm)})).filter(o=>o.ativa!==false),opcoes:{}})),listRegrasObrigacao:jest.fn(async()=>({ok:true,regras:[]})),previewEscopoRegra:jest.fn(async()=>({ok:true,total:2,empresas})),createRegraObrigacao:jest.fn(async()=>({ok:true})),...extras};
  jest.spyOn(api,'excluirOcorrenciasAgenda');jest.spyOn(api,'excluirSerieAgenda');jest.spyOn(api,'salvarTarefaAgenda');
  return {api,...render(<CalendarioGrid api={api} empresas={empresas} initialContext={{visao,referencia}}/>)};
}
test.each([['2026-01-31','fevereiro de 2026'],['2024-02-29','março de 2024'],['2026-12-31','janeiro de 2027']])('navega um mês civil de %s',async(referencia,destino)=>{
  montar({visao:'mes',referencia});fireEvent.click(screen.getByRole('button',{name:'Próximo período'}));expect(await screen.findByText(destino)).toBeInTheDocument();
});
test('semana limpa: horários à direita, sem botão de adicionar nem seletor de empresa',async()=>{
  const {container}=montar();await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Visualização do calendário')).toHaveValue('semana');expect(container.querySelector('.agenda-time-columns').lastElementChild).toHaveClass('agenda-hours');
  expect(screen.queryByText('Tarefas e obrigações')).not.toBeInTheDocument();expect(screen.queryByLabelText('Empresa')).not.toBeInTheDocument();expect(screen.queryByText(/Filtros e legenda/)).not.toBeInTheDocument();
});
test('clique no horário cria tarefa sem empresa com recorrência e cor',async()=>{
  const {api}=montar();await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());fireEvent.click(screen.getByLabelText('Criar atividade em 10/09/2026 às 09:00'));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferir NFS-e'}});expect(screen.getByLabelText('Horário inicial')).toHaveValue('09:00');
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'SEMANAL'}});fireEvent.click(screen.getByRole('button',{name:'Alta'}));fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.salvarTarefaAgenda).toHaveBeenCalledWith(expect.objectContaining({titulo:'Conferir NFS-e',config:expect.objectContaining({recorrencia:'SEMANAL',prioridade:'ALTA',horaInicio:'09:00'})})));
  expect(await screen.findByRole('button',{name:'Conferir NFS-e'})).toBeInTheDocument();
});

test('tarefa permite horário fixo, editar para intervalo e remover horário',async()=>{
  const {api}=montar();await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Criar atividade em 10/09/2026 às 09:00'));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Revisar notas'}});
  fireEvent.change(screen.getByLabelText('Horário',{exact:true}),{target:{value:'FIXO'}});
  fireEvent.change(screen.getByLabelText('Às'),{target:{value:'09:30'}});
  expect(screen.queryByLabelText('Horário final')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.salvarTarefaAgenda).toHaveBeenCalledWith(expect.objectContaining({config:expect.objectContaining({horaInicio:'09:30',horaFim:null})})));
  fireEvent.click(await screen.findByRole('button',{name:'Revisar notas'}));
  expect(screen.getByLabelText('Horário',{exact:true})).toHaveValue('FIXO');
  fireEvent.change(screen.getByLabelText('Horário',{exact:true}),{target:{value:'INTERVALO'}});
  fireEvent.change(screen.getByLabelText('Horário final'),{target:{value:'10:45'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(await screen.findByRole('button',{name:'Revisar notas'}));
  expect(screen.getByLabelText('Horário final')).toHaveValue('10:45');
  fireEvent.change(screen.getByLabelText('Horário',{exact:true}),{target:{value:'SEM'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Revisar notas'}).closest('.agenda-bands')).not.toBeNull());
  fireEvent.click(await screen.findByRole('button',{name:'Revisar notas'}));
  expect(screen.getByLabelText('De')).toHaveValue('2026-09-10');
});
test('segundo passo aplica regime e separa janela e vencimento fiscal',async()=>{
  const {api}=montar();fireEvent.click(screen.getByLabelText('Criar atividade em 10/09/2026'));fireEvent.change(screen.getByLabelText('Título'),{target:{value:'EFD-Contribuições'}});fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-15'}});
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'MENSAL'}});fireEvent.click(screen.getByLabelText('Obrigação'));fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  fireEvent.change(screen.getByLabelText('Dia do vencimento fiscal'),{target:{value:'21'}});fireEvent.change(screen.getByLabelText('Aplicar a'),{target:{value:'POR_FILTRO'}});fireEvent.click(screen.getByLabelText('Lucro Presumido'));
  await screen.findByText('2 empresas');fireEvent.click(screen.getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(api.createRegraObrigacao).toHaveBeenCalledWith(expect.objectContaining({diaVencimento:21,agendaConfig:expect.objectContaining({dataInicio:'2026-09-10',dataFim:'2026-09-15'}),filtros:{regimes:['LUCRO_PRESUMIDO'],temFolha:null}})));
});

test('editar a tarefa de 10 a 15 mostra blocos diários das 9 às 11 em duas semanas',async()=>{
  montar();await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Criar atividade em 10/09/2026 às 09:00'));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferência de notas'}});
  fireEvent.change(screen.getByLabelText('Horário final'),{target:{value:'11:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  fireEvent.click(await screen.findByRole('button',{name:'Conferência de notas'}));
  fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-15'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Conferência de notas'})).toHaveLength(4));
  for(const evento of screen.getAllByRole('button',{name:'Conferência de notas'})) {
    expect(evento.closest('.agenda-time-columns')).not.toBeNull();
    expect(evento).toHaveStyle({top:'504px',height:'110px'});
  }
  fireEvent.click(screen.getAllByRole('button',{name:'Conferência de notas'})[2]);
  fireEvent.click(screen.getByRole('button',{name:'Excluir ocorrência',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Excluir',exact:true}));
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Conferência de notas'})).toHaveLength(3));
  fireEvent.click(screen.getByRole('button',{name:'Próximo período'}));
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Conferência de notas'})).toHaveLength(2));
});
test('faixa agrupa empresas e mostra conclusão parcial e prazo fiscal',async()=>{
  const obs=obrigacoes();obs[0].ocorrencias[0].situacao='CONCLUIDA';const {container}=montar({obs});const eventos=await screen.findAllByRole('button',{name:/EFD-Contribuições/});expect(eventos).toHaveLength(1);expect(container.querySelector('.agenda-event')).not.toHaveClass('is-complete');
  fireEvent.click(eventos[0]);expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();expect(screen.getAllByText('Vencimento fiscal · 21/09/2026')).toHaveLength(2);
});
test('excluir faixa cancela só este ciclo inclusive concluída, preservando histórico',async()=>{
  const obs=obrigacoes();obs[0].ocorrencias[0].status='CONCLUIDA';const {api}=montar({obs});fireEvent.click(await screen.findByRole('button',{name:/EFD-Contribuições/}));fireEvent.click(screen.getAllByRole('button',{name:'Excluir ocorrência'}).at(-1));fireEvent.click(screen.getByRole('button',{name:'Excluir',exact:true}));
  await waitFor(()=>expect(api.excluirOcorrenciasAgenda).toHaveBeenCalledWith(['oc-a','oc-b']));expect(api.excluirSerieAgenda).not.toHaveBeenCalled();expect(obs[0].ocorrencias[0].status).toBe('CONCLUIDA');expect(obs[0].ocorrencias[0].canceladaEm).toBeTruthy();
});
test('lista filtra obrigações e permite excluir a série completa',async()=>{
  const {api}=montar({obs:obrigacoes()});await screen.findByRole('button',{name:/EFD-Contribuições/});fireEvent.click(screen.getByRole('button',{name:'Lista'}));fireEvent.change(screen.getByLabelText('Filtrar atividades'),{target:{value:'obrigacao'}});fireEvent.click(await screen.findByRole('button',{name:'Excluir série'}));fireEvent.click(screen.getByRole('button',{name:'Excluir',exact:true}));
  await waitFor(()=>expect(api.excluirSerieAgenda).toHaveBeenCalledWith({regraId:'regra-efd'}));expect(api.excluirOcorrenciasAgenda).not.toHaveBeenCalled();
});
test('mês divide intervalo entre semanas e lista conta uma série',async()=>{
  montar({visao:'mes',obs:obrigacoes()});expect(await screen.findAllByRole('button',{name:/EFD-Contribuições/})).toHaveLength(2);fireEvent.click(screen.getByRole('button',{name:'Lista'}));expect(await screen.findAllByRole('button',{name:/EFD-Contribuições/})).toHaveLength(1);
});
test('falha permite tentar novamente',async()=>{
  const getCalendario=jest.fn().mockRejectedValueOnce(new Error('Sem conexão')).mockResolvedValue({ok:true,dias:[]});montar({extras:{getCalendario}});expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});


test('tarefa abre edição central, mantém rascunho ao concluir e permanece riscada só naquele dia',async()=>{
  const {api}=montar();
  await api.salvarTarefaAgenda({titulo:'Conferir notas',config:{...config,horaInicio:'09:00',horaFim:'11:00'}});
  const eventos=await screen.findAllByRole('button',{name:'Conferir notas'});
  fireEvent.click(eventos[0]);
  expect(screen.getByRole('dialog',{name:'Editar atividade'})).not.toHaveClass('modal-fundo--lateral');
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferir NFS-e'}});
  fireEvent.change(screen.getByLabelText('Descrição'),{target:{value:'Revisar notas de serviços'}});
  fireEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
  await screen.findByRole('button',{name:'Reabrir tarefa'});
  expect(screen.getByLabelText('Título')).toHaveValue('Conferir NFS-e');
  expect(screen.getByLabelText('Descrição')).toHaveValue('Revisar notas de serviços');
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Conferir notas'}).filter(e=>e.classList.contains('is-complete'))).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Horário inicial'),{target:{value:'10:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const concluida=await screen.findByRole('button',{name:'Conferir NFS-e'});
  expect(concluida).toHaveClass('is-complete');
  expect(concluida).toHaveStyle({top:'560px'});
  expect(screen.getAllByRole('button',{name:'Conferir notas'})).toHaveLength(3);
  fireEvent.click(concluida);
  fireEvent.click(screen.getByRole('button',{name:'Reabrir tarefa'}));
  await screen.findByRole('button',{name:'Concluir tarefa'});
  fireEvent.click(screen.getByRole('button',{name:'Fechar',exact:true}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir NFS-e'})).not.toHaveClass('is-complete'));
});

test('falha ao concluir mantém tarefa pendente e permite repetir no mesmo modal',async()=>{
  const {api}=montar();
  await api.salvarTarefaAgenda({titulo:'Revisar serviços',config:{...config,dataFim:config.dataInicio}});
  const acao=jest.spyOn(api,'acaoTarefaAgenda').mockRejectedValueOnce(new Error('Sem conexão'));
  fireEvent.click(await screen.findByRole('button',{name:'Revisar serviços'}));
  fireEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
  expect(screen.getByRole('button',{name:'Revisar serviços'})).not.toHaveClass('is-complete');
  fireEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
  await screen.findByRole('button',{name:'Reabrir tarefa'});
  expect(acao).toHaveBeenCalledTimes(2);
});

test('EFD mantém conclusões por empresa e permite editar grupo parcialmente concluído',async()=>{
  const obs=obrigacoes();
  Object.assign(obs[0].ocorrencias[0],{status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-11T12:00:00Z',concluidaPorId:'contador'});
  montar({obs,extras:{concluirOcorrencia:jest.fn(async id=>{
    const oc=obs.flatMap(o=>o.ocorrencias).find(o=>o.ocorrenciaId===id);oc.status='CONCLUIDA';oc.situacao='CONCLUIDA';return {ok:true};
  })}});
  fireEvent.click(await screen.findByRole('button',{name:/EFD-Contribuições/}));
  expect(screen.getByRole('dialog')).toHaveClass('modal-fundo--lateral');
  const linhas=screen.getByRole('dialog').querySelectorAll('.agenda-company-row');
  expect(within(linhas[0]).getByText('CNPJ 11.222.333/0001-81')).toBeInTheDocument();
  expect(within(linhas[1]).getByText('CNPJ 22.333.444/0001-81')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Concluir tarefa'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Editar',exact:true}));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Revisão EFD'}});
  fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-16'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(obs[0].ocorrencias[0]).toMatchObject({status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-11T12:00:00Z',concluidaPorId:'contador',dataFim:'2026-09-16',dataVencimento:'2026-09-21'});
  const evento=await screen.findByRole('button',{name:/Revisão EFD/});
  expect(evento).not.toHaveClass('is-complete');fireEvent.click(evento);
  expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Concluir',exact:true}));
  await screen.findByText('2 de 2 concluídas');
  await waitFor(()=>expect(screen.getByRole('button',{name:/Revisão EFD/})).toHaveClass('is-complete'));
});


test('tarefa da lista abre o mesmo editor central com conclusão',async()=>{
  const {api}=montar();
  await api.salvarTarefaAgenda({titulo:'Conferir serviços',config:{...config,dataFim:config.dataInicio}});
  await screen.findByRole('button',{name:'Conferir serviços'});
  fireEvent.click(screen.getByRole('button',{name:'Lista',exact:true}));
  fireEvent.click(await screen.findByRole('button',{name:/Conferir serviços Todo mês/}));
  expect(screen.getByRole('dialog',{name:'Editar atividade'})).not.toHaveClass('modal-fundo--lateral');
  expect(screen.getByLabelText('Título')).toHaveFocus();
  expect(screen.getByRole('button',{name:'Concluir tarefa'})).toBeInTheDocument();
});
