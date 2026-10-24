import { gzipSync } from "node:zlib";
import { evidenciaDaNota, projetarEmissaoServico } from "../dataEmissaoNota.js";
import { prepararDocumentoNota } from "../persistirDocumentoNota.js";
import { xmlNfseData, xmlNfeData, xmlResumoData, CHAVE_NFE, CHAVE_NFSE, CNPJ_DATAS } from "../__fixtures__/dataEmissaoNotas.js";
import { extrairDataEmissao, interpretarDataOriginal, camposDataEmissao, preservarDataEmissao, projetarDataEmissao } from '../dataEmissaoNota.js';

const nfe = (value, versao = '4.00', tag = 'dhEmi') => `<NFe><infNFe versao="${versao}" Id="NFe123"><ide><${tag}>${value}</${tag}></ide></infNFe></NFe>`;
test.each(['2024-02-29', '2026-09-28'])('pure civil date %s does not invent an instant', value => {
  expect(interpretarDataOriginal(value)).toMatchObject({ civil: value, instante: null, precisao: 'DATA_CIVIL' });
});
test.each(['2026-02-29', '2024-02-30', '2026-13-01', '0000-01-01', '2026-09-28T24:00:00Z', '2026-09-28T12:60:00Z', '2026-09-28T12:00:00+14:01'])('invalid date %s', value => {
  expect(interpretarDataOriginal(value).motivo).toBeTruthy();
});
test.each(['Z', '-03:00', '-04:00', '+14:00'])('keeps civil day across offset %s', offset => {
  const e = extrairDataEmissao(nfe(`2026-12-31T23:59:59${offset}`));
  expect(e).toMatchObject({ civil: '2026-12-31', offset, motivo: null, caminho: 'NFe/infNFe/ide/dhEmi' });
  expect(e.instante).toBe(new Date(`2026-12-31T23:59:59${offset}`).toISOString());
});
test('local time only when the recognized format permits it; legacy dEmi requires 2.00', () => {
  expect(extrairDataEmissao(nfe('2026-09-28T12:00:00')).motivo).toBe('OFFSET_AUSENTE');
  expect(extrairDataEmissao(nfe('2026-09-28', '2.00', 'dEmi'))).toMatchObject({ civil: '2026-09-28', instante: null });
  expect(extrairDataEmissao(nfe('2026-09-28', '4.00', 'dEmi')).civil).toBeNull();
  expect(extrairDataEmissao('<CompNfse><Nfse versao="2.04"><InfNfse><DataEmissao>2026-09-28T01:00:00</DataEmissao></InfNfse></Nfse></CompNfse>')).toMatchObject({ civil: '2026-09-28', instante: null, precisao: 'HORA_LOCAL' });
});
test('national NFS-e uses dhProc, never DPS emission or competência', () => {
  const xml = '<NFSe versao="1.00"><infNFSe><dhProc>2026-09-28T00:00:00Z</dhProc><DPS><infDPS><dhEmi>2026-09-27T23:00:00-03:00</dhEmi><dCompet>2026-08-01</dCompet></infDPS></DPS></infNFSe></NFSe>';
  expect(extrairDataEmissao(xml)).toMatchObject({ civil: '2026-09-28', caminho: 'NFSe/infNFSe/dhProc' });
});
test.each([null, '<NFSe>', '<!DOCTYPE a><a/>', '<DPS><infDPS><dhEmi>2026-09-28T00:00:00Z</dhEmi></infDPS></DPS>', '<resEvento><dhEmi>2026-09-28T00:00:00Z</dhEmi></resEvento>'])('unsupported/invalid XML creates no evidence %s', xml => {
  const e = extrairDataEmissao(xml); expect(e.civil).toBeNull(); expect(e.motivo).toBeTruthy();
});
test('duplicate recognized sources are a conflict, not first match wins', () => {
  expect(extrairDataEmissao(nfe('2026-09-28T00:00:00Z').replace('</ide>', '<dhEmi>2026-09-29T00:00:00Z</dhEmi></ide>')).motivo).toBe('FONTES_CONFLITANTES');
});
test('summary upgrades to complete XML and never downgrades; legacy remains unknown', () => {
  const summary = camposDataEmissao(extrairDataEmissao('<resNFe versao="1.01"><dhEmi>2026-09-27T23:00:00-03:00</dhEmi><dhRecbto>2026-09-28T00:00:00Z</dhRecbto></resNFe>'));
  const full = camposDataEmissao(extrairDataEmissao(nfe('2026-09-28T00:00:00Z')));
  expect(preservarDataEmissao(summary, full)).toEqual(full);
  expect(preservarDataEmissao(full, summary)).toEqual(full);
  expect(projetarDataEmissao({ issueDate: new Date('2026-09-28T00:00:00Z') }).dataEmissao).toMatchObject({ civil: null, motivo: 'LEGADO_SEM_ORIGEM' });
});

describe('identidade documental comum', () => {
  test.each(['plain', 'base64', 'gzip'])('ServiceInvoice: envelope %s, dhProc e dia civil distintos de DPS/criação', envelope => {
    const plain = xmlNfseData({ data: '2026-12-31T23:59:59-03:00', dps: '2026-12-01T12:00:00Z' });
    const xml = envelope === 'plain' ? plain : envelope === 'base64' ? Buffer.from(plain).toString('base64') : gzipSync(plain).toString('base64');
    const projection = projetarEmissaoServico({ xml, chaveAcesso: CHAVE_NFSE, createdAt: new Date('2027-02-01') }, CNPJ_DATAS);
    expect(projection.dataEmissao).toMatchObject({ civil: '2026-12-31', motivo: null, instante: new Date('2027-01-01T02:59:59Z') });
    expect(projection.evidencia).toMatchObject({ identidade: CHAVE_NFSE, identidadeConferida: true });
    expect(projection.xml).toBe(plain);
  });
  test.each([
    [{ chaveAcesso: null }, 'IDENTIDADE_AUSENTE'],
    [{ chaveAcesso: '2'.repeat(50) }, 'IDENTIDADE_DIVERGENTE'],
    [{ xmlRaw: xmlNfseData({ cnpj: '44555666000177' }) }, 'EMPRESA_DIVERGENTE'],
    [{ xmlRaw: xmlNfseData().replace(` Id="NFS${CHAVE_NFSE}"`, '') }, 'IDENTIDADE_AUSENTE'],
  ])('nunca confia em outra nota/empresa ou identidade ausente', (patch, motivo) => {
    expect(evidenciaDaNota({ chaveAcesso: CHAVE_NFSE, xmlRaw: xmlNfseData(), ...patch }, { documentoEmpresa: CNPJ_DATAS })).toMatchObject({ civil: null, motivo });
  });
  test('ABRASF sem identidade composta permanece explicitamente indeterminada', () => {
    expect(evidenciaDaNota({ chaveAcesso: '1', xmlRaw: '<CompNfse><Nfse versao="2.04"><InfNfse><DataEmissao>2026-09-28</DataEmissao></InfNfse></Nfse></CompNfse>' })).toMatchObject({ civil: null, motivo: 'IDENTIDADE_COMPOSTA_NAO_COMPROVADA' });
  });
  test.each([null, '<NFSe>', '<DPS/>', xmlResumoData()])('fonte completa e projeção permanecem juntas após fonte fraca/inválida', xmlRaw => {
    const row = { chaveAcesso: CHAVE_NFE, emitenteDoc: CNPJ_DATAS, xmlRaw: xmlNfeData() };
    const full = prepararDocumentoNota(null, row);
    const result = prepararDocumentoNota({ ...row, ...full }, { ...row, xmlRaw, xmlResumo: xmlRaw === xmlResumoData() ? xmlRaw : null });
    expect(result.documentoPreservado).toBe(true);
    expect(result.xmlRaw).toBe(row.xmlRaw);
    expect(result.dataEmissaoCivil).toBe(full.dataEmissaoCivil);
    expect(result.dataEmissaoEvidencia.hash).toBe(full.dataEmissaoEvidencia.hash);
  });
});