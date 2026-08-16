// DE ONDE SAI A SÉRIE E O NÚMERO DA DPS — A ÚLTIMA NOTA QUE EXISTE, NÃO A NOSSA CONTAGEM.
//
// ─── O PEDIDO DO DONO (16/08/2026) ──────────────────────────────────────────────────────────
//
// > *"sobre a série RPS, deve ser automática, devemos consultar a última nota emitida e extrair o
// > RPS dela, e colocar para emissão, nem sempre o usuário vai emitir pelo nosso portal, então
// > precisamos que isso seja feito automático."*
//
// O ponto é a segunda metade da frase. `Company.rpsNumero` conta **as nossas** emissões; o
// contribuinte emite também pelo Emissor Web, pelo app da prefeitura, por outro ERP. Essas notas
// chegam aqui pela captura do ADN (elas vivem em `PortalInvoice`, com o XML inteiro em `xmlRaw`) e
// **consumiram números da mesma série**. Continuar a partir do nosso contador reusaria número já
// emitido — que é a rejeição **E0014** ("Conjunto de Série, Número, Código do Município Emissor e
// CNPJ/CPF informado nesta DPS já existe").
//
// ─── ⚠ DE QUAL CAMPO DO XML, EXATAMENTE ─────────────────────────────────────────────────────
//
// Do leiaute transcrito em `danfse/danfseLeiaute.js` (NT 008 §2.4.5), bloco "DADOS DA NFS-e":
//
//   NÚMERO DA DPS ....... `NFSe/infNFSe/DPS/infDPS/` tag `nDPS`   (id `nDPS`,  max 15)
//   SÉRIE DA DPS ........ `NFSe/infNFSe/DPS/infDPS/` tag `serie`  (id `serie`, max 5)
//
// Não confundir com `NFSe/infNFSe/nNFSe`, que é o **número da NFS-e** (outro contador, do
// município/SEFIN) — é ele que `AdnXmlMetadata.parseXmlMetadata` extrai como `numeroNfse` e que
// `PortalInvoice.numero` guarda. Usá-lo como número de DPS misturaria dois contadores diferentes.
//
// ─── ⚠ O QUE `PortalInvoice` GUARDA EM COLUNA (medido no código, não suposto) ────────────────
//
// | coluna | quem escreve | o que é |
// |---|---|---|
// | `numero` | `notas/ingestaoNfse.js` | `metadata.numeroNfse` = `nNFSe`. **NÃO é o `nDPS`** |
// | `serie`  | só `notas/dfe/DfeSyncService.js` (NF-e/SEFAZ) | para NFS-e **nunca é escrita** |
// | `idDps`  | `NfseService.upsertFromProvider` (consulta), não a captura ADN | string derivada |
// | `xmlRaw` | `notas/ingestaoNfse.js` | o XML inteiro — **a única fonte da série/nDPS** |
//
// Ou seja: **não há coluna com a série da DPS de uma NFS-e capturada.** Só dá para ler do
// `xmlRaw`, e é o que este módulo faz. Acrescentar as colunas seria um backfill sobre 556+ notas e
// uma mudança na captura — decisão do dono, não detalhe de implementação; está no relatório.
//
// ─── ⚠ LEITURA POR CAMINHO, NUNCA POR "PRIMEIRO COM ESSE NOME" ──────────────────────────────
//
// Mesma razão de `danfseDados.js` (que também não reusa `getTextByLocalNames`): o XML da NFS-e
// repete nomes de tag em grupos diferentes. `serie` é curto e genérico o bastante para aparecer
// em outro lugar num leiaute futuro, e pegar o errado aqui não dá erro — dá **número de DPS
// errado**, que é a rejeição E0014 ou um buraco permanente na numeração.

import { DOMParser } from "@xmldom/xmldom";
import { prisma } from "../../infrastructure/db/prisma.js";

const ELEMENT_NODE = 1;

/**
 * ⚠ A JANELA. Ler TODAS as notas da empresa para achar o maior `nDPS` significaria carregar todo o
 * `xmlRaw` da carteira a cada emissão (as notas passam de 500 numa empresa ativa, e cada XML tem
 * alguns KB). A janela é das mais RECENTES por data de emissão, e o piso é o **maior `nDPS` dentro
 * dela** — não o da primeira linha.
 *
 * Por que isso basta: `nDPS` é um contador sequencial dentro da série, então a nota mais recente é
 * a de maior número. Tomar o MÁXIMO da janela (em vez do primeiro) é a defesa contra o caso em que
 * não é — notas emitidas fora de ordem, ou com a data de emissão fora de ordem em relação ao
 * número.
 */
export const JANELA_DE_NOTAS = 50;

export const ESTADO = Object.freeze({
  /** A empresa nunca teve NFS-e. Primeira emissão: o ponto de partida é o cadastro. */
  SEM_NOTA: "SEM_NOTA",
  /** Achou nota e leu série + nDPS. */
  LIDA: "LIDA",
});

export class NfseUltimaNotaError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ─── Navegação por caminho (namespace-agnóstica: compara sempre `localName`) ─────────────────

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

function descer(raiz, caminho) {
  let atual = raiz;
  for (const parte of caminho) {
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

// Os três caminhos possíveis até `infDPS`, do mais específico para o mais geral. Nenhum deles é
// suposição: são as formas em que o documento chega.
//   • `NFSe/infNFSe/DPS/infDPS` — a NFS-e devolvida pelo sistema nacional, que é o que a captura
//     guarda (ANEXO_I v1.01; é este o caminho que a NT 008 §2.4.5 escreve para `nDPS` e `serie`);
//   • `DPS/infDPS` — o documento de DECLARAÇÃO cru, que é o que um import manual pode trazer;
//   • o próprio elemento raiz, quando o arquivo salvo já é o `infDPS`.
const CAMINHOS_ATE_INFDPS = [
  ["NFSe", "infNFSe", "DPS", "infDPS"],
  ["DPS", "infDPS"],
  ["infDPS"],
];

/**
 * Lê `serie` e `nDPS` de um XML de NFS-e (ou de DPS). PURA: não toca banco nem rede.
 *
 * @returns {{serie: string|null, numero: number|null}} — `null` em cada campo que o XML não trouxe.
 *   ⚠ Devolver `null` é diferente de devolver `0`: ausência não é numeração.
 */
export function lerSerieENumeroDaDps(xmlPlain) {
  const vazio = { serie: null, numero: null };
  if (!xmlPlain) return vazio;

  let doc;
  try {
    doc = new DOMParser().parseFromString(String(xmlPlain), "text/xml");
  } catch {
    return vazio;
  }
  if (!doc) return vazio;

  let infDps = null;
  for (const caminho of CAMINHOS_ATE_INFDPS) {
    infDps = descer(doc, caminho);
    if (infDps) break;
  }
  if (!infDps) return vazio;

  const serieBruta = textoDe(descer(infDps, ["serie"]));
  const numeroBruto = textoDe(descer(infDps, ["nDPS"]));

  const serieDigitos = String(serieBruta ?? "").replace(/\D+/g, "");
  const numeroDigitos = String(numeroBruto ?? "").replace(/\D+/g, "");

  // ⚠ A série volta com 5 dígitos, a MESMA forma de `normalizarSerie` — "1" e "00001" são a mesma
  // série, e devolver as duas escritas faria a comparação com o cadastro dizer que divergem.
  const serie = serieDigitos ? String(Number(serieDigitos)).padStart(5, "0") : null;
  const numero = numeroDigitos ? Number(numeroDigitos) : null;

  return {
    serie,
    numero: Number.isSafeInteger(numero) && numero > 0 ? numero : null,
  };
}

/**
 * A última numeração de DPS que existe para esta empresa — a nossa e a de fora.
 *
 * ⚠ **NÃO FILTRA POR SITUAÇÃO.** Nota CANCELADA consumiu o número do mesmo jeito: não existe
 * inutilização na NFS-e (varrido nos 16 eventos do Anexo II e nas RNs do Anexo I), então o número
 * de uma nota cancelada continua ocupado e reemiti-lo é E0014.
 *
 * ⚠ **FILTRA POR `papel: "EMIT"`.** O DFe traz também as notas em que a empresa é TOMADORA; a
 * numeração delas é do prestador, e continuá-la seria emitir na sequência de outro CNPJ.
 *
 * ⚠ **RECUSA EM VEZ DE CHUTAR.** Se existem notas com XML e NENHUMA rende série/número, a leitura
 * está quebrada contra o dado real — e continuar a partir do nosso contador arriscaria repetir
 * número. Lança `NFSE_ULTIMA_NOTA_ILEGIVEL`. "Não achei" nunca vira "então comece do zero".
 *
 * @returns {Promise<{estado: string, serie?: string, numero?: number, notasLidas: number}>}
 */
export async function lerUltimaNumeracaoDaEmpresa({ companyId, client = prisma } = {}) {
  if (!companyId) {
    throw new NfseUltimaNotaError(
      "NFSE_ULTIMA_NOTA_SEM_EMPRESA",
      "Não foi possível ler a última nota emitida: empresa não informada."
    );
  }

  // ⚠ MULTI-TENANCY. A ponte entre os dois mundos é `PortalClient.companyId`, que é `@unique` — uma
  // empresa legada, um portal client. Nunca casar por CNPJ, nome ou semelhança: é o mesmo erro que
  // o vínculo de telefone do WhatsApp existe para impedir.
  let portalClient;
  try {
    portalClient = await client.portalClient.findUnique({
      where: { companyId: String(companyId) },
      select: { id: true },
    });
  } catch (err) {
    throw new NfseUltimaNotaError(
      "NFSE_LEITURA_ULTIMA_NOTA_FALHOU",
      "Não foi possível consultar as notas já emitidas desta empresa para descobrir a série e o " +
        "número da próxima DPS. A emissão foi RECUSADA em vez de chutar o próximo número: número " +
        "repetido é rejeição E0014 e número pulado é buraco permanente (não existe inutilização " +
        "na NFS-e). Tente de novo; se persistir, é problema de banco.",
      { causa: err?.message || String(err) }
    );
  }

  if (!portalClient) {
    // Empresa legada sem PortalClient: não há de onde ler notas. Isso NÃO é falha de leitura — é
    // ausência de fonte, e vale como "primeira emissão".
    return { estado: ESTADO.SEM_NOTA, notasLidas: 0 };
  }

  let notas;
  try {
    notas = await client.portalInvoice.findMany({
      where: {
        clientId: portalClient.id,
        type: "NFSE",
        papel: "EMIT",
        xmlRaw: { not: null },
      },
      orderBy: [{ issueDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: JANELA_DE_NOTAS,
      select: { id: true, xmlRaw: true },
    });
  } catch (err) {
    throw new NfseUltimaNotaError(
      "NFSE_LEITURA_ULTIMA_NOTA_FALHOU",
      "Não foi possível ler as notas já emitidas desta empresa para descobrir a série e o número " +
        "da próxima DPS. A emissão foi RECUSADA em vez de chutar o próximo número: número " +
        "repetido é rejeição E0014 e número pulado é buraco permanente.",
      { causa: err?.message || String(err) }
    );
  }

  if (!notas.length) return { estado: ESTADO.SEM_NOTA, notasLidas: 0 };

  // Para CADA série encontrada, o maior `nDPS` — e a série da nota mais recente que rendeu leitura.
  const maiorPorSerie = new Map();
  let serieMaisRecente = null;
  for (const nota of notas) {
    const { serie, numero } = lerSerieENumeroDaDps(nota.xmlRaw);
    if (!serie || !numero) continue;
    if (!serieMaisRecente) serieMaisRecente = serie;
    const atual = maiorPorSerie.get(serie);
    if (atual == null || numero > atual) maiorPorSerie.set(serie, numero);
  }

  if (!serieMaisRecente) {
    throw new NfseUltimaNotaError(
      "NFSE_ULTIMA_NOTA_ILEGIVEL",
      `Esta empresa tem ${notas.length} nota(s) de serviço guardada(s), e não foi possível ler a ` +
        "série nem o número da DPS de nenhuma delas. A emissão foi RECUSADA: continuar a partir do " +
        "contador interno arriscaria repetir um número já emitido (rejeição E0014), e pular para o " +
        "seguinte deixaria um buraco permanente — não existe inutilização na NFS-e.",
      {
        notasLidas: notas.length,
        correcao:
          "Abra uma nota recente na aba Notas Fiscais e confira se o XML está completo. Se o " +
          "leiaute mudou, a leitura de nDPS/serie precisa ser revista antes de emitir.",
      }
    );
  }

  return {
    estado: ESTADO.LIDA,
    serie: serieMaisRecente,
    numero: maiorPorSerie.get(serieMaisRecente),
    notasLidas: notas.length,
    // Todas as séries vistas na janela, com o maior número de cada uma. Não é usado para escolher —
    // serve para explicar a decisão em log e em teste.
    porSerie: Object.fromEntries(maiorPorSerie),
  };
}
