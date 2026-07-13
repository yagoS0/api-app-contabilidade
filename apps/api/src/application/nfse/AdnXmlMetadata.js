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

  // Q12.C fix: extrai código LC116 do serviço pra alimentar NotaItem.
  // NFS-e Nacional (Padrão Nacional gov.br/nfse) → <cTribNac> dentro de <servico>
  // ABRASF antigo                                 → <ItemListaServico>
  // Variantes municipais                           → <CodigoTributacaoMunicipio> / <Codigo>
  const servicoNode =
    findFirstByLocalName(doc, "servico") ||
    findFirstByLocalName(doc, "Servico");
  const codigoServico =
    getTextByLocalNames(servicoNode, ["cTribNac", "ItemListaServico", "CodigoTributacaoMunicipio", "codigo", "Codigo"]) ||
    getTextByLocalNames(infNfse, ["cTribNac", "ItemListaServico", "CodigoTributacaoMunicipio"]) ||
    getTextByLocalNames(doc, ["cTribNac", "ItemListaServico", "CodigoTributacaoMunicipio"]);
  const descricaoServico =
    getTextByLocalNames(servicoNode, ["Discriminacao", "discriminacao", "xDescServ", "Descricao"]) ||
    getTextByLocalNames(infNfse, ["Discriminacao", "xDescServ"]) ||
    null;

  // Chave de acesso da NFS-e Nacional: normalmente no atributo Id de <infNFSe> (50 dígitos, às vezes
  // prefixado por "NFS"), ou num elemento <chNFSe>. Antes não era extraída → a captura ADN descartava
  // a nota por "sem chave" (o campo top-level do item ADN não traz a chave). Extraímos aqui.
  let chaveAcesso = getTextByLocalNames(doc, ["chNFSe", "ChaveAcesso", "chaveAcesso"]);
  if (!chaveAcesso && infNfse && typeof infNfse.getAttribute === "function") {
    const idAttr = infNfse.getAttribute("Id") || infNfse.getAttribute("id");
    if (idAttr) {
      const digits = String(idAttr).replace(/\D+/g, "");
      chaveAcesso = digits.length >= 40 ? digits : String(idAttr).trim();
    }
  }

  const valorServicosNumber = valorServicos ? Number(valorServicos) : null;
  const valorIssNumber = valorIss ? Number(valorIss) : null;

  return {
    chaveAcesso: chaveAcesso ? String(chaveAcesso).trim() : null,
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
    codigoServico: codigoServico ? String(codigoServico).trim() : null,
    descricaoServico: descricaoServico ? String(descricaoServico).trim() : null,
  };
}

// Códigos de tpEvento conhecidos de cancelamento da NFS-e Nacional (com e sem prefixo "e").
// A validação final é contra evento REAL (logamos o XML cru); múltiplos sinais reduzem falso-negativo.
const TP_EVENTO_CANCELAMENTO = new Set(["101101", "e101101", "105102", "e105102", "110111"]);

/**
 * Parseia um item TipoDocumento="EVENTO" da NFS-e Nacional (documento separado da nota).
 * O ADN entrega o evento no mesmo LoteDFe; aqui extraímos a chave da nota afetada, o tpEvento
 * e se é (ou parece ser) um cancelamento. Conservador: só marca cancelamento com sinal estrutural
 * (código de evento OU elemento de cancelamento OU descrição "cancel").
 * @returns {{ chave, tpEvento, descricao, isCancelamento }}
 */
export function parseNfseEvento(xmlPlain) {
  if (!xmlPlain) return { chave: null, tpEvento: null, descricao: null, isCancelamento: false };
  const doc = new DOMParser().parseFromString(xmlPlain, "text/xml");
  const chave = getTextByLocalNames(doc, ["chNFSe", "ChaveAcesso", "chaveAcesso", "chAcesso"]) || null;
  const tpEvento = getTextByLocalNames(doc, ["tpEvento", "TipoEvento"]) || null;
  const descricao = getTextByLocalNames(doc, ["xDesc", "descEvento", "xEvento", "xMotivo", "descSit"]) || null;
  const porTp = tpEvento && TP_EVENTO_CANCELAMENTO.has(String(tpEvento).trim().toLowerCase());
  // Alguns layouts nomeiam o elemento do evento pelo código (ex.: <e101101>, <e105102>).
  const porElemento = Boolean(
    findFirstByLocalName(doc, "e101101") || findFirstByLocalName(doc, "e105102") ||
    findFirstByLocalName(doc, "cancNFSe") || findFirstByLocalName(doc, "cancelamento")
  );
  const porDescricao = descricao && /cancel/i.test(descricao);
  return {
    chave: chave ? String(chave).trim() : null,
    tpEvento: tpEvento ? String(tpEvento).trim() : null,
    descricao: descricao ? String(descricao).trim() : null,
    isCancelamento: Boolean(porTp || porElemento || porDescricao),
  };
}
