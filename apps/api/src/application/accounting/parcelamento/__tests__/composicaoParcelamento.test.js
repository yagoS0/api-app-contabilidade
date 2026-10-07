jest.mock('../../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import {candidatosComposicao,incluirComposicaoTx,exigirBaixaForaDaComposicao} from '../ComposicaoParcelamentoService.js';
import {resumoOrigensParcelamento} from '../../../../../../../packages/shared/src/accounting/composicaoParcelamento.js';
function banco(){
 const entries=[{id:'pis',portalClientId:'e',tipo:'PROVISAO',subtipo:'PIS',competencia:'2026-01',statusPagamento:'PARCIAL',updatedAt:'v1',lines:[{tipo:'D',conta:'despesa',valor:150},{tipo:'C',conta:'passivo-pis',valor:150}],baixas:[{tipo:'BAIXA',lines:[{tipo:'D',conta:'passivo-pis',valor:50}]}]}];
 const vinculos=[],parcelamento={id:'p',portalClientId:'e',tipo:'LUCRO_PRESUMIDO',status:'ATIVO',principalTotal:100};
 const db={$queryRaw:jest.fn(),accountingEntry:{findMany:jest.fn(async()=>entries)},guide:{findMany:jest.fn(async()=>[])},parcelamento:{findFirst:jest.fn(async()=>parcelamento)},parcelamentoDebitoOrigem:{findMany:jest.fn(async({where})=>vinculos.filter(o=>!where.parcelamentoId||o.parcelamentoId===where.parcelamentoId)),findFirst:jest.fn(async()=>vinculos[0]),create:jest.fn(async({data})=>{const v={...data,id:'o'};vinculos.push(v);return v;})}};
 const lines=[{tipo:'D',tipoLinha:'PRINCIPAL',conta:'passivo-pis',codigoTributo:'8109',valor:100},{tipo:'C',tipoLinha:'PARC',conta:'acordo',valor:100}];
 return {db,entries,vinculos,parcelamento,lines};
}
test('seleciona apenas saldo residual e registra origem separada sem mudar provisão',async()=>{
 const {db,entries,vinculos,parcelamento,lines}=banco(),antes=JSON.stringify(entries);
 const origens=await candidatosComposicao({portalClientId:'e',tipo:'LUCRO_PRESUMIDO'},db);expect(origens[0]).toMatchObject({saldo:100,elegivel:true,contaPassivo:'passivo-pis'});
 await incluirComposicaoTx(db,{portalClientId:'e',parcelamento,origens,provisaoLines:lines,userId:'u'});
 expect(vinculos[0]).toMatchObject({entryId:'pis',principalIncluido:100,criadoPorId:'u',parcelamentoId:'p'});expect(JSON.stringify(entries)).toBe(antes);
 await incluirComposicaoTx(db,{portalClientId:'e',parcelamento,origens,provisaoLines:lines});expect(vinculos).toHaveLength(1);
 await expect(exigirBaixaForaDaComposicao(db,'e','pis')).rejects.toMatchObject({code:'DIVIDA_PARCELADA'});
});
test.each(['valor','conta','versao','empresa','status'])('recusa mudança de %s sem gravar',async(caso)=>{
 const {db,entries,vinculos,parcelamento,lines}=banco(),origens=await candidatosComposicao({portalClientId:'e',tipo:'LUCRO_PRESUMIDO'},db);
 if(caso==='valor')origens[0].saldo=99;if(caso==='conta')lines[0].conta='despesa';if(caso==='versao')entries[0].updatedAt='v2';if(caso==='empresa')db.parcelamento.findFirst.mockResolvedValue(null);if(caso==='status')parcelamento.status='RESCINDIDO';
 await expect(incluirComposicaoTx(db,{portalClientId:'e',parcelamento,origens,provisaoLines:lines})).rejects.toThrow();expect(vinculos).toHaveLength(0);
});
test('não inclui tributo incompatível, quitado ou já alocado em outro acordo',async()=>{
 const {db,entries,vinculos,parcelamento,lines}=banco();
 expect((await candidatosComposicao({portalClientId:'e',tipo:'PARCSN'},db))[0].elegivel).toBe(false);
 const origens=await candidatosComposicao({portalClientId:'e',tipo:'LUCRO_PRESUMIDO'},db);
 vinculos.push({origemChave:'entry:pis',parcelamentoId:'outro'});
 await expect(incluirComposicaoTx(db,{portalClientId:'e',parcelamento,origens,provisaoLines:lines})).rejects.toMatchObject({code:'ORIGEM_INDISPONIVEL'});
 entries[0].statusPagamento='PAGO';expect(await candidatosComposicao({portalClientId:'e',tipo:'LUCRO_PRESUMIDO'},db)).toEqual([]);
});
test('meses e anos no histórico são ordenados e deduplicados somente no texto',()=>{
 expect(resumoOrigensParcelamento([{tributo:'PIS',competencia:'2026-02'},{tributo:'PIS',competencia:'2026-01'},{tributo:'PIS',competencia:'2026-02'},{tributo:'PIS',competencia:'2025-12'}])).toBe('PIS — 12/2025; PIS — 01,02/2026');
});
