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

  // ⚠ A NOTA SUBSTITUTA DECLARA, ELA MESMA, QUEM ELA SUBSTITUI — e isso não é o evento.
  //
  // São os dois lados do mesmo fato, em documentos diferentes:
  //   • aqui, na DPS da nota nova: `<subst><chSubstda>` = "eu substituo AQUELA"
  //   • no evento e105102 da nota velha: `<chSubstituta>` = "eu fui substituída por AQUELA"
  // O evento pode se perder (e se perdeu: 0 linhas em PortalInvoiceEvent para 556 canceladas);
  // este bloco não, porque viaja dentro do XML da própria nota, que guardamos inteiro. Medido em
  // produção: 22 notas com o bloco, e nenhuma coluna que o expressasse.
  //
  // Leiaute oficial (ANEXO_I v1.01): NFSe/infNFSe/DPS/infDPS/subst/chSubstda.
  //
  // ⚠ O nó tem de ser buscado ANTES dos campos: `cMotivo`/`xMotivo` existem em mais de um lugar do
  // XML, e procurá-los no documento inteiro traria o motivo errado.
  const substNode = findFirstByLocalName(doc, "subst");
  const chaveSubstituida = substNode
    ? (getTextByLocalNames(substNode, ["chSubstda", "chSubstituida"]) || null)
    : null;

  const valorServicosNumber = valorServicos ? Number(valorServicos) : null;
  const valorIssNumber = valorIss ? Number(valorIss) : null;

  return {
    chaveAcesso: chaveAcesso ? String(chaveAcesso).trim() : null,
    // Nulo quando a nota não substitui ninguém — que é o caso da esmagadora maioria.
    chaveSubstituida: chaveSubstituida ? String(chaveSubstituida).replace(/\D+/g, "") || null : null,
    motivoSubstituicao: substNode ? (getTextByLocalNames(substNode, ["xMotivo"]) || null) : null,
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

// ⚠ CANCELAMENTO E CANCELAMENTO-POR-SUBSTITUIÇÃO NÃO SÃO O MESMO FATO.
//
// Este mapa existe porque `isCancelamento` (um booleano) achatava os dois num só, e o efeito no
// banco era idêntico: a nota virava "cancelada" e a chave da substituta ia embora. Quem olhasse
// depois não tinha como saber se a nota deixou de existir para o fisco ou se foi TROCADA por
// outra — e são consequências diferentes na apuração.
//
// O vocabulário aqui é DE PROPÓSITO o mesmo do model `Evento` do ledger da Fase 1
// (`schema.prisma:2317`), para que ligar a Fase 1 à captura seja um mapeamento direto, sem
// tradução: `cancelamento` | `canc_por_substituicao`.
const TIPO_POR_CODIGO = {
  101101: "cancelamento",
  105102: "canc_por_substituicao",
};

// O Id do evento carrega o que o corpo não traz: `EVT` + chave(50) + tpEvento(6) + nSeqEvento(3).
// (O `infPedReg` usa `PRE` + chave(50) + tpEvento(6), sem o nSeq.)
//
// ⚠ ISTO NÃO É UM ATALHO — É A ÚNICA FONTE. Medido nos 62 eventos reais capturados em produção:
// o elemento `<tpEvento>` NÃO EXISTE em nenhum deles. Ler o código só do corpo devolvia `null`
// sempre, e a detecção sobrevivia por acaso, pelo nome do elemento (`<e101101>`) ou pela palavra
// "cancel" na descrição. Nenhum dos dois distingue 101101 de 105102 de forma confiável.
function lerIdDoEvento(doc) {
  const node = findFirstByLocalName(doc, "infEvento") || findFirstByLocalName(doc, "infPedReg");
  const id = node && typeof node.getAttribute === "function"
    ? (node.getAttribute("Id") || node.getAttribute("id"))
    : null;
  const digits = String(id || "").replace(/\D+/g, "");
  if (digits.length < 56) return { chave: null, tpEvento: null, nSeqEvento: null };
  return {
    chave: digits.slice(0, 50),
    tpEvento: digits.slice(50, 56),
    nSeqEvento: digits.length >= 59 ? Number(digits.slice(56, 59)) : null,
  };
}

/**
 * Parseia um item TipoDocumento="EVENTO" da NFS-e Nacional (documento separado da nota).
 *
 * Leiaute confirmado em documentação oficial (ANEXO_II-SEFIN_ADN-PEDREGEVT_EVT-SNNFSe v1.01,
 * 22/01/2026) e batendo com os 62 eventos reais capturados do ADN:
 *
 *   evento/infEvento@Id .......................... EVT + chave(50) + tpEvento(6) + nSeq(3)
 *   evento/pedRegEvento/infPedReg/chNFSe ......... chave da nota afetada
 *   evento/pedRegEvento/infPedReg/dhEvento ....... quando o fato aconteceu
 *   evento/pedRegEvento/infPedReg/e101101 ........ Cancelamento de NFS-e
 *   evento/pedRegEvento/infPedReg/e105102 ........ Cancelamento por Substituição
 *   evento/…/e105102/chSubstituta (50) ........... "Chave de Acesso da NFS-e substituta"
 *
 * @returns {{ chave, tpEvento, tipo, nSeqEvento, dhEvento, cMotivo, xMotivo, descricao,
 *             chaveSubstituta, isCancelamento }}
 */
export function parseNfseEvento(xmlPlain) {
  const vazio = {
    chave: null, tpEvento: null, tipo: null, nSeqEvento: null, dhEvento: null,
    cMotivo: null, xMotivo: null, descricao: null, chaveSubstituta: null, isCancelamento: false,
  };
  if (!xmlPlain) return vazio;
  const doc = new DOMParser().parseFromString(xmlPlain, "text/xml");
  const doId = lerIdDoEvento(doc);

  const chave =
    getTextByLocalNames(doc, ["chNFSe", "ChaveAcesso", "chaveAcesso", "chAcesso"]) || doId.chave || null;
  // Corpo primeiro (se um dia o elemento existir, ele manda), Id como fonte real de hoje.
  const tpEvento = getTextByLocalNames(doc, ["tpEvento", "TipoEvento"]) || doId.tpEvento || null;
  const descricao = getTextByLocalNames(doc, ["xDesc", "descEvento", "xEvento", "descSit"]) || null;

  // O nó do evento propriamente dito — `cMotivo`/`xMotivo` moram DENTRO dele.
  const noEvento =
    findFirstByLocalName(doc, "e101101") || findFirstByLocalName(doc, "e105102") ||
    findFirstByLocalName(doc, "cancNFSe") || findFirstByLocalName(doc, "cancelamento") || doc;

  // ⚠ `chSubstituta` é o nome do padrão (ANEXO_II v1.01) e o único que aparece nos 6 eventos
  // e105102 reais que capturamos. `chNFSeSubst` — que o NOSSO `NfseService.buildEventoXml` escreve
  // ao PEDIR o evento — não existe no leiaute e não aparece em nenhum XML capturado; é lido aqui
  // apenas por defesa, porque o evento devolvido pelo ADN ecoa o `pedRegEvento` que foi enviado.
  // Ler os dois não pode produzir dado errado (significam a mesma coisa); ler só um pode perder.
  const chaveSubstituta =
    getTextByLocalNames(noEvento, ["chSubstituta", "chNFSeSubst"]) || null;

  const codigo = String(tpEvento || "").replace(/\D+/g, "");
  const tipoPorCodigo = TIPO_POR_CODIGO[codigo] || null;
  // Sem código legível, a presença do elemento ainda nomeia o fato — é o que sobra e é honesto.
  const tipoPorElemento = findFirstByLocalName(doc, "e105102")
    ? "canc_por_substituicao"
    : findFirstByLocalName(doc, "e101101") ? "cancelamento" : null;
  // ⚠ Substituição vence: um e105102 detectado pelo elemento não pode ser rebaixado a
  // "cancelamento" só porque o código veio ilegível — perderíamos justamente a distinção.
  const tipo = tipoPorElemento === "canc_por_substituicao" ? "canc_por_substituicao"
    : tipoPorCodigo || tipoPorElemento
    // Chave substituta presente É a assinatura da substituição, mesmo sem código nem elemento.
    || (chaveSubstituta ? "canc_por_substituicao" : null);

  const porTp = tpEvento && TP_EVENTO_CANCELAMENTO.has(String(tpEvento).trim().toLowerCase());
  const xMotivo = getTextByLocalNames(noEvento, ["xMotivo"]) || null;
  const porDescricao = (descricao && /cancel/i.test(descricao)) || (xMotivo && /cancel/i.test(xMotivo));

  return {
    chave: chave ? String(chave).trim() : null,
    tpEvento: tpEvento ? String(tpEvento).trim() : null,
    tipo,
    nSeqEvento: getTextByLocalNames(doc, ["nSeqEvento"]) != null
      ? Number(getTextByLocalNames(doc, ["nSeqEvento"]))
      : doId.nSeqEvento,
    dhEvento: parseDate(getTextByLocalNames(doc, ["dhEvento"])),
    cMotivo: getTextByLocalNames(noEvento, ["cMotivo"]) || null,
    xMotivo,
    descricao: descricao ? String(descricao).trim() : null,
    chaveSubstituta: chaveSubstituta ? String(chaveSubstituta).replace(/\D+/g, "") || null : null,
    isCancelamento: Boolean(porTp || tipo || porDescricao),
  };
}
