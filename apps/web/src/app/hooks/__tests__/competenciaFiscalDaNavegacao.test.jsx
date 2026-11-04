import {useApuracaoV2} from '../../../features/apuracao-v2/hooks/useApuracaoV2';
import {ApuracaoV2Tab} from '../../../features/apuracao-v2/pages/renderApuracaoV2Tab';
import {useEffect} from 'react';
import {render,screen,fireEvent,act,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation,useNavigate} from 'react-router-dom';
import {useManageAccountingWorkspace} from '../useManageAccountingWorkspace';

const api={};
function Reader({workspace,onRead}) {
  useEffect(()=>{onRead(workspace.circularCompetencia);},[workspace.circularCompetencia,onRead]);
  return <output data-testid="period">{workspace.circularCompetencia}|{workspace.accountingEntriesState.filters.competencia}|{workspace.circularYear}</output>;
}
function Harness({onRead,id='a',tab='cadastroFiscal'}){
 const navigation=useLocation(),navigate=useNavigate();
 const workspace=useManageAccountingWorkspace({api,page:'companyDetail',selectedCompanyId:id,companyDetailTab:tab,navigation});
 return <><Reader workspace={workspace} onRead={onRead}/><button onClick={()=>workspace.setCircularCompetencia('2025-08')}>Manual</button><button onClick={()=>workspace.handleCircularYearChange(2024)}>Ano manual</button><button onClick={()=>navigate('/companies/a/cadastro-fiscal?competencia=2026-07')}>Julho</button><button onClick={()=>navigate(-1)}>Voltar</button></>;
}
function mount(url,onRead=jest.fn()) {return {onRead,...render(<MemoryRouter initialEntries={[url]}><Harness onRead={onRead}/></MemoryRouter>)};}

test('entrada direta usa competência da URL antes do primeiro efeito consumidor e mantém fonte global/ano',()=>{
 const {onRead}=mount('/companies/a/cadastro-fiscal?competencia=2025-12');
 expect(screen.getByTestId('period')).toHaveTextContent('2025-12|2025-12|2025');
 expect(onRead.mock.calls).toEqual([['2025-12']]);
});
test('navegação interna e retorno no histórico aplicam intenção nova; seletores continuam livres depois',()=>{
 const {onRead}=mount('/companies/a/cadastro-fiscal?competencia=2025-12');
 fireEvent.click(screen.getByText('Manual'));fireEvent.click(screen.getByText('Ano manual'));
 expect(screen.getByTestId('period')).toHaveTextContent('2025-08|2025-08|2024');
 fireEvent.click(screen.getByText('Julho'));
 expect(screen.getByTestId('period')).toHaveTextContent('2026-07|2026-07|2026');
 fireEvent.click(screen.getByText('Voltar'));
 expect(screen.getByTestId('period')).toHaveTextContent('2025-12|2025-12|2025');
 expect(onRead.mock.calls.map(c=>c[0])).toEqual(['2025-12','2025-08','2026-07','2025-12']);
});
test.each(['?competencia=2026-13','?competencia=2026-1','?competencia=2026-01&competencia=2026-02','?competencia=0000-01',''])('query inválida/ausente %s não impede escolha manual',query=>{
 mount('/companies/a/cadastro-fiscal'+query);fireEvent.click(screen.getByText('Manual'));
 expect(screen.getByTestId('period')).toHaveTextContent('2025-08|2025-08|2025');
});
test('identidade da empresa deve coincidir; seleção posterior aplica antes de montar consumidor desse contexto',()=>{
 const onRead=jest.fn();const view=render(<MemoryRouter initialEntries={['/companies/b/cadastro-fiscal?competencia=2025-12']}><Harness id="a" onRead={onRead}/></MemoryRouter>);
 fireEvent.click(screen.getByText('Manual'));expect(screen.getByTestId('period')).toHaveTextContent('2025-08');onRead.mockClear();
 view.rerender(<MemoryRouter initialEntries={['/companies/b/cadastro-fiscal?competencia=2025-12']}><Harness id="b" onRead={onRead}/></MemoryRouter>);
 expect(onRead.mock.calls).toEqual([['2025-12']]);
});
test('dados e resposta tardia de lançamentos continuam isolados da nova competência',async()=>{
 let resolve;const localApi={getAccountingEntries:jest.fn(()=>new Promise(r=>{resolve=r;}))};let current;
 function Probe(){const navigation=useLocation(),navigate=useNavigate();current=useManageAccountingWorkspace({api:localApi,page:'companyDetail',selectedCompanyId:'a',companyDetailTab:'cadastroFiscal',navigation});return <><output data-testid="entries">{JSON.stringify(current.accountingEntriesState.entries)}</output><button onClick={()=>navigate('/companies/a/cadastro-fiscal?competencia=2026-07')}>Trocar</button></>;}
 render(<MemoryRouter initialEntries={['/companies/a/cadastro-fiscal?competencia=2026-06']}><Probe/></MemoryRouter>);
 let request;act(()=>{request=current.loadAccountingEntries();});await waitFor(()=>expect(localApi.getAccountingEntries).toHaveBeenCalled());
 fireEvent.click(screen.getByText('Trocar'));await act(async()=>{resolve({data:[{id:'antigo'}],total:1});await request;});
 expect(screen.getByTestId('entries')).not.toHaveTextContent('antigo');expect(current.circularCompetencia).toBe('2026-07');
});

// Real fiscal hook and tab: same composition as the private ApuracaoV2TabWrapper.
// Only saved-data APIs are fake; no action or fiscal transport is available.
test.each(['direta','interna'])('Apuração real consome primeiro período correto na entrada %s',async mode=>{
 const reads={
  getCadastroFiscal:jest.fn(async()=>({cadastro:{regimeTributario:'SIMPLES'}})),
  getPerfilFiscal:jest.fn(async()=>({ok:true,atividades:[]})),
  listProdutosServicos:jest.fn(async()=>({items:[]})),
  listPendencias:jest.fn(async()=>({items:[],counts:[]})),
  getFechamento:jest.fn(async()=>({dados:{estado:'aberta',faturamento:{interno:100,externo:0},atividades:[]}})),
  getApuracaoSnapshot:jest.fn(async()=>({snapshot:null})),
  getRelatorioFaturamento:jest.fn(async()=>({relatorio:null})),
 };
 function Fiscal({workspace}){
  const panel=useApuracaoV2({api:reads,companyId:'a',competencia:workspace.circularCompetencia});
  return <ApuracaoV2Tab panel={panel} api={reads} companyId="a" competencia={workspace.circularCompetencia} onCompetenciaChange={workspace.setCircularCompetencia}/>;
 }
 function Destination(){
  const navigation=useLocation(),navigate=useNavigate(),isFiscal=navigation.pathname.endsWith('/cadastro-fiscal');
  const workspace=useManageAccountingWorkspace({api:reads,page:isFiscal?'companyDetail':'companies',selectedCompanyId:'a',companyDetailTab:isFiscal?'cadastroFiscal':'anotacoes',navigation});
  return isFiscal?<Fiscal workspace={workspace}/>:<button onClick={()=>navigate('/companies/a/cadastro-fiscal?competencia=2025-12')}>Abrir apuração real</button>;
 }
 render(<MemoryRouter initialEntries={[mode==='direta'?'/companies/a/cadastro-fiscal?competencia=2025-12':'/companies']}><Destination/></MemoryRouter>);
 if(mode==='interna')fireEvent.click(screen.getByText('Abrir apuração real'));
 await waitFor(()=>expect(reads.getFechamento).toHaveBeenCalled());
 await waitFor(()=>expect(reads.listPendencias).toHaveBeenCalled());
 expect(screen.getAllByText('2025-12').some(e=>e.tagName==='STRONG')).toBe(true);
 expect(reads.getFechamento.mock.calls.every(([id,period])=>id==='a'&&period==='2025-12')).toBe(true);
 expect(reads.getApuracaoSnapshot.mock.calls.every(([id,period])=>id==='a'&&period==='2025-12')).toBe(true);
 expect(reads.listPendencias.mock.calls.every(([id,input])=>id==='a'&&input.competencia==='2025-12')).toBe(true);
 expect(reads.getRelatorioFaturamento.mock.calls.every(([id,period])=>id==='a'&&period==='2025-12')).toBe(true);
});
test('Guias abre diretamente na competência do documento e mantém a seleção manual após a entrada',()=>{
 const onRead=jest.fn();
 render(<MemoryRouter initialEntries={['/companies/a/guides?competencia=2025-10']}>
   <Harness id="a" tab="guides" onRead={onRead}/>
 </MemoryRouter>);
 expect(screen.getByTestId('period')).toHaveTextContent('2025-10|2025-10|2025');
 expect(onRead.mock.calls).toEqual([['2025-10']]);
 fireEvent.click(screen.getByText('Manual'));
 expect(screen.getByTestId('period')).toHaveTextContent('2025-08|2025-08|2025');
});
test.each([
 '/companies/b/guides?competencia=2025-10',
 '/companies/a/cadastro-fiscal?competencia=2025-10',
 '/companies/a/guides?competencia=2025-10&competencia=2025-11',
])('Guias recusa competência de empresa, aba ou consulta incompatível: %s',url=>{
 const onRead=jest.fn();
 render(<MemoryRouter initialEntries={[url]}><Harness id="a" tab="guides" onRead={onRead}/></MemoryRouter>);
 expect(onRead).not.toHaveBeenCalledWith('2025-10');
});