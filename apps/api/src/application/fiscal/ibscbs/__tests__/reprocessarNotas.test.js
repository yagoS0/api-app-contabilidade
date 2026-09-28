import { reprocessarIbscbs } from '../reprocessarNotas.js';
import { extrairIbscbsXml } from '../projecaoXml.js';
const xml = '<NFSe><infNFSe><nNFSe>1</nNFSe></infNFSe></NFSe>';
function banco(ibscbs, count = 1) {
  return { portalInvoice: { findMany:jest.fn().mockResolvedValueOnce([{id:'n1',type:'NFSE',xmlRaw:xml,ibscbs,updatedAt:new Date('2026-09-28')}]).mockResolvedValue([]), updateMany:jest.fn(async()=>({count})) } };
}
it('simula por padrão e não escreve nem altera outra empresa',async()=>{
  const client=banco(null);
  expect(await reprocessarIbscbs({client,portalClientId:'p1'})).toMatchObject({lidas:1,alterariam:1,atualizadas:0});
  expect(client.portalInvoice.updateMany).not.toHaveBeenCalled();
  expect(client.portalInvoice.findMany.mock.calls[0][0].where.clientId).toBe('p1');
});
it('é idempotente por XML e versão, e recusa sobrescrever uma recaptura concorrente',async()=>{
  const igual=banco(extrairIbscbsXml(xml,'NFSE'));
  expect(await reprocessarIbscbs({client:igual,portalClientId:'p1',aplicar:true})).toMatchObject({iguais:1,atualizadas:0});
  const concorrente=banco(null,0);
  expect(await reprocessarIbscbs({client:concorrente,portalClientId:'p1',aplicar:true})).toMatchObject({concorrentes:1,atualizadas:0});
  expect(concorrente.portalInvoice.updateMany.mock.calls[0][0]).toMatchObject({where:{id:'n1',clientId:'p1',xmlRaw:xml},data:{ibscbs:{situacao:'GRUPO_AUSENTE'}}});
});
