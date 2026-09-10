import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CalendarioGrid } from '../renderCalendarioGrid';
import { criarMockAgenda } from '../../../../api/mock/agendaMock';
const empresas = [{companyId:'a',razao:'Clínica Alfa'},{companyId:'b',razao:'Consultoria Beta'}];
const config = {dataInicio:'2026-09-10',dataFim:'2026-09-15',recorrencia:'MENSAL',prioridade:'ALTA'};
const obrigacoes = () => empresas.map(e=>({obrigacaoId:`ob-${e.companyId}`,companyId:e.companyId,empresa:e.razao,nome:'EFD-Contribuições',tipo:'OBRIGACAO',regraId:'regra-efd',periodicidade:'MENSAL',ativa:true,agendaConfig:config,ocorrencias:[{ocorrenciaId:`oc-${e.companyId}`,cicloChave:'2026-09',dataInicio:config.dataInicio,dataFim:config.dataFim,dataVencimento:'2026-09-21',situacao:'PENDENTE',status:'PENDENTE'}]}));
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
test('segundo passo aplica regime e separa janela e vencimento fiscal',async()=>{
  const {api}=montar();fireEvent.click(screen.getByLabelText('Criar atividade em 10/09/2026'));fireEvent.change(screen.getByLabelText('Título'),{target:{value:'EFD-Contribuições'}});fireEvent.change(screen.getByLabelText('Até'),{target:{value:'2026-09-15'}});
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'MENSAL'}});fireEvent.click(screen.getByLabelText('Obrigação'));fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  fireEvent.change(screen.getByLabelText('Dia do vencimento fiscal'),{target:{value:'21'}});fireEvent.change(screen.getByLabelText('Aplicar a'),{target:{value:'POR_FILTRO'}});fireEvent.click(screen.getByLabelText('Lucro Presumido'));
  await screen.findByText('2 empresas');fireEvent.click(screen.getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(api.createRegraObrigacao).toHaveBeenCalledWith(expect.objectContaining({diaVencimento:21,agendaConfig:expect.objectContaining({dataInicio:'2026-09-10',dataFim:'2026-09-15'}),filtros:{regimes:['LUCRO_PRESUMIDO'],temFolha:null}})));
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
