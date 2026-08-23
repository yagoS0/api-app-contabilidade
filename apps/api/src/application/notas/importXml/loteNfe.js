// CLASSIFICAÇÃO DE UM DOCUMENTO DO LOTE DO FISCO FÁCIL — puro, sem banco, sem rede.
//
// ⚠⚠ ESTE ARQUIVO EXISTE POR CAUSA DE UMA ARMADILHA MEDIDA, e ela anula a entrega inteira se
// passar. Em `dfe/DfeParser.js` o `papel` cai em `"DEST"` no ÚLTIMO RAMO dos DOIS caminhos
// (resNFe e procNFe): "nem emitente nem destinatário" e "eu sou o destinatário" saem com a MESMA
// resposta. No canal DFe isso é tolerável — a SEFAZ só distribui documento de interesse de quem
// consulta. Aqui NÃO É: o arquivo vem de uma PESSOA, que escolheu a empresa na tela e pode ter
// escolhido errado. Reaproveitar aquele default rotularia **nota de VENDA como compra** — e o
// problema que este import existe para resolver (47 NF-e na base, 100% recebidas, ZERO emitidas)
// continuaria exatamente igual, agora com um import por cima dizendo que deu certo.
//
// A REGRA AQUI: o `papel` sai da COMPARAÇÃO do `emit/CNPJ` com o CNPJ do cliente. Emitente bate →
// EMIT. Destinatário bate → DEST. **Nenhum dos dois bate → o documento é RECUSADO, com motivo.**
// Não existe caminho que produza `papel` sem uma igualdade de CNPJ tendo sido verdadeira.
//
// ⚠ POR ESTABELECIMENTO, e a raiz do CNPJ NÃO SERVE. A extração do Fisco Fácil não aceita raiz de
// CNPJ: empresa com filial gera um lote POR ESTABELECIMENTO. E no nosso schema cada estabelecimento
// é um `PortalClient` próprio (`cnpj` é `@unique`; não há coluna de filial, medido em
// `schema.prisma`). Então subir o lote da filial dentro da matriz é um erro possível e frequente —
// e ele tem motivo PRÓPRIO (`outro_estabelecimento`), não o genérico: "esta nota é do CNPJ
// XX.XXX.XXX/0002-YY e você a subiu no /0001-ZZ" é acionável; "não pertence" manda o dono procurar
// defeito onde não há.

import { parseDocZip } from "../dfe/DfeParser.js";

/** Vocabulário FECHADO dos motivos — a tela e os testes leem daqui, ninguém escreve string solta. */
export const MOTIVO = {
  EVENTO: "evento",
  MODELO_65: "modelo_65_nfce",
  OUTRO_MODELO: "outro_modelo",
  OUTRO_DOCUMENTO: "outro_documento",
  NAO_E_XML: "nao_e_xml",
  XML_ILEGIVEL: "xml_ilegivel",
  SEM_CHAVE: "sem_chave_de_acesso",
  RESUMO_SEM_TITULARIDADE: "resumo_sem_titularidade",
  NOTA_NAO_PERTENCE: "nota_nao_pertence",
  OUTRO_ESTABELECIMENTO: "outro_estabelecimento",
  // ⚠ ZIP DENTRO DE ZIP — NÃO ABRIMOS, e isso é decisão, não esquecimento. A documentação do
  // Fisco Fácil diz "um ou mais arquivos ZIP", o que descreve VÁRIOS zips entregues lado a lado
  // (e esses o import aceita, todos de uma vez); ela não diz nada sobre aninhamento. Desaninhar
  // por conta seria inventar o formato. Se aparecer, sai CONTADO e com este nome — o dono vê
  // "ignoradas 3 (zip aninhado)" e sabe exatamente o que pedir, em vez de ver um lote vazio.
  ZIP_ANINHADO: "zip_aninhado",
  ENTRADA_ILEGIVEL: "entrada_ilegivel",
};

// ⚠ `resnfe` ESTÁ AQUI DE PROPÓSITO, e a ausência dele era defeito. O resumo é NF-e — só que sem o
// XML completo. Fora desta lista ele caía em `OUTRO_DOCUMENTO` ("não é nota fiscal"), e com isso o
// ramo `RESUMO_SEM_TITULARIDADE` — que existe justamente para NÃO presumir `DEST` num resumo de
// emitente que não é a empresa — era INALCANÇÁVEL. O lote do Fisco Fácil pode trazer resumo junto,
// e "ignorado porque não é nota" mentiria sobre o motivo.
const RAIZES_NFE = new Set(["nfeproc", "procnfe", "nfe", "resnfe"]);
const RAIZES_EVENTO = new Set([
  "proceventonfe", "resevento", "enveventonfe", "retenveventonfe", "eventonfe", "evento",
]);

export function apenasDigitos(valor) {
  return String(valor || "").replace(/\D+/g, "");
}

/** Raiz do CNPJ (os 8 primeiros dígitos) — o que matriz e filial têm em comum. */
export function raizCnpj(cnpj) {
  const d = apenasDigitos(cnpj);
  return d.length >= 8 ? d.slice(0, 8) : null;
}

/**
 * Nome do elemento raiz. Usado só para ESCOLHER o ramo do parser — nenhum dado sai daqui.
 * Prólogo (`<?xml ?>`), comentários e DOCTYPE são descartados antes.
 */
export function raizDoXml(xml) {
  if (typeof xml !== "string") return null;
  const limpo = xml
    .replace(/^﻿/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");
  const m = limpo.match(/<\s*(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/);
  return m ? m[1] : null;
}

/**
 * Decide o que fazer com UM documento do lote.
 *
 * @returns
 *   { decisao: "importar", papel, chaveAcesso, modelo, parsed, items }
 *   { decisao: "ignorar",  motivo, detalhe }   ← veio junto no ZIP e não é nota nossa de NF-e
 *   { decisao: "recusar",  motivo, detalhe }   ← É uma NF-e, mas não é desta empresa
 *
 * ⚠ IGNORAR ≠ RECUSAR, e a diferença é do dono, não estética. "Ignorada" é o que o Fisco Fácil
 * manda junto por natureza (eventos, NFC-e) — esperado, não é erro. "Recusada" é nota de OUTRA
 * empresa dentro do lote: ou o lote está no cliente errado, ou o extrator trouxe o que não devia.
 * A primeira é ruído; a segunda pede ação.
 */
export function classificarDocumentoDoLote(xml, { cnpjEmpresa } = {}) {
  const empresa = apenasDigitos(cnpjEmpresa);
  if (!xml || typeof xml !== "string" || !xml.trim().startsWith("<")) {
    return { decisao: "ignorar", motivo: MOTIVO.NAO_E_XML, detalhe: null };
  }

  const raiz = String(raizDoXml(xml) || "").toLowerCase();

  if (RAIZES_EVENTO.has(raiz)) {
    // ⚠ EVENTO NÃO DERRUBA O LOTE — e também NÃO é aplicado aqui. Ver o cabeçalho de
    // `ImportNfeLoteService.js`: o cancelamento que vem no ZIP é CONTADO e nomeado, nunca calado.
    const r = seguro(() => parseDocZip({ schema: "procEventoNFe", xml }, { companyCnpj: empresa }));
    return {
      decisao: "ignorar",
      motivo: MOTIVO.EVENTO,
      detalhe: r?.action || null,
      chaveAcesso: r?.chaveAcesso || null,
      tpEvento: r?.tpEvento || null,
    };
  }

  if (!RAIZES_NFE.has(raiz)) {
    return { decisao: "ignorar", motivo: MOTIVO.OUTRO_DOCUMENTO, detalhe: raiz || null };
  }

  // `parseDocZip` despacha por prefixo de schema OU por elemento raiz. `<NFe>` puro (sem
  // `nfeProc`) só entra pelo prefixo — daí a dica explícita.
  const r = seguro(() => parseDocZip({ schema: "procNFe", xml }, { companyCnpj: empresa }));
  if (!r || r.type === "error" || r.type === "unknown") {
    return { decisao: "ignorar", motivo: MOTIVO.XML_ILEGIVEL, detalhe: r?.error || raiz };
  }

  const modelo = String(r.modelo || "");
  if (modelo && modelo !== "55") {
    // ⚠ NFC-e (65) é venda TAMBÉM, e ela vem junto no lote do varejo. Ignorar aqui é o pedido do
    // dono para ESTA entrega — mas ignorar EM SILÊNCIO seria o defeito de sempre. Ela sai contada,
    // com o modelo no motivo, para o dono decidir se quer o modelo 65 na próxima volta.
    return {
      decisao: "ignorar",
      motivo: modelo === "65" ? MOTIVO.MODELO_65 : MOTIVO.OUTRO_MODELO,
      detalhe: modelo,
      chaveAcesso: r.chaveAcesso || null,
    };
  }

  if (!r.chaveAcesso) {
    return { decisao: "ignorar", motivo: MOTIVO.SEM_CHAVE, detalhe: null };
  }

  const emit = apenasDigitos(r.emitCnpj);
  const dest = apenasDigitos(r.destCnpj);

  // ═══ O PAPEL, E ELE NÃO TEM DEFAULT ═══════════════════════════════════════════════════════
  let papel = null;
  if (empresa && emit && emit === empresa) papel = "EMIT";
  else if (empresa && dest && dest === empresa) papel = "DEST";

  if (!papel) {
    // resNFe é RESUMO: não traz destinatário nenhum (`destCnpj` é sempre nulo). Se o emitente não
    // é a empresa, não há no documento nada que PROVE que ela é a destinatária — e num arquivo
    // que veio de uma pessoa, presumir DEST é justamente o default proibido. Fica ignorado e
    // nomeado: o resumo não traz o XML da nota, então não há o que auditar mesmo.
    if (r.type === "nfe_summary") {
      return { decisao: "ignorar", motivo: MOTIVO.RESUMO_SEM_TITULARIDADE, detalhe: emit || null, chaveAcesso: r.chaveAcesso };
    }
    const raizEmpresa = raizCnpj(empresa);
    const mesmaRaiz = Boolean(raizEmpresa) && (raizCnpj(emit) === raizEmpresa || raizCnpj(dest) === raizEmpresa);
    return {
      decisao: "recusar",
      motivo: mesmaRaiz ? MOTIVO.OUTRO_ESTABELECIMENTO : MOTIVO.NOTA_NAO_PERTENCE,
      detalhe: emit || dest || null,
      chaveAcesso: r.chaveAcesso,
    };
  }

  return {
    decisao: "importar",
    papel,
    chaveAcesso: r.chaveAcesso,
    modelo: modelo || null,
    // ⚠ O `papel` do parser é SOBRESCRITO pelo medido — de propósito e nos dois lugares (o objeto
    // que vai para o banco e o topo). Deixar o do parser passar é a armadilha inteira.
    parsed: { ...r.parsed, papel },
    items: r.items || [],
  };
}

function seguro(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
