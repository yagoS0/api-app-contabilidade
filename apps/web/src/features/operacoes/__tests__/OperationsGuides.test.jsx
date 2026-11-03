import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationsGuides } from '../OperationsGuides';
import { reconcileOperationGuides } from '../operationsDetails';
const row={company:{companyId:'a',razao:'Alfa'},guideSummary:{items:[{key:'das',guideId:'g1',label:'DAS'}]}};
const guide={companyId:'a',guideId:'g1',competencia:'2026-10',tipo:'DAS',status:'PROCESSED',valor:100,vencimento:'2026-11-20T00:00:00Z',versaoPagamento:'v1',paymentStatus:'PAID',paymentStatusSource:'CLIENTE',paymentConfirmedAt:'2026-10-30T02:00:00Z',envio:{canais:[{canal:'WHATSAPP',destino:'destino sintético',status:'indeterminado',podeTentarDeNovo:false}]}};
test('documentos conciliam só por identidade e período; duplicata é erro',()=>{
 const result=reconcileOperationGuides([guide,{...guide,guideId:'outro',companyId:'b'},{...guide,guideId:'mes-anterior',competencia:'2026-09'}],row,'2026-10');expect(result.guides).toEqual([guide]);expect(result.missing).toEqual([]);expect(reconcileOperationGuides([{...guide,guideId:'igual-valor'}],row,'2026-10').missing).toHaveLength(1);expect(()=>reconcileOperationGuides([guide,guide],row,'2026-10')).toThrow(/repetido/);
});
test('Pago identifica guias pagas, origem cliente, data Brasília e envio incerto independente',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide,{...guide,guideId:'aberta',tipo:'INSS',paymentStatus:'OPEN'}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('Documento g1');expect(screen.queryByText('Documento aberta')).not.toBeInTheDocument();expect(screen.getByText(/Confirmada pelo cliente/)).toBeInTheDocument();expect(screen.getByText('Confirmação: A verificar')).toBeInTheDocument();expect(screen.getByText(/Resultado incerto/)).toBeInTheDocument();expect(screen.getByText(/Vencimento 20\/11\/2026/)).toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});
test('retorno de outra competência não contamina a tabela',async()=>{
 let finish;const api={getCompanyGuides:jest.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue([])};const view=render(<OperationsGuides api={api} rows={[row]} competencia="2026-10"/>);view.rerender(<OperationsGuides api={api} rows={[row]} competencia="2026-09"/>);await screen.findByText(/Nenhum documento identificado/);await act(async()=>finish([guide]));expect(screen.queryByText('Documento g1')).not.toBeInTheDocument();
});
test.each([
 ['OPEN','SERPRO','Origem: consulta SERPRO'],
 ['OVERDUE','SERPRO','Origem: consulta SERPRO'],
 ['UNPAID','SERPRO','Origem: consulta SERPRO'],
 [null,'SERPRO','Origem: consulta SERPRO'],
 ['OPEN','CLIENTE','Origem: informação do cliente'],
 ['OPEN','MANUAL','Origem: registro manual'],
])('estado %s com origem %s não afirma confirmação',async(paymentStatus,paymentStatusSource,origin)=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,paymentStatus,paymentStatusSource}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="enviado"/>);await screen.findByText('Documento g1');expect(screen.getByText(/Pagamento não confirmado/)).toBeInTheDocument();expect(screen.getByText(new RegExp(origin))).toBeInTheDocument();expect(screen.queryByText(/Confirmada na Receita|Confirmada pelo cliente|Confirmada pelo contador/)).not.toBeInTheDocument();expect(screen.getByText(/Resultado incerto/)).toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});
test.each([
 ['SERPRO','Confirmada na Receita'],
 ['CLIENTE','Confirmada pelo cliente — declaração, não comprovante bancário'],
 ['MANUAL','Confirmada pelo contador'],
 [null,'Origem não informada'],
])('PAID mantém origem %s sem inventar outra evidência',async(paymentStatusSource,origin)=>{
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,paymentStatus:'PAID',paymentStatusSource}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('Documento g1');expect(screen.getByText(new RegExp(origin))).toBeInTheDocument();expect(screen.queryByText(/Pagamento não confirmado/)).not.toBeInTheDocument();expect(api.send).not.toHaveBeenCalled();
});


test('data legada de pagamento não substitui instante de confirmação ausente no DTO',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide]),getOperationsGuideEvidence:jest.fn(async()=>({companyId:'a',competencia:'2026-10',items:[{guideId:'g1',pagamento:{status:'PAID',origem:'CLIENTE',dataCivil:'2026-10-30',registradoEm:null,valorPago:null},envios:[],tentativas:[]}],nextOffset:null}))};
 render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('Documento g1');expect(screen.getByText('Confirmação: A verificar')).toBeInTheDocument();expect(screen.getByText('Data do pagamento: 30/10/2026')).toBeInTheDocument();expect(screen.getByText('Não disponível')).toBeInTheDocument();expect(screen.queryByText(/29\/10\/2026/)).not.toBeInTheDocument();
});

test.each([['ERROR','Erro de processamento'],['NEEDS_REVIEW','Em conferência']])('estado documental %s prevalece sobre projeção Disponível antiga',async(status,label)=>{
 const stale={...row,guideSummary:{items:[{key:'das',guideId:'g1',label:'DAS',documento:'Disponível',comunicacao:'Enviada',pagamento:'Não confirmado'}]}};
 const api={getCompanyGuides:jest.fn(async()=>[{...guide,status,paymentStatus:'OPEN'}])};render(<OperationsGuides api={api} rows={[stale]} competencia="2026-10" stage="disponivel"/>);await screen.findByText('Documento g1');expect(screen.getByText(label)).toBeInTheDocument();expect(screen.getByText(/Expectativa: Disponível/)).toBeInTheDocument();expect(screen.queryByText('Disponível',{exact:true})).not.toBeInTheDocument();
});

test('carga paralela limitada não inicia evidências ou outras empresas após fechar', async () => {
 const pending=[];const api={getCompanyGuides:jest.fn(()=>new Promise(resolve=>pending.push(resolve))),getOperationsGuideEvidence:jest.fn(),send:jest.fn()};
 const many=Array.from({length:8},(_,i)=>({company:{companyId:String(i),razao:`Empresa ${i}`}}));
 const view=render(<OperationsGuides api={api} rows={many} competencia="2026-10" stage="disponivel"/>);
 expect(api.getCompanyGuides.mock.calls.map(([id])=>id)).toEqual(['0','1','2']);view.unmount();
 await act(async()=>pending.forEach(resolve=>resolve([])));
 expect(api.getCompanyGuides).toHaveBeenCalledTimes(3);expect(api.getOperationsGuideEvidence).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();
});
test.each([null, {}, [{...guide,companyId:undefined}], [{...guide,companyId:'outra'}]])('leitura inválida não vira ausência nem libera evidências',async value=>{
 const api={getCompanyGuides:jest.fn(async()=>value),getOperationsGuideEvidence:jest.fn(),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="disponivel"/>);
 await screen.findByText(/Resposta de documentos inválida/);expect(screen.queryByText(/Nenhum documento identificado/)).not.toBeInTheDocument();expect(api.getOperationsGuideEvidence).not.toHaveBeenCalled();expect(api.send).not.toHaveBeenCalled();
});

test('comunicação só lê a empresa expandida e relê ao reabrir', async () => {
 const api={getCompanyGuides:jest.fn(async()=>[]),getCompanyGuideDelivery:jest.fn(async()=>null)};
 render(<OperationsGuides api={api} rows={[row,{company:{companyId:'b',razao:'Beta'}}]} competencia="2026-10" stage="disponivel"/>);
 await waitFor(()=>expect(api.getCompanyGuides).toHaveBeenCalledTimes(2));expect(api.getCompanyGuideDelivery).not.toHaveBeenCalled();
 const detail=screen.getAllByText('Comunicação da empresa')[0].closest('details');
 detail.open=true;fireEvent(detail,new Event('toggle'));await waitFor(()=>expect(api.getCompanyGuideDelivery).toHaveBeenCalledTimes(1));
 expect(api.getCompanyGuideDelivery).toHaveBeenCalledWith('a','2026-10');
 detail.open=false;fireEvent(detail,new Event('toggle'));detail.open=true;fireEvent(detail,new Event('toggle'));
 await waitFor(()=>expect(api.getCompanyGuideDelivery).toHaveBeenCalledTimes(2));
});


test('guia sem competência não invalida documento do mês nem entra na seleção de envio', async () => {
 const valid={...guide,paymentStatus:'OPEN'};
 const unscoped={...valid,guideId:'sem-periodo',competencia:null};
 const writable={...row,company:{...row.company,myRole:'ACCOUNTANT'}};
 expect(reconcileOperationGuides([valid,unscoped],writable,'2026-10').guides).toEqual([valid]);
 const api={getCompanyGuides:jest.fn(async()=>[valid,unscoped]),
  listarContatosWhatsapp:jest.fn(async()=>({canalPadraoEnvio:'EMAIL'})),
  previewOperationsGuideSend:jest.fn(async()=>({preview:{companyId:'a',competencia:'2026-10',items:[]}})),
  sendGuidesTask:jest.fn()};
 render(<OperationsGuides api={api} rows={[writable]} competencia="2026-10" stage="enviado"/>);
 await screen.findByText('Documento g1');
 expect(screen.queryByText(/Resposta de documentos inválida/)).not.toBeInTheDocument();
 expect(screen.queryByText('Documento sem-periodo')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Alfa'}));
 fireEvent.click(screen.getByRole('button',{name:'Conferir envio / reenvio'}));
 await waitFor(()=>expect(api.previewOperationsGuideSend).toHaveBeenCalledTimes(1));
 expect(api.previewOperationsGuideSend).toHaveBeenCalledWith('a','2026-10',{items:[{guideId:'g1',reenviarConfirmado:false}],whatsappRequested:false});
 expect(api.sendGuidesTask).not.toHaveBeenCalled();
});
