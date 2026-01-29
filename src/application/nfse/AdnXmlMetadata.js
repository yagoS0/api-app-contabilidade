import { DOMParser } from "@xmldom/xmldom";
import { parseDate } from "../../utils/date.js";
import { findFirstByLocalName, getTextByLocalNames } from "../../utils/xml.js";

function normalizeDoc(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\D+/g, "");
  return normalized || null;
}

export function parseXmlMetadata(xmlPlain) {
  if (!xmlPlain) return {};
  const doc = new DOMParser().parseFromString(xmlPlain, "text/xml");
  const infNfse = findFirstByLocalName(doc, "InfNfse") || doc;
  const prestadorNode =
    findFirstByLocalName(doc, "Prestador") ||
    findFirstByLocalName(doc, "emit") ||
    findFirstByLocalName(doc, "prest");
  const tomadorNode =
    findFirstByLocalName(doc, "Tomador") || findFirstByLocalName(doc, "toma");

  const cnpjPrestador = getTextByLocalNames(prestadorNode, ["Cnpj", "CNPJ", "CPF"]);
  const cnpjTomador = getTextByLocalNames(tomadorNode, ["Cnpj", "CNPJ", "CPF"]);
  const cnpjAutor =
    getTextByLocalNames(doc, ["CNPJAutor", "CNPJ", "CPFAutor", "CPF"]) ||
    getTextByLocalNames(infNfse, ["CNPJAutor", "CNPJ", "CPFAutor", "CPF"]);
  const competencia =
    getTextByLocalNames(infNfse, ["Competencia", "dCompet"]) ||
    getTextByLocalNames(doc, ["Competencia", "dCompet"]);
  const dataEmissao =
    getTextByLocalNames(infNfse, ["DataEmissao", "dhEmi", "dEmi", "dhProc"]) ||
    getTextByLocalNames(doc, ["DataEmissao", "dhEmi", "dEmi", "dhProc"]);
  const numeroNfse =
    getTextByLocalNames(infNfse, ["nNFSe", "Numero", "numero"]) ||
    getTextByLocalNames(doc, ["nNFSe", "Numero", "numero"]);
  const valorServicos =
    getTextByLocalNames(infNfse, ["vServ", "ValorServicos", "valorServicos"]) ||
    getTextByLocalNames(doc, ["vServ", "ValorServicos", "valorServicos"]);
  const valorIss =
    getTextByLocalNames(infNfse, ["vISS", "ValorIss", "valorIss"]) ||
    getTextByLocalNames(doc, ["vISS", "ValorIss", "valorIss"]);
  const situacao =
    getTextByLocalNames(infNfse, ["SituacaoNfse", "Situacao", "xSit"]) ||
    getTextByLocalNames(doc, ["SituacaoNfse", "Situacao", "xSit"]);

  const valorServicosNumber = valorServicos ? Number(valorServicos) : null;
  const valorIssNumber = valorIss ? Number(valorIss) : null;

  return {
    cnpjPrestador: normalizeDoc(cnpjPrestador || cnpjAutor),
    cnpjTomador: normalizeDoc(cnpjTomador),
    competencia: parseDate(competencia),
    dataEmissao: parseDate(dataEmissao),
    numeroNfse: numeroNfse ? String(numeroNfse) : null,
    valorServicos:
      valorServicosNumber !== null && !Number.isNaN(valorServicosNumber)
        ? valorServicosNumber
        : null,
    valorIss:
      valorIssNumber !== null && !Number.isNaN(valorIssNumber) ? valorIssNumber : null,
    situacao: situacao ? String(situacao) : null,
  };
}
