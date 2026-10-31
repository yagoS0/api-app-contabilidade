import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OperationsApproval } from '../OperationsApproval';

const rows = [{ company: { companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT' } }];
function fixture(overrides = {}) {
  let state = { companyId: 'a', competencia: '2026-09', revision: 'r1', status: 'PENDING', pending: [], schedule: null, calculation: { calculoId: 'calculo-1', dasValor: 100 }, ...overrides };
  return { getApuracaoSnapshot: jest.fn(async (id, competencia) => ({ snapshot: { portalClientId: id, competencia, estado: 'calculada', idempotencyKey: 'calculo-1', dasSimuladoSerpro: 100, atividadesEscolhidas: [] } })),
    getAuditoriaNotas: jest.fn(async (id, competencia) => ({ auditoria: { competencia, totalAchados: 0, perguntas: [] } })),
    getPgdasHistorico: jest.fn(async (id, competencia) => ({ competencia, versoes: [] })),
    getCompanyOperation: jest.fn(async () => state), saveCompanyOperation: jest.fn(async (id, comp, input) => {
    state = { ...state, revision: 'r2', status: { confirm: 'CONFIRMED', review: 'IN_REVIEW', release: 'RELEASED' }[input.action] || state.status, ...(input.action === 'schedule' ? { schedule: input.schedule } : {}) }; return state;
  }) };
}
test('confirmação e liberação são separadas e exigem prévia explícita', async () => {
  const api = fixture(); api.executeCompanyOperation = jest.fn(async () => ({ ok: true })); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar apuração' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar elegíveis (1)' }));
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar selecionadas (1)' }));
  expect(api.saveCompanyOperation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar e executar' }));
  await screen.findByText(/1 liberação\(ões\) processada/);
  expect(api.executeCompanyOperation).toHaveBeenCalledWith('a', '2026-09', 'r2');
  expect(api.saveCompanyOperation.mock.calls[1][2]).toMatchObject({ action: 'release', expectedRevision: 'r2' });
});
test('nota de setembro impede confirmação e aponta para revisão sem alterar competência', async () => {
  const api = fixture({ blocked: 'Revise a nota de setembro', pending: [{ id: 'p', observacoes: 'Emitida em outubro, competência setembro' }] });
  render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  expect(screen.getByRole('button', { name: 'Confirmar apuração' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Revisar notas da competência' })).toHaveAttribute('href', '/companies/a/auditoria?competencia=2026-09');
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
});
test('programação salva reaparece após remontar; timeout não reenvia', async () => {
  const api = fixture(); const view = render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  fireEvent.change(screen.getByLabelText('Programar conferência'), { target: { value: '2026-10-16T08:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar programação' }));
  await screen.findByText(/16\/10\/2026 · 08:30/);
  view.unmount(); render(<OperationsApproval api={api} rows={rows} competencia="2026-09" />);
  await screen.findByText(/16\/10\/2026 · 08:30/);
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
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
  expect(screen.queryByRole('button', { name: /Liberar selecionadas/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Liberar selecionadas (1)' }));
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'), { target: { value: '2026-09' } });
  view.rerender(<OperationsApproval api={api} rows={[{ company: { ...rows[0].company, myRole: 'STAFF' } }]} competencia="2026-09" />);
  expect(screen.getByRole('button', { name: 'Liberar e executar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Liberar e executar' }));
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('detalhe embutido direciona foco e retorna à empresa sem criar modal extra',async()=>{
 render(<OperationsApproval embedded api={fixture()} rows={rows} competencia="2026-09"/>);await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Conferir'}));expect(screen.getByRole('heading',{name:'Conferir CDA'})).toHaveFocus();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Voltar'}));expect(screen.getByRole('button',{name:'Conferir'})).toHaveFocus();
});
test('lote embutido recebe foco e cancelar retorna ao acionador',async()=>{
 render(<OperationsApproval embedded api={fixture({status:'CONFIRMED'})} rows={rows} competencia="2026-09"/>);const select=await screen.findByRole('button',{name:'Selecionar elegíveis (1)'});await waitFor(()=>expect(select).toBeEnabled());fireEvent.click(select);const btn=screen.getByRole('button',{name:'Liberar selecionadas (1)'});fireEvent.click(btn);expect(screen.getByRole('heading',{name:'Liberar apurações confirmadas'})).toHaveFocus();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(screen.getByRole('button',{name:'Liberar selecionadas (1)'})).toHaveFocus();
});

test('seleção explícita libera somente o subconjunto e resposta vazia não executa', async () => {
  const api = fixture({ status:'CONFIRMED' });
  api.getCompanyOperation = jest.fn(async id => ({companyId:id,competencia:'2026-09',revision:'r1',status:'CONFIRMED',pending:[],calculation:{calculoId:'calculo-1',dasValor:100}}));
  api.saveCompanyOperation.mockResolvedValueOnce(null);
  api.executeCompanyOperation = jest.fn();
  render(<OperationsApproval api={api} rows={[...rows,{company:{companyId:'b',razao:'Beta',myRole:'ACCOUNTANT'}}]} competencia="2026-09" />);
  await waitFor(()=>expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(api.saveCompanyOperation).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Liberar selecionadas (0)'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  fireEvent.click(screen.getByRole('button',{name:'Liberar selecionadas (1)'}));
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'),{target:{value:'2026-09'}});
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
  fireEvent.click(screen.getByRole('button',{name:'Liberar selecionadas (1)'}));
  fireEvent.change(screen.getByLabelText('Digite a competência 2026-09 para executar'),{target:{value:'2026-09'}});
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
  expect(screen.getByLabelText('Selecionar CDA')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Selecionar elegíveis (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Liberar selecionadas (0)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
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
  expect(screen.getByLabelText('Selecionar CDA')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar evidências' }));
  await waitFor(() => expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(screen.getByLabelText('Selecionar CDA')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Selecionar CDA'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar conferências' }));
  await waitFor(() => expect(screen.getByLabelText('Selecionar CDA')).toBeEnabled());
  expect(screen.getByLabelText('Selecionar CDA')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Conferir' }));
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
 fireEvent.click(screen.getByRole('button',{name:'Conferir'}));
 expect(screen.getByRole('button',{name:'Confirmar apuração'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Executar liberação'})).not.toBeInTheDocument();
 if(readFailure) expect(screen.getAllByText(/Auditoria indisponível/).length).toBeGreaterThan(0);
 else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
