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
import { lerEnvelopeXml, raizDoXml } from "../lerEnvelopeXml.js";
import { gerarDanfse } from "./gerarDanfse.js";

/** Códigos que este serviço lança. Os de `gerarDanfse` (DANFSE_SEM_QRCODE, …) sobem sem tradução. */
export const DANFSE_ERRO = Object.freeze({
  NOTA_NAO_ENCONTRADA: "DANFSE_NOTA_NAO_ENCONTRADA",
  XML_INDISPONIVEL: "DANFSE_XML_INDISPONIVEL",
  // ⚠ A nota que NÓS emitimos e o sistema nacional RECUSOU guarda, na mesma coluna, a DPS que
  // enviamos — não a NFS-e. Medido em produção: as 3 `rejected` têm raiz `DPS`, as 3 `issued` têm
  // raiz `NFSe`. Um código próprio porque o conserto é outro: não é "recapture", é "esta nota não
  // existe no sistema nacional".
  XML_E_O_PEDIDO: "DANFSE_XML_E_O_PEDIDO",
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

  // ═══ A NOTA QUE ACABAMOS DE EMITIR AINDA NÃO É UMA `PortalInvoice` ═══════════════════════════
  //
  // > Dono, 24/08/2026: *"ao emitir a nota pelo portal do cliente preciso que a DANFE esteja
  // > imediatamente disponível"*.
  //
  // A emissão grava **`ServiceInvoice`**; `PortalInvoice` é a projeção do ADN e só existe depois da
  // captura. Entre um e outro o `notaId` que a lista mostra é um `ServiceInvoice.id`, e esta rota
  // respondia 404 — por isso a tela desabilitava o botão (`confirmadaPeloAdn === false`).
  //
  // ⚠⚠ **A SAÍDA NÃO É GRAVAR `PortalInvoice` NA EMISSÃO** — está proibido, com motivo longo, em
  // `apps/api/CLAUDE.md` ("uma quarta escrita criaria linha que a captura não sabe que existe", e o
  // encontro das duas já produziu **faturamento somado duas vezes**). A saída é LER também do outro
  // lado, que é a mesma disciplina da união na leitura de `notasEmitidasNaoConfirmadas.js`.
  //
  // ⚠ **O XML DA NFS-e AUTORIZADA JÁ ESTÁ GUARDADO.** `NfseService.js:1775` grava
  // `response.nfseXmlGZipB64 || rawXml` em `ServiceInvoice.xml`. Medido em produção
  // (`scripts/diag-danfse-na-emissao.mjs`): das notas `issued`/`cancelled`, **5 de 5** têm o
  // envelope `GZIP_B64` com raiz `NFSe` e `infNFSe` presente. As `rejected` guardam a **DPS** — e é
  // exatamente por isso que existe `XML_E_O_PEDIDO`, abaixo.
  // ⚠⚠ O ESCOPO AQUI É OUTRO ID, E ELE PRECISA SER RESOLVIDO — é a SEXTA vez que esta confusão
  // aparece no projeto, e as cinco anteriores falharam em SILÊNCIO (`findMany` vazio, 200 na rota).
  // `ServiceInvoice.companyId` é o da `Company` LEGADA; o que chega no path é o `PortalClient.id`.
  // ⚠ E **não há relação Prisma** entre os dois: `PortalClient.companyId` é `String? @unique`, uma
  // coluna solta — `where: { company: { portalClient: … } }` não existe e nem compila. A volta é
  // esta, explícita.
  let nossa = null;
  if (!nota) {
    const portal = await client.portalClient.findUnique({
      where: { id: clientId },
      select: { companyId: true },
    });
    // ⚠ Sem `companyId` NÃO se busca. Cair para `where: { id }` sozinho serviria a nota de outra
    // empresa a quem soubesse o id — o furo de multi-tenancy que o `where` desta função existe
    // para fechar.
    if (portal?.companyId) {
      nossa = await client.serviceInvoice.findFirst({
        where: { id, companyId: portal.companyId },
        select: { id: true, numeroNfse: true, chaveAcesso: true, status: true, xml: true },
      });
    }
  }

  if (!nota && !nossa) {
    throw erro(DANFSE_ERRO.NOTA_NAO_ENCONTRADA, "Nota não encontrada nesta empresa.");
  }

  if (nossa) return await danfseDaNossaEmissao({ nota: nossa, incluirCanhoto });

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

/**
 * O DANFSe de uma nota que NÓS acabamos de emitir e que o ADN ainda não devolveu.
 *
 * ⚠ NÃO É UM SEGUNDO GERADOR. Ela desembrulha o XML e chama o MESMO `gerarDanfse`, com as MESMAS
 * recusas. O que muda é só de onde vem o XML e como se decide a marca d'água — e as duas coisas
 * são mais simples aqui porque a nota tem horas de vida.
 */
async function danfseDaNossaEmissao({ nota, incluirCanhoto }) {
  const { forma, xml } = lerEnvelopeXml(nota.xml);

  if (!xml) {
    throw erro(
      DANFSE_ERRO.XML_INDISPONIVEL,
      "Esta nota foi emitida por aqui, mas o XML que o sistema nacional devolveu não pôde ser lido " +
      `(envelope ${forma}). O DANFSe é gerado a partir dele — nada aqui é inventado.`,
    );
  }

  // ⚠⚠ A RECUSA QUE SEPARA "A NOTA EXISTE" DE "O PEDIDO EXISTE". `NfseService.js:1775` grava
  // `response.nfseXmlGZipB64 || rawXml`: quando o sistema nacional RECUSA, o que sobra na coluna é
  // a **DPS que nós assinamos** — o pedido, não o documento. Ela não tem `nNFSe`, não tem chave e
  // não tem `infNFSe`, então não existe DANFSe dela. Medido em produção: as 3 `rejected` têm raiz
  // `DPS`; as 5 `issued`/`cancelled` têm raiz `NFSe`.
  //
  // ⚠ O código é PRÓPRIO porque o conserto é outro: não é "recapture", é "esta nota não existe no
  // sistema nacional — corrija e emita de novo". Cair no `DANFSE_XML_NAO_E_NFSE` genérico mandaria
  // o cliente procurar defeito na captura.
  if (raizDoXml(xml) !== "NFSe") {
    throw erro(
      DANFSE_ERRO.XML_E_O_PEDIDO,
      "Esta nota não chegou a ser autorizada pelo sistema nacional — o que está guardado é o " +
      "pedido de emissão (DPS), não a NFS-e. Não há DANFSe de um pedido recusado.",
    );
  }

  // ⚠ A MARCA D'ÁGUA VEM DO `status`, e a lista é FECHADA. Aqui não há `PortalInvoiceEvent` nem
  // nota substituta para consultar — a linha é NOSSA e tem horas de vida. `cancelled` é o único
  // estado que carimba; qualquer outro (inclusive um novo) sai SEM marca, que é o desenho: carimbar
  // por engano afirma um ato fiscal que não houve.
  //
  // ⚠ SUBSTITUÍDA não é alcançável por aqui, e isso é correto: quem responde "esta foi
  // substituída" é a OUTRA nota apontando para esta, e ela vem pelo ADN — quando vier, a nota
  // deixa de ser "não confirmada" e o caminho passa a ser o de cima, com `derivarCiclo`.
  const marcaDagua = String(nota.status || "").toLowerCase() === "cancelled" ? "CANCELADA" : null;

  const { pdf, conformidade } = await gerarDanfse({
    xml,
    marcaDagua,
    incluirCanhoto: Boolean(incluirCanhoto),
  });

  return {
    pdf,
    conformidade,
    marcaDagua,
    // ⚠ O contrato do nome de arquivo é o mesmo (`chave → número → id`), mas os CAMPOS têm outro
    // nome nesta tabela: `numeroNfse`, não `numero`. Passar a linha crua daria `danfse-<uuid>.pdf`
    // numa nota que TEM chave.
    nomeArquivo: nomeDoArquivoDanfse({
      chaveAcesso: nota.chaveAcesso,
      numero: nota.numeroNfse,
      id: nota.id,
    }),
  };
}
