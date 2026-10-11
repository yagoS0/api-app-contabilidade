import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { lerEnvelopeXml, raizDoXml } from './lerEnvelopeXml.js';

// O número da DPS/RPS nunca substitui o número autorizado. Sem XML válido, mantém ausência.
export function numeroDaNfse(xmlArmazenado, chaveEsperada = null) {
  try {
    const { xml } = lerEnvelopeXml(xmlArmazenado);
    if (!xml || xml.length > 1_000_000 || raizDoXml(xml) !== 'NFSe' || XMLValidator.validate(xml) !== true) return null;
    const inf = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml).NFSe?.infNFSe;
    if (!inf || Array.isArray(inf)) return null;
    const chave = String(inf['@_Id'] || '').replace(/^NFS/, '');
    if (chaveEsperada && chave !== String(chaveEsperada).replace(/^NFS/, '')) return null;
    const numero = inf.nNFSe;
    return typeof numero === 'string' && /^\d{1,13}$/.test(numero) && !/^0+$/.test(numero) ? numero : null;
  } catch { return null; }
}
