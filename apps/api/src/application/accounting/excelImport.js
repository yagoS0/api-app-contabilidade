import * as XLSX from "xlsx";
import { prisma } from "../../infrastructure/db/prisma.js";

const HEADER_ALIASES = {
  data: ["data", "date", "dt", "dia"],
  descricao: ["descricao", "descrição", "historico", "histórico", "description", "memo", "narrative", "lancamento", "lançamento"],
  valor: ["valor", "value", "amount", "vlr", "preço", "preco", "total"],
};

export function normalizeMatchText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos combinantes
    .replace(/[\s\-_/.,;:!?()[\]{}]+/g, " ")
    .trim();
}

function detectColumns(firstRow) {
  // firstRow é array de cells. Devolve { dataIdx, descIdx, valorIdx }.
  // Se a primeira linha parecer header, mapeia por nome. Caso contrário usa posição padrão.
  const lower = (firstRow || []).map((c) => normalizeMatchText(c));
  const findIdx = (aliases) => lower.findIndex((cell) => aliases.includes(cell));
  const dataIdx = findIdx(HEADER_ALIASES.data);
  const descIdx = findIdx(HEADER_ALIASES.descricao);
  const valorIdx = findIdx(HEADER_ALIASES.valor);
  if (dataIdx >= 0 && descIdx >= 0 && valorIdx >= 0) {
    return { dataIdx, descIdx, valorIdx, hasHeader: true };
  }
  // Fallback: posição 0,1,2
  return { dataIdx: 0, descIdx: 1, valorIdx: 2, hasHeader: false };
}

function parseDateCell(cell) {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) return cell;
  // Excel serial date (number)
  if (typeof cell === "number" && Number.isFinite(cell)) {
    const date = XLSX.SSF.parse_date_code(cell);
    if (date) return new Date(Date.UTC(date.y, (date.m || 1) - 1, date.d || 1));
  }
  // String em formatos comuns: 2026-01-15, 15/01/2026, 15-01-2026
  const s = String(cell).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    const y = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return new Date(Date.UTC(y, Number(br[2]) - 1, Number(br[1])));
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseValorCell(cell) {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  const s = String(cell).trim();
  if (!s) return null;
  // Detecta separador decimal: o último '.' ou ',' é o decimal
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else if (lastDot > lastComma) {
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s.replace(/\./g, "").replace(",", ".");
  }
  // Remove caracteres não numéricos exceto - e .
  const cleaned = normalized.replace(/[^0-9.\-]/g, "");
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const MAX_ROWS = 5000;

export function parseExcelBuffer(buffer) {
  // cellDates: true — converte datas seriais para Date automaticamente
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  // header: 1 → array de arrays; defval: "" → preenche células vazias
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  if (!rows.length) return [];
  if (rows.length > MAX_ROWS) {
    const err = new Error(`Excel excede o limite de ${MAX_ROWS} linhas`);
    err.code = "EXCEL_TOO_MANY_ROWS";
    throw err;
  }

  const cols = detectColumns(rows[0]);
  const startIdx = cols.hasHeader ? 1 : 0;

  const transactions = [];
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const data = parseDateCell(row[cols.dataIdx]);
    const descricao = String(row[cols.descIdx] || "").trim();
    const valorRaw = parseValorCell(row[cols.valorIdx]);
    const valor = valorRaw == null ? null : Math.abs(valorRaw);

    if (!data || !descricao || valor == null || valor <= 0) continue;
    transactions.push({ rowIndex: i, data, descricao, valor });
  }

  return transactions;
}

export async function findHistoricoMatches({ portalClientId, userId, descriptions }) {
  // Carrega todos os históricos disponíveis para o usuário/empresa de uma vez (otimização).
  const historicos = await prisma.accountingHistorico.findMany({
    where: {
      createdByUserId: String(userId),
      OR: [{ companyPortalClientId: String(portalClientId) }, { companyPortalClientId: null }],
    },
    orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      text: true,
      historicoSugerido: true,
      contaDebito: true,
      contaCredito: true,
      usageCount: true,
      companyPortalClientId: true,
    },
  });

  // Pré-normaliza
  const normalized = historicos.map((h) => ({ ...h, _norm: normalizeMatchText(h.text) }));
  const exactMap = new Map();
  for (const h of normalized) {
    if (h._norm && !exactMap.has(h._norm)) exactMap.set(h._norm, h);
  }

  function buildMatch(h, matchType) {
    return {
      historicoId: h.id,
      text: h.text,
      historicoSugerido: h.historicoSugerido || null,
      contaDebito: h.contaDebito,
      contaCredito: h.contaCredito,
      usageCount: h.usageCount,
      scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
      matchType,
    };
  }

  return descriptions.map((desc) => {
    const normInput = normalizeMatchText(desc);
    if (!normInput) return null;
    // Pass 1: exato
    const exact = exactMap.get(normInput);
    if (exact) return buildMatch(exact, "exact");
    // Pass 2: substring
    let best = null;
    for (const h of normalized) {
      if (!h._norm) continue;
      if (normInput.includes(h._norm) || h._norm.includes(normInput)) {
        if (!best || (h.usageCount || 0) > (best.usageCount || 0)) best = h;
      }
    }
    if (best) return buildMatch(best, "substring");
    return null;
  });
}

export async function upsertHistoricoFromImport({
  userId,
  portalClientId,
  text,
  contaDebito,
  contaCredito,
  historicoSugerido,
}) {
  if (!userId || !text) return;
  const trimmed = String(text).trim();
  if (!trimmed) return;
  const historicoTrimmed = historicoSugerido ? String(historicoSugerido).trim() || null : null;
  try {
    const existing = await prisma.accountingHistorico.findFirst({
      where: { createdByUserId: String(userId), companyPortalClientId: String(portalClientId), text: trimmed },
    });
    if (existing) {
      await prisma.accountingHistorico.update({
        where: { id: existing.id },
        data: {
          contaDebito: contaDebito || existing.contaDebito,
          contaCredito: contaCredito || existing.contaCredito,
          historicoSugerido: historicoTrimmed || existing.historicoSugerido,
          usageCount: existing.usageCount + 1,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.accountingHistorico.create({
        data: {
          createdByUserId: String(userId),
          companyPortalClientId: String(portalClientId),
          text: trimmed,
          contaDebito: contaDebito || null,
          contaCredito: contaCredito || null,
          historicoSugerido: historicoTrimmed,
        },
      });
    }
  } catch {
    // Não crítico — falha silenciosa
  }
}
