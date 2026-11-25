import {criarPersistenciaFs12} from '../fs12DaApuracao.js';
function fixture(){
  const statements=[];
  const tx={$queryRaw:jest.fn(async(strings)=>{
    const sql=strings.join('?');statements.push(sql);
    return sql.includes('INSERT INTO "AppSetting"')?[{value:{v:1,revision:1}}]:[];
  }),user:{findUnique:jest.fn(async()=>({role:'admin',status:'active',accountType:'FIRM'}))},
  companyFirmAccess:{findUnique:jest.fn(async()=>null)}};
  const db={$transaction:jest.fn(async fn=>fn(tx))};
  return {db,tx,statements};
}
test('B31 coordena antes da primeira leitura de ACL e so uma vez no escopo da TX',async()=>{
  const f=fixture(),e={autorId:'actor',portalClientId:'portal',competencia:'2026-11'};
  await criarPersistenciaFs12(f.db).transacionar(async p=>{await p.autorizar(e);await p.autorizar(e);},{escrita:true});
  expect(f.statements[0]).toContain('INSERT INTO "AppSetting"');
  expect(f.statements.filter(x=>x.includes('INSERT INTO "AppSetting"'))).toHaveLength(1);
  expect(f.statements[1]).toContain('FROM "User"');
});
test('B31 P2010 meta40001 reinicia TX inteira e nao reusa snapshot abortado',async()=>{
  const f=fixture();f.tx.$queryRaw.mockRejectedValueOnce({code:'P2010',meta:{code:'40001'}});
  await criarPersistenciaFs12(f.db).transacionar(p=>p.autorizar({autorId:'actor',portalClientId:'portal',competencia:'2026-11'}),{escrita:true});
  expect(f.db.$transaction).toHaveBeenCalledTimes(2);
  expect(f.tx.user.findUnique).toHaveBeenCalledTimes(1);
});
test('B31 erro SQL nao serializavel nao vira retry ou sucesso',async()=>{
  const f=fixture();f.tx.$queryRaw.mockRejectedValue({code:'P2010',meta:{code:'23514'}});
  await expect(criarPersistenciaFs12(f.db).transacionar(p=>p.autorizar({autorId:'actor',portalClientId:'portal',competencia:'2026-11'}),{escrita:true})).rejects.toMatchObject({meta:{code:'23514'}});
  expect(f.db.$transaction).toHaveBeenCalledTimes(1);
});
