import { XMLParser } from "fast-xml-parser";

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).replace(",", ".");
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function ensureArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractInfNFe(json) {
  // Common wrappers: nfeProc.NFe.infNFe, procNFe.NFe.infNFe, NFe.infNFe
  return (
    json?.nfeProc?.NFe?.infNFe ||
    json?.procNFe?.NFe?.infNFe ||
    json?.NFe?.infNFe ||
    json?.infNFe
  );
}

export function parseNfeXml(xml) {
  if (!xml || !xml.toString().trim()) {
    throw new Error("xml_required");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
  });

  const json = parser.parse(xml.toString());
  const infNFe = extractInfNFe(json);
  if (!infNFe) {
    const err = new Error("invalid_nfe");
    err.details = "infNFe not found";
    throw err;
  }

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const dest = infNFe.dest || {};
  const totals = infNFe.total?.ICMSTot || {};

  const detArray = ensureArray(infNFe.det);
  const items = detArray.map((det) => {
    const prod = det?.prod || {};
    const imposto = det?.imposto || {};
    const icms = imposto?.ICMS
      ? Object.values(imposto.ICMS)[0] || {}
      : {};
    const pis = imposto?.PIS
      ? Object.values(imposto.PIS)[0] || {}
      : {};
    const cofins = imposto?.COFINS
      ? Object.values(imposto.COFINS)[0] || {}
      : {};

    return {
      codigo: prod.cProd || null,
      descricao: prod.xProd || null,
      ncm: prod.NCM || null,
      cfop: prod.CFOP || null,
      unidade: prod.uCom || null,
      quantidade: toNumber(prod.qCom),
      valorUnitario: toNumber(prod.vUnCom),
      valorTotal: toNumber(prod.vProd),
      cstIcms: icms.CST || icms.CSOSN || null,
      csosn: icms.CSOSN || null,
      cstPis: pis.CST || null,
      cstCofins: cofins.CST || null,
      aliquotaIcms: toNumber(icms.pICMS),
      aliquotaPis: toNumber(pis.pPIS),
      aliquotaCofins: toNumber(cofins.pCOFINS),
    };
  });

  const chaveRaw = infNFe["@_Id"] || infNFe["@_IdNFe"] || "";
  const chave = chaveRaw.startsWith("NFe")
    ? chaveRaw.slice(3)
    : chaveRaw || ide.chNFe || null;

  const header = {
    chave,
    numero: ide.nNF || null,
    serie: ide.serie || null,
    dhEmi: ide.dhEmi || ide.dEmi || null,
    emitCnpj: emit.CNPJ || null,
    emitNome: emit.xNome || null,
    destDoc: dest.CNPJ || dest.CPF || null,
    destNome: dest.xNome || null,
    cfopPrincipal: detArray[0]?.prod?.CFOP || null,
    valorTotal: toNumber(totals.vNF),
    valorProdutos: toNumber(totals.vProd),
    valorServicos: toNumber(totals.vServ),
    valorImpostos: toNumber(totals.vTotTrib),
    valorIcms: toNumber(totals.vICMS),
    valorPis: toNumber(totals.vPIS),
    valorCofins: toNumber(totals.vCOFINS),
    valorIss: toNumber(totals.vISS),
  };

  if (!header.chave) {
    const err = new Error("chave_not_found");
    err.details = "Chave da NF-e não encontrada no XML";
    throw err;
  }

  return { header, items };
}

