// Q12.C.2: classifica itens de notas (NotaItem) em anexos do Simples Nacional.
//
// Regra de lookup (em ordem):
//   1. DeparaAnexo escopo EMPRESA + portalClientId (override específico)
//   2. DeparaAnexo escopo GLOBAL (seed nacional)
//   3. Default: III (serviço genérico, sem Fator R)
//
// Tipos de código:
//   - LC116 (NotaItem.codigoServico, NFS-e)  → mais comum
//   - NCM   (NotaItem.ncm, NF-e produto)     → futuro (Anexo I/II)
//   - CFOP  (NotaItem.cfop, NF-e operação)   → flags (export, ST)
//
// Persiste resultado em NotaItem.anexoResolvido e NotaItem.sujeitoFatorR.
// Idempotente — re-rodar não muda nada (a menos que De/Para mude).

import { prisma } from "../../../infrastructure/db/prisma.js";

const ANEXO_DEFAULT = "III";

/**
 * Q12.C fix: NFS-e Padrão Nacional (gov.br/nfse) usa cTribNac (6 dígitos)
 * em vez do LC116 antigo (1.08, 17.06 etc).
 *
 * Formato cTribNac: CCAATT
 *   CC = capítulo LC116      (01 = informática, 04 = saúde, 17 = apoio técnico...)
 *   AA = sub-item LC116      (08 = páginas eletrônicas)
 *   TT = sub-sub-item/variante
 *
 * Conversão: "010801" → "1.08", "170601" → "17.06", "040101" → "4.01".
 * Retorna null se não parecer formato cTribNac.
 */
function cTribNacToLc116(codigo) {
  const digits = String(codigo || "").replace(/\D+/g, "");
  if (digits.length !== 6) return null;
  const cap = parseInt(digits.slice(0, 2), 10);  // 01..40
  const item = parseInt(digits.slice(2, 4), 10); // 01..99
  if (!cap || !item) return null;
  return `${cap}.${String(item).padStart(2, "0")}`;
}

/**
 * Carrega o mapa De/Para pra uma empresa, mesclando EMPRESA sobre GLOBAL.
 * Retorna estrutura `{ "LC116:1.06": { anexoResolvido, sujeitoFatorR }, ... }`.
 */
async function loadDeparaForCompany(portalClientId) {
  const all = await prisma.deparaAnexo.findMany({
    where: {
      OR: [
        { escopo: "GLOBAL" },
        { escopo: "EMPRESA", portalClientId },
      ],
    },
    select: { escopo: true, tipoCodigo: true, codigo: true, anexoResolvido: true, sujeitoFatorR: true },
  });
  // Construir mapa — EMPRESA vence sobre GLOBAL
  const map = new Map();
  for (const row of all) {
    const key = `${row.tipoCodigo}:${row.codigo}`;
    if (row.escopo === "EMPRESA") {
      map.set(key, row); // EMPRESA sobrescreve sem checar
    } else if (!map.has(key) || map.get(key).escopo !== "EMPRESA") {
      map.set(key, row);
    }
  }
  return map;
}

/**
 * Classifica 1 item dado o mapa pré-carregado.
 * Retorna { anexoResolvido, sujeitoFatorR, source: "EMPRESA"|"GLOBAL"|"DEFAULT" }.
 */
function classifyItem(item, map) {
  // Ordem de tentativa pra LC116/NFS-e:
  //   1. Match exato pelo código original (ex: "17.06" se já vier LC116 puro)
  //   2. Conversão cTribNac→LC116 e match exato (ex: "172501" → "17.25")
  //   3. Fallback de capítulo LC116 (ex: "17") — cobre subitens não mapeados
  // Depois tenta NCM (produto) e CFOP (operação).
  const candidates = [];
  if (item.codigoServico) {
    const raw = String(item.codigoServico);
    candidates.push({ tipo: "LC116", codigo: raw });
    const lc = cTribNacToLc116(raw);
    if (lc && lc !== raw) candidates.push({ tipo: "LC116", codigo: lc });
    // Fallback por capítulo: extrai prefixo antes do "." (ou primeiros 2 dígitos do cTribNac)
    const lc116ish = lc || raw;
    const chapter = lc116ish.includes(".") ? lc116ish.split(".")[0] : lc116ish.replace(/\D+/g, "").slice(0, 2).replace(/^0+/, "");
    if (chapter && chapter !== lc116ish) candidates.push({ tipo: "LC116", codigo: chapter });
  }
  if (item.ncm) candidates.push({ tipo: "NCM", codigo: String(item.ncm) });
  if (item.cfop) candidates.push({ tipo: "CFOP", codigo: String(item.cfop) });

  for (const c of candidates) {
    const hit = map.get(`${c.tipo}:${c.codigo}`);
    if (hit) {
      return {
        anexoResolvido: hit.anexoResolvido,
        sujeitoFatorR: hit.sujeitoFatorR,
        source: hit.escopo, // "EMPRESA" | "GLOBAL"
      };
    }
  }
  // Default: III sem Fator R (mais conservador — contador revisa)
  return {
    anexoResolvido: ANEXO_DEFAULT,
    sujeitoFatorR: false,
    source: "DEFAULT",
  };
}

/**
 * Classifica TODOS os itens não-classificados de uma empresa (ou força reclassificação).
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {boolean} [opts.force=false]  se true, reclassifica tudo (incluindo já classificados)
 * @returns {Promise<{processed, classified, defaultUsed, byAnexo: { III, IV, V }}>}
 */
export async function classifyItemsForCompany({ portalClientId, force = false }) {
  const map = await loadDeparaForCompany(portalClientId);

  // Pega itens das notas dessa empresa
  const items = await prisma.notaItem.findMany({
    where: {
      nota: { clientId: portalClientId },
      ...(force ? {} : { anexoResolvido: null }),
    },
    select: { id: true, codigoServico: true, ncm: true, cfop: true },
  });

  const byAnexo = { III: 0, IV: 0, V: 0 };
  let defaultUsed = 0;

  // updateMany em batch por anexo+flag (4 grupos: III/IV/V × sujeitoFatorR true/false)
  // Mais eficiente que 1 update por item.
  const groups = new Map(); // key: "ANEXO|fatorR" → [ids]
  for (const item of items) {
    const result = classifyItem(item, map);
    if (result.source === "DEFAULT") defaultUsed++;
    byAnexo[result.anexoResolvido] = (byAnexo[result.anexoResolvido] || 0) + 1;
    const key = `${result.anexoResolvido}|${result.sujeitoFatorR}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.id);
  }

  for (const [key, ids] of groups.entries()) {
    const [anexo, fatorRStr] = key.split("|");
    await prisma.notaItem.updateMany({
      where: { id: { in: ids } },
      data: {
        anexoResolvido: anexo,
        sujeitoFatorR: fatorRStr === "true",
      },
    });
  }

  return {
    processed: items.length,
    classified: items.length - defaultUsed,
    defaultUsed,
    byAnexo,
  };
}

/**
 * Classifica 1 item específico — usado quando captura nova nota.
 * Mais leve que classifyItemsForCompany se já chamada via batch.
 */
export async function classifySingleItem({ portalClientId, item }) {
  const map = await loadDeparaForCompany(portalClientId);
  return classifyItem(item, map);
}

// Re-exports
export { ANEXO_DEFAULT };
