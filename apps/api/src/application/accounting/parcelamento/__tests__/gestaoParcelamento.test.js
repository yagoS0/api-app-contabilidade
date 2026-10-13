import { quadroGestaoParcelamento } from '../../../../../../../packages/shared/src/accounting/gestaoParcelamento.js';
import { preverCorrecaoParcelamento } from '../GestaoParcelamentoService.js';
import { validarLinhasBaixa } from '../BaixaGestaoParcelamentoService.js';

const linha=(tipoLinha,valor)=>({tipoLinha,valor,tipo:tipoLinha==='CAIXA'?'C':'D',conta:'100',historico:'Pagamento da parcela'});
const fixture=()=>({id:'a',portalClientId:'c',status:'ATIVO',numParcelas:2,numEntradas:0,label:'Acordo',formaPagamento:'DEBITO_AUTOMATICO',numeroParcelamento:'1',parcelasContratadas:[1,2].map(n=>({id:`p${n}`,numeroParcela:n,competencia:`2026-0${n}`,vencimento:`2026-0${n}-30`,valorPrevisto:100}))});
function mockDb(a){return {parcelamento:{findFirst:jest.fn(async()=>a)},accountingEntry:{findMany:jest.fn(async()=>[])},companyMonthlyCircular:{findMany:jest.fn(async()=>[])}};}
const body=a=>({companyId:'c',parcelamentoId:'a',alteracao:{motivo:'Corrigir importação',parcelas:a.parcelasContratadas.map(p=>({...p,tipo:'PARCELA'}))}});

test('parcela do mês não é quantidade de pagamentos nem quantidade de tarefas',()=>{
 const parcelas=Array.from({length:11},(_,i)=>({id:`p${i}`,numeroParcela:i+1,vencimento:`2026-${String(i).padStart(2,'0')}-30`,origemBaixa:i<3?'MANUAL':null}));
 const q=quadroGestaoParcelamento({parcelasContratadas:parcelas},'2026-10');
 expect(q.doMes).toEqual([11]);expect(q.confirmadas).toBe(3);expect(q.baixadas).toBe(3);
});
test('histórico, SERPRO e baixa são informações diferentes',()=>{
 const q=quadroGestaoParcelamento({parcelasContratadas:[{numeroParcela:1,origemBaixa:'HISTORICO'},{numeroParcela:2,pagamentoStatus:'CONFIRMADO',pagamentoEvidencia:{resultado:'CONFIRMADO'}},{numeroParcela:3,guia:{paymentStatus:'PAID',paymentStatusSource:'SERPRO',baixada:true}}]},'2026-10');
 expect(q.historicas).toBe(1);expect(q.baixadas).toBe(1);expect(q.aLancar).toBe(1);expect(q.parcelas[1].origemConfirmacao).toBe('SERPRO');
});
test('aponta calendário fora de ordem sem inventar inadimplência',()=>{
 const q=quadroGestaoParcelamento({parcelasContratadas:[{numeroParcela:1,vencimento:'2026-10-20'},{numeroParcela:2,vencimento:'2026-08-20'}]},'2026-10');
 expect(q.inconsistencias).toHaveLength(1);expect(q.confirmadas).toBe(0);expect(q.aConferir).toBe(2);
});
test.each([
 [[linha('PARC',99),linha('CAIXA',99)],'integral'],
 [[linha('PARC',100),linha('JUROS',5),linha('CAIXA',100)],'mesmo total'],
 [[linha('PARC',100),linha('CAIXA',100),linha('CAIXA',1)],'Agrupe'],
 [[{...linha('PARC',100),conta:''},linha('CAIXA',100)],'Preencha'],
 [[linha('PARC',100),linha('MULTA',-2),linha('CAIXA',98)],'positivos'],
])('recusa baixa inválida %#',(linhas,erro)=>expect(()=>validarLinhasBaixa(linhas,100)).toThrow(erro));
test('baixa integral aceita juros e multa explícitos',()=>expect(validarLinhasBaixa([linha('PARC',100),linha('JUROS',5),linha('MULTA',2),linha('CAIXA',107)],100).total).toBe(107));
test('correção preserva forma de pagamento omitida',async()=>{
 const a=fixture();a.parcelasContratadas[1].vencimento='2026-02-28';
 expect((await preverCorrecaoParcelamento(body(a),mockDb(a))).cadastro.formaPagamento).toBe('DEBITO_AUTOMATICO');
});
test('recusa parcelas de outro contrato, números repetidos e data inválida',async()=>{
 const a=fixture(),db=mockDb(a),args=body(a);
 args.alteracao.parcelas[0].id='outro';await expect(preverCorrecaoParcelamento(args,db)).rejects.toThrow('inválidas');
 args.alteracao.parcelas[0].id='p1';args.alteracao.parcelas[1].numeroParcela=1;await expect(preverCorrecaoParcelamento(args,db)).rejects.toThrow('numeração');
 args.alteracao.parcelas[1].numeroParcela=2;await expect(preverCorrecaoParcelamento(args,db)).rejects.toThrow('vencimento válido');
});
test('pagamentos e meses fechados não são reescritos',async()=>{
 const a=fixture();a.parcelasContratadas[1].vencimento='2026-02-28';a.parcelasContratadas[0].origemBaixa='MANUAL';
 const db=mockDb(a),args=body(a);args.alteracao.parcelas[0].valorPrevisto=200;
 await expect(preverCorrecaoParcelamento(args,db)).rejects.toThrow('Preserve valores');
 args.alteracao.parcelas[0].valorPrevisto=100;args.alteracao.parcelas[0].numeroParcela=2;args.alteracao.parcelas[1].numeroParcela=1;
 db.companyMonthlyCircular.findMany.mockResolvedValue([{competencia:'2026-01',fechadoContabilEm:new Date()}]);
 await expect(preverCorrecaoParcelamento(args,db)).rejects.toThrow('competência fechada');
});
test('vínculo por guia prevalece sobre número legado divergente',async()=>{
 const a=fixture();a.parcelasContratadas[1].vencimento='2026-02-28';a.parcelasContratadas[0].guiaId='g1';
 const db=mockDb(a),args=body(a);
 db.accountingEntry.findMany.mockResolvedValue([{id:'baixa',sourceGuideId:'g1',numeroParcela:2,competencia:'2026-01'}]);
 args.alteracao.parcelas[1].valorPrevisto=200;
 const preview=await preverCorrecaoParcelamento(args,db);
 expect(preview.alteracoes[0].id).toBe('p2');
 expect(preview.alteracoes[0].lancamentos).toEqual([]);
});
