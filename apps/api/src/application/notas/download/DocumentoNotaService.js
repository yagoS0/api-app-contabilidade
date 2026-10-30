import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { gerarPDF } from "nfe-danfe-pdf";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { raizDoXml } from "../../nfse/lerEnvelopeXml.js";
import { gerarDanfseDaNota } from "../../nfse/danfse/danfseDaNotaDoPortal.js";
import { safeFilePart } from "../../nfse/danfse/loteDanfseDoPortal.js";
import { projetarEmissaoServico, evidenciaDaNota } from '../dataEmissaoNota.js';

const falha = (message, status = 422, code = "DOCUMENTO_INDISPONIVEL") => Object.assign(new Error(message), { status, code });
export async function gerarDanfeNfe({ xml, cancelada = false }) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw falha("XML de NF-e inválido.");
  conferirNfe(xml);
  const doc = await gerarPDF(xml, { cancelada, textoRodape: "Altan" });
  // A biblioteca encerra o documento; apenas consumimos o stream.
  const chunks = [];
  for await (const chunk of doc) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// The historical projection trims the envelope for parsing. Downloads preserve all original
// UTF-8 bytes, including BOM/whitespace; never serialize a parsed fiscal XML again.
function xmlOriginalDaEmissao(value) {
  if (typeof value !== 'string') return '';
  if (value.trimStart().startsWith('<')) return value;
  const bytes = Buffer.from(value.trim(), 'base64');
  try { return gunzipSync(bytes, { maxOutputLength: 50 * 1024 * 1024 }).toString('utf8'); }
  catch { return bytes.toString('utf8'); }
}

export async function resolverNotasDocumentais({ portalClientId, ids, client = prisma }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 100))
    throw falha('Identificação de nota inválida.', 400);
  const portal = await client.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true, cnpj: true } });
  const notas = await client.portalInvoice.findMany({
    where: { clientId: portalClientId, id: { in: ids } },
    select: { id: true, type: true, numero: true, xmlRaw: true, chaveAcesso: true, emitenteDoc: true, status: true, statusEfetivo: true },
  });
  const byId = new Map(notas.map(n => [n.id, n]));
  const faltantes = ids.filter(id => !byId.has(id));
  if (faltantes.length) {
    const emitidas = portal?.companyId ? await client.serviceInvoice.findMany({
      where: { companyId: portal.companyId, id: { in: faltantes } },
      select: { id: true, numeroNfse: true, chaveAcesso: true, xml: true, status: true },
    }) : [];
    for (const n of emitidas) {
      const xmlOriginal = xmlOriginalDaEmissao(n.xml);
      const projection = projetarEmissaoServico({ ...n, xml: xmlOriginal }, portal.cnpj);
      byId.set(n.id, { ...n, type: 'NFSE', numero: n.numeroNfse, xmlRaw: xmlOriginal, evidencia: projection.evidencia });
    }
  }
  // IDs fora da empresa e IDs inexistentes produzem exatamente a mesma resposta.
  if (ids.some(id => !byId.has(id))) throw falha("Uma ou mais notas não foram encontradas nesta empresa. Atualize a lista.", 404);
  return { byId, portal };
}

function conferirXml(n, portal) {
  const xml = n.xmlRaw;
  if (raizDoXml(xml) === 'DPS') throw falha('O documento guardado é o pedido de emissão (DPS), não uma nota autorizada.', 422, 'DANFSE_XML_E_O_PEDIDO');
  if (!xml || !['NFSe', 'NFe', 'nfeProc'].includes(raizDoXml(xml)) || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw falha('XML completo indisponível; o resumo da captura não substitui o documento.');
  const evidence = n.evidencia || evidenciaDaNota(n, { documentoEmpresa: portal?.cnpj });
  if (!evidence.identidadeConferida) throw falha('A identidade do documento precisa ser conferida antes do download.');
  if ((n.type === 'NFE') !== ['NFe', 'nfeProc'].includes(raizDoXml(xml))) throw falha('Tipo do documento divergente.');
  return xml;
}

function conferirNfe(xml) {
  const proc = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true }).parse(xml).nfeProc;
  const inf = proc?.NFe?.infNFe;
  if (!inf || String(inf.ide?.mod) !== '55' || !proc.protNFe?.infProt?.nProt)
    throw falha('DANFE requer o XML completo da NF-e com protocolo de autorização. O resumo não contém esses dados.');
  if (!['100', '150'].includes(String(proc.protNFe.infProt.cStat))) throw falha('O XML não comprova autorização da NF-e.');
  if (proc.protNFe.infProt.chNFe !== String(inf['@_Id'] || '').replace(/^NFe/, '')) throw falha('Protocolo de autorização de outra NF-e.');
}

export async function prepararDocumentoNota({ portalClientId, nota: n, portal, formato, client = prisma, gerarNfe = gerarDanfeNfe, gerarNfse = gerarDanfseDaNota }) {
  if (!['XML', 'PDF'].includes(formato)) throw falha('Escolha XML ou PDF.', 400);
  const xml = conferirXml(n, portal);
  if (formato === 'PDF' && n.type === 'NFE') conferirNfe(xml);
  const conteudo = formato === 'XML' ? Buffer.from(xml, 'utf8') : n.type === 'NFE'
    ? await gerarNfe({ xml, cancelada: ['cancelada', 'cancelled'].includes(String(n.statusEfetivo || n.status).toLowerCase()) })
    : (await gerarNfse({ portalClientId, notaId: n.id, client })).pdf;
  if (formato === 'PDF' && (!Buffer.isBuffer(conteudo) || conteudo.subarray(0, 5).toString() !== '%PDF-'))
    throw falha('O gerador não retornou um PDF válido.', 502, 'PDF_INVALIDO');
  return { conteudo, mime: formato === 'PDF' ? 'application/pdf' : 'application/xml', formato,
    nome: `${safeFilePart(n.type)}-${safeFilePart(n.numero) || 'sem-numero'}-${safeFilePart(n.id)}.${formato.toLowerCase()}` };
}

export async function documentoNota({ portalClientId, notaId, formato, client = prisma, ...geradores }) {
  if (!['XML', 'PDF'].includes(formato)) throw falha('Escolha XML ou PDF.', 400);
  const { byId, portal } = await resolverNotasDocumentais({ portalClientId, ids: [notaId], client });
  return prepararDocumentoNota({ portalClientId, nota: byId.get(notaId), portal, formato, client, ...geradores });
}

// Local preconditions only: never generate a PDF or contact a fiscal provider here.
export async function acoesDocumentoNota({ portalClientId, notaId, client = prisma }) {
  const { byId, portal } = await resolverNotasDocumentais({ portalClientId, ids: [notaId], client });
  const n = byId.get(notaId);
  const disponivel = { estado: 'disponivel', motivo: null };
  let xml, XML, PDF;
  try { xml = conferirXml(n, portal); XML = disponivel; }
  catch (e) { XML = { estado: 'indisponivel', motivo: e.message, code: e.code }; }
  PDF = XML;
  if (xml) {
    try {
      if (n.type === 'NFE') conferirNfe(xml);
      else {
        const inf = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true }).parse(xml)?.NFSe?.infNFSe;
        if (!inf || !/^NFS\d{50}$/.test(inf['@_Id'] || '') || !inf.nNFSe)
          throw falha('Dados locais insuficientes para gerar o DANFSe com QR Code.');
      }
      PDF = disponivel;
    } catch (e) { PDF = { estado: 'indisponivel', motivo: e.message, code: e.code }; }
  }
  return { revisao: createHash('sha256').update(JSON.stringify([portalClientId, notaId, n.xmlRaw, n.status, n.statusEfetivo])).digest('hex'),
    XML, PDF, cancelar: { estado: 'indisponivel', motivo: 'Cancelamento fiscal indisponível nesta etapa.' } };
}
