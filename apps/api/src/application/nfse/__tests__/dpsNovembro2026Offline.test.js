import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import XLSX from 'xlsx';
import { DOMParser } from '@xmldom/xmldom';
import { prepararDpsNovembro2026Offline } from '../laboratorio/dpsNovembro2026.js';
import { xmlBase } from './fixtures/dpsNovembro2026.js';
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
 for(const nome of ['regApIBSCBSSN','cAtvSN','Signature']) expect(tag(d,nome)).toBeUndefined();
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

test('grupo de tributação permanece obrigatório para CST 000',()=>{
 const d=parse(preparar().xml);expect(tag(d,'gIBSCBS')).toBeDefined();
 expect(elementos(tag(d,'CST').parentNode).map(n=>n.localName)).toEqual(['CST','cClassTrib','gIBSCBS']);
});
test('isenção remove grupo vazio e exige ausência explícita de cIndOp',()=>{
 const isenta=xmlBase.replace('<CST>000</CST>','<CST>400</CST>').replace('<cClassTrib>000001</cClassTrib>','<cClassTrib>400001</cClassTrib>');
 expect(()=>preparar({xmlBase:isenta})).toThrow(expect.objectContaining({code:'E0859'}));
 const d=parse(preparar({xmlBase:isenta.replace('<cIndOp>100301</cIndOp>','')}).xml);
 expect(tag(d,'cIndOp')).toBeUndefined();expect(tag(d,'gIBSCBS')).toBeUndefined();expect(texto(d,'CST')).toBe('400');
});
test.each([
 ['operação ausente','<cIndOp>100301</cIndOp>','','E0860'],
 ['operação não NFSe','100301</cIndOp>','010104</cIndOp>','INDOP_INVALIDO'],
 ['incompatibilidade CST/classe','<CST>000','<CST>410','CLASSIFICACAO_INVALIDA'],
 ['classe não NFSe','000001</cClassTrib>','000002</cClassTrib>','CLASSIFICACAO_INVALIDA'],
 ['grupo regular indevido','</gIBSCBS>','<gTribRegular><CSTReg>000</CSTReg><cClassTribReg>000001</cClassTribReg></gTribRegular></gIBSCBS>','E0964'],
 ['diferimento indevido','</gIBSCBS>','<gDif/></gIBSCBS>','E0971'],
 ['município inválido','<cMun>3304557','<cMun>9999999','MUNICIPIO_TOMADOR_INVALIDO'],
 ['CEP inválido','<CEP>20040002','<CEP>abc','CEP_INVALIDO'],
])('valida %s',(_n,a,b,code)=>expect(()=>preparar({xmlBase:xmlBase.replace(a,b)})).toThrow(expect.objectContaining({code})));
const comAjuste=ajuste=>xmlBase.replace('</vServPrest>','</vServPrest><vAjusteBC>'+ajuste+'</vAjusteBC>');
test('ajuste monetário e percentual mantêm valores declarados',()=>{
 for(const campo of ['<vAjusteBCISSQN>0.30</vAjusteBCISSQN>','<pAjusteBCISSQN>30.00</pAjusteBCISSQN>'])expect(preparar({xmlBase:comAjuste(campo)}).xml).toContain(campo);
});
test.each([
 ['<pAjusteBCISSQN>0</pAjusteBCISSQN>','E0453'],
 ['<pAjusteBCISSQN>100.01</pAjusteBCISSQN>','E0453'],
 ['<pAjusteBCISSQN>20.123</pAjusteBCISSQN>','DECIMAL_INVALIDO'],
 ['<vAjusteBCISSQN>-1</vAjusteBCISSQN>','DECIMAL_INVALIDO'],
 ['<vAjusteBCISSQN>1.01</vAjusteBCISSQN>','E0427'],
 ['<vAjusteBCISSQN>0.20</vAjusteBCISSQN><pAjusteBCISSQN>20</pAjusteBCISSQN>','AJUSTE_DUPLICADO'],
 ['','AJUSTE_VAZIO'],
])('recusa ajuste inválido %#',(ajuste,code)=>expect(()=>preparar({xmlBase:comAjuste(ajuste)})).toThrow(expect.objectContaining({code})));
const documento='<documentos><docAjusteBC><tpAjusteBC>104</tpAjusteBC><vTotDoc>1.00</vTotDoc><vAjusteAplic>0.20</vAjusteAplic><dtEmiDoc>2026-10-01</dtEmiDoc><dtCompDoc>2026-09-01</dtCompDoc><dFeNacional><tipoChaveDFe>1</tipoChaveDFe><chaveDFe>'+ '1'.repeat(50)+'</chaveDFe></dFeNacional></docAjusteBC></documentos>';
test('preserva referência documental e ajuste sem inferir dedução municipal',()=>expect(preparar({xmlBase:comAjuste(documento)}).xml).toContain('<tpAjusteBC>104</tpAjusteBC>'));
test.each([
 ['0.20</vAjusteAplic>','1.01</vAjusteAplic>','E0467'],
 ['1.00</vTotDoc>','0.10</vTotDoc>','E0469'],
 ['2026-10-01</dtEmiDoc>','2026-08-01</dtEmiDoc>','E0472'],
 ['<tpAjusteBC>104','<tpAjusteBC>199','E0465'],
 ['<tipoChaveDFe>1','<tipoChaveDFe>2','E0460'],
])('recusa documento inconsistente %#',(a,b,code)=>expect(()=>preparar({xmlBase:comAjuste(documento.replace(a,b))})).toThrow(expect.objectContaining({code})));
const evento='<atvEvento><xNome>Evento sintético</xNome><dtIni>2026-11-01</dtIni><dtFim>2026-11-03</dtFim><cMun>3550308</cMun><idAtvEvt>teste</idAtvEvt></atvEvento>';
test('evento 17.10 admite município diferente e exige grupo',()=>{
 const base=xmlBase.replace('170601','171001');expect(()=>preparar({xmlBase:base})).toThrow(expect.objectContaining({code:'E0390'}));
 expect(preparar({xmlBase:base.replace('</cServ>','</cServ>'+evento)}).xml).toContain(evento);
});
test('evento em serviço incompatível é recusado',()=>expect(()=>preparar({xmlBase:xmlBase.replace('</cServ>','</cServ>'+evento)})).toThrow(expect.objectContaining({code:'E0392'})));
test('17.05 usa município do destinatário quando CNPJ tem mesma raiz',()=>{
 const endereco='<end><endNac><cMun>3550308</cMun><CEP>01001000</CEP></endNac><xLgr>Rua teste</xLgr><nro>1</nro><xBairro>Centro</xBairro></end>';
 const base=xmlBase.replace('170601','170501').replace('<indDest>0</indDest>','<indDest>1</indDest><dest><CNPJ>11222333000262</CNPJ><xNome>Filial</xNome>'+endereco+'</dest>');
 expect(preparar({xmlBase:base}).municipioIss1705).toBe('3550308');
 expect(preparar({xmlBase:base.replace('11222333000262','39254243000191')}).municipioIss1705).toBe('3304557');
});

test('diferimento e tributação regular obedecem aos indicadores da classe',()=>{
 const diferida=xmlBase.replace('<CST>000</CST>','<CST>515</CST>').replace('000001</cClassTrib>','515001</cClassTrib>');
 expect(()=>preparar({xmlBase:diferida})).toThrow(expect.objectContaining({code:'E0972'}));
 expect(preparar({xmlBase:diferida.replace('</gIBSCBS>','<gDif><pDifUF>10</pDifUF><pDifMun>0</pDifMun><pDifCBS>100</pDifCBS></gDif></gIBSCBS>')}).xml).toContain('<pDifCBS>100</pDifCBS>');
 const regular=xmlBase.replace('<CST>000</CST>','<CST>550</CST>').replace('000001</cClassTrib>','550016</cClassTrib>');
 expect(()=>preparar({xmlBase:regular})).toThrow(expect.objectContaining({code:'E0965'}));
 expect(preparar({xmlBase:regular.replace('</gIBSCBS>','<gTribRegular><CSTReg>000</CSTReg><cClassTribReg>000001</cClassTribReg></gTribRegular></gIBSCBS>')}).xml).toContain('<CSTReg>000</CSTReg>');
});
test('CLI é independente de configuração e não sobrescreve evidência',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nt009-'));const entrada=path.join(dir,'entrada.json'),saida=path.join(dir,'saida.json');
 try {
  fs.writeFileSync(entrada,JSON.stringify({xmlBase,contrato:'NT009_V1_01_NOVEMBRO_2026'}));
  const executar=()=>spawnSync(process.execPath,[path.join(raiz,'apps/api/scripts/preparar-dps-nt009-offline.mjs'),entrada,saida],{encoding:'utf8',cwd:dir,env:{SystemRoot:process.env.SystemRoot||''}});
  expect(executar().status).toBe(0);const antes=fs.readFileSync(saida,'utf8');expect(JSON.parse(antes)).toMatchObject({liberadoParaEmissao:false,somenteOffline:true});
  expect(executar().stderr).toContain('EEXIST');expect(fs.readFileSync(saida,'utf8')).toBe(antes);
 }finally{for(const f of [entrada,saida])if(fs.existsSync(f))fs.unlinkSync(f);fs.rmdirSync(dir);}
});
