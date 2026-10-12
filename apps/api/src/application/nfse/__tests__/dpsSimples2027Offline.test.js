import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import XLSX from 'xlsx';
import { DOMParser } from '@xmldom/xmldom';
import { prepararDpsSimples2027Offline, validarAtividadeSimples } from '../laboratorio/dpsSimples2027.js';

// Dados sintéticos. Não é uma nota aceita, assinada ou transmitida.
const xmlBase = `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS330455723925424300019100001000000000000001">
<tpAmb>2</tpAmb><dhEmi>2027-01-10T12:00:00-03:00</dhEmi><verAplic>teste-local</verAplic><serie>1</serie><nDPS>1</nDPS><dCompet>2027-01-10</dCompet><tpEmit>1</tpEmit><cLocEmi>3304557</cLocEmi>
<prest><CNPJ>39254243000191</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
<toma><CNPJ>11222333000181</CNPJ><xNome>Tomador sintético &amp; teste</xNome><end><endNac><cMun>3304557</cMun><CEP>20040002</CEP></endNac><xLgr>Rua de teste</xLgr><nro>1</nro><xBairro>Centro</xBairro></end></toma>
<serv><locPrest><cLocPrestacao>3304557</cLocPrestacao></locPrest><cServ><cTribNac>170601</cTribNac><cTribMun>001</cTribMun><xDescServ>Teste local &amp; campanha</xDescServ><cNBS>114061100</cNBS></cServ></serv>
<valores><vServPrest><vServ>1.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></trib></valores>
<IBSCBS><finNFSe>0</finNFSe><cIndOp>100301</cIndOp><indDest>0</indDest><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
</infDPS></DPS>`;
const company = { cnpj: '39254243000191', regimeHistorico: [
  { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '2027-06-30', apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'referencia-sintetica' },
  { regime: 'SIMPLES', vigenciaInicio: '2027-07-01', apuracaoIbsCbs: 'NO_DAS' },
] };
const perfil = { id: 'perfil-sintetico', codigoServicoNacional: '170601', cAtvSN: '09', ativo: true };
const preparar = (overrides = {}) => prepararDpsSimples2027Offline({ xmlBase, company, perfil, ...overrides });
const parse = xml => new DOMParser().parseFromString(xml, 'application/xml');
const elementos = n => Array.from(n.childNodes).filter(c => c.nodeType === 1);
const tag = (d, nome) => d.getElementsByTagName(nome)[0];
const texto = (d, nome) => tag(d, nome)?.textContent;

test('usa atividade exclusivamente do perfil e registra procedência', () => {
  const r = preparar({ perfil: { ...perfil, cAtvSN: '07' }, cAtvSN: '09' });
  expect(texto(parse(r.xml), 'cAtvSN')).toBe('07');
  expect(r.atividadeSimples).toEqual({ codigo: '07', fonte: 'PERFIL', perfilId: perfil.id });
});
test.each([null, { ...perfil, cAtvSN: null }, { ...perfil, ativo: false }, { ...perfil, codigoServicoNacional: '171901' }])('recusa perfil incompleto ou divergente %#', perfilInvalido => {
  expect(() => preparar({ perfil: perfilInvalido })).toThrow();
});

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

test('adapta os caminhos e a ordem conforme o Anexo VI sem mudar ISS, descrição ou valores', () => {
  const r = preparar({ indFinal: '1' });
  const doc = parse(r.xml);
  expect(r).toMatchObject({ somenteOffline: true, liberadoParaEmissao: false, validadoContraXsdFuturo: false, apuracao: 'REGULAR' });
  expect(texto(doc, 'regApIBSCBSSN')).toBe('3');
  expect(texto(doc, 'regApTribSN')).toBe('1');
  expect(texto(doc, 'cAtvSN')).toBe('09');
  expect(texto(doc, 'xDescServ')).toBe('Teste local & campanha');
  expect(texto(doc, 'vServ')).toBe('1.00');
  expect(texto(doc, 'pTotTribSN')).toBe('6.00');
  expect(texto(doc, 'indFinal')).toBe('1');
  for (const nome of ['finNFSe', 'indDest']) expect(tag(doc, nome).parentNode.localName).toBe('infDPS');
  for (const nome of ['CST', 'cClassTrib']) expect(tag(doc, nome).parentNode.localName).toBe('trib');
  for (const nome of ['Signature',  'gTribSN', 'vReceitaBrutaSN', 'pIBS', 'pCBS']) expect(tag(doc, nome)).toBeUndefined();
  const base = 'NFSe/infNFSe/DPS/infDPS/';
  conferirOrdem(tag(doc, 'infDPS'), base);
  conferirOrdem(tag(doc, 'regTrib'), base + 'prest/regTrib/');
  conferirOrdem(tag(doc, 'cServ'), base + 'serv/cServ/');
  conferirOrdem(tag(doc, 'IBSCBS'), base + 'IBSCBS/');
  conferirOrdem(tag(doc, 'CST').parentNode, base + 'IBSCBS/valores/trib/');
});

test.each([['2027-06-30', '3'], ['2027-07-01', '1']])('resolve a opção vigente em %s no mesmo preparador', (dia, esperado) => {
  const r = preparar({ xmlBase: xmlBase.replace('2027-01-10</dCompet>', `${dia}</dCompet>`) });
  expect(texto(parse(r.xml), 'regApIBSCBSSN')).toBe(esperado);
  expect(tag(parse(r.xml), 'indFinal')).toBeUndefined();
});

test('move destinatário distinto sem perder identificação', () => {
  const r = preparar({ xmlBase: xmlBase.replace('<indDest>0</indDest>', '<indDest>1</indDest><dest><CPF>12345678909</CPF><xNome>Destinatário</xNome></dest>') });
  expect(tag(parse(r.xml), 'dest').parentNode.localName).toBe('infDPS');
  expect(texto(parse(r.xml), 'CPF')).toBe('12345678909');
});

test.each([
  ['produção', '<tpAmb>2', '<tpAmb>1', 'PRODUCAO_PROIBIDA'],
  ['assinatura', '</DPS>', '<Signature/></DPS>', 'XML_ASSINADO'],
  ['2026', '2027-01-10</dCompet>', '2026-12-31</dCompet>', 'COMPETENCIA_INVALIDA'],
  ['dia inválido', '2027-01-10</dCompet>', '2027-02-30</dCompet>', 'COMPETENCIA_INVALIDA'],
  ['ajuste', '<finNFSe>0', '<finNFSe>1', 'CENARIO_NAO_PREPARADO'],
  ['outra classificação', '<CST>000', '<CST>200', 'CENARIO_NAO_PREPARADO'],
  ['dedução', '</vServPrest>', '</vServPrest><vDedRed/>', 'CENARIO_NAO_PREPARADO'],
  ['destinatário ausente', '<indDest>0', '<indDest>1', 'DESTINATARIO_INVALIDO'],
  ['campo duplicado', '<tpAmb>2</tpAmb>', '<tpAmb>2</tpAmb><tpAmb>2</tpAmb>', 'XML_BASE_INVALIDO'],
])('recusa %s sem produzir XML', (_nome, de, para, code) => {
  expect(() => preparar({ xmlBase: xmlBase.replace(de, para) })).toThrow(expect.objectContaining({ code }));
});

test.each([
  [{ ...company, cnpj: '11222333000181' }, 'EMPRESA_DIVERGENTE'],
  [{ ...company, regimeHistorico: [] }, 'NFSE_REGIME_SEM_VIGENCIA'],
  [{ ...company, regimeHistorico: [{ ...company.regimeHistorico[0], comprovanteOpcaoIbsCbs: '' }] }, 'NFSE_IBSCBS_OPCAO_INVALIDA'],
  [{ ...company, regimeHistorico: [{ ...company.regimeHistorico[0], apuracaoIbsCbs: null }] }, 'NFSE_IBSCBS_OPCAO_PENDENTE'],
])('recusa cadastro inconsistente %#', (cadastro, code) => {
  expect(() => preparar({ company: cadastro })).toThrow(expect.objectContaining({ code }));
});

test.each([['160101', '10'], ['990401', '11'], ['070201', '12'], ['070501', '13'], ['170601', '09']])('aceita vínculo de atividade %s/%s', (cTribNac, cAtvSN) => {
  expect(() => validarAtividadeSimples({ cTribNac, cAtvSN })).not.toThrow();
});
test.each([['160101', '09'], ['170601', '10'], ['990401', '07'], ['170601', '11'], ['070201', '09'], ['170601', '12'], ['170601', '13'], ['170601', '9'], ['170601', '99']])('recusa vínculo/domínio incorreto %s/%s', (cTribNac, cAtvSN) => {
  expect(() => validarAtividadeSimples({ cTribNac, cAtvSN })).toThrow();
});

test('preserva o contrato operacional e não permite converter duas vezes', () => {
  const antes = JSON.stringify(company);
  const r = preparar();
  expect(JSON.stringify(company)).toBe(antes);
  expect(() => preparar({ xmlBase: r.xml })).toThrow();
});

test.each([
  ['<!DOCTYPE DPS [<!ENTITY externa SYSTEM "file:///segredo">]>' + xmlBase, 'XML_BASE_INVALIDO'],
  [xmlBase.replace('</DPS>', ''), 'XML_BASE_INVALIDO'],
  [xmlBase.replace('<cServ>', '<cServ xmlns="http://exemplo.invalid">'), 'XML_BASE_INVALIDO'],
])('recusa XML inválido ou ambíguo %#', (xml, code) => {
  expect(() => preparar({ xmlBase: xml })).toThrow(expect.objectContaining({ code }));
});

test('CLI gera artefato bloqueado sem configuração da API e não sobrescreve a saída', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-offline-'));
  const entrada = path.join(dir, 'entrada.json');
  const saida = path.join(dir, 'saida.json');
  const script = path.join(raiz, 'apps/api/scripts/preparar-dps-simples-2027-offline.mjs');
  try {
    fs.writeFileSync(entrada, JSON.stringify({ xmlBase, company, perfil }));
    const executar = () => spawnSync(process.execPath, [script, entrada, saida], {
      cwd: dir, encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot || '' },
    });
    const r = executar();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const antes = fs.readFileSync(saida, 'utf8');
    expect(JSON.parse(antes)).toMatchObject({ somenteOffline: true, liberadoParaEmissao: false });
    const repetido = executar();
    expect(repetido.status).toBe(1);
    expect(repetido.stderr).toContain('EEXIST');
    expect(fs.readFileSync(saida, 'utf8')).toBe(antes);
  } finally {
    for (const arquivo of [entrada, saida]) if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
    fs.rmdirSync(dir);
  }
});
