export const CNPJ_DATAS = '11222333000181';
export const CHAVE_NFSE = `35503082${CNPJ_DATAS}${'0'.repeat(27)}1`;
const baseNfe = `352609${CNPJ_DATAS}55001000000001100000001`;
let sum = 0, weight = 2;
for (const digit of [...baseNfe].reverse()) { sum += Number(digit) * weight; weight = weight === 9 ? 2 : weight + 1; }
const remainder = sum % 11;
export const CHAVE_NFE = `${baseNfe}${remainder < 2 ? 0 : 11 - remainder}`;
export function xmlNfseData({ chave = CHAVE_NFSE, cnpj = CNPJ_DATAS, data = '2026-09-28T00:00:00Z', dps = '2026-09-27T23:00:00-03:00' } = {}) {
  return `<NFSe versao="1.00"><infNFSe Id="NFS${chave}"><nNFSe>1</nNFSe><dhProc>${data}</dhProc><emit><CNPJ>${cnpj}</CNPJ></emit><DPS><infDPS><dhEmi>${dps}</dhEmi><dCompet>2026-08-01</dCompet><prest><CNPJ>${cnpj}</CNPJ></prest></infDPS></DPS></infNFSe></NFSe>`;
}
export function xmlNfeData(data = '2026-09-28T00:00:00Z') {
  return `<nfeProc><NFe><infNFe versao="4.00" Id="NFe${CHAVE_NFE}"><ide><dhEmi>${data}</dhEmi><mod>55</mod></ide><emit><CNPJ>${CNPJ_DATAS}</CNPJ></emit><dest><CNPJ>44555666000177</CNPJ><xNome>Tomador preservado</xNome></dest></infNFe></NFe></nfeProc>`;
}
export function xmlResumoData(data = '2026-09-27T23:00:00-03:00') {
  return `<resNFe versao="1.01"><chNFe>${CHAVE_NFE}</chNFe><CNPJ>${CNPJ_DATAS}</CNPJ><dhEmi>${data}</dhEmi><dhRecbto>2026-09-28T04:00:00Z</dhRecbto></resNFe>`;
}
