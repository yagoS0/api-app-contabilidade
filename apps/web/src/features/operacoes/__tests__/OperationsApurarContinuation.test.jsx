import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsPage } from '../OperationsPage';

jest.mock('../OperationsDailyCalendar', () => ({ OperationsDailyCalendar: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));

const companies = [{ companyId: 'a', razao: 'CDA', myRole: 'ACCOUNTANT', apuracao: { competencia: '2026-09' } }];
beforeAll(() => {
  if (!global.crypto.randomUUID) global.crypto.randomUUID = () => 'request-demo';
});

function fixture(status = 'CONFIRMED', {regime = 'SIMPLES', externalDone = false, detail = false} = {}) {
  const current = { regime, externalSummary: {apurar: {concluida: externalDone}}, companyId: 'a', competencia: '2026-09', revision: 'r1', status, pending: [], schedule: null, calculation: { calculoId: 'calculo-1', dasValor: 100 } };
  const api = {
    listOperationsBatches: jest.fn(async () => ({ ok: true, items: [] })),
    previewOperationsBatch: jest.fn(async () => ({ ok: true, preview: { id: 'preview-batch', competencia: '2026-09', items: [{ companyId: 'a', name: 'CDA' }], blocked: [] } })),
    acceptOperationsBatch: jest.fn(async () => ({ ok: true, batch: { id: 'batch', competencia: '2026-09', items: [] } })),
    getApuracaoSnapshot: jest.fn(async (id, competencia) => ({ snapshot: { portalClientId: id, competencia, estado: 'calculada', idempotencyKey: 'calculo-1', dasSimuladoSerpro: 100, atividadesEscolhidas: [] } })),
    getAuditoriaNotas: jest.fn(async (id, competencia) => ({ auditoria: { competencia, totalAchados: 0, perguntas: [] } })),
    getPgdasHistorico: jest.fn(async (id, competencia) => ({ competencia, versoes: [] })),
    getCompanyOperation: jest.fn(async () => current),
    getOperationEvidence: jest.fn(async () => ({items:[current], total:1, competencia:'2026-09'})),
    saveCompanyOperation: jest.fn(),
    executeCompanyOperation: jest.fn(),
  };
  if (detail) delete api.getCompanyOperation; // Exercises the existing Calculado evidence fallback.
  render(<OperationsPage api={api} companies={companies} competencia="2026-09" />);
  return { api };
}

test.each(['PENDING','IN_REVIEW','CONFIRMED'])('Apurar continua empresa %s na etapa que conserva a empresa',async status=>{
 const {api}=fixture(status);
 fireEvent.click(screen.getByRole('button',{name:'Apuração',exact:true}));
 const next=await screen.findByRole('button',{name:'Conferir e continuar rotina'});
 await waitFor(()=>expect(next).toBeEnabled());fireEvent.click(next);
 const stage=status==='CONFIRMED'?'Confirmado':'Calculado';
 expect(await screen.findByRole('dialog',{name:stage,exact:true})).toBeVisible();
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Selecionar CDA'})).toBeEnabled());
 if(status!=='CONFIRMED'){
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar CDA'}));
  fireEvent.click(screen.getByRole('button',{name:'Conferir selecionadas'}));
  expect(await screen.findByRole('button',{name:'Confirmar cálculos selecionados'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:'Liberar e executar'})).not.toBeInTheDocument();
 }
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
});

async function continueFromEvidence() {
 const calculated=screen.getByRole('button',{name:/^Calculado /});
 await waitFor(()=>expect(calculated).toBeEnabled());fireEvent.click(calculated);
 fireEvent.click(await screen.findByRole('button',{name:'Ver evidências de CDA'}));
 const next=await screen.findByRole('button',{name:'Conferir e continuar rotina'});
 await waitFor(()=>expect(next).toBeEnabled());fireEvent.click(next);
}
function expectNoCommands(api) {
 expect(api.saveCompanyOperation).not.toHaveBeenCalled();
 expect(api.executeCompanyOperation).not.toHaveBeenCalled();
 expect(api.acceptOperationsBatch).not.toHaveBeenCalled();
}
test.each(['PENDING','IN_REVIEW','CONFIRMED'])('evidências continuam Simples %s na etapa correta com API indisponível explícita',async status=>{
 const {api}=fixture(status,{detail:true});await continueFromEvidence();
 expect(await screen.findByRole('dialog',{name:status==='CONFIRMED'?'Confirmado':'Calculado',exact:true})).toBeVisible();
 expect(await screen.findByText(/Conferência agrupada indisponível neste ambiente/)).toBeVisible();expectNoCommands(api);
});
test.each([[false,false],[false,true],[true,false],[true,true]])('Presumido conclusão externa=%s detalhe=%s respeita etapa',async(externalDone,detail)=>{
 const {api}=fixture('PENDING',{regime:'PRESUMIDO',externalDone,detail});
 if(detail)await continueFromEvidence();else {
  fireEvent.click(screen.getByRole('button',{name:'Apuração',exact:true}));
  const next=await screen.findByRole('button',{name:'Conferir e continuar rotina'});
  await waitFor(()=>expect(next).toBeEnabled());fireEvent.click(next);
 }
 expect(await screen.findByRole('dialog',{name:externalDone?'Confirmado':'Calculado',exact:true})).toBeVisible();
 if(detail)expect(await screen.findByText(/Conferência agrupada indisponível neste ambiente/)).toBeVisible();
 else await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Selecionar CDA'})).toBeEnabled());expectNoCommands(api);
});
