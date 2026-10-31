import { act, render, screen } from '@testing-library/react';
import { OperationsCalculationDetails, OperationsTransmissionValues } from '../OperationsCalculationDetails';
const apiFor = () => ({getApuracaoSnapshot:jest.fn(async(id,competencia)=>({ok:true,snapshot:{portalClientId:id,competencia,estado:'transmitida',idempotencyKey:'calculo-1',dasRetornadoSerpro:74,transmitidoEm:'2026-10-20T12:00:00Z',numeroDeclaracao:'123',receitaInterna:1200,receitaExterna:0,dasSimuladoSerpro:72,atividadesEscolhidas:[{idAtividade:'a',anexoImplicito:'III',valorInterno:1200,valorExterno:0}]}})),getAuditoriaNotas:jest.fn(async()=>({auditoria:{competencia:'2026-10',totalAchados:1,foraDaConferencia:{total:2},perguntas:[{id:'x',titulo:'Divergência de nota',situacao:'NAO_CONFERIVEL',achados:[{}],naoAvaliadas:[],motivo:'Dados insuficientes'}]}})),getPgdasHistorico:jest.fn(async()=>({ok:true,competencia:'2026-10',versoes:[{numeroDeclaracao:'123',atual:true,dasTotal:73,origem:'CONSULTA_PGDAS'}]})),saveCompanyOperation:jest.fn(),executeCompanyOperation:jest.fn()});
test('mostra faturamento/anexo congelados, auditoria e extratos independentes da revisão sem mutação',async()=>{
 const api=apiFor();render(<OperationsCalculationDetails api={api} companyId="a" competencia="2026-10"/>);await screen.findByText('III');expect(screen.getAllByText(/1.200,00/).length).toBeGreaterThan(0);expect(screen.getByText(/72,00/)).toBeInTheDocument();expect(screen.getByText(/73,00/)).toBeInTheDocument();expect(screen.getByText('Dados insuficientes')).toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('outra declaração permanece no histórico sem correspondência e auditoria ausente não aprova',async()=>{
 const api=apiFor();api.getPgdasHistorico.mockResolvedValue({competencia:'2026-10',versoes:[{numeroDeclaracao:'999',dasTotal:73,atual:true}]});api.getAuditoriaNotas.mockResolvedValue({auditoria:null});render(<OperationsCalculationDetails api={api} companyId="a" competencia="2026-10"/>);await screen.findByText(/ausência não significa aprovação/);expect(screen.getByText(/Extrato sem vínculo/)).toBeInTheDocument();expect(screen.getByText(/73,00/)).toBeInTheDocument();expect(screen.getByText('Correspondência do extrato com esta revisão').nextElementSibling).toHaveTextContent('A verificar');expect(screen.getByText(/ausência não significa aprovação/)).toBeInTheDocument();
});

test.each([
 ['reaberta mantendo número', { estado: 'aberta', idempotencyKey: 'reaberta:nova' }, {}],
 ['recalculada mantendo número', { estado: 'calculada', idempotencyKey: 'novo-calculo' }, {}],
 ['transmissão incerta', { estado: 'erro_transmissao' }, {}],
 ['divergência informada', {}, { declaracaoDiferenteDaInterna: true }],
 ['duas versões atuais', {}, { versoes: [{ id: '1', numeroDeclaracao: '123', atual: true, dasTotal: 73 }, { id: '2', numeroDeclaracao: '123', atual: true, dasTotal: 75 }] }],
 ['única versão histórica', {}, { versoes: [{ numeroDeclaracao: '123', atual: false, dasTotal: 73 }] }],
 ['legado sem vínculo', {}, { versoes: [{ numeroDeclaracao: '123', atual: true, legado: true, dasTotal: 73 }] }],
 ['transmitida com datas e identidade, sem revisão no DTO', { transmitidoEm: '2026-10-20T12:00:00Z' }, { atualId: '1', estadoInterno: 'transmitida', numeroDeclaracaoInterna: '123', versoes: [{ id: '1', numeroDeclaracao: '123', atual: true, legado: false, consultadaEm: '2026-10-20T12:01:00Z', dasTotal: 73, origem: 'CONSULTA_PGDAS' }] }],
])('%s não transforma extrato salvo em evidência da revisão', async (_, snapshotOverride, historyOverride) => {
 const api = apiFor();
 const original = await api.getApuracaoSnapshot('a', '2026-10');
 api.getApuracaoSnapshot.mockResolvedValue({ snapshot: { ...original.snapshot, ...snapshotOverride } });
 const originalHistory = await api.getPgdasHistorico();
 api.getPgdasHistorico.mockResolvedValue({ ...originalHistory, ...historyOverride });
 render(<OperationsCalculationDetails api={api} companyId="a" competencia="2026-10" />);
 await screen.findByText('Correspondência do extrato com esta revisão');
 expect(screen.getByText('Correspondência do extrato com esta revisão').nextElementSibling).toHaveTextContent('A verificar');
 expect(screen.getByText('Cálculo simulado salvo').nextElementSibling).toHaveTextContent('72,00');
 expect(screen.getByText('Retorno salvo da transmissão SERPRO').nextElementSibling).toHaveTextContent('74,00');
 expect(screen.getByRole('region', { name: 'Extratos salvos, sem conciliação de revisão' })).toHaveTextContent('73,00');
 expect(screen.queryByText('Imposto recebido do extrato correspondente')).not.toBeInTheDocument();
 expect(api.saveCompanyOperation).not.toHaveBeenCalled(); expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test('troca de competência descarta leitura antiga',async()=>{
 const api=apiFor();let finish;api.getApuracaoSnapshot.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue({snapshot:null});const view=render(<OperationsCalculationDetails api={api} companyId="a" competencia="2026-10"/>);view.rerender(<OperationsCalculationDetails api={api} companyId="b" competencia="2026-09"/>);await screen.findByText(/Atividades\/anexo não disponíveis/);await act(async()=>finish({snapshot:{competencia:'2026-10',portalClientId:'a',receitaInterna:987654}}));expect(screen.queryByText(/987.654/)).not.toBeInTheDocument();
});

const summaryApi = () => {
 const api = apiFor();
 api.getPgdasHistorico.mockResolvedValue({ competencia:'2026-10', atualId:'v2', numeroDeclaracaoInterna:'123', versoes:[
  {id:'v2',numeroDeclaracao:'123',atual:true,dasTotal:73},
  {id:'v1',numeroDeclaracao:'122',atual:false,dasTotal:71},
 ] });
 return api;
};
const summary = (api, companyId='a', competencia='2026-10') => <table><tbody><tr><OperationsTransmissionValues api={api} companyId={companyId} competencia={competencia}/></tr></tbody></table>;
test('resumo da transmissão conserva simulação e todas as versões identificadas, sem copiar retorno',async()=>{
 const api=summaryApi();render(summary(api));await screen.findByText(/72,00/);
 expect(screen.getByText(/73,00/)).toBeInTheDocument();expect(screen.getByText(/71,00/)).toBeInTheDocument();expect(screen.queryByText(/74,00/)).not.toBeInTheDocument();
 expect(screen.getByText(/Simulação · calculo-1/)).toBeInTheDocument();expect(screen.getByText(/Declaração 123 · versão v2/)).toHaveTextContent('Atual na circular');expect(screen.getByText(/Declaração 122 · versão v1/)).toHaveTextContent('Histórico');
 expect(screen.queryByRole('region')).not.toBeInTheDocument();expect(api.saveCompanyOperation).not.toHaveBeenCalled();expect(api.executeCompanyOperation).not.toHaveBeenCalled();
});
test.each([
 ['múltiplos atuais',h=>({...h,versoes:h.versoes.map(v=>({...v,atual:true}))})],
 ['atualId inconsistente',h=>({...h,atualId:'inexistente'})],
 ['identidade interna divergente',h=>({...h,numeroDeclaracaoInterna:'999'})],
 ['identidade atual divergente',h=>({...h,versoes:[{...h.versoes[0],numeroDeclaracao:'999'}]})],
 ['competência divergente',h=>({...h,competencia:'2026-09'})],
 ['empresa divergente',h=>({...h,companyId:'outra'})],
 ['versão de outra empresa',h=>({...h,versoes:[{...h.versoes[0],companyId:'outra'}]})],
 ['versão de outra competência',h=>({...h,versoes:[{...h.versoes[0],competencia:'2026-09'}]})],
 ...['declaracaoDiferenteDaInterna','entregaSemTransmissaoInterna','mudancaDetectada'].map(flag=>[flag,h=>({...h,[flag]:true})]),
])('resumo fica a verificar: %s',async(_,change)=>{
 const api=summaryApi();api.getPgdasHistorico.mockResolvedValue(change(await api.getPgdasHistorico()));render(summary(api));
 expect(await screen.findAllByText('A verificar')).toHaveLength(2);expect(screen.queryByText(/7[1234],00/)).not.toBeInTheDocument();
});
test.each(['getApuracaoSnapshot','getAuditoriaNotas','getPgdasHistorico'])('falha de %s não apresenta valores como conferidos',async method=>{
 const api=summaryApi();api[method].mockRejectedValue(Error('offline'));render(summary(api));expect(await screen.findAllByText('A verificar')).toHaveLength(2);
});
test('extrato sem identidade ou valor não recebe número inventado',async()=>{
 const api=summaryApi();api.getPgdasHistorico.mockResolvedValue({competencia:'2026-10',versoes:[{atual:false,dasTotal:null}]});render(summary(api));
 await screen.findByText(/72,00/);expect(screen.getByText('A verificar')).toBeInTheDocument();expect(screen.getByText(/Declaração a verificar/)).toHaveTextContent('versão a verificar');expect(screen.queryByText(/74,00/)).not.toBeInTheDocument();
});
test('valor zero salvo é válido e permanece distinto do retorno',async()=>{
 const api=summaryApi();api.getPgdasHistorico.mockResolvedValue({competencia:'2026-10',versoes:[{id:'v0',numeroDeclaracao:'120',atual:false,dasTotal:0}]});render(summary(api));expect(await screen.findByText(/^R\$\s*0,00$/)).toBeInTheDocument();expect(screen.queryByText(/74,00/)).not.toBeInTheDocument();
});
test('resumo descarta resposta antiga e não reutiliza valor na troca de empresa',async()=>{
 const api=summaryApi();let finish;api.getPgdasHistorico.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const view=render(summary(api));view.rerender(summary(api,'b','2026-09'));
 await screen.findAllByText('A verificar');await act(async()=>finish({competencia:'2026-10',versoes:[{id:'old',numeroDeclaracao:'123',dasTotal:987654}]}));expect(screen.queryByText(/987.654/)).not.toBeInTheDocument();expect(screen.queryByText(/72,00/)).not.toBeInTheDocument();
});

test.each([undefined,null,{}])('resumo sem conexão disponível (%s) não derruba a página nem inventa valores',async api=>{
 render(summary(api));expect(screen.getByText('Lendo cálculo salvo…')).toBeInTheDocument();expect(screen.getByText('Lendo extrato salvo…')).toBeInTheDocument();expect(await screen.findAllByText('A verificar')).toHaveLength(2);expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
});
