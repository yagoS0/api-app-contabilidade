import { withComposicaoParcelamentoMock } from '../composicaoParcelamentoMock';
const base={id:'origem',tipo:'PROVISAO',subtipo:'PIS',competencia:'2026-01',statusPagamento:'ABERTO',saldo:100,lines:[{tipo:'D',conta:'despesa',valor:100},{tipo:'C',conta:'pis',valor:100}]};
test('demonstração mantém o mesmo vínculo na Circular, pagamentos e situação fiscal', async()=>{
 const contratos=[];
 const original={listParcelamentos:async()=>contratos,getCircular:async()=>({provisoes:[base]}),getPagamentosPendentes:async()=>({itens:[base]}),listPendenciasContabeis:async()=>({itens:[]}),createBaixa:jest.fn(),ingestParcelamento:jest.fn(async()=>{contratos.push({id:'p',tipo:'LUCRO_PRESUMIDO',status:'ATIVO'});return {ok:true,data:{parcelamentoId:'p'}};})};
 const api=withComposicaoParcelamentoMock(original,()=>[base]);
 const origens=(await api.listDebitosCircularParcelamento('teste-projecao','LUCRO_PRESUMIDO')).debitos;
 const body={header:{tipo:'LUCRO_PRESUMIDO',valorPrincipal:100},origensCircular:origens,provisaoLines:[{tipo:'D',tipoLinha:'PRINCIPAL',conta:'pis',codigoTributo:'8109',valor:100},{tipo:'C',tipoLinha:'PARC',conta:'acordo',valor:100}]};
 await api.ingestParcelamento('teste-projecao',body);
 await api.ingestParcelamento('teste-projecao',body);
 expect((await api.listParcelamentos('teste-projecao'))[0].debitosOrigem).toHaveLength(1);
 expect((await api.getPagamentosPendentes('teste-projecao','2026-10')).itens).toEqual([]);
 expect((await api.getCircular('teste-projecao',{})).provisoes[0].parcelamentoOrigem.statusContrato).toBe('ATIVO');
 expect((await api.listPendenciasContabeis('teste-projecao')).itens[0].estado).toBe('PARCELADO');
 await expect(api.createBaixa('teste-projecao','origem',{})).rejects.toThrow(/parcelamento/);
 contratos[0].status='RESCINDIDO';
 expect((await api.listPendenciasContabeis('teste-projecao')).itens[0]).toMatchObject({estado:'A_CONCILIAR',total:null});
});
