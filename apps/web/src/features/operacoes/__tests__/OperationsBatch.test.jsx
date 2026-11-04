import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OperationsBatch } from '../OperationsBatch';

const pa = '2026-10';
const deferred = () => { let resolve, reject; const promise = new Promise((r,j) => { resolve=r; reject=j; }); return {promise,resolve,reject}; };
function fixture() {
  const batch = { id: 'accepted', competencia: pa, taskId: 'task-1', canResume: true, items: [
    { companyId: 'a', name: 'Empresa A', state: 'ATTENTION', message: 'Resultado incerto. Confira a apuração.' },
    { companyId: 'b', name: 'Empresa B', state: 'WAITING' },
  ] };
  const api = {
    listOperationsBatches: jest.fn(async () => ({ ok: true, items: [] })),
    previewOperationsBatch: jest.fn(async () => ({ ok: true, preview: { id: 'preview', competencia: pa, items: [{ companyId: 'b', name: 'Empresa B' }], blocked: [{ companyId: 'a', name: 'Empresa A', reason: 'Procuração não comprovada.' }] } })),
    acceptOperationsBatch: jest.fn(async () => { api.listOperationsBatches.mockResolvedValue({ ok: true, items: [batch] }); return { ok: true, batch }; }),
    getBackgroundTask: jest.fn(async () => ({ task: { jobId: 'task-1', competencia: pa, status: 'interrupted', total: 2, processadas: 1, erroMensagem: 'Confira os resultados.' } })),
  };
  return { api, batch };
}
beforeAll(() => { if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: () => 'request-id-1234567890' }); });

test.each(['success','error'])('resposta anterior %s não substitui atualização mais recente',async outcome=>{
 const {api,batch}=fixture();api.listOperationsBatches.mockResolvedValue({ok:true,items:[batch]});
 render(<OperationsBatch api={api} competencia={pa} embedded/>);
 fireEvent.click(await screen.findByRole('button',{name:'Acompanhar tarefa'}));
 const detail=await screen.findByRole('region',{name:'Acompanhamento da tarefa'}),old=deferred(),latest=deferred();
 api.getBackgroundTask.mockImplementationOnce(()=>old.promise).mockImplementationOnce(()=>latest.promise);
 fireEvent.click(within(detail).getByRole('button',{name:'Atualizar tarefa'}));fireEvent.click(within(detail).getByRole('button',{name:'Atualizar tarefa'}));
 await act(async()=>latest.resolve({task:{jobId:'task-1',competencia:pa,status:'done',processadas:2,total:2}}));
 await act(async()=>outcome==='error'?old.reject(Error('Falha antiga')):old.resolve({task:{jobId:'task-1',competencia:pa,status:'interrupted',processadas:0,total:2}}));
 expect(within(detail).getByText('2/2 itens processados')).toBeInTheDocument();expect(within(detail).queryByText(/Falha antiga/)).not.toBeInTheDocument();
 expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
});
test.each([true,false])('fechar durante atualização não reabre tarefa nem apresenta erro antigo; embedded=%s',async embedded=>{
 const {api,batch}=fixture();api.listOperationsBatches.mockResolvedValue({ok:true,items:[batch]});
 render(<OperationsBatch api={api} competencia={pa} embedded={embedded}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Acompanhar tarefa'}));
 const role=embedded?'region':'dialog',detail=await screen.findByRole(role,{name:'Acompanhamento da tarefa'}),pending=deferred();
 api.getBackgroundTask.mockImplementationOnce(()=>pending.promise);fireEvent.click(within(detail).getByRole('button',{name:'Atualizar tarefa'}));
 if(embedded)fireEvent.click(within(detail).getByRole('button',{name:'Voltar'}));else fireEvent.keyDown(document,{key:'Escape'});
 await act(async()=>pending.resolve({task:{jobId:'task-1',competencia:pa,status:'done',processadas:2,total:2}}));
 expect(screen.queryByRole(role,{name:'Acompanhamento da tarefa'})).not.toBeInTheDocument();
 if(embedded)expect(screen.getByRole('button',{name:'Liberar rotina'})).toHaveFocus();
});
test('resposta de outra tarefa preserva dados e informa incompatibilidade; reconsulta válida recupera',async()=>{
 const {api,batch}=fixture();api.listOperationsBatches.mockResolvedValue({ok:true,items:[batch]});render(<OperationsBatch api={api} competencia={pa} embedded/>);
 fireEvent.click(await screen.findByRole('button',{name:'Acompanhar tarefa'}));const detail=await screen.findByRole('region',{name:'Acompanhamento da tarefa'});
 api.getBackgroundTask.mockResolvedValueOnce({task:{jobId:'outra',competencia:pa,status:'done',processadas:2,total:2}});
 fireEvent.click(within(detail).getByRole('button',{name:'Atualizar tarefa'}));await within(detail).findByText(/Tarefa indisponível/);expect(within(detail).getByText('1/2 itens processados')).toBeInTheDocument();
 fireEvent.click(within(detail).getByRole('button',{name:'Atualizar tarefa'}));await waitFor(()=>expect(within(detail).queryByText(/Tarefa indisponível/)).not.toBeInTheDocument());
});
test('troca de competência invalida leitura pendente da tarefa',async()=>{
 const {api,batch}=fixture(),pending=deferred();api.listOperationsBatches.mockResolvedValue({ok:true,items:[batch]});api.getBackgroundTask.mockImplementationOnce(()=>pending.promise);
 const view=render(<OperationsBatch api={api} competencia={pa} embedded/>);fireEvent.click(await screen.findByRole('button',{name:'Acompanhar tarefa'}));
 api.listOperationsBatches.mockResolvedValue({ok:true,items:[]});view.rerender(<OperationsBatch api={api} competencia="2026-09" embedded/>);
 await act(async()=>pending.resolve({task:{jobId:'task-1',competencia:pa,status:'done',processadas:2,total:2}}));expect(screen.queryByRole('region',{name:'Acompanhamento da tarefa'})).not.toBeInTheDocument();expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
});

test.each([true, false])('falha ao atualizar tarefa fica visível e preserva dados; embedded=%s', async embedded => {
  const { api, batch } = fixture();
  api.listOperationsBatches.mockResolvedValue({ ok: true, items: [batch] });
  render(<OperationsBatch api={api} competencia={pa} embedded={embedded} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Acompanhar tarefa' }));
  const detail = await screen.findByRole(embedded ? 'region' : 'dialog', { name: 'Acompanhamento da tarefa' });
  expect(within(detail).getByText('1/2 itens processados')).toBeInTheDocument();
  api.getBackgroundTask.mockRejectedValueOnce(Error('Atualização indisponível'));
  fireEvent.click(within(detail).getByRole('button', { name: 'Atualizar tarefa' }));
  const failure = await within(detail).findByText(/Atualização indisponível/);
  expect(failure).toHaveAttribute('role', 'alert');
  expect(failure).toHaveTextContent('Os últimos dados da tarefa foram preservados.');
  expect(within(detail).getByText('1/2 itens processados')).toBeInTheDocument();
  expect(within(detail).getByText(/Interrompida/)).toBeInTheDocument();
  expect(within(detail).getByText('Confira os resultados.')).toBeInTheDocument();
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
  expect(api.previewOperationsBatch).not.toHaveBeenCalled();

  api.getBackgroundTask.mockResolvedValueOnce({ task: { jobId: 'task-1', competencia: pa, status: 'done', total: 2, processadas: 2 } });
  fireEvent.click(within(detail).getByRole('button', { name: 'Atualizar tarefa' }));
  await within(detail).findByText('2/2 itens processados');
  expect(within(detail).queryByText(/Atualização indisponível/)).not.toBeInTheDocument();
  expect(within(detail).queryByText('Confira os resultados.')).not.toBeInTheDocument();
  expect(api.getBackgroundTask).toHaveBeenCalledTimes(3);
  expect(api.getBackgroundTask).toHaveBeenLastCalledWith('task-1');
});

test('liberação usa prévia do servidor sem linhas selecionadas e exige confirmação da competência', async () => {
  const { api } = fixture(); render(<OperationsBatch api={api} competencia={pa} />);
  await screen.findByText(/Nenhuma liberação registrada/);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  const dialog = await screen.findByRole('dialog');
  expect(api.previewOperationsBatch).toHaveBeenCalledWith(pa, null);
  expect(within(dialog).getByText(/Procuração não comprovada/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Liberar rotina' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(`Digite a competência ${pa}`), { target: { value: pa } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar rotina' }));
  await waitFor(() => expect(api.acceptOperationsBatch).toHaveBeenCalledTimes(1));
  expect(api.acceptOperationsBatch.mock.calls[0][0]).toEqual({ previewId: 'preview', requestId: expect.any(String), confirmCompetencia: pa });
  await screen.findByText('Resultado incerto. Confira a apuração.');
  fireEvent.click(screen.getByRole('button', { name: 'Acompanhar tarefa' }));
  await screen.findByText(/Interrompida/); expect(api.getBackgroundTask).toHaveBeenCalledWith('task-1');
});

test('erro de aceite não oferece repetição cega e conserva acompanhamento', async () => {
  const { api } = fixture(); api.acceptOperationsBatch.mockRejectedValue(Error('Resposta perdida'));
  render(<OperationsBatch api={api} competencia={pa} />);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(`Digite a competência ${pa}`), { target: { value: pa } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar rotina' }));
  await screen.findByRole('alert'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(api.acceptOperationsBatch).toHaveBeenCalledTimes(1);
});

test('retomada pede nova prévia do mesmo lote; leitura falha não apaga resultados', async () => {
  const { api, batch } = fixture(); api.listOperationsBatches.mockResolvedValue({ ok: true, items: [batch] });
  render(<OperationsBatch api={api} competencia={pa} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir não iniciadas' }));
  await screen.findByRole('dialog'); expect(api.previewOperationsBatch).toHaveBeenCalledWith(pa, 'accepted');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  api.listOperationsBatches.mockRejectedValue(Error('Leitura indisponível'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar liberações' }));
  await screen.findByRole('alert'); expect(screen.getByText('Empresa A')).toBeInTheDocument(); expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
});

test('resposta tardia da competência anterior não abre a prévia', async () => {
  const { api } = fixture(); let resolve;
  api.previewOperationsBatch.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<OperationsBatch api={api} competencia={pa} />);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  view.rerender(<OperationsBatch api={api} competencia="2026-09" />);
  resolve({ ok: true, preview: { id: 'old', competencia: pa, items: [], blocked: [] } });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Liberar rotina' })).toBeEnabled();
  api.previewOperationsBatch.mockResolvedValue({ ok: true, preview: { id: 'new', competencia: '2026-09', items: [], blocked: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Competência 2026-09');
  expect(api.previewOperationsBatch).toHaveBeenLastCalledWith('2026-09', null);
});

test('trocar competência durante aceite libera o contexto novo e ignora o resultado antigo', async () => {
  const { api } = fixture(); let finish;
  api.acceptOperationsBatch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<OperationsBatch api={api} competencia={pa} />);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(`Digite a competência ${pa}`), { target: { value: pa } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar rotina' }));
  await waitFor(() => expect(api.acceptOperationsBatch).toHaveBeenCalledTimes(1));
  view.rerender(<OperationsBatch api={api} competencia="2026-09" />);
  expect(screen.getByRole('button', { name: 'Liberar rotina' })).toBeEnabled();
  await act(async () => finish({ ok: true, batch: { id: 'old', competencia: pa, items: [] } }));
  api.previewOperationsBatch.mockResolvedValue({ ok: true, preview: { id: 'new', competencia: '2026-09', items: [], blocked: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Liberar rotina' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Competência 2026-09');
  expect(api.previewOperationsBatch).toHaveBeenLastCalledWith('2026-09', null);
});


test('Batch embedded porta confirmação para o rodapé sem alterar aceite/competência',async()=>{
 const {api}=fixture();const footer=document.createElement('div');footer.setAttribute('aria-label','Rodapé externo');document.body.appendChild(footer);
 const view=render(<OperationsBatch api={api} competencia={pa} embedded footerTarget={footer}/>);
 try {
  const trigger=await screen.findByRole('button',{name:'Liberar rotina'});trigger.focus();fireEvent.click(trigger);
  const detail=await screen.findByRole('region',{name:'Liberar rotina de transmissão'});
  expect(within(detail).queryByRole('button',{name:'Cancelar'})).not.toBeInTheDocument();expect(within(footer).getByRole('button',{name:'Liberar rotina'})).toBeDisabled();
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();fireEvent.click(within(footer).getByRole('button',{name:'Cancelar'}));expect(screen.getByRole('button',{name:'Liberar rotina'})).toHaveFocus();
  expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
 } finally {view.unmount();footer.remove();}
});

test('condições e custos preservam competência digitada e retorno sem aceitar lote',async()=>{
 const {api}=fixture();render(<OperationsBatch api={api} competencia={pa}/>);await screen.findByText(/Nenhuma liberação registrada/);fireEvent.click(screen.getByRole('button',{name:'Liberar rotina'}));const dialog=await screen.findByRole('dialog');fireEvent.change(within(dialog).getByLabelText(`Digite a competência ${pa}`),{target:{value:pa}});const trigger=within(dialog).getByRole('button',{name:'Condições e custos'});fireEvent.click(trigger);expect(within(dialog).getByRole('heading',{name:'Condições e custos'})).toHaveFocus();expect(within(dialog).getByText(/pode consultar documentos faltantes, com custo externo/)).toBeVisible();expect(within(dialog).getByText(/Resultados incertos exigem conferência e não serão repetidos/)).toBeVisible();expect(within(dialog).queryByRole('button',{name:'Liberar rotina'})).not.toBeInTheDocument();fireEvent.click(within(dialog).getByRole('button',{name:'Voltar às empresas'}));await waitFor(()=>expect(trigger).toHaveFocus());expect(within(dialog).getByLabelText(`Digite a competência ${pa}`)).toHaveValue(pa);expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
});
