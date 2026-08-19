// O DANFSe DE UMA NOTA QUE ESTÁ NO BANCO — o serviço que as DUAS portas chamam.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE (19/08/2026). `gerarDanfse(xml)` é puro: ele recebe o XML e devolve
// o PDF. Tudo o que vem ANTES dele — achar a nota, recusar quando não há XML, e decidir a MARCA
// D'ÁGUA a partir do ciclo — morava dentro da rota do escritório
// (`routes/firm/notas.js`, `GET /notas/:notaId/danfse`). Quando o app do CLIENTE ganhou a mesma
// porta, havia dois caminhos: repetir aquelas ~40 linhas no `/client`, ou extraí-las para cá.
//
// Repetir é o defeito que este projeto já nomeou duas vezes: em `ingestaoNfse.js` ("a segunda
// implementação criava linha duplicada") e na fachada de emissão do cliente ("as duas portas
// discordariam na primeira correção, e a que o cliente usa é a que ninguém do escritório testa").
// A marca d'água é exatamente o tipo de regra que divergiria em silêncio: o cliente veria um PDF
// sem "CANCELADA" e o contador veria com, sobre a MESMA nota.
//
// ⚠ NADA DE HTTP MORA AQUI. Este módulo lança erros com `code`; quem traduz para status é
// `routes/danfseHttp.js`, consumido pelas duas portas — mesmo desenho de `nfseEmissaoHttp.js`.
//
// ⚠ MULTI-TENANCY: a busca é SEMPRE `{ id: notaId, clientId: portalClientId }`. O `portalClientId`
// vem do PATH, já conferido pelo middleware da porta (`requireFirmCompanyAccess` /
// `requireClientCompanyAccess`). Nunca só por `id`.
//
// ⚠ O PDF É GERADO SOB DEMANDA E NUNCA SALVO — não há cache a limpar. O porquê (derivável do
// `xmlRaw` + volume efêmero do Railway) está escrito na rota do escritório e em `apps/api/CLAUDE.md`.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { derivarCiclo } from "../../notas/cicloNota.js";
import { gerarDanfse } from "./gerarDanfse.js";

/** Códigos que este serviço lança. Os de `gerarDanfse` (DANFSE_SEM_QRCODE, …) sobem sem tradução. */
export const DANFSE_ERRO = Object.freeze({
  NOTA_NAO_ENCONTRADA: "DANFSE_NOTA_NAO_ENCONTRADA",
  XML_INDISPONIVEL: "DANFSE_XML_INDISPONIVEL",
});

function erro(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * O nome do arquivo: chave → número → id, com os mesmos caracteres removidos que a tela espera
 * (`apps/web/src/features/notas/lib/danfseDaNota.js#nomeDoArquivoDanfse`). Está aqui, e não na
 * rota, porque as duas portas têm de escrever o MESMO `Content-Disposition`.
 */
export function nomeDoArquivoDanfse(nota) {
  const base = String(nota?.chaveAcesso || nota?.numero || nota?.id || "nota").replace(/[^\w.-]/g, "");
  return `danfse-${base || "nota"}.pdf`;
}

/**
 * Gera o DANFSe de uma `PortalInvoice`.
 *
 * @param {Object} params
 * @param {string} params.portalClientId  `PortalClient.id` — multi-tenancy, vem do PATH
 * @param {string} params.notaId          `PortalInvoice.id`
 * @param {boolean} [params.incluirCanhoto=false]
 * @param {Object} [params.client=prisma]
 * @returns {Promise<{pdf: Buffer, conformidade: Object, nomeArquivo: string, marcaDagua: string|null}>}
 * @throws {Error} com `code` = `DANFSE_NOTA_NAO_ENCONTRADA` | `DANFSE_XML_INDISPONIVEL` |
 *   `DANFSE_SEM_QRCODE` | `DANFSE_XML_NAO_E_NFSE` | `DANFSE_XML_VAZIO`
 */
export async function gerarDanfseDaNota({
  portalClientId,
  notaId,
  incluirCanhoto = false,
  client = prisma,
} = {}) {
  const clientId = String(portalClientId || "");
  const id = String(notaId || "");

  const nota = await client.portalInvoice.findFirst({
    where: { id, clientId },
    select: {
      id: true, numero: true, chaveAcesso: true, chaveSubstituida: true,
      status: true, statusEfetivo: true, xmlRaw: true,
    },
  });
  if (!nota) {
    throw erro(DANFSE_ERRO.NOTA_NAO_ENCONTRADA, "Nota não encontrada nesta empresa.");
  }

  if (!nota.xmlRaw) {
    throw erro(
      DANFSE_ERRO.XML_INDISPONIVEL,
      "Esta nota não tem o XML guardado, e o DANFSe é gerado a partir dele — nada aqui é " +
      "inventado. Recapture a nota para que o XML entre na base.",
    );
  }

  // ⚠ A MARCA D'ÁGUA VEM DO CICLO DA NOTA, NUNCA DO `chSubstda` DO XML. `chSubstda` diz "eu
  // substituo AQUELA"; quem responde "esta foi substituída" é o evento (ou outra nota apontando
  // para esta) — a mesma distinção que o `NotaDetailModal` já errou uma vez.
  const eventos = await client.portalInvoiceEvent.findMany({
    where: { clientId, invoiceId: nota.id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { type: true, chaveSubstituta: true },
  });
  const substituta = nota.chaveAcesso
    ? await client.portalInvoice.findFirst({
        where: { clientId, chaveSubstituida: nota.chaveAcesso },
        select: { chaveAcesso: true },
      })
    : null;
  const ciclo = derivarCiclo({
    nota,
    evento: eventos.find((e) => e.type === "canc_por_substituicao") || eventos[eventos.length - 1] || null,
    substituta,
  });
  const marcaDagua =
    ciclo?.situacao === "substituida" ? "SUBSTITUIDA"
    : ciclo?.situacao === "cancelada" ? "CANCELADA"
    : null;

  // ⚠ O QR CODE É OBRIGATÓRIO (NT 008 §2.2 e §2.4.3). Quando ele não sai, `gerarDanfse` lança
  // `DANFSE_SEM_QRCODE` e o erro SOBE — não existe caminho aqui que devolva PDF sem QR. Um DANFSe
  // sem QR Code não é um DANFSe: servi-lo em silêncio faria o tomador receber documento inválido.
  const { pdf, conformidade } = await gerarDanfse({
    xml: nota.xmlRaw,
    marcaDagua,
    incluirCanhoto: Boolean(incluirCanhoto),
  });

  return { pdf, conformidade, marcaDagua, nomeArquivo: nomeDoArquivoDanfse(nota) };
}
