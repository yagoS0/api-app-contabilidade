import { extrairIbscbsXml } from '../projecaoXml.js';
import { parseNfeXml } from '../../../../utils/nfeParser.js';
export const nfse = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><valores><vBC>1000.00</vBC></valores><DPS><infDPS><IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS></infDPS></DPS><IBSCBS><valores><vBC>980.00</vBC><uf><pIBSUF>0.1000</pIBSUF></uf><fed><pCBS>0.9000</pCBS></fed></valores><totCIBS><gIBS><gIBSUFTot><vIBSUF>0.98</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot><vIBSTot>0.98</vIBSTot></gIBS><gCBS><vCBS>8.82</vCBS></gCBS><vTotNF>1000.00</vTotNF></totCIBS></IBSCBS></infNFSe></NFSe>`;
const nfe = `<n:nfeProc xmlns:n="http://www.portalfiscal.inf.br/nfe"><n:NFe><n:infNFe Id="NFe35260912345678000190550010000000011000000010"><n:ide><n:nNF>1</n:nNF></n:ide><n:det nItem="1"><n:prod><n:vProd>1000.00</n:vProd></n:prod><n:imposto><n:IBSCBS><n:CST>000</n:CST><n:cClassTrib>000001</n:cClassTrib><n:gIBSCBS><n:vBC>980.00</n:vBC><n:gIBSUF><n:pIBSUF>0.1000</n:pIBSUF><n:vIBSUF>0.98</n:vIBSUF></n:gIBSUF><n:gCBS><n:vCBS>8.82</n:vCBS></n:gCBS><n:vIBS>0.98</n:vIBS></n:gIBSCBS></n:IBSCBS></n:imposto></n:det><n:total><n:ICMSTot><n:vNF>1000.00</n:vNF></n:ICMSTot><n:IBSCBSTot><n:vBCIBSCBS>980.00</n:vBCIBSCBS><n:gIBS><n:vIBS>0.98</n:vIBS></n:gIBS><n:gCBS><n:vCBS>8.82</n:vCBS></n:gCBS></n:IBSCBSTot></n:total></n:infNFe></n:NFe></n:nfeProc>`;
it('lê base própria e decimais exatos; zero informado difere de ausência', () => {
  const r=extrairIbscbsXml(nfse,'NFSE');
  expect(r.valores.baseCalculo).toBe('980.00');
  expect(r.valores.ibsMunicipio.valor).toBe('0.00');
  expect(r.valores.ibsMunicipio.aliquota).toBeNull();
  expect(r.valores.cbs.valor).toBe('8.82');
  expect(r.declaracao.cst).toBe('000');
  expect(r.avisos).toEqual([]);
  expect(r.xmlSha256).toHaveLength(64);
  expect(extrairIbscbsXml(nfse,'NFSE')).toEqual(r);
});
it('lê NF-e com namespace por item e total, sem reter só ICMSTot', () => {
  const r=extrairIbscbsXml(nfe,'NFE');
  expect(r.itens[0]).toMatchObject({numero:'1',cst:'000',cClassTrib:'000001',baseCalculo:'980.00',ibsUf:{valor:'0.98'}});
  expect(r.valores.cbs.valor).toBe('8.82');
  expect(parseNfeXml(nfe).header.ibscbs).toEqual(r);
});
it('não transforma DPS, ausência, XML ruim ou grupo vazio em tributo zero', () => {
  expect(extrairIbscbsXml(null,'NFSE').situacao).toBe('XML_AUSENTE');
  expect(extrairIbscbsXml('<DPS><infDPS/></DPS>','NFSE').situacao).toBe('DOCUMENTO_INCOMPATIVEL');
  expect(extrairIbscbsXml('<NFSe>','NFSE').situacao).toBe('XML_INVALIDO');
  expect(extrairIbscbsXml('<NFSe><infNFSe><nNFSe>1</nNFSe></infNFSe></NFSe>','NFSE')).toMatchObject({situacao:'GRUPO_AUSENTE',valores:null});
  const r=extrairIbscbsXml(nfse.replace('8.82','inválido'),'NFSE');
  expect(r.valores.cbs.valor).toBeNull();
  expect(r.avisos).toContain('VALOR_INVALIDO:vCBS');
});
