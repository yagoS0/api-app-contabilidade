import { gzipSync } from 'node:zlib';
import { numeroDaNfse } from '../numeroDaNfse.js';
const xml='<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS123456"><nNFSe>11</nNFSe><DPS><infDPS><nDPS>5</nDPS></infDPS></DPS></infNFSe></NFSe>';
test.each([xml,Buffer.from(xml).toString('base64'),gzipSync(xml).toString('base64')])('extrai número autorizado em todos os envelopes',value=>expect(numeroDaNfse(value,'123456')).toBe('11'));
test('respeita namespace',()=>expect(numeroDaNfse(xml.replace(/<(\/?)(NFSe|infNFSe|nNFSe)/g,'<$1n:$2').replace('xmlns=','xmlns:n='),'123456')).toBe('11'));
test('não aceita outra chave, DPS isolada, xml inválido ou múltiplos números',()=>{
 expect(numeroDaNfse(xml,'outra')).toBeNull();
 expect(numeroDaNfse('<DPS><infDPS><nDPS>5</nDPS></infDPS></DPS>')).toBeNull();
 expect(numeroDaNfse(xml.slice(0,-7))).toBeNull();
 expect(numeroDaNfse(xml.replace('<nNFSe>11</nNFSe>','<nNFSe>11</nNFSe><nNFSe>12</nNFSe>'))).toBeNull();
});
