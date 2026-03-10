import { DOMParser } from "@xmldom/xmldom";
import { parseDate } from "../../utils/date.js";
import { findFirstByLocalName, getTextByLocalNames } from "../../utils/xml.js";

function normalizeDoc(value) {
  if (!value) return null;
  const normalized = String(value).replace(/\D+/g, "");
  return normalized || null;
}

function normalizeName(value) {
  if (!value) return null;
  const text = String(value).trim();
  return text ? text : null;
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
  const prestadorNome =
    getTextByLocalNames(prestadorNode, ["xNome", "Nome", "RazaoSocial", "xFant"]) ||
    getTextByLocalNames(doc, ["xNomePrestador", "PrestadorNome"]);
  const tomadorNome =
    getTextByLocalNames(tomadorNode, ["xNome", "Nome", "RazaoSocial"]) ||
    getTextByLocalNames(doc, ["xNomeTomador", "TomadorNome"]);
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
  const cStat =
    getTextByLocalNames(infNfse, ["cStat"]) ||
    getTextByLocalNames(doc, ["cStat"]);

  const valorServicosNumber = valorServicos ? Number(valorServicos) : null;
  const valorIssNumber = valorIss ? Number(valorIss) : null;

  return {
    cnpjPrestador: normalizeDoc(cnpjPrestador || cnpjAutor),
    cnpjTomador: normalizeDoc(cnpjTomador),
    prestadorNome: normalizeName(prestadorNome),
    tomadorNome: normalizeName(tomadorNome),
    competencia: parseDate(competencia),
    dataEmissao: parseDate(dataEmissao),
    numeroNfse: numeroNfse ? String(numeroNfse) : null,
    valorServicos:
      valorServicosNumber !== null && !Number.isNaN(valorServicosNumber)
        ? valorServicosNumber
        : null,
    valorIss:
      valorIssNumber !== null && !Number.isNaN(valorIssNumber) ? valorIssNumber : null,
    // Algumas implementações do XML da NFS-e Nacional não trazem SituacaoNfse,
    // mas trazem cStat (ex.: 100 = autorizada). Guardamos como fallback.
    situacao: situacao ? String(situacao) : cStat ? String(cStat) : null,
  };
}
