// O ENVELOPE DO XML — gzip+base64, base64 puro, ou já plano. Módulo PURO (sem prisma, sem rede).
//
// O sistema nacional e o ADN devolvem o XML embrulhado, e o embrulho varia por campo e por
// endpoint (`nfseXmlGZipB64`, `dpsXmlGZipB64`, `xmlBase64`, `docZip`…). Quem lê precisa desembrulhar
// sem saber de antemão qual dos três chegou.
//
// ⚠⚠ ESTA LEITURA JÁ EXISTE EM QUATRO CÓPIAS, e este arquivo é o lugar para onde elas devem migrar:
//
//   application/nfse/AdnSyncService.js:82
//   application/notas/adn/AdnNotasService.js:89-92
//   application/notas/apuracao/v2/ConferenciaAdnService.js:30
//   application/notas/dfe/DfeParser.js:88
//
// ⚠ AS QUATRO NÃO FORAM TOCADAS NESTA ENTREGA, de propósito: são caminhos de CAPTURA, e mexer nelas
// para um conserto de DANFSe seria arriscar a ingestão de nota fiscal por uma refatoração que
// ninguém pediu. **Pendência nomeada**, não descuido — quem for unificá-las, comece por aqui e
// confira que `DfeParser` distingue `gunzip_failed` (ele devolve motivo, e o motivo é usado).
//
// ⚠ NÃO LANÇA. Envelope ilegível devolve `{ forma: "ILEGIVEL", xml: "" }` — quem chama decide o que
// fazer com a ausência. Uma exceção aqui derrubaria a listagem inteira por causa de uma linha.

import { gunzipSync } from "node:zlib";

/** De que forma o XML estava guardado. Vocabulário FECHADO. */
export const FORMA = Object.freeze({
  AUSENTE: "AUSENTE",
  PLANO: "PLANO",
  GZIP_B64: "GZIP_B64",
  B64: "B64",
  ILEGIVEL: "ILEGIVEL",
});

// ⚠ `<` por code point: literais `<` em scripts colados no shell do Windows viram redirecionamento,
// e este módulo é copiado para diagnósticos. Custa nada e evita um bug que já apareceu.
const ABRE = String.fromCharCode(60);

/**
 * Desembrulha o XML.
 *
 * @param {string|null|undefined} valor  o conteúdo guardado (`ServiceInvoice.xml`, `docZip`, …)
 * @returns {{ forma: string, xml: string }}
 */
export function lerEnvelopeXml(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return { forma: FORMA.AUSENTE, xml: "" };

  // Já veio plano — é o caso do `rawXml` (a DPS que NÓS assinamos) no fallback de `markIssued`.
  if (texto.startsWith(ABRE)) return { forma: FORMA.PLANO, xml: texto };

  let bruto;
  try {
    bruto = Buffer.from(texto, "base64");
  } catch {
    return { forma: FORMA.ILEGIVEL, xml: "" };
  }
  if (!bruto.length) return { forma: FORMA.ILEGIVEL, xml: "" };

  // ⚠ GZIP PRIMEIRO, base64 puro depois — a mesma ordem de `AdnNotasService.js:89`. Invertida, um
  // gzip válido seria lido como texto binário e passaria como "XML" que não abre com `<`.
  try {
    const descomprimido = gunzipSync(bruto).toString("utf-8").trim();
    if (descomprimido.startsWith(ABRE)) return { forma: FORMA.GZIP_B64, xml: descomprimido };
    return { forma: FORMA.ILEGIVEL, xml: "" };
  } catch {
    const texto64 = bruto.toString("utf-8").trim();
    return texto64.startsWith(ABRE)
      ? { forma: FORMA.B64, xml: texto64 }
      : { forma: FORMA.ILEGIVEL, xml: "" };
  }
}

/**
 * O nome do elemento raiz, sem prefixo de namespace. `null` quando não há XML legível.
 *
 * Serve para distinguir **o que foi guardado**: `NFSe` (o documento que o sistema nacional
 * autorizou) × `DPS` (o pedido que nós enviamos). Os dois moram na MESMA coluna
 * (`NfseService.js:1775` grava `response.nfseXmlGZipB64 || rawXml`), e só o primeiro serve para
 * gerar DANFSe — o DPS não tem `nNFSe`, nem chave, nem `infNFSe`.
 */
export function raizDoXml(xml) {
  if (typeof xml !== "string" || !xml) return null;
  const limpo = xml
    .replace(/^﻿/, "")
    .replace(new RegExp(`${ABRE}\\?[\\s\\S]*?\\?>`, "g"), "")
    .replace(new RegExp(`${ABRE}!--[\\s\\S]*?-->`, "g"), "")
    .replace(new RegExp(`${ABRE}!DOCTYPE[^>]*>`, "gi"), "");
  const m = limpo.match(new RegExp(`${ABRE}\\s*(?:[A-Za-z_][\\w.-]*:)?([A-Za-z_][\\w.-]*)`));
  return m ? m[1] : null;
}
