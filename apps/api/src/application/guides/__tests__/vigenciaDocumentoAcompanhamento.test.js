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
