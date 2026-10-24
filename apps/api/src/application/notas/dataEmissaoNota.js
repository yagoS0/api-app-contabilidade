import { createHash } from 'node:crypto';
import { lerEnvelopeXml } from '../nfse/lerEnvelopeXml.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { validarProvenienciaDfe } from './dfe/provenienciaDfe.js';

export const VERSAO_DATA_EMISSAO = 2;
export const selectDataEmissao = { dataEmissaoCivil: true, dataEmissaoInstante: true, dataEmissaoEvidencia: true,
  provenienciaDfe: true, clientId: true, xmlResumo: true, client: { select: { cnpj: true } } };
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false });
export const hashXml = xml => createHash('sha256').update(xml).digest('hex');
export function dataCivilValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || value.slice(0, 4) === '0000') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A civil date belongs to the source document, not to the browser/server timezone.
export function interpretarDataOriginal(original, { offsetObrigatorio = false, somenteData = false } = {}) {
  if (typeof original !== 'string') return { motivo: 'DATA_AUSENTE' };
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(original);
  if (!match || !dataCivilValida(match[1])) return { motivo: 'DATA_INVALIDA' };
  const [, civil, hh, mm, ss, , offset] = match;
  if (hh && (+hh > 23 || +mm > 59 || +ss > 59)) return { motivo: 'DATA_INVALIDA' };
  if (somenteData && hh) return { motivo: 'FORMATO_INCOMPATIVEL' };
  if (offset && offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))) return { motivo: 'OFFSET_INVALIDO' };
  if (offsetObrigatorio && (!hh || !offset)) return { motivo: 'OFFSET_AUSENTE' };
  return { civil, instante: offset ? new Date(original).toISOString() : null, offset: offset || null,
    precisao: offset ? 'INSTANTE' : hh ? 'HORA_LOCAL' : 'DATA_CIVIL', motivo: null };
}

const at = (root, path) => path.reduce((nodes, key) => nodes.flatMap(n => {
  const v = n?.[key]; return v == null ? [] : Array.isArray(v) ? v : [v];
}), [root]);

/** Only recognized document paths are evidence. DPS, events and receipt dates are excluded. */
export function extrairDataEmissao(xml) {
  const base = { versaoExtrator: VERSAO_DATA_EMISSAO, hash: null, origem: null, caminho: null,
    versaoDocumento: null, original: null, civil: null, instante: null, precisao: null, offset: null, forca: 0 };
  const fail = motivo => ({ ...base, motivo });
  if (typeof xml !== 'string' || !xml.trim()) return fail('XML_AUSENTE');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return fail('XML_INVALIDO');
  base.hash = hashXml(xml);
  let doc;
  try { doc = parser.parse(xml); } catch { return fail('XML_INVALIDO'); }
  const roots = Object.keys(doc).filter(k => !k.startsWith('?'));
  if (roots.length !== 1) return fail('ESTRUTURA_AMBIGUA');
  const root = roots[0];
  let paths = [], options = {};
  if (root === 'NFSe') {
    base.identidade = normalizarChaveDocumental(doc.NFSe?.infNFSe?.['@_Id'], 'NFSE_NACIONAL');
    base.emitenteDoc = doc.NFSe?.infNFSe?.emit?.CNPJ || doc.NFSe?.infNFSe?.emit?.CPF || doc.NFSe?.infNFSe?.DPS?.infDPS?.prest?.CNPJ || doc.NFSe?.infNFSe?.DPS?.infDPS?.prest?.CPF || null;
    base.tomadorDoc = doc.NFSe?.infNFSe?.DPS?.infDPS?.toma?.CNPJ || doc.NFSe?.infNFSe?.DPS?.infDPS?.toma?.CPF || null;
    base.origem = 'NFSE_NACIONAL'; base.versaoDocumento = doc.NFSe?.['@_versao'] || null;
    if (!/^1\.(00|01)$/.test(base.versaoDocumento || '')) return fail('VERSAO_NAO_SUPORTADA');
    paths = [['NFSe', 'infNFSe', 'dhProc']]; options.offsetObrigatorio = true; base.forca = 3;
  } else if (['nfeProc', 'procNFe', 'NFe'].includes(root)) {
    const prefix = root === 'NFe' ? ['NFe'] : [root, 'NFe'];
    const infos = at(doc, [...prefix, 'infNFe']);
    if (infos.length !== 1) return fail('ESTRUTURA_AMBIGUA');
    base.identidade = normalizarChaveDocumental(infos[0]['@_Id'], 'NFE_COMPLETA');
    base.emitenteDoc = infos[0].emit?.CNPJ || infos[0].emit?.CPF || null;
    base.tomadorDoc = infos[0].dest?.CNPJ || infos[0].dest?.CPF || null;
    base.origem = 'NFE_COMPLETA'; base.versaoDocumento = infos[0]['@_versao'] || null;
    if (['3.10', '4.00'].includes(base.versaoDocumento)) {
      paths = [[...prefix, 'infNFe', 'ide', 'dhEmi']]; options.offsetObrigatorio = true;
    } else if (base.versaoDocumento === '2.00') {
      paths = [[...prefix, 'infNFe', 'ide', 'dEmi']]; options.somenteData = true;
    } else return fail('VERSAO_NAO_SUPORTADA');
    base.forca = 3;
  } else if (root === 'resNFe') {
    base.identidade = normalizarChaveDocumental(doc.resNFe?.chNFe, 'NFE_RESUMO');
    base.emitenteDoc = doc.resNFe?.CNPJ || doc.resNFe?.CPF || null;
    base.origem = 'NFE_RESUMO'; base.versaoDocumento = doc.resNFe?.['@_versao'] || null;
    if (!['1.00', '1.01'].includes(base.versaoDocumento)) return fail('VERSAO_NAO_SUPORTADA');
    paths = [['resNFe', 'dhEmi']]; options.offsetObrigatorio = true; base.forca = 1;
  } else if (['CompNfse', 'ConsultarNfseResposta', 'ConsultarNfseServicoPrestadoResposta', 'ConsultarNfseServicoTomadoResposta'].includes(root)) {
    const prefix = root === 'CompNfse' ? ['CompNfse'] : [root, 'ListaNfse', 'CompNfse'];
    const nodes = at(doc, [...prefix, 'Nfse']);
    if (nodes.length !== 1) return fail('ESTRUTURA_AMBIGUA');
    base.origem = 'NFSE_ABRASF'; base.versaoDocumento = nodes[0]['@_versao'] || null;
    if (!['1.00', '2.00', '2.01', '2.02', '2.03', '2.04'].includes(base.versaoDocumento)) return fail('VERSAO_NAO_SUPORTADA');
    paths = [[...prefix, 'Nfse', 'InfNfse', 'DataEmissao']]; base.forca = 3;
  } else return fail('DOCUMENTO_NAO_SUPORTADO');
  const values = paths.flatMap(path => at(doc, path).map(original => ({ original, caminho: path.join('/') })));
  if (!values.length) return fail('DATA_AUSENTE');
  if (values.length !== 1) return fail('FONTES_CONFLITANTES');
  Object.assign(base, values[0]);
  return { ...base, ...interpretarDataOriginal(base.original, options) };
}

export function camposDataEmissao(evidencia) {
  return { dataEmissaoCivil: evidencia.motivo ? null : evidencia.civil,
    dataEmissaoInstante: evidencia.motivo || !evidencia.instante ? null : new Date(evidencia.instante), dataEmissaoEvidencia: evidencia };
}

// Do not downgrade a complete source when the distributor subsequently sends a summary.
export function preservarDataEmissao(existing, incoming) {
  const old = existing?.dataEmissaoEvidencia;
  const next = incoming?.dataEmissaoEvidencia;
  if (old && !old.motivo && (!next || next.motivo || old.forca > next.forca)) {
    return { dataEmissaoCivil: existing.dataEmissaoCivil, dataEmissaoInstante: existing.dataEmissaoInstante,
      dataEmissaoEvidencia: old };
  }
  return incoming;
}

export function projetarDataEmissao(nota, documentoEmpresa = nota?.client?.cnpj) {
  let e = nota?.dataEmissaoEvidencia;
  if (e?.origem === 'NFE_RESUMO') {
    e = documentoEmpresa ? evidenciaDaNota(nota, { documentoEmpresa })
      : { ...e, motivo: 'EMPRESA_NAO_COMPROVADA', civil: null, instante: null };
    nota = { ...nota, ...camposDataEmissao(e) };
  }
  return { dataEmissao: { civil: e && !e.motivo ? nota.dataEmissaoCivil || null : null,
    instante: nota?.dataEmissaoInstante || null, evidencia: e || null,
    motivo: e?.motivo || (e && nota.dataEmissaoCivil ? null : 'LEGADO_SEM_ORIGEM') } };
}

// Structure identifies a document family; it never proves fiscal authorization.
export function normalizarChaveDocumental(value, origem) {
  const national = origem === 'NFSE_NACIONAL';
  const key = String(value || '').trim().replace(national ? /^NFS(?=\d{50}$)/ : /^NFe(?=\d{44}$)/, '');
  return (national ? /^\d{50}$/ : /^\d{44}$/).test(key) ? key : null;
}

export function evidenciaDaNota(nota, { documentoEmpresa = null } = {}) {
  const { xml } = lerEnvelopeXml(nota?.xmlRaw || nota?.xmlResumo || nota?.xml);
  const e = extrairDataEmissao(xml);
  const fail = motivo => ({ ...e, civil: null, instante: null, motivo, identidadeConferida: false });
  if (e.motivo) return fail(e.motivo);
  // No ABRASF composite identity is persisted today. A number alone is not proof.
  if (e.origem === 'NFSE_ABRASF') return fail('IDENTIDADE_COMPOSTA_NAO_COMPROVADA');
  const expected = normalizarChaveDocumental(nota?.chaveAcesso, e.origem);
  if (!expected || !e.identidade) return fail('IDENTIDADE_AUSENTE');
  if (expected !== e.identidade) return fail('IDENTIDADE_DIVERGENTE');
  const digits = value => String(value || '').replace(/\D/g, '');
  const issuer = digits(e.emitenteDoc);
  const expectedIssuer = digits(nota?.emitenteDoc);
  const company = digits(documentoEmpresa);
  if (!issuer || (expectedIssuer && issuer !== expectedIssuer)) return fail('EMITENTE_DIVERGENTE');
  if (company && issuer !== company && digits(e.tomadorDoc) !== company) {
    if (e.origem !== 'NFE_RESUMO' || !validarProvenienciaDfe(nota?.provenienciaDfe,
      { clientId: nota?.clientId, cnpj: company, chave: expected, xml })) return fail('EMPRESA_DIVERGENTE');
  }
  if (!company && !expectedIssuer) return fail('EMPRESA_NAO_COMPROVADA');
  return { ...e, identidadeConferida: true };
}

export function projetarEmissaoServico(nota, documentoEmpresa) {
  const evidencia = evidenciaDaNota(nota, { documentoEmpresa });
  const { xml } = lerEnvelopeXml(nota?.xml);
  return { ...projetarDataEmissao(camposDataEmissao(evidencia)), xml, evidencia };
}
