import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { ExportarLancamentosLoteModal } from '../ExportarLancamentosLoteModal';
test('confere selecionadas e bloqueia download até reconhecer alertas',async()=>{
  const api={preflightEntriesBatch:jest.fn(async()=>({ok:true,empresas:[{id:'a',preflightHash:'hash-da-previa',estado:'PRONTA',alertas:[{competencia:'2026-08',motivo:'Mês aberto'}]}]})),exportEntriesBatch:jest.fn().mockRejectedValue(new Error('Falha no download'))};
  render(<ExportarLancamentosLoteModal api={api} companies={[{id:'a',razao:'Empresa A'}]} competencia="2026-08" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Conferir lote'}));
  await screen.findByText('2026-08 · Mês aberto');
  expect(api.preflightEntriesBatch).toHaveBeenCalledWith({companyIds:['a'],competenciaInicio:'2026-08',competenciaFim:'2026-08'});
  const baixar=screen.getByRole('button',{name:'Baixar ZIP com CSVs'});
  expect(baixar).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(baixar);
  await screen.findByRole('alert');
  expect(api.exportEntriesBatch).toHaveBeenCalledWith(expect.objectContaining({companyIds:['a'],confirmarAlertas:true,preflightHashes:{a:'hash-da-previa'}}));
  expect(screen.queryByText(/Download solicitado/)).not.toBeInTheDocument();
});
test('alterar período invalida a prévia e reconhecimento anteriores',async()=>{
  const api={preflightEntriesBatch:jest.fn(async()=>({ok:true,empresas:[{id:'a',estado:'PRONTA'}]}))};
  render(<ExportarLancamentosLoteModal api={api} companies={[{id:'a'}]} competencia="2026-08" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Conferir lote'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Baixar ZIP com CSVs'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Competência final'),{target:{value:'2026-09'}});
  expect(screen.getByRole('button',{name:'Baixar ZIP com CSVs'})).toBeDisabled();
});
