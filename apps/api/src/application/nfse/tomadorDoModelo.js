import { XMLParser, XMLValidator } from "fast-xml-parser";

const texto = v => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const digitos = v => texto(v).replace(/\D/g, "");

/** Somente o tomador da DPS desta nota; nunca buscar endereço por nome de tag no XML inteiro. */
export function tomadorDoModelo(xml, documento) {
  if (typeof xml !== "string" || !xml.trim() || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  try {
    if (XMLValidator.validate(xml) !== true) return null;
    const doc = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, processEntities: true }).parse(xml);
    const dps = doc.NFSe?.infNFSe?.DPS?.infDPS || doc.DPS?.infDPS;
    const toma = dps?.toma;
    const cnpjCpf = digitos(toma?.CNPJ || toma?.CPF);
    if (!cnpjCpf || cnpjCpf !== digitos(documento)) return null;
    const end = toma.end;
    // O formulário atual é de endereço nacional; não converter endereço exterior em brasileiro.
    const endereco = end?.endNac && !end.endExt ? {
      cMun: texto(end.endNac.cMun), CEP: texto(end.endNac.CEP),
      xLgr: texto(end.xLgr), nro: texto(end.nro), xCpl: texto(end.xCpl), xBairro: texto(end.xBairro),
    } : null;
    return { cnpjCpf, nome: texto(toma.xNome), email: texto(toma.email), endereco };
  } catch { return null; }
}
