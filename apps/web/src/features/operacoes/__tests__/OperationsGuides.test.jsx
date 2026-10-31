import { act, render, screen } from '@testing-library/react';
import { OperationsGuides } from '../OperationsGuides';
import { reconcileOperationGuides } from '../operationsDetails';
const row={company:{companyId:'a',razao:'Alfa'},guideSummary:{items:[{key:'das',guideId:'g1',label:'DAS'}]}};
const guide={companyId:'a',guideId:'g1',competencia:'2026-10',tipo:'DAS',status:'PROCESSED',valor:100,vencimento:'2026-11-20T00:00:00Z',versaoPagamento:'v1',paymentStatus:'PAID',paymentStatusSource:'CLIENTE',paymentConfirmedAt:'2026-10-30T02:00:00Z',envio:{canais:[{canal:'WHATSAPP',destino:'destino sintético',status:'indeterminado',podeTentarDeNovo:false}]}};
test('documentos conciliam só por identidade e período; duplicata é erro',()=>{
 const result=reconcileOperationGuides([guide,{...guide,guideId:'outro',companyId:'b'},{...guide,guideId:'mes-anterior',competencia:'2026-09'}],row,'2026-10');expect(result.guides).toEqual([guide]);expect(result.missing).toEqual([]);expect(reconcileOperationGuides([{...guide,guideId:'igual-valor'}],row,'2026-10').missing).toHaveLength(1);expect(()=>reconcileOperationGuides([guide,guide],row,'2026-10')).toThrow(/repetido/);
});
test('Pago identifica guias pagas, origem cliente, data Brasília e envio incerto independente',async()=>{
 const api={getCompanyGuides:jest.fn(async()=>[guide,{...guide,guideId:'aberta',tipo:'INSS',paymentStatus:'OPEN'}]),send:jest.fn()};render(<OperationsGuides api={api} rows={[row]} competencia="2026-10" stage="pago"/>);await screen.findByText('Documento g1');expect(screen.queryByText('Documento aberta')).not.toBeInTheDocument();expect(screen.getByText(/Confirmada pelo cliente/)).toBeInTheDocument();expect(screen.getByText(/29\/10\/2026/)).toBeInTheDocument();expect(screen.getByText(/Resultado incerto/)).toBeInTheDocument();expect(screen.getByRole('cell', { name: /^2026-10\s*20\/11\/2026$/ })).toHaveTextContent('20/11/2026');expect(api.send).not.toHaveBeenCalled();
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
