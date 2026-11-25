import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsFiscalWorkspace } from '../OperationsFiscalWorkspace';
// These boundary doubles test workspace lifecycle only, not the fiscal form or transport.
jest.mock('../../apuracao/components/FechamentoModal', () => ({ FechamentoModal: props => <section aria-label="Formulário compartilhado"><span>{props.portalClientId}</span><button onClick={props.onChanged}>Cálculo persistido</button></section> }));
jest.mock('../../apuracao/components/FluxoPgdasPanel', () => ({ FluxoPgdasPanel: props => <button disabled={props.ocupado}>Registrar fora da Altan</button> }));
const pa='2026-11', item={companyId:'a',name:'Empresa A'};
const aptitude = (id='a',patch={}) => ({ok:true,aptidao:{portalClientId:id,competencia:pa,fs12:{revisao:1},fiscal:{estado:'NAO_TRANSMITIDA'},capacidades:{calcular:true,transmitir:false,retificar:false,reconciliar:false},impedimentos:[],pendencias:[],...patch}});
function setup(patch={},props={}) {
 const api={getAptidaoFiscalFechamento:jest.fn(async()=>aptitude()),getFechamento:jest.fn(async()=>({ok:true,dados:{}})),conferirTransmissaoFechamento:jest.fn(async()=>({ok:true})),...patch};
 const options={api,item,competencia:pa,canWrite:()=>true,...props};
 return {...render(<OperationsFiscalWorkspace {...options}/>),api,options};
}
test('monta formulário reutilizado na central e relê após persistência, sem transmitir',async()=>{
 const {api}=setup();
 const prepare=await screen.findByRole('button',{name:'Preparar cálculo individual'});
 await waitFor(()=>expect(prepare).toBeEnabled()); fireEvent.click(prepare);
 expect(screen.getByRole('region',{name:'Formulário compartilhado'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Cálculo persistido'}));
 await waitFor(()=>expect(api.getAptidaoFiscalFechamento).toHaveBeenCalledTimes(2));
 expect(api.conferirTransmissaoFechamento).not.toHaveBeenCalled();
});
test('declaração localizada não resolve tentativa Altan desconhecida nem habilita registro externo',async()=>{
 setup({getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'DESCONHECIDA'},declaracao:{confirmada:true,origem:'DESCONHECIDA',numeroDeclaracao:'123'},capacidades:{reconciliar:true}}))});
 expect(await screen.findByText(/tentativa Altan continua sem correlação/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Registrar fora da Altan'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Conferir transmissão'})).toBeEnabled();
});
test('reconciliação exige confirmação e relê sem nova transmissão',async()=>{
 const {api}=setup({getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'DESCONHECIDA'},capacidades:{reconciliar:true}}))});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir transmissão'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Conferir transmissão'}));
 expect(api.conferirTransmissaoFechamento).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar conferência'}));
 await waitFor(()=>expect(api.conferirTransmissaoFechamento).toHaveBeenCalledWith('a',pa));
 expect(api.getAptidaoFiscalFechamento).toHaveBeenCalledTimes(2);
});
test('resposta tardia de outra empresa não substitui identidade atual',async()=>{
 let release; const slow=new Promise(resolve=>{release=resolve;});
 const {api,rerender,options}=setup({getAptidaoFiscalFechamento:jest.fn(id=>id==='a'?slow:Promise.resolve(aptitude('b',{fiscal:{estado:'REJEITADA',motivo:'Situação B'}})))});
 rerender(<OperationsFiscalWorkspace {...options} api={api} item={{companyId:'b',name:'Empresa B'}}/>);
 expect(await screen.findByText(/Situação B/)).toBeInTheDocument();
 await act(async()=>release(aptitude('a',{fiscal:{estado:'CONFIRMADA',motivo:'Resposta A antiga'}})));
 expect(screen.queryByText(/Resposta A antiga/)).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Empresa B · 2026-11'})).toBeInTheDocument();
});
test('erro mantém retorno e recarga, sem liberar comando por dado anterior',async()=>{
 const {api}=setup({getAptidaoFiscalFechamento:jest.fn().mockRejectedValueOnce(Error('Fonte indisponível')).mockResolvedValue(aptitude())});
 expect(await screen.findByRole('alert')).toHaveTextContent('Fonte indisponível');
 expect(screen.getByRole('button',{name:'Preparar cálculo individual'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Recarregar estado fiscal'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Preparar cálculo individual'})).toBeEnabled());
 expect(api.getAptidaoFiscalFechamento).toHaveBeenCalledTimes(2);
});

test('Operações monta situação fiscal diretamente sem navegar nem executar comando',async()=>{
 const {OperationsApproval}=await import('../OperationsApproval');
 const api={getOperationEvidence:jest.fn(async()=>({competencia:pa,total:1,items:[{companyId:'a',competencia:pa,regime:'SIMPLES',revision:'r1',status:'PENDING',pending:[],calculation:null}]})),
 getAptidaoFiscalFechamento:jest.fn(async()=>aptitude()),getFechamento:jest.fn(async()=>({ok:true,dados:{}})),getCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()};
 render(<OperationsApproval embedded modalStage tableContext={{page:0,setPage:jest.fn()}} api={api} rows={[{company:{companyId:'a',razao:'Empresa A',myRole:'ACCOUNTANT'}}]} competencia={pa} stage="calculado"/>);
 const open=await screen.findByRole('button',{name:'Apurar na central'});
 await waitFor(()=>expect(open).toBeEnabled()); fireEvent.click(open);
 expect(await screen.findByRole('heading',{name:'Empresa A · 2026-11'})).toBeInTheDocument();
 expect(api.getAptidaoFiscalFechamento).toHaveBeenCalledWith('a',pa);
 expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});

test('troca API durante ação não prende ocupado nem aceita resposta antiga',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const {rerender,options}=setup({getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'DESCONHECIDA'},capacidades:{reconciliar:true}})),conferirTransmissaoFechamento:jest.fn(()=>pending)});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Conferir transmissão'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Conferir transmissão'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar conferência'}));
 const nextApi={...options.api,getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'REJEITADA',motivo:'Nova leitura'}}))};
 rerender(<OperationsFiscalWorkspace {...options} api={nextApi}/>);
 expect(await screen.findByText(/Nova leitura/)).toBeInTheDocument();
 await act(async()=>release({ok:true,result:{mensagem:'Resposta antiga descartada'}}));
 expect(screen.getByRole('button',{name:'Recarregar estado fiscal'})).toBeEnabled();
 expect(screen.queryByText('Resposta antiga descartada')).not.toBeInTheDocument();
});

test('encerramento de preparação exige ação nominal e envia três confirmações; cancelar não consulta',async()=>{
 const {api}=setup({getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'DESCONHECIDA'},capacidades:{reconciliar:true}})),conferirTransmissaoFechamento:jest.fn(async()=>({ok:true,result:{encerradaSemDespacho:true,mensagem:'Encerramento auditado'}}))});
 const open=await screen.findByRole('button',{name:'Encerrar tentativa não enviada'});await waitFor(()=>expect(open).toBeEnabled());
 fireEvent.click(open);expect(api.conferirTransmissaoFechamento).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancelar ação'}));expect(api.conferirTransmissaoFechamento).not.toHaveBeenCalled();
 fireEvent.click(open);fireEvent.click(screen.getByRole('button',{name:'Confirmar encerramento sem despacho'}));
 await waitFor(()=>expect(api.conferirTransmissaoFechamento).toHaveBeenCalledWith('a',pa,{encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:pa}));
 expect(await screen.findByText('Encerramento auditado')).toBeInTheDocument();
});
test('encerramento recusado mantém desconhecido e não anuncia sucesso',async()=>{
 setup({getAptidaoFiscalFechamento:jest.fn(async()=>aptitude('a',{fiscal:{estado:'DESCONHECIDA'},capacidades:{reconciliar:true}})),conferirTransmissaoFechamento:jest.fn(async()=>({ok:true,result:{estado:'DESCONHECIDA'}}))});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Encerrar tentativa não enviada'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Encerrar tentativa não enviada'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar encerramento sem despacho'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Resultado não confirmado');
 expect(screen.getByText(/Resultado desconhecido/)).toBeInTheDocument();
});