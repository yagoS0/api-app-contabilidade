jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
import {conferirVigenciaDocumentoAcompanhamento as conferir} from '../VigenciaDocumentoAcompanhamento.js';
const guide=(id,tipo='IRPJ')=>({id,portalClientId:'c',competencia:'2026-10',tipo,status:'PROCESSED',liberadaCliente:true,hash:id,valor:10,vencimento:'2026-11-20'});
const dbFor=rows=>({guide:{findMany:jest.fn(async()=>rows)}});
test('antiga e nova ainda processadas bloqueiam ambas sem escolher data',async()=>{
 const a={...guide('antiga'),createdAt:'2020-01-01'},b={...guide('nova'),createdAt:'2026-11-01'},db=dbFor([a,b]);
 expect(await conferir(db,a)).toMatchObject({vigente:false,reason:'DOCUMENTO_AMBIGUO'});
 expect(await conferir(db,b)).toMatchObject({vigente:false,reason:'DOCUMENTO_AMBIGUO'});
});
test('obrigações distintas continuam independentes; DARF misto sobreposto exige conferência',async()=>{
 const a=guide('irpj'),b=guide('csll','CSLL');expect((await conferir(dbFor([a,b]),a)).vigente).toBe(true);
 const mixed={...guide('misto','OUTRA'),extracted:{composicao:[{codigo:'2089'},{codigo:'2372'}]}};
 expect((await conferir(dbFor([a,b,mixed]),mixed)).vigente).toBe(false);
});
test('contratos distintos usam vínculo da parcela e não competência/data para escolher',async()=>{
 const a={...guide('a','OUTRA'),parcelamentoId:'contrato-a',parcela:{id:'pa'}},b={...guide('b','OUTRA'),parcelamentoId:'contrato-b',parcela:{id:'pb'}};
 const rows={pa:{id:'pa',portalClientId:'c',guiaId:'a',parcelamentoId:'contrato-a'},pb:{id:'pb',portalClientId:'c',guiaId:'b',parcelamentoId:'contrato-b'}};
 const db={parcela:{findFirst:jest.fn(async({where})=>rows[where.id])}};
 expect((await conferir(db,a)).vigente).toBe(true);expect((await conferir(db,b)).vigente).toBe(true);
 rows.pa.guiaId='substituta';expect(await conferir(db,a)).toMatchObject({vigente:false,reason:'DOCUMENTO_SUBSTITUIDO'});
});

test.each([{id:null},{portalClientId:null},{competencia:null},{status:'VAZIO'},{liberadaCliente:false},{hash:null}])('pré-condições recusam antes de ler %j',async patch=>{
 const g={...guide('g'),...patch},db=dbFor([]);
 expect(await conferir(db,g)).toEqual({vigente:false,reason:'DOCUMENTO_NAO_LIBERADO',guideId:g.id});
 expect(db.guide.findMany).not.toHaveBeenCalled();
});
test('queries e retorno de obrigação única preservam hash legado sem exigir formato SHA',async()=>{
 const g=guide('g'),db=dbFor([g]);
 expect(await conferir(db,g)).toEqual({vigente:true,source:'OBRIGACAO_DOCUMENTO_UNICO',guideId:'g',tributos:['IRPJ'],revisao:require('../ConfirmacaoPagamentoClienteService.js').versaoPagamentoGuia(g)});
 expect(db.guide.findMany).toHaveBeenCalledTimes(1);
 expect(db.guide.findMany).toHaveBeenCalledWith({where:{portalClientId:'c',competencia:'2026-10',status:'PROCESSED',parcelamentoId:null},orderBy:{id:'asc'}});
});
test('outro tenant/período/status/parcela não contaminam candidatos mesmo retornados pelo leitor',async()=>{
 const g=guide('g');
 const strangers=[{portalClientId:'outro'},{competencia:'2026-11'},{status:'ERROR'},{parcelamentoId:'p'}].map(p=>({...guide('outro','OUTRA'),...p}));
 expect((await conferir(dbFor([...strangers,g]),g)).vigente).toBe(true);
});
test.each([{hash:'novo'},{valor:11},{extracted:{fields:{principal:10}}}])('mesmo id com revisão alterada recusa %j',async patch=>{
 const g=guide('g');expect(await conferir(dbFor([{...g,...patch}]),g)).toMatchObject({reason:'DOCUMENTO_ALTERADO'});
});
test('composição desconhecida precede ambiguidade; documento não liberado concorrente continua contando',async()=>{
 const g=guide('g');
 expect(await conferir(dbFor([g,guide('x','OUTRA')]),g)).toMatchObject({reason:'COMPOSICAO_A_CONFERIR'});
 expect(await conferir(dbFor([g,{...guide('x'),liberadaCliente:false}]),g)).toMatchObject({reason:'DOCUMENTO_AMBIGUO'});
});
test.each([null,{portalClientId:'outro'},{parcelamentoId:'outro'},{guiaId:'substituta'},{id:'outra'}])('parcela recusa vínculo ausente, substituído ou de outro tenant %j',async patch=>{
 const g={...guide('g','OUTRA'),parcelamentoId:'contrato',parcela:{id:'p'}};
 const row=patch===null?null:{id:'p',portalClientId:'c',parcelamentoId:'contrato',guiaId:'g',...patch};
 const db={parcela:{findFirst:jest.fn(async()=>row)}};
 expect(await conferir(db,g)).toEqual({vigente:false,reason:'DOCUMENTO_SUBSTITUIDO',guideId:'g'});
 expect(db.parcela.findFirst).toHaveBeenCalledWith({where:{id:'p',portalClientId:'c',parcelamentoId:'contrato'}});
});
test('falhas de ambas as consultas propagam a mesma instância sem converter em ausência',async()=>{
 const error=new Error('leitura falhou'), fail=jest.fn().mockRejectedValue(error);
 await expect(conferir({guide:{findMany:fail}},guide('g'))).rejects.toBe(error);
 await expect(conferir({parcela:{findFirst:fail}},{...guide('g','OUTRA'),parcelamentoId:'p'})).rejects.toBe(error);
});
