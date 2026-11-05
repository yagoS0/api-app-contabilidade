import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsApproval } from '../OperationsApproval';

const rows = [{ company: { companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT' } }];
function fixture(overrides = {}) {
  let state = { regime: 'SIMPLES', companyId: 'a', competencia: '2026-09', revision: 'r1', status: 'PENDING', pending: [], schedule: null, calculation: { calculoId: 'calculo-1', dasValor: 100 }, ...overrides };
  return { getOperationEvidence: jest.fn(async competencia => ({items:[state,{...state,companyId:'b'}].map(item=>({...item,competencia})),total:2,competencia})), getApuracaoSnapshot: jest.fn(async (id, competencia) => ({ snapshot: { portalClientId: id, competencia, estado: 'calculada', idempotencyKey: 'calculo-1', dasSimuladoSerpro: 100, atividadesEscolhidas: [] } })),
    getAuditoriaNotas: jest.fn(async (id, competencia) => ({ auditoria: { competencia, totalAchados: 0, perguntas: [] } })),
    getPgdasHistorico: jest.fn(async (id, competencia) => ({ competencia, versoes: [] })),
    getCompanyOperation: jest.fn(async () => state), saveCompanyOperation: jest.fn(async (id, comp, input) => {
    state = { ...state, revision: 'r2', status: { confirm: 'CONFIRMED', review: 'IN_REVIEW', release: 'RELEASED' }[input.action] || state.status, ...(input.action === 'schedule' ? { schedule: input.schedule } : {}) }; return state;
  }) };
}
async function openDetail({ embedded = false } = {}) {
 fireEvent.click(screen.getByRole('button',{name:'Conferir',exact:true}));
 if (embedded) expect(await screen.findByRole('heading',{name:'Conferir CDA'})).toHaveFocus();
 else await screen.findByRole('dialog',{name:'Conferir CDA',exact:true});
}

test('confirmação e liberação são separadas e exigem prévia explícita', async () => {
  const api = fixture(); api.executeCompanyOperation = jest.fn(async () => ({ ok: true })); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' }));
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Transmitir selecionadas (1)' }));
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.change(await screen.findByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Liberar e executar' }));
  await screen.findByText(/1 liberação\(ões\) processada/);
  expect(api.executeCompanyOperation).toHaveBeenCalledWith('a', '2026-09', 'r2');
  expect(api.saveCompanyOperation.mock.calls[1][2]).toMatchObject({ action: 'release', expectedRevision: 'r2' });
});
test('nota de setembro impede confirmação e aponta para revisão sem alterar competência', async () => {
  const api = fixture({ blocked: 'Revise a nota de setembro', pending: [{ id: 'p', observacoes: 'Emitida em outubro, competência setembro' }] });
  render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail();
  expect(screen.getByRole('button', { name: 'Confirmar apuração' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});
test('programação salva reaparece após remontar; timeout não reenvia', async () => {
  const api = fixture(); const view = render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail();
  fireEvent.change(screen.getByLabelText('Programar conferência'), { target: { value: '2026-10-16T08:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar programação' }));
  await screen.findByText(/16\/10\/2026 · 08:30/);
  view.unmount(); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await screen.findByText(/16\/10\/2026 · 08:30/);
  await openDetail();
  api.saveCompanyOperation.mockRejectedValueOnce(Error('Resultado desconhecido'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await screen.findByRole('alert');
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Conferir' })).toBeDisabled();
});

test.each(['STAFF', 'VIEWER', undefined])('papel %s mantém leitura sem ações de escrita', async myRole => {
  const api = fixture({ status: 'CONFIRMED' });
  render(<OperationsApproval api={api} rows={[{ company: { ...rows[0].company, myRole } }]} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: /Transmitir selecionadas/ })).not.toBeInTheDocument();
  await openDetail();
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toBeInTheDocument();
  expect(screen.getByText('Seu acesso permite somente consultar esta apuração.')).toBeInTheDocument();
  for (const name of ['Confirmar apuração', 'Marcar para revisão', 'Salvar programação']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

test('permissão retirada com prévia aberta bloqueia execução', async () => {
  const api = fixture({ status: 'CONFIRMED' }); api.executeCompanyOperation = jest.fn();
  const view = render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Transmitir selecionadas (1)' }));
  fireEvent.change(await screen.findByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  view.rerender(<OperationsApproval api={api} rows={[{ company: { ...rows[0].company, myRole: 'STAFF' } }]} competencia="2026-09" />);
  expect(await screen.findByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Liberar e executar' }));
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('detalhe embutido direciona foco e retorna à empresa sem criar modal extra',async()=>{
 render(<OperationsApproval embedded api={fixture()} rows={rows} competencia="2026-09"/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir'})).toBeEnabled());await openDetail({embedded:true});expect(screen.getByRole('heading',{name:'Conferir CDA'})).toHaveFocus();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Voltar'}));expect(screen.getByRole('button',{name:'Conferir'})).toHaveFocus();
});
test('lote embutido recebe foco e cancelar retorna ao acionador',async()=>{
 render(<OperationsApproval embedded api={fixture({status:'CONFIRMED'})} rows={rows} competencia="2026-09"/>);const select=await screen.findByRole('button',{name:'Selecionar elegíveis (1)'});await waitFor(()=>expect(select).toBeEnabled());fireEvent.click(select);const btn=screen.getByRole('button',{name:'Transmitir selecionadas (1)'});fireEvent.click(btn);expect(await screen.findByRole('heading',{name:'Conferir transmissão'})).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(screen.getByRole('button',{name:'Transmitir selecionadas (1)'})).toHaveFocus();
});

test('seleção explícita libera somente o subconjunto e resposta vazia não executa', async () => {
  const api = fixture({ status:'CONFIRMED' });
  api.getCompanyOperation = jest.fn(async id => ({companyId:id,competencia:'2026-09',revision:'r1',status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100}}));
  api.saveCompanyOperation.mockResolvedValueOnce(null);
  api.executeCompanyOperation = jest.fn();
  render(<OperationsApproval api={api} rows={[...rows,{company:{companyId:'b',razao:'Beta',myRole:'ACCOUNTANT'}}]} competencia="2026-09" />);
  await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Transmitir selecionadas (0)'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas (1)'}));
  fireEvent.change(await screen.findByLabelText('Digite a competência 2026-09 para executar'),{target:{value:'2026-09'}});
  fireEvent.click(screen.getByRole('button',{name:'Liberar e executar'}));
  await screen.findByRole('alert');
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(api.saveCompanyOperation.mock.calls[0][0]).toBe('a');
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('troca de competência durante gravação impede execução tardia', async () => {
  let resolve;
  const api=fixture({status:'CONFIRMED'});
  api.saveCompanyOperation=jest.fn(()=>new Promise(done=>{resolve=done;}));
  api.executeCompanyOperation=jest.fn();
  const view=render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas (1)'}));
  fireEvent.change(await screen.findByLabelText('Digite a competência 2026-09 para executar'),{target:{value:'2026-09'}});
  fireEvent.click(screen.getByRole('button',{name:'Liberar e executar'}));
  view.rerender(<OperationsApproval api={api} rows={rows} competencia="2026-10" />);
  resolve({companyId:'a',competencia:'2026-09',revision:'r2',status:'RELEASED'});
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Liberar e executar'})).not.toBeInTheDocument());
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test.each([
  ['falha no snapshot', api => api.getApuracaoSnapshot.mockRejectedValue(Error('Leitura recusada'))],
  ['snapshot ausente', api => api.getApuracaoSnapshot.mockResolvedValue({ snapshot: null })],
  ['snapshot inválido', api => api.getApuracaoSnapshot.mockResolvedValue({ snapshot: {} })],
  ['falha na auditoria', api => api.getAuditoriaNotas.mockRejectedValue(Error('Leitura recusada'))],
  ['auditoria ausente', api => api.getAuditoriaNotas.mockResolvedValue({ auditoria: null })],
  ['auditoria inválida', api => api.getAuditoriaNotas.mockResolvedValue({ auditoria: { competencia: '2026-09', perguntas: 'inválido' } })],
  ['outra empresa', api => api.getApuracaoSnapshot.mockResolvedValue({ snapshot: { portalClientId: 'b', competencia: '2026-09' } })],
  ['outra competência', api => api.getAuditoriaNotas.mockResolvedValue({ auditoria: { competencia: '2026-08', totalAchados: 0, perguntas: [] } })],
  ['outra revisão', api => api.getApuracaoSnapshot.mockResolvedValue({ snapshot: { portalClientId: 'a', competencia: '2026-09', estado: 'calculada', idempotencyKey: 'antiga', dasSimuladoSerpro: 100 } })],
])('%s impede confirmação e lote sem impedir navegação/revisão', async (_, invalidate) => {
  const api = fixture({ status: 'CONFIRMED' }); api.executeCompanyOperation = jest.fn(); invalidate(api);
  render(<OperationsApproval embedded api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail({embedded:true});
  fireEvent.click(screen.getByRole('button',{name:'Voltar'}));
  expect(screen.getByLabelText('Selecionar CDA')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Selecionar elegíveis (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Transmitir selecionadas (0)' })).toBeDisabled();
  await openDetail({embedded:true});
  expect(screen.getByRole('button', { name: 'Confirmar apuração' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  expect(screen.getByRole('button', { name: 'Marcar para revisão' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Atualizar evidências' })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toBeInTheDocument();
  expect(screen.getByText(/Confirmar e liberar estão indisponíveis/)).toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('atualizar recupera evidências, limpa seleção e permite achados legíveis sem exigir extrato', async () => {
  const api = fixture({ status: 'CONFIRMED' });
  api.getPgdasHistorico.mockRejectedValue(Error('Extrato futuro não é necessário para conferir'));
  api.getAuditoriaNotas.mockRejectedValueOnce(Error('Falha da leitura'));
  api.getAuditoriaNotas.mockResolvedValue({ auditoria: { competencia: '2026-09', totalAchados: 1, perguntas: [{ id: 'nota', situacao: 'NAO_CONFERIVEL', achados: [{}], naoAvaliadas: [], motivo: 'Conferir divergência' }] } });
  render(<OperationsApproval embedded api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail({embedded:true});
  expect(screen.getByRole('button',{name:'Confirmar apuração'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Voltar'}));
  expect(screen.getByLabelText('Selecionar CDA')).toBeDisabled();
  await openDetail({embedded:true});
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar evidências' }));
  await waitFor(() => expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(screen.getByLabelText('Selecionar CDA')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar conferências' }));
  await waitFor(() => expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(screen.getByLabelText('Selecionar CDA')).not.toBeChecked();
  await openDetail({embedded:true});
  expect(screen.getByText('Conferir divergência')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmar apuração' })).toBeEnabled();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await waitFor(() => expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1));
});

test('liberação anteriormente salva não executa sem auditoria disponível', async () => {
  const api = fixture({ status: 'RELEASED' }); api.executeCompanyOperation = jest.fn();
  api.getAuditoriaNotas.mockResolvedValue({ auditoria: null });
  render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  await openDetail();
  expect(screen.queryByRole('button', { name: 'Executar liberação' })).not.toBeInTheDocument();
  expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test.each([false,true])('execução concluída preserva histórico e bloqueia comandos; falha de leitura=%s',async readFailure=>{
 const api=fixture({status:'EXECUTED',calculation:null,execution:{status:'DONE'}});api.executeCompanyOperation=jest.fn();
 api.getApuracaoSnapshot.mockResolvedValue({snapshot:{portalClientId:'a',competencia:'2026-09',estado:'transmitida',idempotencyKey:'calculo-1',dasSimuladoSerpro:100}});
 if(readFailure) api.getAuditoriaNotas.mockRejectedValue(Error('Auditoria indisponível'));
 render(<OperationsApproval embedded api={api} rows={rows} competencia="2026-09"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir'})).toBeEnabled());
 expect(screen.getByLabelText('Selecionar CDA')).toBeDisabled();
 expect(screen.getByText(/Execução concluída/)).toBeInTheDocument();
 expect(screen.queryByText(/Revisão do cálculo não corresponde/)).not.toBeInTheDocument();
 await openDetail({embedded:true});
 expect(screen.getByRole('button',{name:'Confirmar apuração'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Executar liberação'})).not.toBeInTheDocument();
 if(readFailure) expect(screen.getAllByText(/Auditoria indisponível/).length).toBeGreaterThan(0);
 else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});


test('Calculado confere seleção sem transmitir e sem usar ausência como zero',async()=>{
 const api=fixture();api.executeCompanyOperation=jest.fn();
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="calculado" embedded/>);
 await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());expect(screen.getByRole('columnheader',{name:'Receita calculada'})).toBeInTheDocument();fireEvent.click(screen.getByLabelText('Selecionar CDA'));fireEvent.click(screen.getByText('Conferir selecionadas'));expect(api.saveCompanyOperation).not.toHaveBeenCalled();fireEvent.click(await screen.findByText('Confirmar cálculos selecionados'));await waitFor(()=>expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1));expect(api.saveCompanyOperation.mock.calls[0][2].action).toBe('confirm');expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

import { Modal } from '../../../components/ui/Modal';
test.each([['calculado','PENDING','Conferir selecionadas','Conferir cálculos selecionados'],['confirmado','CONFIRMED','Transmitir selecionadas','Conferir transmissão']])('cancelar prévia %s devolve foco ao gatilho dentro do Modal real',async(stage,status,label,heading)=>{
 const api=fixture({status});api.executeCompanyOperation=jest.fn();render(<Modal titulo="Operações" aoFechar={()=>{}}><OperationsApproval api={api} rows={rows} competencia="2026-09" stage={stage} embedded/></Modal>);
 await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());fireEvent.click(screen.getByLabelText('Selecionar CDA'));const trigger=screen.getByRole('button',{name:label,exact:true});trigger.focus();fireEvent.click(trigger);expect(await screen.findByRole('heading',{name:heading})).toHaveFocus();const cancel=screen.getByRole('button',{name:'Cancelar',exact:true});cancel.focus();fireEvent.click(cancel);expect(screen.getByRole('button',{name:label,exact:true})).toHaveFocus();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('três empresas selecionadas em paralelo; fechar não inicia detalhes, provas ou restante da carteira', async () => {
 const pending=[];const api=fixture();api.getCompanyOperation=jest.fn(()=>new Promise(resolve=>pending.push(resolve)));api.getOperationsTransmissionDocuments=jest.fn();api.executeCompanyOperation=jest.fn();
 const many=Array.from({length:8},(_,i)=>({company:{companyId:String(i),razao:`Empresa ${i}`,myRole:'ACCOUNTANT'}}));
 api.getOperationEvidence=jest.fn(async competencia=>({items:many.map(({company})=>({regime:'SIMPLES',companyId:company.companyId,competencia,revision:'r1',status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100}})),total:8,competencia}));
 const view=render(<OperationsApproval api={api} rows={many} competencia="2026-09" stage="confirmado"/>);
 await waitFor(()=>expect(screen.getByLabelText('Selecionar elegíveis exibidas')).toBeEnabled());
 expect(api.getCompanyOperation).not.toHaveBeenCalled();
 fireEvent.click(screen.getByLabelText('Selecionar elegíveis exibidas'));fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas',exact:true}));
 expect(api.getCompanyOperation.mock.calls.map(([id])=>id)).toEqual(['0','1','2']);view.unmount();
 await act(async()=>pending.forEach((resolve,i)=>resolve({companyId:String(i),competencia:'2026-09',revision:'r1',pending:[]})));
 expect(api.getCompanyOperation).toHaveBeenCalledTimes(3);expect(api.getApuracaoSnapshot).not.toHaveBeenCalled();expect(api.getOperationsTransmissionDocuments).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

test('troca de competência descarta a fila selecionada antiga antes de ler evidências', async () => {
 const pending=[];const api=fixture();api.executeCompanyOperation=jest.fn();api.getCompanyOperation=jest.fn((id,competencia)=>new Promise(resolve=>pending.push(()=>resolve({companyId:id,competencia,revision:'antiga',pending:[]}))));
 const many=Array.from({length:5},(_,i)=>({company:{companyId:String(i),razao:`Empresa ${i}`,myRole:'ACCOUNTANT'}}));
 api.getOperationEvidence=jest.fn(async competencia=>({items:many.map(({company})=>({regime:'SIMPLES',companyId:company.companyId,competencia,revision:competencia,status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100}})),total:5,competencia}));
 const view=render(<OperationsApproval api={api} rows={many} competencia="2026-09" stage="confirmado"/>);
 await waitFor(()=>expect(screen.getByLabelText('Selecionar elegíveis exibidas')).toBeEnabled());
 fireEvent.click(screen.getByLabelText('Selecionar elegíveis exibidas'));fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas',exact:true}));
 expect(api.getCompanyOperation).toHaveBeenCalledTimes(3);
 view.rerender(<OperationsApproval api={api} rows={many} competencia="2026-10" stage="confirmado"/>);
 await waitFor(()=>expect(api.getOperationEvidence).toHaveBeenCalledTimes(2));await act(async()=>pending.forEach(resolve=>resolve()));
 expect(api.getCompanyOperation.mock.calls.filter(([,comp])=>comp==='2026-09')).toHaveLength(3);
 expect(api.getCompanyOperation.mock.calls.filter(([,comp])=>comp==='2026-10')).toHaveLength(0);
 expect(api.getApuracaoSnapshot).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

test.each(['PENDING', 'CONFIRMED'])('39 empresas %s: uma leitura agrupada, sem HTTP para detalhes invisíveis', async status => {
 const many = Array.from({length:39}, (_, i) => ({company:{companyId:`c${i}`,razao:`Empresa ${i}`,myRole:'ACCOUNTANT'}}));
 const items = many.map(({company}) => ({companyId:company.companyId,competencia:'2026-09',revision:'r1',status,pending:[],calculation:{calculoId:'calculo-1',dasValor:100},calculationSummary:{receitaInterna:1000,receitaExterna:0}}));
 const api = fixture();
 api.getOperationEvidence = jest.fn(async () => ({items,total:39,competencia:'2026-09'}));
 api.getCompanyOperation = jest.fn(async id => items.find(item => item.companyId === id));
 api.getOperationsTransmissionDocuments = jest.fn(async id => ({companyId:id,competencia:'2026-09',confirmation:null}));
 render(<OperationsApproval api={api} rows={many} competencia="2026-09" stage="confirmado" embedded />);
 await waitFor(() => expect(screen.queryByText('Lendo cálculos e evidências…')).not.toBeInTheDocument());
 expect(api.getOperationEvidence).toHaveBeenCalledTimes(1);
 for (const method of ['getCompanyOperation','getApuracaoSnapshot','getAuditoriaNotas','getPgdasHistorico','getOperationsTransmissionDocuments']) expect(api[method]).not.toHaveBeenCalled();
 if (status === 'PENDING') expect(screen.getByText('Nenhuma empresa nesta etapa ou busca.')).toBeInTheDocument();
 else {
   expect(screen.getAllByRole('button',{name:'Conferir detalhes'})).toHaveLength(39);
   fireEvent.click(screen.getAllByRole('button',{name:'Conferir detalhes'})[0]);
   expect(await screen.findByRole('heading',{name:'Conferir Empresa 0'})).toHaveFocus();
   for (const method of ['getCompanyOperation','getApuracaoSnapshot','getAuditoriaNotas','getPgdasHistorico','getOperationsTransmissionDocuments']) {
     expect(api[method]).toHaveBeenCalledTimes(1); expect(api[method]).toHaveBeenCalledWith('c0','2026-09');
   }
   fireEvent.click(screen.getByRole('button',{name:'Voltar'}));
   expect(screen.getAllByRole('button',{name:'Conferir detalhes'})[0]).toHaveFocus();
 }
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});

test.each(['revisao', 'auditoria', 'operacao'])('prévia agrupada relê só seleção e recusa %s sem comando', async failure => {
 const api = fixture({status:'CONFIRMED'});
 const item = await api.getCompanyOperation(); api.getCompanyOperation.mockClear();
 api.getOperationEvidence = jest.fn(async () => ({items:[item],total:1,competencia:'2026-09'}));
 api.executeCompanyOperation = jest.fn();
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado" embedded />);
 await waitFor(() => expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
 if (failure === 'revisao') api.getCompanyOperation.mockResolvedValue({...item,revision:'r2'});
 if (failure === 'auditoria') api.getAuditoriaNotas.mockRejectedValue(Error('Auditoria indisponível'));
 if (failure === 'operacao') api.getCompanyOperation.mockRejectedValue(Error('Operação indisponível'));
 fireEvent.click(screen.getByLabelText('Selecionar CDA'));
 fireEvent.click(screen.getByRole('button',{name:'Transmitir selecionadas',exact:true}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/indisponível|mudaram/);
 expect(screen.queryByRole('button',{name:'Liberar e executar'})).not.toBeInTheDocument();
 expect(api.getCompanyOperation).toHaveBeenCalledTimes(1);
 expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('lote incompleto não anuncia vazio legítimo nem busca auditorias para preencher ausência', async () => {
 const api=fixture(); api.getOperationEvidence=jest.fn(async()=>({items:[],total:0,competencia:'2026-09'}));
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent(/Lista incompleta/);
 expect(screen.queryByText('Nenhuma empresa nesta etapa ou busca.')).not.toBeInTheDocument();
 expect(api.getCompanyOperation).not.toHaveBeenCalled(); expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
});

test('detalhe agrupado tardio não reabre outra competência nem inicia suas evidências',async()=>{
 const api=fixture(); let finish;
 api.getOperationEvidence=jest.fn(async competencia=>({items:[{companyId:'a',competencia,revision:competencia,status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100}}],total:1,competencia}));
 api.getCompanyOperation=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado" embedded/>);
 fireEvent.click(await screen.findByRole('button',{name:'Conferir detalhes'}));
 await waitFor(()=>expect(finish).toBeDefined());
 view.rerender(<OperationsApproval api={api} rows={rows} competencia="2026-10" stage="confirmado" embedded/>);
 await act(async()=>finish({companyId:'a',competencia:'2026-09',revision:'2026-09',status:'CONFIRMED',pending:[]}));
 expect(screen.queryByRole('heading',{name:'Conferir CDA'})).not.toBeInTheDocument();
 expect(api.getApuracaoSnapshot).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});


test('sem leitura agrupada mostra indisponível sem iniciar a fila antiga',async()=>{
 const api=fixture();delete api.getOperationEvidence;
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Conferência agrupada indisponível');
 expect(api.getCompanyOperation).not.toHaveBeenCalled();expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
});

test('resumo mostra autoria da confirmação da mesma revisão sem carregar documentos',async()=>{
 const api=fixture({status:'CONFIRMED',fingerprint:'fingerprint-atual'});
 api.getOperationEvidence=jest.fn(async()=>({items:[{companyId:'a',competencia:'2026-09',revision:'r1',fingerprint:'fingerprint-atual',status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100},confirmationSummary:{status:'AVAILABLE',confirmation:{by:'Contador confirmado',at:'2026-10-01T12:00:00Z',fingerprint:'fingerprint-atual'}}}],total:1,competencia:'2026-09'}));
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado" embedded/>);
 expect(await screen.findByText('Contador confirmado')).toBeVisible();
 expect(screen.getByText(/01\/10\/2026/)).toBeVisible();
 expect(api.getCompanyOperation).not.toHaveBeenCalled();expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
});


test('Calculado mantém carregamento sem acessar prova de uma linha ainda ausente',async()=>{
 const api=fixture();let finish;
 api.getOperationEvidence=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="calculado" embedded/>);
 expect(screen.getByText('Lendo cálculos e evidências…')).toBeVisible();
 expect(screen.getByRole('button',{name:'Conferir detalhes'})).toBeDisabled();
 expect(api.getCompanyOperation).not.toHaveBeenCalled();expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
 await waitFor(()=>expect(finish).toBeDefined());
 view.unmount();await act(async()=>finish({items:[],total:0,competencia:'2026-09'}));
});

test.each([
 ['ausente', 'atual', undefined],
 ['incompleto', 'atual', {status:'INCOMPLETE',confirmation:{by:'Autor indevido',at:'2026-10-01T12:00:00Z',fingerprint:'atual'}}],
 ['fingerprint ausente', undefined, {status:'AVAILABLE',confirmation:{by:'Autor indevido',at:'2026-10-01T12:00:00Z'}}],
 ['fingerprint vazio', '', {status:'AVAILABLE',confirmation:{by:'Autor indevido',at:'2026-10-01T12:00:00Z',fingerprint:''}}],
 ['fingerprint divergente', 'atual', {status:'AVAILABLE',confirmation:{by:'Autor indevido',at:'2026-10-01T12:00:00Z',fingerprint:'antigo'}}],
])('resumo %s não apresenta autoria sem prova válida nem inicia detalhes',async(_,fingerprint,confirmationSummary)=>{
 const api=fixture();api.getOperationEvidence=jest.fn(async()=>({items:[{companyId:'a',competencia:'2026-09',revision:'r1',fingerprint,status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100},confirmationSummary}],total:1,competencia:'2026-09'}));
 render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado" embedded/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir detalhes'})).toBeEnabled());
 expect(screen.queryByText('Autor indevido')).not.toBeInTheDocument();
 expect(api.getCompanyOperation).not.toHaveBeenCalled();expect(api.getAuditoriaNotas).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});


test('prévia embedded usa rodapé externo e cancelar preserva seleção e foco',async()=>{
 const footer=document.createElement('div');document.body.appendChild(footer);
 const api=fixture({status:'CONFIRMED'});api.executeCompanyOperation=jest.fn();
 const view=render(<OperationsApproval api={api} rows={rows} competencia="2026-09" stage="confirmado" embedded footerTarget={footer}/>);
 await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());fireEvent.click(screen.getByLabelText('Selecionar CDA'));
 const trigger=screen.getByRole('button',{name:'Transmitir selecionadas'});trigger.focus();fireEvent.click(trigger);
 expect(await screen.findByRole('heading',{name:'Conferir transmissão'})).toHaveFocus();
 const cancel=screen.getByRole('button',{name:'Cancelar'}),release=screen.getByRole('button',{name:'Liberar e executar'});
 expect(footer.contains(cancel)).toBe(true);expect(footer.contains(release)).toBe(true);expect(release).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Transmitir selecionadas'})).not.toBeInTheDocument();fireEvent.click(cancel);
 expect(screen.getByRole('button',{name:'Transmitir selecionadas'})).toHaveFocus();expect(screen.getByLabelText('Selecionar CDA')).toBeChecked();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();view.unmount();footer.remove();
});


test('prévia manual oculta rotina geral sem desmontar histórico e cancelar restaura contexto', async () => {
  const api = fixture({status:'CONFIRMED'});
  api.executeCompanyOperation = jest.fn();
  api.previewOperationsBatch = jest.fn();
  api.listOperationsBatches = jest.fn(async()=>({ok:true,items:[]}));
  render(<OperationsApproval embedded stage="confirmado" api={api} rows={rows} competencia="2026-09"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Ver liberações' })); await screen.findByText('Nenhuma liberação registrada nesta competência.');
  await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  const routine = screen.getByRole('region',{name:'Liberação da rotina de transmissão'});
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  const trigger=screen.getByRole('button',{name:'Transmitir selecionadas'});trigger.focus();fireEvent.click(trigger);
  expect(await screen.findByRole('heading',{name:'Conferir transmissão'})).toHaveFocus();
  expect(routine).toBeInTheDocument();expect(routine).not.toBeVisible();
  expect(screen.queryByRole('button',{name:'Liberar rotina',exact:true})).not.toBeInTheDocument();
  expect(screen.getByRole('list',{name:'Consequências da transmissão'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Liberar e executar'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'),{target:{value:'2026-08'}});
  expect(screen.getByRole('button',{name:'Liberar e executar'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  expect(routine).toBeVisible();expect(screen.getByRole('button',{name:'Transmitir selecionadas'})).toHaveFocus();
  expect(screen.getByLabelText('Selecionar CDA')).toBeChecked();
  expect(screen.getByRole('region',{name:'Liberação da rotina de transmissão'})).toBe(routine);
  expect(api.previewOperationsBatch).not.toHaveBeenCalled();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
