import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalendarioGrid } from '../renderCalendarioGrid';
import { criarMockAgenda } from '../../../../api/mock/agendaMock';
jest.setTimeout(20000);
configure({asyncUtilTimeout:5000});
const empresas = [{companyId:'a',razao:'Clínica Alfa',cnpj:'11.222.333/0001-81'},{companyId:'b',razao:'Consultoria Beta',cnpj:'22333444000181'}];
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
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'MENSAL'}});fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'OBRIGACAO'}});fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
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
    expect(evento.closest('.agenda-event')).toHaveStyle({top:'504px',height:'110px'});
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
  fireEvent.click(eventos[0]);expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();expect(screen.getAllByText('Vencimento fiscal · 21/09/2026')).toHaveLength(1);
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
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Conferir notas'}).filter(e=>e.closest('.agenda-event').classList.contains('is-complete'))).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Horário inicial'),{target:{value:'10:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const concluida=await screen.findByRole('button',{name:'Conferir NFS-e'});
  expect(concluida.closest('.agenda-event')).toHaveClass('is-complete');
  expect(concluida.closest('.agenda-event')).toHaveStyle({top:'560px'});
  expect(screen.getAllByRole('button',{name:'Conferir notas'})).toHaveLength(3);
  fireEvent.click(concluida);
  fireEvent.click(screen.getByRole('button',{name:'Reabrir tarefa'}));
  await screen.findByRole('button',{name:'Concluir tarefa'});
  fireEvent.click(screen.getByRole('button',{name:'Fechar',exact:true}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir NFS-e'}).closest('.agenda-event')).not.toHaveClass('is-complete'));
});

test('falha ao concluir mantém tarefa pendente e permite repetir no mesmo modal',async()=>{
  const {api}=montar();
  await api.salvarTarefaAgenda({titulo:'Revisar serviços',config:{...config,dataFim:config.dataInicio}});
  const acao=jest.spyOn(api,'acaoTarefaAgenda').mockRejectedValueOnce(new Error('Sem conexão'));
  fireEvent.click(await screen.findByRole('button',{name:'Revisar serviços'}));
  fireEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
  expect(screen.getByRole('button',{name:'Revisar serviços'}).closest('.agenda-event')).not.toHaveClass('is-complete');
  fireEvent.click(screen.getByRole('button',{name:'Concluir tarefa'}));
  await screen.findByRole('button',{name:'Reabrir tarefa'});
  expect(acao).toHaveBeenCalledTimes(2);
});

test('EFD mantém conclusões por empresa e permite editar grupo parcialmente concluído',async()=>{
  const obs=obrigacoes();
  Object.assign(obs[0].ocorrencias[0],{status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-11T12:00:00Z',concluidaPorId:'contador'});
  montar({obs,extras:{concluirOcorrencia:jest.fn(async id=>{
    const oc=obs.flatMap(o=>o.ocorrencias).find(o=>o.ocorrenciaId===id);oc.status='CONCLUIDA';oc.situacao='CONCLUIDA';return {ok:true};
  }),reabrirOcorrencia:jest.fn(async id=>{
    const oc=obs.flatMap(o=>o.ocorrencias).find(o=>o.ocorrenciaId===id);oc.status='PENDENTE';oc.situacao='PENDENTE';return {ok:true};
  })}});
  fireEvent.click(await screen.findByRole('button',{name:/EFD-Contribuições/}));
  expect(screen.getByRole('dialog')).toHaveClass('modal-fundo--lateral');
  const linhas=screen.getByRole('dialog').querySelectorAll('.agenda-company-row');
  expect(within(linhas[0]).getByText('11.222.333/0001-81')).toBeInTheDocument();
  expect(within(linhas[1]).getByText('22.333.444/0001-81')).toBeInTheDocument();
  const writeText=jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  fireEvent.click(within(linhas[0]).getByText('11.222.333/0001-81'));
  await waitFor(()=>expect(writeText).toHaveBeenCalledWith('11222333000181'));
  fireEvent.click(within(linhas[1]).getByText('22.333.444/0001-81'));
  await waitFor(()=>expect(writeText).toHaveBeenLastCalledWith('22333444000181'));
  expect(screen.getByRole('dialog')).toHaveClass('modal-fundo--lateral');
  expect(linhas[0]).toHaveClass('is-complete');
  expect(linhas[1]).not.toHaveClass('is-complete');
  expect(within(linhas[0]).getByText('Concluída')).toBeInTheDocument();
  expect(screen.getByLabelText('1 de 2 concluídas')).toHaveTextContent('1/2');
  expect(screen.queryByRole('button',{name:'Concluir tarefa'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Editar',exact:true}));
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Revisão EFD'}});
  fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-16'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(obs[0].ocorrencias[0]).toMatchObject({status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-11T12:00:00Z',concluidaPorId:'contador',dataFim:'2026-09-16',dataVencimento:'2026-09-21'});
  const evento=await screen.findByRole('button',{name:/Revisão EFD/});
  expect(evento.closest('.agenda-event')).not.toHaveClass('is-complete');fireEvent.click(evento);
  expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Concluir',exact:true}));
  await screen.findByText('2 de 2 concluídas');
  await waitFor(()=>expect(screen.getByRole('button',{name:/Revisão EFD/}).closest('.agenda-event')).toHaveClass('is-complete'));
  expect(screen.getByLabelText('2 de 2 concluídas')).toHaveTextContent('2/2');
  expect(screen.getByRole('dialog').querySelectorAll('.agenda-company-row.is-complete')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Fechar',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:/Revisão EFD/}));
  const reabertas=screen.getByRole('dialog').querySelectorAll('.agenda-company-row');
  expect(reabertas[0]).toHaveClass('is-complete');
  expect(reabertas[1]).toHaveClass('is-complete');
  fireEvent.click(within(reabertas[1]).getByRole('button',{name:'Reabrir',exact:true}));
  await waitFor(()=>expect(reabertas[1]).not.toHaveClass('is-complete'));
  expect(reabertas[0]).toHaveClass('is-complete');
  await waitFor(()=>expect(screen.getByLabelText('1 de 2 concluídas')).toHaveTextContent('1/2'));
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


test('vencimentos automáticos de guias ficam fora do calendário', async () => {
  montar({visao:'mes',extras:{getCalendario:jest.fn(async()=>({ok:true,dias:[{data:'2026-09-10',itens:[{id:'das',tipo:'guia',titulo:'SIMPLES'},{id:'inss',tipo:'guia',titulo:'INSS'},{id:'nota',tipo:'marco',titulo:'Reunião de serviços'}]}]}))}});
  expect(await screen.findByRole('button',{name:'Reunião de serviços'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'SIMPLES'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'INSS'})).not.toBeInTheDocument();
});

test('obrigação de 10 a 15 tem seis blocos azuis com horário, preserva empresas e janela ao editar', async () => {
  const obs=obrigacoes();obs.forEach(o=>o.agendaConfig={...o.agendaConfig,horaInicio:'09:00',horaFim:'10:00'});
  montar({obs,extras:{concluirOcorrencia:jest.fn(async id=>{const oc=obs.flatMap(o=>o.ocorrencias).find(o=>o.ocorrenciaId===id);oc.situacao='CONCLUIDA';return {ok:true};})}});
  const eventos=await screen.findAllByRole('button',{name:/EFD-Contribuições/});
  expect(eventos).toHaveLength(4);
  eventos.forEach(e=>{expect(e.closest('.agenda-time-day')).not.toBeNull();expect(e.closest('.agenda-event')).toHaveStyle({top:'504px',height:'54px'});expect(e.closest('.agenda-event').style.getPropertyValue('--event-color')).toBe('#1351b4');});
  fireEvent.click(eventos[1]);expect(screen.getByText('0 de 2 concluídas')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button',{name:'Concluir',exact:true})[0]);
  await screen.findByText('1 de 2 concluídas');
  fireEvent.click(screen.getByRole('button',{name:'Editar',exact:true}));
  expect(screen.getByLabelText('De')).toHaveValue('2026-09-10');expect(screen.getByLabelText('Até')).toHaveValue('2026-09-15');
  expect(screen.queryByRole('button',{name:'Alta'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  fireEvent.change(screen.getByLabelText('Visualização do calendário'),{target:{value:'mes'}});
  await waitFor(()=>expect(screen.getAllByRole('button',{name:/EFD-Contribuições/})).toHaveLength(6));
  expect(screen.getAllByRole('button',{name:/EFD-Contribuições/}).every(e=>e.closest('.agenda-month'))).toBe(true);
});

test('nota com horário continua visível no mês mesmo após três outras atividades', async () => {
  const tasks=Array.from({length:5},(_,n)=>({id:'t'+n,tarefaId:'t'+n,fonte:'TAREFA',tipo:'tarefa',titulo:n===4?'Conferir notas de serviços':'Atividade '+n,dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00',horaFim:'10:00'}));
  montar({extras:{getTarefasAgenda:jest.fn(async()=>({ok:true,tarefas:[],itens:tasks}))}});
  await screen.findByRole('button',{name:'Conferir notas de serviços'});
  fireEvent.change(screen.getByLabelText('Visualização do calendário'),{target:{value:'mes'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir notas de serviços'}).closest('.agenda-month')).not.toBeNull());
  expect(screen.getByRole('button',{name:'Conferir notas de serviços'})).not.toHaveTextContent('09:00');
  expect(screen.getAllByRole('button',{name:/Atividade [0-3]/})).toHaveLength(4);
});

test('configuração da obrigação existente carrega filtros e permite todas as empresas com folha', async () => {
  const regra={regraId:'regra-efd',nome:'EFD-Contribuições',agendaConfig:config,periodicidade:'MENSAL',diaVencimento:21,categoria:'fiscal',escopo:'POR_FILTRO',filtros:{regimes:['LUCRO_PRESUMIDO'],temFolha:null},aplicarANovas:true};
  const updateRegraObrigacao=jest.fn(async()=>({ok:true}));
  const {api}=montar({obs:obrigacoes(),extras:{listRegrasObrigacao:jest.fn(async()=>({ok:true,regras:[regra]})),updateRegraObrigacao}});
  fireEvent.click(await screen.findByRole('button',{name:/EFD-Contribuições/}));
  fireEvent.click(screen.getByRole('button',{name:'Configurar obrigação',exact:true}));
  expect(screen.getByLabelText('Título')).toHaveValue('EFD-Contribuições');
  expect(screen.getByLabelText('Recorrência')).toHaveValue('MENSAL');
  fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  expect(screen.getByLabelText('Lucro Presumido')).toBeChecked();
  expect(screen.getByLabelText('Dia do vencimento fiscal')).toHaveValue(21);
  fireEvent.click(screen.getByLabelText('Lucro Presumido'));fireEvent.click(screen.getByLabelText('Somente com folha'));
  await waitFor(()=>expect(api.previewEscopoRegra).toHaveBeenLastCalledWith({escopo:'POR_FILTRO',filtros:{regimes:[],temFolha:true}}));
  await screen.findByText('2 empresas');fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(updateRegraObrigacao).toHaveBeenCalledWith('regra-efd',expect.objectContaining({escopo:'POR_FILTRO',filtros:{regimes:[],temFolha:true},agendaConfig:expect.objectContaining({dataInicio:'2026-09-10',dataFim:'2026-09-15'})})));
  expect(api.createRegraObrigacao).not.toHaveBeenCalled();
});


test('mover pelo modal preserva duração e substitui o dia original, inclusive fora do mês', async () => {
  const {api}=montar();
  await api.salvarTarefaAgenda({titulo:'Revisar NFS-e',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00',horaFim:'10:00',recorrencia:'MENSAL'}});
  fireEvent.click(await screen.findByRole('button',{name:'Revisar NFS-e',exact:true}));
  fireEvent.change(screen.getByLabelText('De'),{target:{value:'2026-08-25'}});
  expect(screen.getByLabelText('Até')).toHaveValue('2026-08-25');
  fireEvent.change(screen.getByLabelText('Horário inicial'),{target:{value:'11:00'}});
  expect(screen.getByLabelText('Horário final')).toHaveValue('12:00');
  fireEvent.click(screen.getByRole('button',{name:'Salvar',exact:true}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const agosto=await api.getTarefasAgenda('2026-08-01','2026-08-31');
  expect(agosto.itens).toHaveLength(1);expect(agosto.itens[0]).toMatchObject({dataInicio:'2026-08-25',dataFim:'2026-08-25',horaInicio:'11:00',horaFim:'12:00'});
  expect((await api.getTarefasAgenda('2026-09-01','2026-09-30')).itens).toHaveLength(0);
  expect((await api.getTarefasAgenda('2026-10-01','2026-10-31')).itens).toHaveLength(1);
});

function prepararPonteiro(container) {
  const anterior=window.PointerEvent;
  window.PointerEvent=class extends MouseEvent {constructor(tipo,props){super(tipo,props);this.pointerId=props.pointerId;}};
  const grade=container.querySelector('.agenda-time-columns'),rolagem=container.querySelector('.agenda-time-scroll');
  grade.getBoundingClientRect=()=>({left:0,top:-392,width:756,height:1344,right:756,bottom:952});
  rolagem.getBoundingClientRect=()=>({left:0,top:0,width:756,height:800,right:756,bottom:800});
  grade.querySelectorAll('.agenda-time-day').forEach((el,i)=>{el.getBoundingClientRect=()=>({left:i*100,right:(i+1)*100,width:100});});
  grade.querySelector('.agenda-time-slot').getBoundingClientRect=()=>({height:56});
  return ()=>{window.PointerEvent=anterior;};
}
function arrastar(evento,x,y,alvo=evento) {
  fireEvent.pointerDown(alvo,{pointerId:1,button:0,clientX:350,clientY:140});
  fireEvent.pointerMove(evento,{pointerId:1,clientX:x,clientY:y});
  fireEvent.pointerUp(evento,{pointerId:1,clientX:x,clientY:y});
  fireEvent.click(evento);
}

test('arrastar obrigação move todas as empresas sem duplicar nem alterar conclusões ou vencimentos',async()=>{
  const obs=obrigacoes();
  obs.forEach(o=>{o.agendaConfig={...o.agendaConfig,horaInicio:'09:00',horaFim:'10:00'};o.ocorrencias[0].dataFim='2026-09-10';});
  Object.assign(obs[0].ocorrencias[0],{status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-10T12:00:00Z'});
  const {api,container}=montar({obs});const salvar=jest.spyOn(api,'editarOcorrenciasAgenda');
  const evento=await screen.findByRole('button',{name:/EFD-Contribuições/});const restaurar=prepararPonteiro(container);
  try {
    expect(evento.closest('.agenda-event')).toHaveClass('is-draggable');
    arrastar(evento,450,196);
    await waitFor(()=>expect(screen.getByRole('button',{name:/EFD-Contribuições/}).closest('.agenda-event')).toHaveStyle({top:'560px'}));
    expect(salvar).toHaveBeenCalledWith(['oc-a','oc-b'],expect.objectContaining({dataInicio:'2026-09-11',dataFim:'2026-09-11',horaInicio:'10:00',horaFim:'11:00'}));
    expect(screen.getAllByRole('button',{name:/EFD-Contribuições/})).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    obs.forEach(o=>{expect(o.ocorrencias).toHaveLength(1);expect(o.ocorrencias[0]).toMatchObject({cicloChave:'2026-09',dataVencimento:'2026-09-21'});});
    expect(obs[0].ocorrencias[0]).toMatchObject({status:'CONCLUIDA',situacao:'CONCLUIDA',concluidaEm:'2026-09-10T12:00:00Z'});
    await waitFor(()=>expect(screen.getByRole('button',{name:/EFD-Contribuições/}).closest('.agenda-event')).not.toHaveAttribute('aria-busy'));
    fireEvent.pointerDown(screen.getByRole('button',{name:/EFD-Contribuições/}),{pointerId:2,button:0});
    fireEvent.click(screen.getByRole('button',{name:/EFD-Contribuições/}));
    expect(screen.getByText('1 de 2 concluídas')).toBeInTheDocument();
  } finally {restaurar();}
});

test.each(['inicio','fim'])('redimensionar %s da obrigação ajusta o período com os mesmos controles das tarefas',async(borda)=>{
  const obs=obrigacoes();obs.forEach(o=>o.agendaConfig={...o.agendaConfig,horaInicio:'09:00',horaFim:'11:00'});
  const {container}=montar({obs});const eventos=await screen.findAllByRole('button',{name:/EFD-Contribuições/});const restaurar=prepararPonteiro(container);
  try {
    arrastar(eventos[0],350,196,eventos[0].closest('.agenda-event').querySelector(`[data-agenda-resize="${borda}"]`));
    const esperado=borda==='inicio'?{horaInicio:'10:00',horaFim:'11:00'}:{horaInicio:'09:00',horaFim:'12:00'};
    await waitFor(()=>expect(obs[0].ocorrencias[0].agendaConfig).toMatchObject(esperado));
    await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
    obs.forEach(o=>expect(o.ocorrencias[0]).toMatchObject({dataInicio:'2026-09-10',dataFim:'2026-09-15',agendaConfig:esperado}));
    expect(screen.getAllByRole('button',{name:/EFD-Contribuições/})).toHaveLength(4);
    screen.getAllByRole('button',{name:/EFD-Contribuições/}).forEach(e=>expect(e.closest('.agenda-event')).toHaveStyle({height:borda==='inicio'?'54px':'166px'}));
  } finally {restaurar();}
});

test.each(['IRRF','Simples Nacional'])('%s sem configuração de agenda recebe dia e horário ao soltar na grade',async(nome)=>{
  const obs=obrigacoes();obs.forEach(o=>{o.nome=nome;delete o.agendaConfig;o.ocorrencias[0].dataFim='2026-09-10';});
  const {api,container}=montar({obs});const evento=await screen.findByRole('button',{name:new RegExp(nome)});const restaurar=prepararPonteiro(container);
  try {
    expect(evento.closest('.agenda-all-day')).not.toBeNull();
    arrastar(evento,450,168);
    await waitFor(()=>expect(screen.getByRole('button',{name:new RegExp(nome)}).closest('.agenda-event')).toHaveStyle({top:'560px'}));
    expect(screen.getByRole('button',{name:new RegExp(nome)}).closest('.agenda-time-day')).not.toBeNull();
    expect(screen.getAllByRole('button',{name:new RegExp(nome)})).toHaveLength(1);
    jest.spyOn(api,'editarOcorrenciasAgenda').mockRejectedValueOnce(new Error('Sem conexão'));
    fireEvent.keyDown(screen.getByRole('button',{name:new RegExp(nome)}),{key:'ArrowDown',altKey:true});
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(screen.getByRole('button',{name:new RegExp(nome)}).closest('.agenda-event')).toHaveStyle({top:'560px'});
    obs.forEach(o=>expect(o.ocorrencias[0]).toMatchObject({dataInicio:'2026-09-11',dataFim:'2026-09-11',dataVencimento:'2026-09-21',agendaConfig:{horaInicio:'10:00',horaFim:null}}));
  } finally {restaurar();}
});

test('arrastar substitui a ocorrência diária, preserva duração e não abre o modal',async()=>{
  const {api,container}=montar();await api.salvarTarefaAgenda({titulo:'Notas diárias',config:{...config,horaInicio:'09:00',horaFim:'10:00'}});
  const eventos=await screen.findAllByRole('button',{name:'Notas diárias'});const restaurar=prepararPonteiro(container);
  try {
    arrastar(eventos[0],450,196);
    await waitFor(()=>expect(container.querySelectorAll('.agenda-event.is-draggable')).toHaveLength(4));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const itens=(await api.getTarefasAgenda('2026-09-07','2026-09-13')).itens;
    expect(itens).toHaveLength(4);expect(itens.filter(i=>i.dataInicio==='2026-09-10')).toHaveLength(0);
    expect(itens.find(i=>i.cicloChave==='2026-09@2026-09-10')).toMatchObject({dataInicio:'2026-09-11',dataFim:'2026-09-11',horaInicio:'10:00',horaFim:'11:00'});
    expect(itens.find(i=>i.cicloChave==='2026-09@2026-09-11')).toMatchObject({horaInicio:'09:00'});
  } finally {restaurar();}
});

test('esticar a borda muda somente o fim e falha de gravação mantém o horário salvo',async()=>{
  const {api,container}=montar();await api.salvarTarefaAgenda({titulo:'Reunião',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00',horaFim:'10:00'}});
  let evento=await screen.findByRole('button',{name:'Reunião'});const restaurar=prepararPonteiro(container);
  try {
    arrastar(evento,350,196,evento.closest('.agenda-event').querySelector('[data-agenda-resize="fim"]'));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Reunião'}).closest('.agenda-event')).toHaveStyle({height:'110px'}));
    expect((await api.getTarefasAgenda('2026-09-10','2026-09-10')).itens[0]).toMatchObject({horaInicio:'09:00',horaFim:'11:00'});
    jest.spyOn(api,'acaoTarefaAgenda').mockRejectedValueOnce(new Error('Sem conexão'));
    evento=screen.getByRole('button',{name:'Reunião'});arrastar(evento,350,252);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(screen.getByRole('button',{name:'Reunião'}).closest('.agenda-event')).toHaveStyle({top:'504px',height:'110px'});
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  } finally {restaurar();}
});

test('Escape cancela arraste sem gravar, e clique simples continua abrindo edição',async()=>{
  const {api,container}=montar();await api.salvarTarefaAgenda({titulo:'Cancelar movimento',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00'}});
  const evento=await screen.findByRole('button',{name:'Cancelar movimento'});const salvar=jest.spyOn(api,'acaoTarefaAgenda');const restaurar=prepararPonteiro(container);
  try {
    fireEvent.pointerDown(evento,{pointerId:1,button:0,clientX:350,clientY:140});fireEvent.pointerMove(evento,{pointerId:1,clientX:450,clientY:196});
    await waitFor(()=>expect(container.querySelector('.agenda-drag-preview')).not.toBeNull());fireEvent.keyDown(window,{key:'Escape'});
    fireEvent.pointerUp(evento,{pointerId:1,clientX:450,clientY:196});fireEvent.click(evento);
    expect(salvar).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.pointerDown(evento,{pointerId:2,button:0,clientX:350,clientY:140});fireEvent.pointerUp(evento,{pointerId:2,clientX:350,clientY:140});fireEvent.click(evento);
    expect(screen.getByRole('dialog',{name:'Editar atividade'})).toBeInTheDocument();
  } finally {restaurar();}
});


test('tarefa sem horário pode ser levada para a grade e ajustada pelo teclado',async()=>{
  const {api,container}=montar();await api.salvarTarefaAgenda({titulo:'Organizar documentos',config:{dataInicio:'2026-09-10',dataFim:'2026-09-10'}});
  const evento=await screen.findByRole('button',{name:'Organizar documentos'});const restaurar=prepararPonteiro(container);
  try {
    arrastar(evento,450,168);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Organizar documentos'}).closest('.agenda-time-day')).not.toBeNull());
    expect((await api.getTarefasAgenda('2026-09-07','2026-09-13')).itens).toEqual([expect.objectContaining({dataInicio:'2026-09-11',horaInicio:'10:00',horaFim:null})]);
    fireEvent.keyDown(screen.getByRole('button',{name:'Organizar documentos'}),{key:'ArrowDown',altKey:true,shiftKey:true});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Organizar documentos'}).closest('.agenda-event')).toHaveStyle({height:'40px'}));
    expect((await api.getTarefasAgenda('2026-09-07','2026-09-13')).itens[0]).toMatchObject({horaInicio:'10:00',horaFim:'10:45'});
  } finally {restaurar();}
});

test('desenhar intervalo abre um único modal central com título focado e horário selecionado',async()=>{
  const {container}=montar();await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  const restaurar=prepararPonteiro(container),slot=screen.getByLabelText('Criar atividade em 10/09/2026 às 09:00');
  try {
    fireEvent.pointerDown(slot,{pointerId:1,button:0,clientX:350,clientY:126});
    fireEvent.pointerMove(slot,{pointerId:1,clientX:350,clientY:210});
    await waitFor(()=>expect(container.querySelector('.agenda-drag-preview')).toHaveTextContent('09:15–10:45'));
    expect(container.querySelector('.agenda-drag-preview')).toHaveTextContent('90 min');
    fireEvent.pointerUp(slot,{pointerId:1,clientX:350,clientY:210});fireEvent.click(slot);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).not.toHaveClass('modal-fundo--lateral');
    expect(screen.getByLabelText('Título')).toHaveFocus();
    expect(screen.getByLabelText('Horário inicial')).toHaveValue('09:15');
    expect(screen.getByLabelText('Horário final')).toHaveValue('10:45');
  } finally {restaurar();}
});

test('gesto com resposta lenta mantém destino e permite mover outra atividade; atualização final é silenciosa',async()=>{
  const store=criarMockAgenda([],[]),cfg={dataInicio:'2026-09-10',dataFim:'2026-09-10',horaInicio:'09:00',horaFim:'10:00'};
  const a=await store.salvarTarefaAgenda({titulo:'Revisar A',config:cfg});await store.salvarTarefaAgenda({titulo:'Revisar B',config:cfg});
  let liberar;const atraso=new Promise(resolve=>{liberar=resolve;});
  const original=store.acaoTarefaAgenda;const acaoTarefaAgenda=jest.fn(async(id,dados)=>{if(id===a.tarefa.id)await atraso;return original(id,dados);});
  const getTarefasAgenda=jest.fn(store.getTarefasAgenda);
  const {api,container}=montar({extras:{...store,acaoTarefaAgenda,getTarefasAgenda}});
  const evento=await screen.findByRole('button',{name:'Revisar A'}),restaurar=prepararPonteiro(container);
  try {
    arrastar(evento,450,196);
    expect(screen.getByRole('button',{name:'Revisar A'}).closest('.agenda-event')).toHaveStyle({top:'560px'});
    expect(screen.getByRole('button',{name:'Revisar A'}).closest('.agenda-event')).toHaveAttribute('aria-busy','true');
    // Edição pelo modal aguarda somente esta ocorrência; outros gestos seguem disponíveis.
    fireEvent.pointerDown(screen.getByRole('button',{name:'Revisar A'}),{pointerId:2,button:0});
    fireEvent.pointerUp(screen.getByRole('button',{name:'Revisar A'}),{pointerId:2,clientX:0,clientY:0});
    fireEvent.click(screen.getByRole('button',{name:'Revisar A'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    arrastar(screen.getByRole('button',{name:'Revisar B'}),550,252);
    await waitFor(()=>expect(acaoTarefaAgenda).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button',{name:'Revisar B'}).closest('.agenda-event')).toHaveStyle({top:'616px'});
    expect(getTarefasAgenda).toHaveBeenCalledTimes(1);
    liberar();
    await waitFor(()=>expect(screen.queryByText('Salvando horário…')).not.toBeInTheDocument());
    await waitFor(()=>expect(getTarefasAgenda).toHaveBeenCalledTimes(2));
    expect(api.getCalendario).toHaveBeenCalledTimes(1);expect(api.listRegrasObrigacao).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button',{name:'Revisar A'})).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Revisar A'}).closest('.agenda-event')).toHaveStyle({top:'560px'});
  } finally {liberar();restaurar();}
});
