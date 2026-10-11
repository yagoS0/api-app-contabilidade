import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { DOMParser } from '@xmldom/xmldom';
import { prepararDpsNovembro2026Offline } from '../laboratorio/dpsNovembro2026.js';
const xmlBase = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS330455723925424300019100001000000000000001">
<tpAmb>2</tpAmb><dhEmi>2026-11-03T12:00:00-03:00</dhEmi><verAplic>teste-local</verAplic><serie>1</serie><nDPS>1</nDPS><dCompet>2026-11-03</dCompet><tpEmit>1</tpEmit><cLocEmi>3304557</cLocEmi>
<prest><CNPJ>39254243000191</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
<toma><CNPJ>11222333000181</CNPJ><xNome>Tomador sintético &amp; teste</xNome><end><endNac><cMun>3304557</cMun><CEP>20040002</CEP></endNac><xLgr>Rua de teste</xLgr><nro>1</nro><xBairro>Centro</xBairro></end></toma>
<serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest><cServ><cTribNac>170601</cTribNac><cTribMun>001</cTribMun><xDescServ>Teste local &amp; campanha</xDescServ><cNBS>114061100</cNBS></cServ></serv>
<valores><vServPrest><vServ>1.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>
<IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
</infDPS></DPS>`;
const preparar = (overrides = {}) => prepararDpsNovembro2026Offline({xmlBase, contrato: 'NT009_V1_01_NOVEMBRO_2026', ...overrides});
const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');
const elementos = n => Array.from(n.childNodes).filter(c => c.nodeType === 1);
const tag = (d,nome) => d.getElementsByTagName(nome)[0];
const texto = (d,nome) => tag(d,nome)?.textContent;
// Oráculo independente: posições vêm do Anexo VI oficial versionado, não de arrays do gerador.
let raiz = process.cwd();
while (!fs.existsSync(path.join(raiz, 'docs/leiaute-nfse'))) {
  const pai = path.dirname(raiz);
  if (pai === raiz) throw new Error('Anexo oficial não encontrado');
  raiz = pai;
}
const livro = XLSX.readFile(path.join(raiz, 'docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/anexo-vi-v1.04.01.xlsx'));
const leiaute = XLSX.utils.sheet_to_json(livro.Sheets['LEIAUTE DPS_NFS-e - RT'], { header: 1 });
function conferirOrdem(no, caminho) {
  const ordem = leiaute.filter(r => r[1] === caminho && r[3] !== 'ID').map(r => r[2]);
  const presentes = elementos(no).map(n => n.localName);
  expect(presentes.every(n => ordem.includes(n))).toBe(true);
  expect(presentes).toEqual(ordem.filter(n => presentes.includes(n)));
}

test('novembro move campos conforme Anexo VI sem antecipar regras do Simples 2027', () => {
 const r=preparar(), d=parse(r.xml);
 expect(r).toMatchObject({somenteOffline:true,liberadoParaEmissao:false,validadoContraXsdFuturo:false});
 const base='NFSe/infNFSe/DPS/infDPS/';
 for (const [nome,caminho] of [['infDPS',''],['cServ','serv/cServ/'],['IBSCBS','IBSCBS/'],['trib','IBSCBS/valores/trib/']]) {
  const no=nome==='trib'?tag(d,'CST').parentNode:tag(d,nome); conferirOrdem(no,base+caminho);
 }
 for(const nome of ['finNFSe','indDest']) expect(tag(d,nome).parentNode.localName).toBe('infDPS');
 for(const nome of ['CST','cClassTrib']) expect(tag(d,nome).parentNode.localName).toBe('trib');
 for(const nome of ['regApIBSCBSSN','cAtvSN','gIBSCBS','Signature']) expect(tag(d,nome)).toBeUndefined();
 for(const nome of ['vServ','pTotTribSN','regApTribSN','xDescServ','CNPJ','dCompet']) expect(texto(d,nome)).toBe(texto(parse(xmlBase),nome));
});
test('competência retroativa não escolhe outro contrato',()=>expect(preparar({xmlBase:xmlBase.replace('2026-11-03</dCompet>','2026-09-01</dCompet>')}).competencia).toBe('2026-09-01'));
test('preserva destinatário distinto',()=>{
 const d=parse(preparar({xmlBase:xmlBase.replace('<indDest>0</indDest>','<indDest>1</indDest><dest><CPF>12345678909</CPF><xNome>Teste</xNome></dest>')}).xml);
 expect(tag(d,'dest').parentNode.localName).toBe('infDPS');expect(texto(d,'CPF')).toBe('12345678909');
});
test('contrato explícito obrigatório',()=>expect(()=>preparar({contrato:undefined})).toThrow());
test.each([
 ['produção','<tpAmb>2','<tpAmb>1'],
 ['2027','2026-11-03</dCompet>','2027-01-10</dCompet>'],
 ['dia inválido','2026-11-03</dCompet>','2026-02-30</dCompet>'],
 ['assinatura','</DPS>','<Signature/></DPS>'],
 ['CST ainda não suportado','<CST>000','<CST>400'],
 ['deduções','</vServPrest>','</vServPrest><vDedRed/>'],
 ['exterior','</cServ>','</cServ><comExt/>'],
 ['duplicação','<CST>000</CST>','<CST>000</CST><CST>000</CST>'],
 ['ajuste','<finNFSe>0','<finNFSe>1'],
 ['destinatário ausente','<indDest>0','<indDest>1'],
 ['DTD','<DPS','<!DOCTYPE DPS><DPS'],
 ['namespace','http://www.sped.fazenda.gov.br/nfse','http://invalido'],
])('recusa %s',(_nome,antes,depois)=>expect(()=>preparar({xmlBase:xmlBase.replace(antes,depois)})).toThrow());
