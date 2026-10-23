import { XMLValidator } from 'fast-xml-parser';
import { Prisma } from '@prisma/client';
import { derivarCiclo } from '../../notas/cicloNota.js';
import { gunzipSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { lerNfse } from '../danfse/danfseDados.js';
import { raizDoXml } from '../lerEnvelopeXml.js';
import { camposGuru, erroGuru, hashGuru } from './cobrancaManual.js';
import { periodoGuru } from './transacaoGuru.js';

// Somente documento salvo. Não consulta autorizador nem interpreta invoice.status do Guru.
const digitos = value => String(value ?? '').replace(/\D/g, '');
const DecimalGuru = Prisma.Decimal.clone({ precision: 40 });
const namespaceNfse = 'http://www.sped.fazenda.gov.br/nfse';
function elementoUnico(node, path) {
  for (const name of path.split('/')) {
    const children = Array.from(node?.childNodes || []).filter(n => n.nodeType === 1 && n.localName === name);
    if (children.length !== 1 || children[0].namespaceURI !== namespaceNfse) return null;
    node = children[0];
  }
  return node;
}
function textoUnico(node, path) {
  node = elementoUnico(node, path);
  if (Array.from(node?.childNodes || []).some(n => n.nodeType === 1)) return null;
  return node?.textContent?.trim() || null;
}
function documentoPessoa(node, path) {
  const pessoa = elementoUnico(node, path);
  const docs = Array.from(pessoa?.childNodes || []).filter(n => n.nodeType === 1 && ['CNPJ', 'CPF', 'NIF', 'cNaoNIF'].includes(n.localName));
  return docs.length === 1 ? textoUnico(pessoa, docs[0].localName) : null;
}
function lerDocumento(nota) {
  try {
    if (!nota?.xml || nota.xml.length > 2 * 1024 * 1024) return null;
    let xml = nota.xml.trim();
    if (!xml.startsWith('<')) {
      const bytes = Buffer.from(xml, 'base64');
      xml = (bytes[0] === 31 && bytes[1] === 139
        ? gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 }) : bytes).toString('utf8');
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true || raizDoXml(xml) !== 'NFSe') return null;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.documentElement.namespaceURI !== 'http://www.sped.fazenda.gov.br/nfse'
      || doc.getElementsByTagNameNS('*', 'infNFSe').length !== 1
      || doc.getElementsByTagNameNS('*', 'infDPS').length !== 1) return null;
    const inf = elementoUnico(doc.documentElement, 'infNFSe');
    const dps = elementoUnico(inf, 'DPS/infDPS');
    if (!inf || !dps || !/^NFS\d{50}$/.test(inf.getAttribute('Id'))) return null;
    const { valores } = lerNfse(xml);
    const prestador = documentoPessoa(dps, 'prest');
    const tomador = documentoPessoa(dps, 'toma');
    const valor = textoUnico(dps, 'valores/vServPrest/vServ');
    const competencia = textoUnico(dps, 'dCompet');
    const coerente = /^\d{50}$/.test(nota.chaveAcesso || '') && !!nota.numeroNfse
      && valores.chaveAcesso === nota.chaveAcesso && valores.nNFSe === nota.numeroNfse
      && inf.getAttribute('Id') === `NFS${nota.chaveAcesso}`
      && textoUnico(inf, 'nNFSe') === nota.numeroNfse && textoUnico(inf, 'cStat') === '100'
      && textoUnico(dps, 'tpAmb') === '1'
      && valores.cStat === '100' && valores.tpAmb === '1'
      && /^\d{14}$/.test(prestador || '') && prestador === digitos(nota.companyCnpj)
      && (nota.fonte !== 'PortalInvoice' || prestador === digitos(nota.emitenteDoc))
      && /^(\d{11}|\d{14})$/.test(tomador || '') && tomador === digitos(nota.tomadorDoc)
      && valor != null && /^\d+(\.\d+)?$/.test(valor) && nota.valorServicos != null
      && new DecimalGuru(valor).equals(String(nota.valorServicos))
      && /^\d{4}-\d{2}-\d{2}$/.test(competencia || '')
      && new Date(competencia).toISOString().slice(0, 10) === competencia
      && (!nota.competencia || new Date(nota.competencia).toISOString().slice(0, 10) === competencia);
    return { xml, valores, prestador, tomador, valor, competencia, coerente: !!coerente };
  } catch { return null; }
}
export function documentoGuru(nota) {
  const info = lerDocumento(nota);
  return info?.coerente ? info.xml : null;
}

export const revisaoNotaGuru = nota => hashGuru([nota.id, nota.companyId, nota.companyCnpj, nota.status,
  nota.updatedAt, nota.numeroNfse, nota.chaveAcesso, nota.emitenteDoc, nota.tomadorDoc, nota.competencia,
  String(nota.valorServicos), nota.xml, nota.ciclo || null, nota.eventos || [], nota.capturada || null, nota.relacionadas || []]);

export function projetarNotaGuru(nota) {
  const info = lerDocumento(nota), documento = info?.coerente;
  const ativa = nota.status === 'issued' && !nota.bloqueioCiclo;
  return { id: nota.id, identidadeFiscal: nota.chaveAcesso, numero: nota.numeroNfse, valor: nota.valorServicos == null ? null : String(nota.valorServicos),
    prestador: info?.prestador || null, tomador: info?.tomador || nota.tomadorDoc || null,
    tomadorNome: nota.tomadorNome || null, competencia: info?.competencia || null,
    ambiente: info?.valores.tpAmb === '1' ? 'PRODUCAO' : info?.valores.tpAmb === '2' ? 'HOMOLOGACAO' : 'NAO_VERIFICADO',
    moeda: 'BRL', estado: nota.ciclo?.situacao || nota.status, ciclo: nota.ciclo || null,
    origem: nota.fonte || 'ServiceInvoice', hash: revisaoNotaGuru(nota),
    atualizadaEm: new Date(nota.updatedAt).toISOString(), documentoValido: !!documento,
    vinculavel: ativa && !!documento,
    documentos: { xml: ativa && !!documento, danfse: ativa && !!documento },
    situacaoAutorizador: 'NAO_CONSULTADA' };
}

export async function contextoNotasGuru(tx, companyId) {
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { cnpj: true } });
  const portal = await tx.portalClient.findUnique({ where: { companyId }, select: { id: true, cnpj: true } });
  if (portal && digitos(portal.cnpj) !== digitos(company?.cnpj)) throw erroGuru('guru_identidade_empresa_divergente', 409);
  return { companyId, companyCnpj: company?.cnpj, portalClientId: portal?.id || null };
}

export async function carregarNotaGuru(tx, ctx, notaId, lock = false) {
  const portalId = notaId.startsWith('portal:') ? notaId.slice(7) : null;
  if (portalId && !ctx.portalClientId) return null;
  if (lock) {
    if (portalId) await tx.$queryRaw`SELECT "id" FROM "PortalInvoice" WHERE "id" = ${portalId} AND "clientId" = ${ctx.portalClientId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT "id" FROM "ServiceInvoice" WHERE "id" = ${notaId} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
  }
  const source = portalId
    ? await tx.portalInvoice.findFirst({ where: { id: portalId, clientId: ctx.portalClientId, type: 'NFSE', papel: 'EMIT' } })
    : await tx.serviceInvoice.findFirst({ where: { id: notaId, companyId: ctx.companyId } });
  if (!source) return null;
  // A captura posterior também invalida uma conferência baseada na emissão antiga.
  let capturada = portalId ? source : ctx.portalClientId && source.chaveAcesso
    ? await tx.portalInvoice.findFirst({ where: { clientId: ctx.portalClientId, chaveAcesso: source.chaveAcesso, type: 'NFSE', papel: 'EMIT' } }) : null;
  let ciclo = null, eventos = [], bloqueioCiclo = false;
  if (capturada) {
    if (lock) {
      await tx.$queryRaw`SELECT "id" FROM "PortalInvoice" WHERE "id" = ${capturada.id} AND "clientId" = ${ctx.portalClientId} FOR UPDATE`;
      capturada = await tx.portalInvoice.findFirst({ where: { id: capturada.id, clientId: ctx.portalClientId } });
      if (!capturada) return null;
    }
    eventos = await tx.portalInvoiceEvent.findMany({ where: { clientId: ctx.portalClientId, invoiceId: capturada.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    bloqueioCiclo = capturada.statusEfetivo !== 'autorizada' || capturada.status !== 'EMITIDA'
      || eventos.some(e => e.type?.startsWith('canc') || e.chaveSubstituta);
  }
  // A substituta pode ter sido capturada antes da original. Consultar por chave,
  // sem fabricar uma PortalInvoice para a emissão nem alterar seu estado salvo.
  const baseCiclo = capturada || source;
  const relacionadas = ctx.portalClientId && baseCiclo.chaveAcesso ? await tx.portalInvoice.findMany({
    where: { clientId: ctx.portalClientId, type: 'NFSE', papel: 'EMIT', OR: [
      { chaveSubstituida: baseCiclo.chaveAcesso },
      ...(baseCiclo.chaveSubstituida ? [{ chaveAcesso: baseCiclo.chaveSubstituida }] : []),
    ] }, orderBy: { id: 'asc' },
  }) : [];
  const substituta = relacionadas.find(n => n.chaveSubstituida === baseCiclo.chaveAcesso);
  if (capturada || substituta) ciclo = derivarCiclo({ nota: baseCiclo,
    evento: eventos.find(e => e.type === 'canc_por_substituicao') || eventos.at(-1), substituta,
    substituida: relacionadas.find(n => n.chaveAcesso === baseCiclo.chaveSubstituida) });
  bloqueioCiclo ||= !!substituta;
  return { ...source, ...ctx, id: notaId, fonte: portalId ? 'PortalInvoice' : 'ServiceInvoice',
    ...(portalId ? { numeroNfse: source.numero, valorServicos: source.total, xml: source.xmlRaw,
      status: source.statusEfetivo === 'autorizada' && source.status === 'EMITIDA' ? 'issued' : source.status } : {}),
    ciclo, eventos, bloqueioCiclo,
    relacionadas: relacionadas.map(n => [n.id, n.updatedAt, n.chaveAcesso, n.chaveSubstituida, n.status, n.statusEfetivo, n.xmlHash]),
    capturada: capturada ? [capturada.id, capturada.updatedAt, capturada.xmlHash, capturada.status, capturada.statusEfetivo] : null };
}

export async function notasDoRegistroGuru(tx, item, cache = new Map()) {
  const vinculos = item.notasVinculadas || [];
  if (!vinculos.length) return [];
  const ctx = await contextoNotasGuru(tx, item.companyId), out = [];
  for (const v of vinculos) {
    if (!cache.has(v.notaId)) {
      const nota = await carregarNotaGuru(tx, ctx, v.notaId);
      cache.set(v.notaId, nota ? projetarNotaGuru(nota) : null);
    }
    const atual = cache.get(v.notaId);
    const vigente = !!atual?.vinculavel && atual.hash === v.notaHash && item.hash === v.vendaHash
      && item.versao === v.vendaVersao && item.estado !== 'CONFLITO';
    out.push({ ...atual, id: v.notaId, conferencia: vigente ? 'CONFERIDA' : 'RECONFERIR',
      conferidaEm: v.instante, conferidaPor: v.atorId, origemVinculo: 'MANUAL',
      documentos: vigente ? atual.documentos : { xml: false, danfse: false } });
  }
  return out;
}

export function filtrosGuru(query) {
  camposGuru(query, ['pagina', 'campo', 'inicio', 'fim', 'estado']);
  const pagina = query.pagina === undefined ? 1 : Number(query.pagina);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000) throw erroGuru('guru_pagina_invalida');
  const estado = query.estado || null;
  if (estado && !['PREPARADA', 'CONFERIDA', 'CONFLITO'].includes(estado)) throw erroGuru('guru_filtro_invalido');
  const periodo = query.inicio || query.fim || query.campo
    ? periodoGuru({ campo: query.campo, inicio: query.inicio, fim: query.fim }) : null;
  return { pagina, estado, periodo };
}

export function filtrarGuru(items, { estado, periodo }) {
  return items.filter(item => {
    if (estado && item.estado !== estado) return false;
    if (!periodo) return true;
    // Datas da origem em UTC, não competência nem data de importação. Ausentes ficam fora.
    const segundos = item.dados?.datas?.[periodo.campo];
    if (segundos == null) return false;
    const dia = new Date(segundos * 1000).toISOString().slice(0, 10);
    return dia >= periodo.inicio && dia <= periodo.fim;
  });
}

export function resumoGuru(items) {
  const moedas = new Map(), notas = new Set();
  let valoresAusentes = 0, moedasAusentes = 0, vendasSemVinculo = 0;
  for (const item of items) {
    const valor = item.dados.financeiro ? item.dados.financeiro.total : item.dados.valorCentavos == null ? null : new DecimalGuru(item.dados.valorCentavos).div(100).toString();
    const moeda = item.dados.financeiro ? item.dados.financeiro.moeda : item.dados.moeda;
    if (valor == null) valoresAusentes++;
    if (!moeda) moedasAusentes++;
    if (moeda) {
      const grupo = moedas.get(moeda) || { moeda, total: null, informados: 0, ausentes: 0 };
      if (valor == null) grupo.ausentes++;
      else { grupo.total = new DecimalGuru(grupo.total ?? 0).plus(String(valor)).toString(); grupo.informados++; }
      moedas.set(moeda, grupo);
    }
    const vinculadas = item.notasVinculadas || item.notas || [];
    if (!vinculadas.length) vendasSemVinculo++;
    for (const nota of vinculadas) notas.add(nota.identidadeFiscal || nota.notaId || nota.id);
  }
  return { vendas: items.length, notasVinculadas: notas.size, vendasSemVinculo,
    valoresAusentes, moedasAusentes, moedas: [...moedas.values()].sort((a, b) => a.moeda.localeCompare(b.moeda)) };
}
