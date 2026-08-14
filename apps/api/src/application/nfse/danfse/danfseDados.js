// LEITURA DO XML DA NFS-e PARA O DANFSe — POR CAMINHO, NUNCA POR "PRIMEIRO COM ESSE NOME".
//
// ⚠ ISTO NÃO PODE REUSAR `getTextByLocalNames` de `utils/xml.js`. Aquela função varre o documento
// inteiro e devolve o primeiro elemento com o nome pedido — e o XML da NFS-e tem `CNPJ` em `emit`,
// em `prest`, em `toma` e em `interm`; `xNome` em quatro grupos; `cMun` em cinco; `vBC` tanto em
// `infNFSe/valores` quanto em `IBSCBS/valores`; `vDescIncond` em dois lugares. O próprio
// `AdnXmlMetadata.js` já registra a armadilha ("`cMotivo`/`xMotivo` existem em mais de um lugar do
// XML, e procurá-los no documento inteiro traria o motivo errado").
//
// Num metadado, pegar o nome errado é um campo torto. Num DANFSe, é imprimir o CNPJ do prestador
// no lugar do tomador — num documento que circula.
//
// A entrada é a **NFS-e**, não a DPS: a DPS é o que se envia, a NFS-e é o que volta, com chave,
// número, `dhProc` e a assinatura do município/SEFIN. O DANFSe representa a NFS-e — e por isso
// todos os caminhos deste módulo começam em `NFSe/infNFSe`.

import { DOMParser } from "@xmldom/xmldom";
import {
  BLOCOS,
  TRACO_DE_AUSENCIA,
  ORDEM_INFO_COMPLEMENTARES,
  TEXTOS,
  truncarComReticencias,
} from "./danfseLeiaute.js";
import { descreverCodigo } from "./danfseDescricoes.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Navegação por caminho (namespace-agnóstica: compara sempre `localName`)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const ELEMENT_NODE = 1;

function filhosPorNome(node, nome) {
  if (!node || !node.childNodes) return [];
  const alvo = String(nome).toLowerCase();
  const achados = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const filho = node.childNodes[i];
    if (filho.nodeType !== ELEMENT_NODE) continue;
    const local = filho.localName || filho.nodeName;
    if (String(local).toLowerCase() === alvo) achados.push(filho);
  }
  return achados;
}

/** Desce por `a/b/c` a partir de `raiz`, sempre pelo PRIMEIRO filho de cada nível. */
function descer(raiz, caminho) {
  const partes = String(caminho || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  let atual = raiz;
  for (const parte of partes) {
    if (!atual) return null;
    atual = filhosPorNome(atual, parte)[0] || null;
  }
  return atual;
}

function textoDe(node) {
  if (!node) return null;
  const texto = String(node.textContent ?? "").trim();
  return texto || null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Formatação — apresentação do MESMO dado, nunca dado novo
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** `2026-01-01` → `01/01/2026` (formato exigido pela NT no campo COMPETÊNCIA). */
function formatarData(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `2026-01-12T13:50:48-03:00` → `12/01/2026 13:50:48`. */
function formatarDataHora(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
}

/**
 * `198.00` → `198,00`.
 *
 * ⚠ Sem "R$". A NT só escreve o símbolo na linha de Totais Aproximados (nota 10), e ali o texto
 * inteiro é ditado por ela. Acrescentar símbolo nos demais campos seria decorar o documento.
 */
function formatarValor(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(String(valor).replace(",", "."));
  if (!Number.isFinite(n)) return String(valor);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarCnpjCpf(doc) {
  const d = String(doc || "").replace(/\D+/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc ? String(doc) : null;
}

function formatarCep(cep) {
  const d = String(cep || "").replace(/\D+/g, "");
  if (d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return cep ? String(cep) : null;
}

function juntar(partes, separador = " / ") {
  const limpas = partes.filter((p) => p != null && String(p).trim() !== "");
  return limpas.length ? limpas.join(separador) : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Extratores por campo — um por linha da tabela do §2.4.5
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Monta o contexto de leitura. Todos os caminhos são relativos a `infNFSe`, que é onde a NT
 * ancora tudo (`NFSe/infNFSe/...`).
 */
function contexto(infNFSe) {
  const t = (caminho) => textoDe(descer(infNFSe, caminho));
  const n = (caminho) => descer(infNFSe, caminho);
  const DPS = "DPS/infDPS";

  /** Grupo de pessoa (`prest`, `toma`, `interm`, `IBSCBS/dest`) → os 7/8 campos do bloco. */
  const pessoa = (base) => {
    const raiz = n(base);
    const end = raiz ? descer(raiz, "end") : null;
    const endNac = end ? descer(end, "endNac") : null;
    const endExt = end ? descer(end, "endExt") : null;
    const endereco = endNac || endExt;

    const logradouro = juntar(
      [textoDe(descer(end, "xLgr")), textoDe(descer(end, "nro")), textoDe(descer(end, "xCpl")), textoDe(descer(end, "xBairro"))],
      ", "
    );

    const cMun = textoDe(descer(endNac, "cMun"));
    const xCidade = textoDe(descer(endExt, "xCidade"));
    const cep = textoDe(descer(endNac, "CEP"));
    const cEndPost = textoDe(descer(endExt, "cEndPost"));

    return {
      doc: formatarCnpjCpf(
        textoDe(descer(raiz, "CNPJ")) || textoDe(descer(raiz, "CPF")) || textoDe(descer(raiz, "NIF"))
      ),
      IM: textoDe(descer(raiz, "IM")),
      fone: textoDe(descer(raiz, "fone")),
      xNome: textoDe(descer(raiz, "xNome")),
      // ⚠ `cMun` é CÓDIGO IBGE e a NT manda imprimir a DESCRIÇÃO dele. A tabela do IBGE não está
      // no projeto (registrado no CLAUDE.md da raiz: "o de-para nome→IBGE exige a tabela do IBGE,
      // que não temos"). Imprimimos o código; o gerador reporta em `municipiosNaoResolvidos`.
      municipio: xCidade || cMun,
      municipioEhCodigoIbge: Boolean(!xCidade && cMun),
      ibgeCep: juntar([cMun, cep ? formatarCep(cep) : cEndPost]),
      endereco: logradouro,
      email: textoDe(descer(raiz, "email")),
      presente: Boolean(raiz && (textoDe(descer(raiz, "CNPJ")) || textoDe(descer(raiz, "CPF")) ||
        textoDe(descer(raiz, "NIF")) || textoDe(descer(raiz, "xNome")))),
      _endereco: endereco,
    };
  };

  return { t, n, DPS, pessoa, infNFSe };
}

/** §2.1.1 — a chave é o `Id` de `infNFSe`, sem o prefixo "NFS", em bloco único de 50 dígitos. */
export function extrairChaveAcesso(infNFSe) {
  if (!infNFSe || typeof infNFSe.getAttribute !== "function") return null;
  const id = infNFSe.getAttribute("Id") || infNFSe.getAttribute("id");
  if (!id) return null;
  const digitos = String(id).replace(/^NFS/i, "").replace(/\D+/g, "");
  return digitos || null;
}

/**
 * Lê o XML da NFS-e e devolve o valor de cada campo do DANFSe.
 *
 * @param {string} xml XML da NFS-e (o documento que VOLTA, não a DPS).
 * @returns {{valores, meta, avisos}}
 */
export function lerNfse(xml) {
  if (!xml || !String(xml).trim()) {
    const erro = new Error("XML da NFS-e vazio.");
    erro.code = "DANFSE_XML_VAZIO";
    throw erro;
  }

  const doc = new DOMParser().parseFromString(String(xml), "text/xml");
  const raiz = doc.documentElement;
  const infNFSe = filhosPorNome(raiz, "infNFSe")[0] || (raiz && String(raiz.localName || raiz.nodeName) === "infNFSe" ? raiz : null);

  if (!infNFSe) {
    // ⚠ Recusa em vez de imprimir um documento em branco. Sem `infNFSe` isto não é uma NFS-e —
    // pode ser uma DPS, um evento, ou um XML de outro provedor. Um DANFSe vazio circularia como
    // se fosse válido.
    const erro = new Error(
      "O XML não tem o elemento `infNFSe`. O DANFSe representa a NFS-e (o documento que volta do " +
      "sistema nacional, com chave, número e dhProc) — uma DPS ou um evento não servem de entrada."
    );
    erro.code = "DANFSE_XML_NAO_E_NFSE";
    throw erro;
  }

  const { t, n, DPS, pessoa } = contexto(infNFSe);
  const avisos = [];

  const chave = extrairChaveAcesso(infNFSe);
  if (chave && chave.length !== 50) {
    // ⚠ Não corrigimos nem completamos: só registramos. §2.1.1 diz "50 dígitos"; chave com outro
    // comprimento é sinal de XML fora do padrão, e inventar dígito é falsificar chave de acesso.
    avisos.push(
      `Chave de acesso com ${chave.length} dígitos — a NT §2.1.1 prevê 50. Impressa como está.`
    );
  }

  const prest = pessoa(`${DPS}/prest`);
  const toma = pessoa(`${DPS}/toma`);
  const dest = pessoa(`${DPS}/IBSCBS/dest`);
  const interm = pessoa(`${DPS}/interm`);

  // ⚠ ACHADO A CONFERIR COM O DONO — ver o relatório em `gerarDanfse.js`.
  // A NT aponta NOME e ENDEREÇO do prestador para `DPS/infDPS/prest/`, mas numa NFS-e devolvida
  // pelo sistema nacional esses dados vivem em `infNFSe/emit` (a DPS enviada não repete o cadastro
  // do emitente). Na amostra versionada, `prest` tem só CNPJ, fone e regTrib. **Não caímos para
  // `emit` por conta própria**: isso seria criar regra de leiaute. O campo sai com traço e a
  // divergência é reportada.
  const emitNome = textoDe(descer(infNFSe, "emit/xNome"));
  if (!prest.xNome && emitNome) {
    avisos.push(
      "NOME do prestador ausente em `DPS/infDPS/prest/xNome` (o caminho que a NT §2.4.5 indica), " +
      "mas presente em `infNFSe/emit/xNome`. Impresso com traço, conforme a nota 12 — usar `emit` " +
      "seria inventar caminho de leiaute. Decisão do dono."
    );
  }

  const tpRetPisCofins = t(`${DPS}/valores/trib/tribFed/piscofins/tpRetPisCofins`);
  const vPisBruto = t(`${DPS}/valores/trib/tribFed/piscofins/vPis`);
  const vCofinsBruto = t(`${DPS}/valores/trib/tribFed/piscofins/vCofins`);
  const vRetCSLL = t(`${DPS}/valores/trib/tribFed/vRetCSLL`);
  const pisCofinsRetido = String(tpRetPisCofins || "").trim() === "1";

  // §2.4.5, regra alterada na v1.02 da NT: com `tpRetPisCofins = 1`, PIS e COFINS de apuração
  // própria saem ZERADOS e o valor deles entra em "Contribuições Sociais - Retidas".
  const somaContribRetidas = pisCofinsRetido
    ? [vRetCSLL, vPisBruto, vCofinsBruto]
        .map((v) => Number(String(v ?? 0).replace(",", ".")) || 0)
        .reduce((a, b) => a + b, 0)
    : null;

  const valores = {
    // ── CABEÇALHO ──
    municipio: juntar([t("xLocEmi"), t("emit/enderNac/UF")]),
    ambGer: t("ambGer"),
    tpAmb: t(`${DPS}/tpAmb`),

    // ── DADOS DA NFS-e ──
    chaveAcesso: chave,
    nNFSe: t("nNFSe"),
    dCompet: formatarData(t(`${DPS}/dCompet`)),
    dhProc: formatarDataHora(t("dhProc")),
    nDPS: t(`${DPS}/nDPS`),
    serie: t(`${DPS}/serie`),
    dhEmi: formatarDataHora(t(`${DPS}/dhEmi`)),
    tpEmit: t(`${DPS}/tpEmit`),
    cStat: t("cStat"),
    finNFSe: t(`${DPS}/IBSCBS/finNFSe`),

    // ── PRESTADOR ──
    prestDoc: prest.doc,
    prestIM: prest.IM,
    prestFone: prest.fone,
    prestNome: prest.xNome,
    prestMunicipio: prest.municipio,
    prestIbgeCep: prest.ibgeCep,
    prestEndereco: prest.endereco,
    prestEmail: prest.email,
    opSimpNac: t(`${DPS}/prest/regTrib/opSimpNac`),
    regApTribSN: t(`${DPS}/prest/regTrib/regApTribSN`),

    // ── TOMADOR ──
    tomaDoc: toma.doc,
    tomaIM: toma.IM,
    tomaFone: toma.fone,
    tomaNome: toma.xNome,
    tomaMunicipio: toma.municipio,
    tomaIbgeCep: toma.ibgeCep,
    tomaEndereco: toma.endereco,
    tomaEmail: toma.email,

    // ── DESTINATÁRIO (grupo IBSCBS — inexistente no leiaute 1.01) ──
    destDoc: dest.doc,
    destFone: dest.fone,
    destNome: dest.xNome,
    destMunicipio: dest.municipio,
    destIbgeCep: dest.ibgeCep,
    destEndereco: dest.endereco,
    destEmail: dest.email,

    // ── INTERMEDIÁRIO ──
    intermDoc: interm.doc,
    intermIM: interm.IM,
    intermFone: interm.fone,
    intermNome: interm.xNome,
    intermMunicipio: interm.municipio,
    intermIbgeCep: interm.ibgeCep,
    intermEndereco: interm.endereco,
    intermEmail: interm.email,

    // ── SERVIÇO ──
    cTrib: juntar([t(`${DPS}/serv/cServ/cTribNac`), t("cTribMun") || t(`${DPS}/serv/cServ/cTribMun`)]),
    cNBS: t(`${DPS}/serv/cServ/cNBS`),
    locPrest: juntar([t("xLocPrestacao"), t(`${DPS}/serv/locPrest/cPaisPrestacao`)]),
    // SE xTribMun <> "" ENTAO Descrição Municipal SENAO Descrição Nacional (§2.4.5).
    xTrib: t("xTribMun") || t("xTribNac"),
    xDescServ: t(`${DPS}/serv/cServ/xDescServ`),

    // ── ISSQN ──
    tribISSQN: t(`${DPS}/valores/trib/tribMun/tribISSQN`),
    locIncid: juntar([t("xLocIncid"), t(`${DPS}/valores/trib/tribMun/cPaisResult`)]),
    regEspTrib: t(`${DPS}/prest/regTrib/regEspTrib`),
    tpImunidade: t(`${DPS}/valores/trib/tribMun/tpImunidade`),
    tpSusp: t(`${DPS}/valores/trib/tribMun/exigSusp/tpSusp`),
    nProcesso: t(`${DPS}/valores/trib/tribMun/exigSusp/nProcesso`),
    tpBM: t("valores/tpBM"),
    vCalcBM: formatarValor(t("valores/vCalcBM") || t(`${DPS}/valores/trib/tribMun/BM/vRedBCBM`)),
    vDedRed: formatarValor(t(`${DPS}/valores/vDedRed/vDR`) || t("valores/vCalcDR")),
    vDescIncondIssqn: formatarValor(t(`${DPS}/valores/vDescCondIncond/vDescIncond`)),
    vBC: formatarValor(t("valores/vBC")),
    pAliqAplic: formatarValor(t("valores/pAliqAplic")),
    tpRetISSQN: t(`${DPS}/valores/trib/tribMun/tpRetISSQN`),
    vISSQN: formatarValor(t("valores/vISSQN")),

    // ── FEDERAL (exceto CBS) ──
    vRetIRRF: formatarValor(t(`${DPS}/valores/trib/tribFed/vRetIRRF`)),
    vRetCP: formatarValor(t(`${DPS}/valores/trib/tribFed/vRetCP`)),
    contribSociaisRetidas: pisCofinsRetido ? formatarValor(somaContribRetidas) : formatarValor(vRetCSLL),
    vPis: pisCofinsRetido ? formatarValor(0) : formatarValor(vPisBruto),
    vCofins: pisCofinsRetido ? formatarValor(0) : formatarValor(vCofinsBruto),
    tpRetPisCofins,

    // ── IBS / CBS (grupos inexistentes no leiaute 1.01) ──
    cstCClassTrib: juntar([
      t(`${DPS}/IBSCBS/valores/trib/gIBSCBS/CST`),
      t(`${DPS}/IBSCBS/valores/trib/gIBSCBS/cClassTrib`),
    ]),
    indOpIncid: juntar([
      t(`${DPS}/IBSCBS/cIndOp`),
      t("IBSCBS/cLocalidadeIncid"),
      t("IBSCBS/xLocalidadeIncid"),
    ]),
    exclusoesReducoesBc: (() => {
      const parcelas = [
        t(`${DPS}/valores/vDescCondIncond/vDescIncond`),
        t("IBSCBS/valores/vCalcReeRepRes"),
        t("valores/vISSQN"),
        vPisBruto,
        vCofinsBruto,
      ].map((v) => (v == null ? null : Number(String(v).replace(",", "."))));
      // Somatório só existe se ao menos uma parcela existir — senão o campo é ausente, não zero.
      if (parcelas.every((v) => v == null || Number.isNaN(v))) return null;
      return formatarValor(parcelas.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
    })(),
    bcAposExclusoes: formatarValor(t("IBSCBS/valores/vBC")),
    redAliq: juntar([
      t("IBSCBS/valores/uf/pRedAliqUF"),
      t("IBSCBS/valores/mun/pRedAliqMun"),
      t("IBSCBS/valores/fed/pRedAliqCBS"),
    ]),
    aliqIbs: juntar([t("IBSCBS/valores/uf/pIBSUF"), t("IBSCBS/valores/mun/pIBSMun")]),
    pAliqEfetMun: t("IBSCBS/valores/mun/pAliqEfetMun"),
    vIBSMun: formatarValor(t("IBSCBS/totCIBS/gIBS/gIBSMunTot/vIBSMun")),
    pAliqEfetUF: t("IBSCBS/valores/uf/pAliqEfetUF"),
    vIBSUF: formatarValor(t("IBSCBS/totCIBS/gIBS/gIBSUFTot/vIBSUF")),
    vIBSTot: formatarValor(t("IBSCBS/totCIBS/gIBS/vIBSTot")),
    pCBS: t("IBSCBS/valores/fed/pCBS"),
    pAliqEfetCBS: t("IBSCBS/valores/fed/pAliqEfetCBS"),
    vCBS: formatarValor(t("IBSCBS/totCIBS/gCBS/vCBS")),

    // ── VALOR TOTAL ──
    vServ: formatarValor(t(`${DPS}/valores/vServPrest/vServ`)),
    vDescIncond: formatarValor(t(`${DPS}/valores/vDescCondIncond/vDescIncond`)),
    vDescCond: formatarValor(t(`${DPS}/valores/vDescCondIncond/vDescCond`)),
    vTotalRet: formatarValor(t("valores/vTotalRet")),
    vLiq: formatarValor(t("valores/vLiq")),
    totalIbsCbs: (() => {
      const a = t("IBSCBS/totCIBS/gIBS/vIBSTot");
      const b = t("IBSCBS/totCIBS/gCBS/vCBS");
      if (a == null && b == null) return null;
      return formatarValor((Number(a || 0) || 0) + (Number(b || 0) || 0));
    })(),
    vTotNF: formatarValor(t("IBSCBS/totCIBS/vTotNF")),

    // ── CANHOTO ──
    dataCientificacao: null,        // preenchimento manual — não vem do XML
    identificacaoAssinatura: null,  // idem
    canhotoNumeroChave: juntar([t("nNFSe"), chave]),
  };

  valores.infoComplementares = montarInfoComplementares(infNFSe, { t, DPS });

  return {
    valores,
    avisos,
    meta: {
      chave,
      // §2 — a expressão "NFS-e SEM VALIDADE JURÍDICA" depende SÓ disto.
      homologacao: String(valores.tpAmb || "").trim() === "2",
      cStat: valores.cStat,
      // Blocos que o §2.3 permite condensar numa frase única.
      tomadorIdentificado: toma.presente,
      destinatarioIdentificado: dest.presente,
      intermediarioIdentificado: interm.presente,
      // A NT não define como se descobre "não sujeita ao ISSQN" a partir do XML — ver o gerador.
      tribISSQN: valores.tribISSQN,
      chaveSubstituida: textoDe(descer(infNFSe, `${DPS}/subst/chSubstda`)),
      municipiosNaoResolvidos: [
        prest.municipioEhCodigoIbge ? "prestMunicipio" : null,
        toma.municipioEhCodigoIbge ? "tomaMunicipio" : null,
        dest.municipioEhCodigoIbge ? "destMunicipio" : null,
        interm.municipioEhCodigoIbge ? "intermMunicipio" : null,
      ].filter(Boolean),
    },
  };
}

/**
 * §2.4.5 — "União de todos os campos de informações complementares", na ordem que a NT fixa,
 * separados por pipes, com a linha de Totais Aproximados **obrigatória** (nota 10).
 */
function montarInfoComplementares(infNFSe, { t, DPS }) {
  const origem = {
    xInfComp: t(`${DPS}/serv/infoCompl/xInfComp`),
    chSubstda: t(`${DPS}/subst/chSubstda`),
    docRef: t(`${DPS}/serv/infoCompl/docRef`),
    cObra: t(`${DPS}/serv/obra/cObra`),
    inscImobFisc: t(`${DPS}/IBSCBS/imovel/inscImobFisc`),
    idAtvEvt: t(`${DPS}/serv/atvEvento/idAtvEvt`),
    idDocTec: t(`${DPS}/serv/infoCompl/idDocTec`),
    xPed: t(`${DPS}/serv/infoCompl/xPed`),
    xItemPed: t(`${DPS}/serv/infoCompl/gItemPed/xItemPed`),
    xOutInf: t(`${DPS}/serv/infoCompl/xOutInf`),
  };

  const partes = ORDEM_INFO_COMPLEMENTARES
    .filter((item) => origem[item.tag] != null && String(origem[item.tag]).trim() !== "")
    .map((item) => `${item.rotulo} ${String(origem[item.tag]).trim()}`);

  // Nota 10 — obrigatória, e a NT dá a forma. Valores OU percentuais: o leiaute traz `vTotTrib*`
  // (monetário) ou `pTotTrib*` (percentual); imprimimos o que existir, com o símbolo certo.
  const base = `${DPS}/valores/trib/totTrib`;
  const v = {
    fed: t(`${base}/vTotTrib/vTotTribFed`),
    est: t(`${base}/vTotTrib/vTotTribEst`),
    mun: t(`${base}/vTotTrib/vTotTribMun`),
  };
  const p = {
    fed: t(`${base}/pTotTrib/pTotTribFed`),
    est: t(`${base}/pTotTrib/pTotTribEst`),
    mun: t(`${base}/pTotTrib/pTotTribMun`),
  };

  const usaPercentual = p.fed != null || p.est != null || p.mun != null;
  const fonte = usaPercentual ? p : v;
  const marca = (valor) => {
    if (valor == null || String(valor).trim() === "") return TRACO_DE_AUSENCIA;
    const formatado = Number(String(valor).replace(",", "."))
      .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return usaPercentual ? `${formatado}%` : `R$ ${formatado}`;
  };

  const linhaTotais =
    `${TEXTOS.prefixoTotaisAproximados} Federais: ${marca(fonte.fed)} ; ` +
    `Estaduais: ${marca(fonte.est)} ; Municipais: ${marca(fonte.mun)}`;

  // ⚠ A linha de totais é FIXA e fica FORA do truncamento (a NT: "sem prejuízo à linha de Totais
  // Aproximados dos Tributos, que é fixa"). Só o resto encolhe.
  const corpo = partes.join(" | ");
  const espacoParaCorpo = Math.max(0, 1997 - linhaTotais.length - 3);
  const corpoTruncado = truncarComReticencias(corpo, espacoParaCorpo);

  return corpoTruncado ? `${corpoTruncado} | ${linhaTotais}` : linhaTotais;
}

/**
 * Aplica a nota 12 (traço para campo sem informação) e o truncamento com reticências do §2.1.
 * `codificado` passa pelo mapa de descrições — que hoje devolve o código cru, de propósito.
 */
export function valorParaImpressao(campo, valores) {
  const bruto = valores[campo.id];

  if (campo.codificado) {
    const { resolvido, texto, motivo } = descreverCodigo(campo.tag, bruto);
    if (!texto) return { texto: TRACO_DE_AUSENCIA, ausente: true, descricaoPendente: false };
    return {
      texto: truncarComReticencias(texto, campo.truncaEm),
      ausente: false,
      descricaoPendente: !resolvido,
      motivo,
    };
  }

  if (bruto == null || String(bruto).trim() === "") {
    return { texto: TRACO_DE_AUSENCIA, ausente: true, descricaoPendente: false };
  }

  return {
    texto: truncarComReticencias(String(bruto), campo.truncaEm),
    ausente: false,
    descricaoPendente: false,
  };
}

export const _internos = { descer, filhosPorNome, formatarData, formatarDataHora, formatarValor, BLOCOS };
