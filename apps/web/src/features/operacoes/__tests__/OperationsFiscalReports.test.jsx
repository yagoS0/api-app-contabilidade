import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsFiscalReports } from '../OperationsFiscalReports';
const rows = [{company:{companyId:'a',razao:'Alfa'}},{company:{companyId:'b',razao:'Beta'}}];
const setup = api => render(<OperationsFiscalReports api={api} rows={rows} title="Relatórios" competencia="2026-10" onClose={jest.fn()} />);
const fixture = () => ({ getStoredSitfis:jest.fn(async()=>({status:{relatorioPdfFileId:'saved',checkedAt:'2026-10-30T02:00:00Z'}})), getSitfis:jest.fn(), fetchSitfisPdfBlob:jest.fn(), createSitfisDownload:jest.fn(async()=>({ok:true,jobId:'zip'})), getSitfisDownload:jest.fn(async()=>({job:{id:'zip',status:'concluido',comPdf:1}})), fetchSitfisDownloadBlob:jest.fn(async()=>new Blob(['zip'],{type:'application/zip'})) });
let click;
beforeEach(()=>{URL.createObjectURL=jest.fn(()=> 'blob:test'); URL.revokeObjectURL=jest.fn();click=jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});});
afterEach(()=>click.mockRestore());
async function select() { await waitFor(()=>expect(screen.getByRole('button',{name:'Selecionar PDFs disponíveis'})).toBeEnabled()); fireEvent.click(screen.getByRole('button',{name:'Selecionar PDFs disponíveis'})); }
test('abrir e selecionar só lê; lote usa um ZIP e informa comPdf sem inventar resultados individuais', async () => {
 const api=fixture(); setup(api); await select();
 expect(api.createSitfisDownload).not.toHaveBeenCalled(); expect(api.fetchSitfisPdfBlob).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await screen.findByText(/ZIP entregue ao navegador: 1 PDFs \/ 2 empresas/);
 expect(api.createSitfisDownload).toHaveBeenCalledWith(['a','b']); expect(api.fetchSitfisDownloadBlob).toHaveBeenCalledWith('zip'); expect(api.fetchSitfisPdfBlob).not.toHaveBeenCalled(); expect(api.getSitfis).not.toHaveBeenCalled(); expect(click).toHaveBeenCalledTimes(1);
});
test('criação incerta não repete POST inclusive após remontagem',async()=>{
 const api=fixture(); api.createSitfisDownload.mockRejectedValue(Error('timeout')); const view=setup(api);await select();fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await screen.findByText(/timeout/);view.unmount();setup(api);await select();
 expect(screen.getByRole('button',{name:'Baixar selecionados (2)'})).toBeDisabled();expect(api.createSitfisDownload).toHaveBeenCalledTimes(1);expect(api.getSitfis).not.toHaveBeenCalled();
});
test('cancelar acompanhamento impede download tardio e retoma o mesmo job',async()=>{
 const api=fixture();let resolve;api.getSitfisDownload.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));setup(api);await select();fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));await waitFor(()=>expect(api.getSitfisDownload).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('button',{name:'Parar acompanhamento'}));await act(async()=>resolve({job:{id:'zip',status:'concluido',comPdf:2}}));expect(api.fetchSitfisDownloadBlob).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Retomar download do mesmo ZIP'}));await screen.findByText(/ZIP entregue/);expect(api.createSitfisDownload).toHaveBeenCalledTimes(1);
});
test('download individual autenticado relata falha sem consultar Fisco',async()=>{
 const api=fixture();api.fetchSitfisPdfBlob.mockRejectedValue(Error('Arquivo ausente'));setup(api);await select();fireEvent.click(screen.getByRole('button',{name:'Baixar PDF de Alfa'}));await screen.findByText(/Falha no download: Arquivo ausente/);expect(api.fetchSitfisPdfBlob).toHaveBeenCalledWith('a');expect(api.createSitfisDownload).not.toHaveBeenCalled();expect(api.getSitfis).not.toHaveBeenCalled();
});
test('retorno tardio de leitura não seleciona PDF de outro contexto', async () => {
 let finish;const api={getStoredSitfis:jest.fn(()=>new Promise(resolve=>{finish=resolve;})),fetchSitfisPdfBlob:jest.fn()};const view=render(<OperationsFiscalReports api={api} rows={[rows[0]]} title="Relatórios" competencia="2026-10" onClose={jest.fn()} />);const old=finish;view.rerender(<OperationsFiscalReports api={api} rows={[rows[1]]} title="Relatórios" competencia="2026-09" onClose={jest.fn()} />);await act(async()=>old({status:{relatorioPdfFileId:'old'}}));expect(screen.getByLabelText('Selecionar PDF de Beta')).toBeDisabled();expect(api.fetchSitfisPdfBlob).not.toHaveBeenCalled();
});
test('novo pedido após atualizar PDFs gera outro ZIP', async () => {
 const api=fixture(); setup(api); await select();
 fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await screen.findByText(/ZIP entregue ao navegador/);
 api.getStoredSitfis.mockResolvedValue({status:{relatorioPdfFileId:'pdf-atualizado'}});
 api.createSitfisDownload.mockResolvedValue({ok:true,jobId:'novo'});
 api.getSitfisDownload.mockResolvedValue({job:{id:'novo',status:'concluido',comPdf:2}});
 fireEvent.click(screen.getByRole('button',{name:'Atualizar lista salva'})); await select();
 expect(api.createSitfisDownload).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await waitFor(()=>expect(api.fetchSitfisDownloadBlob).toHaveBeenLastCalledWith('novo'));
 expect(api.createSitfisDownload).toHaveBeenCalledTimes(2); expect(api.getSitfis).not.toHaveBeenCalled();
});

test.each(['erro','expirado'])('ZIP %s permite novo pedido explícito, sem retry automático',async status=>{
 const api=fixture(); api.getSitfisDownload.mockResolvedValueOnce({job:{id:'zip',status}});
 setup(api);await select();fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await screen.findByText(/solicite um novo download/);
 expect(api.createSitfisDownload).toHaveBeenCalledTimes(1);expect(api.fetchSitfisDownloadBlob).not.toHaveBeenCalled();
 api.createSitfisDownload.mockResolvedValue({ok:true,jobId:'novo'});
 api.getSitfisDownload.mockResolvedValue({job:{id:'novo',status:'concluido',comPdf:2}});
 fireEvent.click(screen.getByRole('button',{name:'Baixar selecionados (2)'}));
 await waitFor(()=>expect(api.fetchSitfisDownloadBlob).toHaveBeenCalledWith('novo'));
 expect(api.createSitfisDownload).toHaveBeenCalledTimes(2);expect(api.getSitfis).not.toHaveBeenCalled();
});
