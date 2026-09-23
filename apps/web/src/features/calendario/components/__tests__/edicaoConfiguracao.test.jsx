import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModalAtividade } from '../ModalAtividade';

const inicial = { tarefaId:'tarefa', cicloChave:'2026-09-10', tipo:'tarefa', titulo:'Conferir notas', dataInicio:'2026-09-10', dataFim:'2026-09-10', horaInicio:'09:00', horaFim:'10:00', recorrencia:'AVULSA' };
function montar(overrides = {}, apiOverrides = {}) {
  const api = { acaoTarefaAgenda:jest.fn(async()=>({ok:true})), previewEscopoRegra:jest.fn(async()=>({ok:true,total:2})), converterTarefaEmObrigacao:jest.fn(async()=>({ok:true})), updateRegraObrigacao:jest.fn(async()=>({ok:true})), editarOcorrenciasAgenda:jest.fn(async()=>({ok:true})), ...apiOverrides };
  const onSalvo = jest.fn();
  render(<ModalAtividade inicial={{...inicial,...overrides}} empresas={[]} api={api} onSalvo={onSalvo} onFechar={()=>{}}/>);
  return {api,onSalvo};
}

test.each(['DIARIA','SEMANAL','MENSAL','SEMESTRAL','ANUAL'])('editar tarefa permite repetição %s e aplica às próximas',async(recorrencia)=>{
  const {api,onSalvo}=montar();
  expect(screen.getByLabelText('Tipo')).toHaveValue('TAREFA');
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:recorrencia}});
  expect(screen.getByLabelText('Aplicar alterações')).toHaveValue('SERIE');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.acaoTarefaAgenda).toHaveBeenCalledWith('tarefa',expect.objectContaining({acao:'EDITAR_SERIE',cicloChave:'2026-09-10',alteracoes:expect.objectContaining({recorrencia,horaInicio:'09:00',horaFim:'10:00'})})));
  expect(onSalvo).toHaveBeenCalled();
});

test('mudar apenas horário continua alterando uma ocorrência',async()=>{
  const {api}=montar({recorrencia:'MENSAL'});
  fireEvent.change(screen.getByLabelText('Horário inicial'),{target:{value:'08:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.acaoTarefaAgenda).toHaveBeenCalledWith('tarefa',expect.objectContaining({acao:'EDITAR',alteracoes:expect.objectContaining({horaInicio:'08:00'})})));
});

test('voltar para ocorrência desfaz mudança de repetição antes de salvar',async()=>{
  const {api}=montar({recorrencia:'MENSAL'});
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'ANUAL'}});
  fireEvent.change(screen.getByLabelText('Aplicar alterações'),{target:{value:'ESTA'}});
  expect(screen.getByLabelText('Recorrência')).toHaveValue('MENSAL');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.acaoTarefaAgenda).toHaveBeenCalledWith('tarefa',expect.objectContaining({acao:'EDITAR'})));
});

test('transformar tarefa em obrigação usa conversão atômica com empresas e frequência',async()=>{
  const {api}=montar();
  fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'OBRIGACAO'}});
  fireEvent.change(screen.getByLabelText('Recorrência'),{target:{value:'MENSAL'}});
  fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  fireEvent.change(screen.getByLabelText('Dia do vencimento fiscal'),{target:{value:'21'}});
  await screen.findByText('2 empresas');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.converterTarefaEmObrigacao).toHaveBeenCalledWith('tarefa',expect.objectContaining({cicloChave:'2026-09-10',regra:expect.objectContaining({tipo:'OBRIGACAO',periodicidade:'MENSAL',escopo:'TODAS'})})));
  expect(api.acaoTarefaAgenda).not.toHaveBeenCalled();
});

test('falha na conversão mantém formulário e não confirma sucesso',async()=>{
  const {onSalvo}=montar({}, {converterTarefaEmObrigacao:jest.fn(async()=>({ok:false,message:'Há atividades concluídas neste período.'}))});
  fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'OBRIGACAO'}});
  fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  await screen.findByText('2 empresas');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Há atividades concluídas');
  expect(onSalvo).not.toHaveBeenCalled();
});

test('obrigação existente mantém tipo correto e edição individual preserva empresas',async()=>{
  const {api}=montar({tarefaId:undefined,ocorrenciaIds:['oc-a','oc-b'],tipo:'obrigacao',regraOriginal:{regraId:'regra',tipo:'OBRIGACAO',periodicidade:'MENSAL'},recorrencia:'MENSAL'});
  expect(screen.getByLabelText('Tipo')).toHaveValue('OBRIGACAO');
  expect(screen.getByLabelText('Recorrência')).toHaveValue('MENSAL');
  fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Conferir EFD'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.editarOcorrenciasAgenda).toHaveBeenCalledWith(['oc-a','oc-b'],expect.objectContaining({titulo:'Conferir EFD'})));
  expect(api.updateRegraObrigacao).not.toHaveBeenCalled();
});

test('conversão de tarefa da empresa não oferece ampliar o escopo silenciosamente',async()=>{
  const {api}=montar({tarefaId:undefined,companyId:'empresa-a',empresa:'Clínica Alfa',ocorrenciaIds:['oc-a'],obrigacaoOriginal:{obrigacaoId:'ob-a',tipo:'TAREFA'}},{updateObrigacao:jest.fn(async()=>({ok:true})),previewEscopoRegra:jest.fn(async()=>({ok:true,total:1}))});
  fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'OBRIGACAO'}});
  fireEvent.click(screen.getByRole('button',{name:'Continuar'}));
  expect(screen.getByLabelText('Empresa')).toHaveValue('Clínica Alfa');
  expect(screen.queryByLabelText('Aplicar a')).not.toBeInTheDocument();
  await screen.findByText('1 empresa');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(api.updateObrigacao).toHaveBeenCalledWith('ob-a',expect.objectContaining({tipo:'OBRIGACAO',filtros:{empresasIds:['empresa-a']}})));
});


test('vincular tarefa exige ciência e envia seleção explícita',async()=>{
 const api={vincularTarefasEmpresas:jest.fn(async()=>({ok:true}))};const onSalvo=jest.fn();
 render(<ModalAtividade inicial={inicial} empresas={[{companyId:'a',razao:'Empresa Alfa',cnpj:'123'}]} api={api} onSalvo={onSalvo} onFechar={()=>{}}/>);
 fireEvent.click(screen.getByLabelText(/Empresa Alfa/));
 fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Confirme');expect(api.vincularTarefasEmpresas).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText(/Compartilhar com a equipe/));fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
 await waitFor(()=>expect(api.vincularTarefasEmpresas).toHaveBeenCalledWith(expect.objectContaining({tarefaId:'tarefa',empresasIds:['a'],compartilhar:true})));
 expect(onSalvo).toHaveBeenCalled();
});
test('editor empresarial abre empresa sem concluir tarefa',()=>{
 const abrir=jest.fn(),concluir=jest.fn();render(<ModalAtividade inicial={{...inicial,companyId:'a',empresa:'Alfa'}} empresas={[]} api={{}} onOpenCompany={abrir} onAlterarConclusao={concluir} onFechar={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Abrir empresa'}));expect(abrir).toHaveBeenCalledWith('a');expect(concluir).not.toHaveBeenCalled();
});
