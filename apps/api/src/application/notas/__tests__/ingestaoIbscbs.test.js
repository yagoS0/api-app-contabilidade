import { upsertNfeFromParsed } from '../ingestaoNfe.js';
function banco(existente, fechado = false) {
  return { portalInvoice: { findUnique: jest.fn(async()=>existente), upsert: jest.fn(async()=>({id:'n1'})) },
    companyMonthlyCircular:{findFirst:jest.fn(async()=> fechado ? {estado:'fechado'} : null)},
    notaItem:{findMany:jest.fn(async()=>[]),deleteMany:jest.fn(),createMany:jest.fn()}, pendenciaPosFechamento:{create:jest.fn(async()=>({}))} };
}
const parsed = { chaveAcesso:'chave1',type:'NFE',competencia:new Date('2026-09-01'),statusEfetivo:'autorizada',total:100,xmlRaw:null };
it('resumo posterior preserva XML, tributos, classificação e cancelamento',async()=>{
  const tx=banco({id:'n1',xmlRaw:'<NFe/>',statusEfetivo:'cancelada'});
  expect(await upsertNfeFromParsed(tx,{portalClientId:'empresa1',parsed,items:[]})).toMatchObject({status:'resumo_preservado'});
  expect(tx.portalInvoice.upsert).not.toHaveBeenCalled();
  expect(tx.notaItem.deleteMany).not.toHaveBeenCalled();
});
it('erro de leitura não autoriza sobrescrever documento',async()=>{
  const tx=banco(null);tx.portalInvoice.findUnique.mockRejectedValue(new Error('db indisponível'));
  await expect(upsertNfeFromParsed(tx,{portalClientId:'empresa1',parsed,items:[]})).rejects.toThrow('db indisponível');
  expect(tx.portalInvoice.upsert).not.toHaveBeenCalled();
});
it('resumo não sobrescreve um XML completo gravado entre a leitura e o upsert',async()=>{
  const tx=banco(null);
  await upsertNfeFromParsed(tx,{portalClientId:'empresa1',parsed,items:[]});
  expect(tx.portalInvoice.upsert.mock.calls[0][0].update).toEqual({});
});
it('competência fechada preserva valores anteriores e gera pendência',async()=>{
  const tx=banco({id:'n1',statusEfetivo:'cancelada'},true);
  await upsertNfeFromParsed(tx,{portalClientId:'empresa1',parsed:{...parsed,xmlRaw:'<NFe><infNFe><ide><mod>55</mod></ide></infNFe></NFe>'},items:[]});
  expect(tx.portalInvoice.upsert.mock.calls[0][0].update).toEqual({competenciaPosFechamento:true,statusEfetivo:'cancelada'});
  expect(tx.pendenciaPosFechamento.create).toHaveBeenCalled();
});
