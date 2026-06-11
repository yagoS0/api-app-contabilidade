import { Router } from "express";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { generateEntriesFromCircular, resolveRule, applyTemplate, formatCompetenciaLabel } from "../../application/accounting/AccountingEntryGeneratorService.js";
import { syncPgdasByCompetencia } from "../../application/fiscal/serpro/SerproPgdasDeclaracaoService.js";
import { resolvePayrollTemplate } from "../../application/accounting/payrollTemplate.js";
import { PROVISAO_TO_BAIXA_EVENT } from "./accountingEntryRules.js";
import { importChartOfAccountsFromBuffer } from "../../application/accounting/chartOfAccountsImport.js";
import { parseExcelBuffer, findHistoricoMatches, upsertHistoricoFromImport } from "../../application/accounting/excelImport.js";
import { sanitizeFilename } from "../../lib/httpHeaders.js";

// ---------------------------------------------------------------------------
// OFX Parser (SGML v1 e XML v2)
// Suporta: namespaces de tag (n0:STMTTRN), encoding UTF-8/Latin-1,
// formatos de data YYYYMMDD[HHMMSS[.XXX]][TZ], entidades HTML, sinais +/-,
// separadores de milhar BR (1.234,56) e US (1,234.56).
// ---------------------------------------------------------------------------

function decodeOfxBuffer(buffer) {
  // Tenta UTF-8 primeiro; se header indicar ENCODING:USASCII ou Latin-1, decodifica como latin1.
  const utf8Text = buffer.toString("utf-8");
  const headerSlice = utf8Text.slice(0, 600).toUpperCase();
  const isLatinHeader =
    /ENCODING:\s*(USASCII|LATIN-?1|ISO-?8859-?1)/.test(headerSlice) ||
    /CHARSET=(LATIN-?1|ISO-?8859-?1|1252)/.test(headerSlice);
  if (isLatinHeader) return buffer.toString("latin1");
  // Detecção heurística: bytes 0x80-0xFF sem padrão UTF-8 multibyte → provavelmente latin1
  if (/�/.test(utf8Text)) return buffer.toString("latin1");
  return utf8Text;
}

function decodeHtmlEntities(value) {
  if (!value) return value;
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseOfxDate(raw) {
  if (!raw) return null;
  // Remove timezone bracket (ex: [-3:GMT]) e qualquer espaço.
  const s = String(raw).replace(/\[[^\]]*\]/, "").trim();
  if (s.length < 8) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(mo) || !/^\d{2}$/.test(d)) return null;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

function parseOfxAmount(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  // Detecta separador decimal: o último '.' ou ',' é o decimal; o outro é separador de milhar.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else if (lastDot > lastComma) {
    // formato US: 1,234.56 → remove vírgulas
    normalized = s.replace(/,/g, "");
  } else {
    // formato BR: 1.234,56 → remove pontos, troca vírgula por ponto
    normalized = s.replace(/\./g, "").replace(",", ".");
  }
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Match de tag insensível a namespace (n0:STMTTRN, ofx:STMTTRN, STMTTRN)
const NS = "(?:[a-z][a-z0-9]*:)?";

function parseOfxSgml(text) {
  const transactions = [];
  const blockRegex = new RegExp(`<${NS}STMTTRN>([\\s\\S]*?)<\\/${NS}STMTTRN>`, "gi");
  // Fallback se não houver tag de fechamento (SGML estrito): usa STMTTRN abertura como delimitador.
  // Aqui aceitamos o fechamento opcional via OR adicional abaixo.
  let match;
  const matched = [];
  while ((match = blockRegex.exec(text)) !== null) matched.push(match[1]);

  // Se não casou nada com fechamento, divide por <STMTTRN>
  let blocks = matched;
  if (!blocks.length) {
    const splits = text.split(new RegExp(`<${NS}STMTTRN>`, "i")).slice(1);
    blocks = splits.map((b) => b.split(new RegExp(`<${NS}(?:STMTTRN|BANKTRANLIST|/STMTRS)>`, "i"))[0]);
  }

  for (const block of blocks) {
    const get = (tag) => {
      const r = new RegExp(`<${NS}${tag}>([^<\\n\\r]*)`, "i");
      const m = r.exec(block);
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    };
    transactions.push({
      trnType: get("TRNTYPE"),
      dtPosted: get("DTPOSTED"),
      trnAmt: get("TRNAMT"),
      fitId: get("FITID"),
      memo: get("MEMO") || get("NAME") || "",
    });
  }
  return transactions;
}

function parseOfxXml(text) {
  const transactions = [];
  const blockRegex = new RegExp(`<${NS}STMTTRN>([\\s\\S]*?)<\\/${NS}STMTTRN>`, "gi");
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const r = new RegExp(`<${NS}${tag}>([^<]*)<\\/${NS}${tag}>`, "i");
      const m = r.exec(block);
      return m ? decodeHtmlEntities(m[1].trim()) : null;
    };
    transactions.push({
      trnType: get("TRNTYPE"),
      dtPosted: get("DTPOSTED"),
      trnAmt: get("TRNAMT"),
      fitId: get("FITID"),
      memo: get("MEMO") || get("NAME") || "",
    });
  }
  return transactions;
}

function parseOfx(buffer) {
  const text = decodeOfxBuffer(buffer);
  const headerSlice = text.slice(0, 800);
  const isXml = /<\?xml/i.test(headerSlice) || /<\?OFX/i.test(headerSlice);
  const raw = isXml ? parseOfxXml(text) : parseOfxSgml(text);

  return raw
    .map((t) => {
      const amount = parseOfxAmount(t.trnAmt);
      return {
        fitId: t.fitId || null,
        trnType: String(t.trnType || "").toUpperCase(),
        data: parseOfxDate(t.dtPosted),
        valor: Math.abs(amount),
        // Convenção bancária: TRNAMT < 0 = saída (DEBITO no extrato), > 0 = entrada (CREDITO no extrato)
        sinal: amount < 0 ? "DEBITO" : "CREDITO",
        historico: t.memo || "",
      };
    })
    .filter((t) => t.data && t.valor > 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: "lines_required" };
  }
  for (const l of lines) {
    if (!l.conta || String(l.conta).trim() === "") {
      return { ok: false, error: "linha_sem_conta" };
    }
    if (!["D", "C"].includes(String(l.tipo || "").toUpperCase())) {
      return { ok: false, error: "linha_tipo_invalido" };
    }
    const v = parseFloat(String(l.valor || "0").replace(",", "."));
    if (isNaN(v) || v <= 0) {
      return { ok: false, error: "linha_valor_invalido" };
    }
  }
  const totalD = lines
    .filter((l) => String(l.tipo).toUpperCase() === "D")
    .reduce((s, l) => s + parseFloat(String(l.valor).replace(",", ".")), 0);
  const totalC = lines
    .filter((l) => String(l.tipo).toUpperCase() === "C")
    .reduce((s, l) => s + parseFloat(String(l.valor).replace(",", ".")), 0);
  const diferenca = Math.abs(totalD - totalC);
  // Lançamentos desequilibrados são permitidos — ficam marcados como "em aberto"
  return { ok: true, totalD, totalC, diferenca, balanced: diferenca <= 0.01 };
}

// Q17: valida se a competência pode ser FECHADA (fechamento contábil).
// Bloqueia por lançamento: em branco (sem linhas / conta vazia) OU D≠C (desbalanceado).
// Ignora linhas de rastreio de parcela (tipo="PARCELA") e a abertura/baixas de parcelamento
// não são desbalanceadas. Retorna { ok, blockers: [{ entryId, competencia, historico, motivo }] }.
async function validateFechamentoContabil(prisma, { portalClientId, competencia }) {
  const entries = await prisma.accountingEntry.findMany({
    where: { portalClientId, competencia, tipo: { not: "PARCELA" } },
    include: { lines: true },
  });
  const blockers = [];
  for (const e of entries) {
    const lines = e.lines || [];
    if (lines.length === 0) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "em_branco" });
      continue;
    }
    const temContaVazia = lines.some((l) => !String(l.conta || "").trim());
    if (temContaVazia) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "conta_em_branco" });
      continue;
    }
    const totalD = lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
    const totalC = lines.filter((l) => String(l.tipo).toUpperCase() === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
    if (Math.abs(totalD - totalC) > 0.01) {
      blockers.push({ entryId: e.id, competencia: e.competencia, historico: e.historico, motivo: "desbalanceado", totalD, totalC });
    }
  }
  return { ok: blockers.length === 0, blockers, totalEntries: entries.length };
}

function entryToResponse(entry) {
  const lines = entry.lines || [];
  const totalD = lines
    .filter((l) => l.tipo === "D")
    .reduce((s, l) => s + Number(l.valor), 0);
  const totalC = lines
    .filter((l) => l.tipo === "C")
    .reduce((s, l) => s + Number(l.valor), 0);
  // placeholder = PROVISAO sem linhas (agendado, aguardando valor)
  const placeholder = entry.tipo === "PROVISAO" && lines.length === 0;
  return { ...entry, totalD, totalC, valor: totalD, placeholder };
}

// Meses "YYYY-MM" de um ano
function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseOptionalDate(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Cria placeholders de provisão para os meses do ano que ainda não têm entrada
async function createProvisionPlaceholders(tx, { portalClientId, subtipo, competenciaOrigem, historico }) {
  const year = Number(competenciaOrigem.slice(0, 4));
  const meses = monthsOfYear(year);

  // Quais meses já têm entrada para este subtipo?
  const existing = await tx.accountingEntry.findMany({
    where: { portalClientId, tipo: "PROVISAO", subtipo, competencia: { in: meses } },
    select: { competencia: true },
  });
  const covered = new Set(existing.map((e) => e.competencia));

  const missing = meses.filter((m) => !covered.has(m));
  if (missing.length === 0) return;

  // Data padrão = dia 1 de cada mês
  await tx.accountingEntry.createMany({
    data: missing.map((comp) => {
      const [y, mo] = comp.split("-");
      return {
        portalClientId,
        data: new Date(`${y}-${mo}-01T00:00:00.000Z`),
        competencia: comp,
        historico: `Provisão ${historico} — aguardando valor`,
        tipo: "PROVISAO",
        subtipo,
        origem: "TEMPLATE",
        statusPagamento: "ABERTO",
        status: "RASCUNHO",
      };
    }),
  });
}

// ---------------------------------------------------------------------------
// CSV export (por linha de lançamento)
// ---------------------------------------------------------------------------

function entriesToCsv(entries) {
  // Formato "lançamento partido": 5 colunas (Data | Codigo Debito | Codigo Credito | Historico | Valor).
  // SEM header — sistema contábil destino consome desde a linha 1.
  // Valor SEM separador de milhar — só vírgula decimal (ex: 17614,98).
  // - Lançamento simples (1D + 1C, mesmo valor, mesmo histórico): uma linha consolidada.
  // - Lançamento composto: uma linha por linha contábil, lado oposto vazio.
  // - line.historico (se presente) tem prioridade sobre entry.historico.
  const rows = [];
  const sanitize = (s) => String(s || "").replace(/;/g, " ").replace(/[\r\n]+/g, " ").trim();
  const fmtValor = (v) => Number(v || 0).toFixed(2).replace(".", ",");

  for (const e of entries) {
    const data = e.data ? new Date(e.data).toLocaleDateString("pt-BR") : "";
    const entryHistorico = sanitize(e.historico);
    const lines = e.lines || [];
    const debits = lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    const credits = lines.filter((l) => String(l.tipo).toUpperCase() === "C");
    const lineHistoric = (l) => sanitize(l.historico) || entryHistorico;

    if (debits.length === 1 && credits.length === 1
        && Math.abs(Number(debits[0].valor) - Number(credits[0].valor)) < 0.01
        && lineHistoric(debits[0]) === lineHistoric(credits[0])) {
      rows.push(`${data};${debits[0].conta};${credits[0].conta};${lineHistoric(debits[0])};${fmtValor(debits[0].valor)}`);
    } else {
      for (const d of debits) {
        rows.push(`${data};${d.conta};;${lineHistoric(d)};${fmtValor(d.valor)}`);
      }
      for (const c of credits) {
        rows.push(`${data};;${c.conta};${lineHistoric(c)};${fmtValor(c.valor)}`);
      }
    }
  }
  return rows.join("\r\n");
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAccountingEntriesRouter({ log }) {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // ─── Plano de Contas ──────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/chart-of-accounts
  // Retorna UNION dedupada de contas globais + contas da empresa.
  // Quando uma conta com mesmo `codigo` existe em ambos os escopos, a da EMPRESA tem
  // prioridade e a global é ocultada (override semantic).
  router.get("/chart-of-accounts", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const accounts = await prisma.chartOfAccount.findMany({
      where: { OR: [{ portalClientId }, { portalClientId: null }] },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    });
    // Dedup por código: empresa vence sobre global
    const byCodigo = new Map();
    for (const acc of accounts) {
      const isCompany = Boolean(acc.portalClientId);
      const existing = byCodigo.get(acc.codigo);
      if (!existing || (isCompany && !existing.portalClientId)) {
        byCodigo.set(acc.codigo, acc);
      }
    }
    const data = [...byCodigo.values()].map((acc) => ({
      ...acc,
      scope: acc.portalClientId ? "COMPANY" : "GLOBAL",
    }));
    return res.json({ data });
  });

  // GET /firm/companies/:companyId/payroll/template?kind=PROLABORE|FOLHA&competencia=YYYY-MM
  router.get("/payroll/template", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const kind = String(req.query?.kind || "").toUpperCase();
    const competencia = String(req.query?.competencia || "").trim();
    if (!kind) return res.status(400).json({ error: "kind_required" });
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const template = await resolvePayrollTemplate({ portalClientId, kind, competencia });
      return res.json({ ok: true, template });
    } catch (err) {
      const code = err?.code || "PAYROLL_TEMPLATE_FAILED";
      const status = code === "UNKNOWN_PAYROLL_KIND" ? 400 : 500;
      return res.status(status).json({ ok: false, error: code, message: err?.message });
    }
  });

  // POST /firm/companies/:companyId/chart-of-accounts
  router.post("/chart-of-accounts", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const body = req.body || {};
    const codigo = String(body.codigo || "").trim();
    const nome = String(body.nome || "").trim();
    const tipo = String(body.tipo || "DESPESA").toUpperCase();
    const natureza = String(body.natureza || "DEVEDORA").toUpperCase();

    if (!codigo) return res.status(400).json({ error: "codigo_required" });
    if (!nome) return res.status(400).json({ error: "nome_required" });

    const TIPOS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];
    if (!TIPOS.includes(tipo)) return res.status(400).json({ error: "tipo_invalido" });

    // Override semantic: per-empresa pode coexistir com global de mesmo código.
    // Quando ambos existem, empresa tem prioridade na visualização (dedupe na rota GET).
    try {
      const account = await prisma.chartOfAccount.create({
        data: {
          portalClientId,
          codigo,
          nome,
          tipo,
          natureza,
          status: "PENDENTE_ERP",
        },
      });
      return res.status(201).json({ ok: true, account });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ error: "codigo_ja_existe" });
      }
      log.error({ err }, "Erro ao criar conta no plano de contas");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/chart-of-accounts/:codigo
  router.patch("/chart-of-accounts/:codigo", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo);
    const body = req.body || {};

    const existing = await prisma.chartOfAccount.findUnique({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });

    const data = {};
    if (body.nome !== undefined) data.nome = String(body.nome).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.natureza !== undefined) data.natureza = String(body.natureza).toUpperCase();
    if (body.status !== undefined && ["CONFIRMADA", "PENDENTE_ERP"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const updated = await prisma.chartOfAccount.update({
      where: { portalClientId_codigo: { portalClientId, codigo } },
      data,
    });
    return res.json({ ok: true, account: updated });
  });

  // DELETE /firm/companies/:companyId/chart-of-accounts/:codigo
  router.delete("/chart-of-accounts/:codigo", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo);

    const existing = await prisma.chartOfAccount.findUnique({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    if (!existing) return res.status(404).json({ error: "conta_nao_encontrada" });

    await prisma.chartOfAccount.delete({
      where: { portalClientId_codigo: { portalClientId, codigo } },
    });
    return res.json({ ok: true });
  });

  // POST /firm/companies/:companyId/chart-of-accounts/import (CSV ou PDF)
  router.post(
    "/chart-of-accounts/import",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

      const result = await importChartOfAccountsFromBuffer({
        portalClientId,
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
      });

      if (!result.ok) {
        const status = result.error === "pdf_no_accounts_found" ? 422 : 500;
        if (result.error === "pdf_import_failed") log.error({ message: result.message }, "Erro ao importar plano de contas via PDF");
        return res.status(status).json(result);
      }
      return res.json(result);
    }
  );

  // ─── Lançamentos ─────────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/entries/circular  (deve vir antes de /entries/:entryId)
  router.get("/entries/circular", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const rawYear = parseInt(String(req.query.year || ""), 10);
    const year = rawYear >= 2000 && rawYear <= 2100 ? rawYear : new Date().getUTCFullYear();

    const meses = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

    // darfGuides removido (Q5): DARFs agora viram AccountingEntry real via GuideToProvisionService
    // e aparecem naturalmente na query `provisoes`. Sintética DARF foi descontinuada.
    const [provisoes, receitas, inssGuides, circulars, simplesGuides] = await Promise.all([
      prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          tipo: "PROVISAO",
          competencia: { in: meses },
          statusPagamento: { in: ["ABERTO", "PAGO"] },
        },
        include: {
          lines: { orderBy: { ordem: "asc" } },
          baixas: { select: { id: true }, take: 1 },
        },
        orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
      }),
      prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          tipo: "RECEITA",
          competencia: { in: meses },
        },
        select: { competencia: true, id: true, lines: { select: { tipo: true, valor: true } } },
      }),
      // Guias INSS (que não geram mais lançamento contábil automático após a remoção de INSS_DCTFWEB).
      // Aqui criamos provisões sintéticas para que apareçam na linha INSS da circular.
      prisma.guide.findMany({
        where: {
          portalClientId,
          source: "SERPRO",
          tipo: "INSS",
          status: "PROCESSED",
          competencia: { in: meses },
        },
        select: {
          id: true,
          competencia: true,
          valor: true,
          valorOriginal: true,
          paymentStatus: true,
          vencimento: true,
          updatedAt: true,
        },
      }),
      prisma.companyMonthlyCircular.findMany({
        where: { portalClientId, competencia: { in: meses } },
        select: { competencia: true, dasTotal: true },
      }),
      prisma.guide.findMany({
        where: {
          portalClientId,
          status: "PROCESSED",
          competencia: { in: meses },
          tipo: "SIMPLES",
        },
        select: { competencia: true, valor: true, valorOriginal: true, updatedAt: true },
      }),
    ]);

    const receitasPorComp = {};
    for (const e of receitas) {
      const total = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
      receitasPorComp[e.competencia] = (receitasPorComp[e.competencia] || 0) + total;
    }

    // Mapas por competência para resolver o valor ORIGINAL do DAS_SIMPLES.
    // Prioridade do "valor original": circular.dasTotal (extrato PGDAS-D) > guide.valorOriginal > guide.valor.
    // Necessário porque entries antigos podem ter lines com valor recalculado (criados antes do fix).
    const circularByComp = new Map(circulars.map((c) => [c.competencia, c]));
    const simplesGuideByComp = new Map(simplesGuides.map((g) => [g.competencia, g]));

    function enrichDasProvisao(entry) {
      if (entry.eventType !== "DAS_SIMPLES") return entry;
      const circ = circularByComp.get(entry.competencia);
      const guide = simplesGuideByComp.get(entry.competencia);
      // Valor do extrato (truth). Se não existir, mantém o totalD (lines).
      const extratoValor = circ?.dasTotal != null ? Number(circ.dasTotal) : null;
      // Valor atual da guia (pode estar recalculado pelo SERPRO).
      const guideValorAtual = guide?.valor != null ? Number(guide.valor) : null;
      const valorOriginal = extratoValor != null
        ? extratoValor
        : (guide?.valorOriginal != null ? Number(guide.valorOriginal) : Number(entry.valor || entry.totalD || 0));
      const recalculado =
        guideValorAtual != null && Math.abs(guideValorAtual - valorOriginal) > 0.01;
      return {
        ...entry,
        valor: valorOriginal,
        totalD: valorOriginal,
        totalC: valorOriginal,
        recalculatedAt: recalculado ? (guide?.updatedAt || entry.recalculatedAt || null) : entry.recalculatedAt,
        recalculatedFromValor: recalculado ? valorOriginal : entry.recalculatedFromValor,
        recalculatedToValor: recalculado ? guideValorAtual : entry.recalculatedToValor,
        recalculatedNotes: recalculado
          ? (entry.recalculatedNotes || "Guia atualizada pelo SERPRO")
          : entry.recalculatedNotes,
      };
    }

    // Provisões sintéticas a partir das guias INSS (não há lançamento contábil PROVISAO para INSS).
    // valorOriginal = valor do extrato (1ª captura, imutável). valor = pode estar recalculado pelo SERPRO.
    // Circular exibe o valor original; badge "↻ R$ X" mostra o recalculado se diferente.
    const inssSynthetic = inssGuides.map((g) => {
      const valorAtual = Number(g.valor || 0);
      const valorOriginal = g.valorOriginal != null ? Number(g.valorOriginal) : valorAtual;
      const valor = valorOriginal; // sempre o original na Circular
      const recalculado = g.valorOriginal != null && Math.abs(valorAtual - valorOriginal) > 0.01;
      const isPaid = String(g.paymentStatus || "").toUpperCase() === "PAID";
      return {
        id: `synthetic-inss-${g.id}`,
        portalClientId,
        circularId: null,
        ruleId: null,
        eventType: "INSS_GUIDE_SYNTHETIC",
        data: g.vencimento || new Date(`${g.competencia}-01T00:00:00.000Z`),
        competencia: g.competencia,
        historico: `INSS DCTFWEB - ${g.competencia}`,
        tipo: "PROVISAO",
        subtipo: "INSS",
        origem: "SERPRO",
        loteImportacao: null,
        status: "RASCUNHO",
        statusPagamento: isPaid ? "PAGO" : "ABERTO",
        openEntryId: null,
        recalculatedAt: recalculado ? g.updatedAt : null,
        recalculatedFromValor: recalculado ? valorOriginal : null,
        recalculatedToValor: recalculado ? valorAtual : null,
        recalculatedNotes: recalculado ? "Guia atualizada pelo SERPRO" : null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: [
          { id: null, entryId: null, conta: "INSS", tipo: "D", valor, ordem: 0, historico: null },
          { id: null, entryId: null, conta: "INSS", tipo: "C", valor, ordem: 1, historico: null },
        ],
        baixas: [],
        totalD: valor,
        totalC: valor,
        valor,
        placeholder: false,
        synthetic: true, // sinaliza ao frontend que é uma "fake provisão"
      };
    });

    // Q5: DARFs agora são AccountingEntry reais (gerados via GuideToProvisionService no momento
    // em que a guia vira PROCESSED). Já aparecem no `provisoes` acima — não há mais sintéticas.

    return res.json({
      year,
      provisoes: [
        ...provisoes.map((p) => enrichDasProvisao(entryToResponse(p))),
        ...inssSynthetic,
      ],
      receitas: receitasPorComp,
    });
  });

  // GET /firm/companies/:companyId/circular/:competencia/accounting-entries
  router.get("/circular/:competencia/accounting-entries", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();

    if (!competencia) return res.status(400).json({ error: "competencia_required" });

    const circular = await prisma.companyMonthlyCircular.findUnique({
      where: {
        portalClientId_competencia: {
          portalClientId,
          competencia,
        },
      },
    });
    if (!circular) return res.status(404).json({ error: "circular_nao_encontrada" });

    const entries = await prisma.accountingEntry.findMany({
      where: {
        portalClientId,
        competencia,
        tipo: { not: "PARCELA" }, // Q16: linhas leves de rastreio não entram na listagem
      },
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });

    const generatedEntries = await prisma.accountingEntry.findMany({
      where: {
        portalClientId,
        competencia,
        origem: "SERPRO",
      },
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });

    return res.json({
      circular,
      entries: generatedEntries.map(entryToResponse),
      allEntries: entries.map(entryToResponse),
    });
  });

  // PATCH /firm/companies/:companyId/circular/:competencia
  router.patch("/circular/:competencia", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });

    const body = req.body || {};
    const data = {};
    if (body.receitaBruta !== undefined) data.receitaBruta = parseMoney(body.receitaBruta);
    if (body.receitaServicos !== undefined) data.receitaServicos = parseMoney(body.receitaServicos) ?? 0;
    if (body.receitaVendas !== undefined) data.receitaVendas = parseMoney(body.receitaVendas) ?? 0;
    if (body.dasTotal !== undefined) data.dasTotal = parseMoney(body.dasTotal);
    if (body.dasNumeroDocumento !== undefined) data.dasNumeroDocumento = String(body.dasNumeroDocumento || "").trim() || null;
    if (body.dasPago !== undefined) data.dasPago = body.dasPago === null ? null : Boolean(body.dasPago);
    if (body.dasDataEmissao !== undefined) data.dasDataEmissao = parseOptionalDate(body.dasDataEmissao);
    if (body.inssTotal !== undefined) data.inssTotal = parseMoney(body.inssTotal);
    if (body.inssVencimento !== undefined) data.inssVencimento = parseOptionalDate(body.inssVencimento);
    if (body.inssPdfFileId !== undefined) data.inssPdfFileId = String(body.inssPdfFileId || "").trim() || null;
    if (body.inssPdfUrl !== undefined) data.inssPdfUrl = String(body.inssPdfUrl || "").trim() || null;
    if (body.inssStatus !== undefined) data.inssStatus = String(body.inssStatus || "").trim().toUpperCase() || null;
    if (body.pgdasNumeroDeclaracao !== undefined) data.pgdasNumeroDeclaracao = String(body.pgdasNumeroDeclaracao || "").trim() || null;
    if (body.pgdasDeclaracaoFileId !== undefined) data.pgdasDeclaracaoFileId = String(body.pgdasDeclaracaoFileId || "").trim() || null;
    if (body.pgdasDeclaracaoFileUrl !== undefined) data.pgdasDeclaracaoFileUrl = String(body.pgdasDeclaracaoFileUrl || "").trim() || null;
    if (body.pgdasReciboFileId !== undefined) data.pgdasReciboFileId = String(body.pgdasReciboFileId || "").trim() || null;
    if (body.pgdasReciboFileUrl !== undefined) data.pgdasReciboFileUrl = String(body.pgdasReciboFileUrl || "").trim() || null;
    if (body.receitaStatus !== undefined) data.receitaStatus = String(body.receitaStatus || "").trim().toUpperCase() || null;
    if (body.dasStatus !== undefined) data.dasStatus = String(body.dasStatus || "").trim().toUpperCase() || null;
    if (body.serproSyncStatus !== undefined) data.serproSyncStatus = String(body.serproSyncStatus || "").trim().toUpperCase() || null;
    if (body.serproLastSyncAt !== undefined) data.serproLastSyncAt = parseOptionalDate(body.serproLastSyncAt);
    if (body.serproLastError !== undefined) data.serproLastError = String(body.serproLastError || "").trim() || null;
    if (body.metadata !== undefined) data.metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : null;

    const computedReceitaBruta =
      body.receitaBruta !== undefined
        ? data.receitaBruta ?? 0
        : (body.receitaServicos !== undefined || body.receitaVendas !== undefined)
          ? Number(data.receitaServicos || 0) + Number(data.receitaVendas || 0)
          : undefined;

    const circular = await prisma.companyMonthlyCircular.upsert({
      where: {
        portalClientId_competencia: { portalClientId, competencia },
      },
      create: {
        portalClientId,
        competencia,
        receitaBruta: computedReceitaBruta ?? data.receitaBruta ?? null,
        receitaServicos: data.receitaServicos ?? 0,
        receitaVendas: data.receitaVendas ?? 0,
        dasTotal: data.dasTotal ?? null,
        dasNumeroDocumento: data.dasNumeroDocumento ?? null,
        dasPago: data.dasPago ?? null,
        dasDataEmissao: data.dasDataEmissao ?? null,
        inssTotal: data.inssTotal ?? null,
        inssVencimento: data.inssVencimento ?? null,
        inssPdfFileId: data.inssPdfFileId ?? null,
        inssPdfUrl: data.inssPdfUrl ?? null,
        inssStatus: data.inssStatus ?? null,
        pgdasNumeroDeclaracao: data.pgdasNumeroDeclaracao ?? null,
        pgdasDeclaracaoFileId: data.pgdasDeclaracaoFileId ?? null,
        pgdasDeclaracaoFileUrl: data.pgdasDeclaracaoFileUrl ?? null,
        pgdasReciboFileId: data.pgdasReciboFileId ?? null,
        pgdasReciboFileUrl: data.pgdasReciboFileUrl ?? null,
        receitaStatus: data.receitaStatus ?? null,
        dasStatus: data.dasStatus ?? null,
        serproSyncStatus: data.serproSyncStatus ?? null,
        serproLastSyncAt: data.serproLastSyncAt ?? null,
        serproLastError: data.serproLastError ?? null,
        metadata: data.metadata ?? null,
      },
      update: {
        ...(body.receitaBruta !== undefined ? { receitaBruta: data.receitaBruta } : {}),
        ...(body.receitaServicos !== undefined ? { receitaServicos: data.receitaServicos } : {}),
        ...(body.receitaVendas !== undefined ? { receitaVendas: data.receitaVendas } : {}),
        ...(body.dasTotal !== undefined ? { dasTotal: data.dasTotal } : {}),
        ...(body.dasNumeroDocumento !== undefined ? { dasNumeroDocumento: data.dasNumeroDocumento } : {}),
        ...(body.dasPago !== undefined ? { dasPago: data.dasPago } : {}),
        ...(body.dasDataEmissao !== undefined ? { dasDataEmissao: data.dasDataEmissao } : {}),
        ...(body.inssTotal !== undefined ? { inssTotal: data.inssTotal } : {}),
        ...(body.inssVencimento !== undefined ? { inssVencimento: data.inssVencimento } : {}),
        ...(body.inssPdfFileId !== undefined ? { inssPdfFileId: data.inssPdfFileId } : {}),
        ...(body.inssPdfUrl !== undefined ? { inssPdfUrl: data.inssPdfUrl } : {}),
        ...(body.inssStatus !== undefined ? { inssStatus: data.inssStatus } : {}),
        ...(body.pgdasNumeroDeclaracao !== undefined ? { pgdasNumeroDeclaracao: data.pgdasNumeroDeclaracao } : {}),
        ...(body.pgdasDeclaracaoFileId !== undefined ? { pgdasDeclaracaoFileId: data.pgdasDeclaracaoFileId } : {}),
        ...(body.pgdasDeclaracaoFileUrl !== undefined ? { pgdasDeclaracaoFileUrl: data.pgdasDeclaracaoFileUrl } : {}),
        ...(body.pgdasReciboFileId !== undefined ? { pgdasReciboFileId: data.pgdasReciboFileId } : {}),
        ...(body.pgdasReciboFileUrl !== undefined ? { pgdasReciboFileUrl: data.pgdasReciboFileUrl } : {}),
        ...(body.receitaStatus !== undefined ? { receitaStatus: data.receitaStatus } : {}),
        ...(body.dasStatus !== undefined ? { dasStatus: data.dasStatus } : {}),
        ...(body.serproSyncStatus !== undefined ? { serproSyncStatus: data.serproSyncStatus } : {}),
        ...(body.serproLastSyncAt !== undefined ? { serproLastSyncAt: data.serproLastSyncAt } : {}),
        ...(body.serproLastError !== undefined ? { serproLastError: data.serproLastError } : {}),
        ...(body.metadata !== undefined ? { metadata: data.metadata } : {}),
      },
    });

    const accounting = await generateEntriesFromCircular({ portalClientId, competencia });
    return res.json({ ok: true, circular, accounting });
  });

  router.post("/circular/:competencia/sync-pgdas", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId || "").trim();
    const competencia = String(req.params.competencia || "").trim();
    const contratanteCnpj = String(req.body?.contratanteCnpj || req.query?.contratanteCnpj || "").trim();

    if (!portalClientId) return res.status(400).json({ ok: false, error: "company_id_required" });
    if (!competencia) return res.status(400).json({ ok: false, error: "competencia_required" });

    try {
      const result = await syncPgdasByCompetencia({
        portalClientId,
        competencia,
        contratanteCnpj: contratanteCnpj || undefined,
      });
      return res.json({ ok: true, result });
    } catch (err) {
      const code = err?.code || "SERPRO_PGDASD_SYNC_FAILED";
      const message = err?.message || "Erro ao sincronizar PGDAS-D.";
      if (
        [
          "SERPRO_INVALID_COMPETENCIA",
          "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED",
          "SERPRO_AUTH_URL_NOT_CONFIGURED",
          "SERPRO_BASE_URL_NOT_CONFIGURED",
          "SERPRO_CONSUMER_KEY_NOT_CONFIGURED",
          "SERPRO_CONSUMER_SECRET_NOT_CONFIGURED",
          "SERPRO_CERTIFICATE_NOT_CONFIGURED",
          "SERPRO_CERT_FILE_NOT_FOUND",
          "SERPRO_CERT_PASSWORD_NOT_FOUND",
          "SERPRO_PGDASD_DADOS_NOT_FOUND",
          "SERPRO_PGDASD_DADOS_INVALID",
          "SERPRO_PGDASD_PDF_INVALID",
          "SERPRO_INVALID_CONTRIBUINTE_CNPJ",
        ].includes(code)
      ) {
        return res.status(400).json({ ok: false, error: code, reason: message });
      }
      if (code === "PORTAL_COMPANY_NOT_FOUND") {
        return res.status(404).json({ ok: false, error: code, reason: message });
      }
      log.error({ err: err?.message || err, code, portalClientId, competencia }, "Falha ao sincronizar PGDAS-D");
      return res.status(502).json({ ok: false, error: code, reason: message, retryable: Boolean(err?.retryable) });
    }
  });

  // GET /firm/companies/:companyId/entries/provisoes  (deve vir antes de /entries/:entryId)
  router.get("/entries/provisoes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, subtipo } = req.query || {};

    const where = {
      portalClientId,
      tipo: "PROVISAO",
      statusPagamento: { in: ["ABERTO", "PAGO"] },
    };
    if (competencia) where.competencia = String(competencia);
    if (subtipo) where.subtipo = String(subtipo).toUpperCase();

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: {
        lines: { orderBy: { ordem: "asc" } },
        baixas: { include: { lines: { orderBy: { ordem: "asc" } } } },
      },
      orderBy: [{ data: "desc" }],
    });

    return res.json({ data: entries.map(entryToResponse) });
  });

  // Q17: FECHAMENTO CONTÁBIL do mês ─────────────────────────────────────────
  // GET estado + bloqueios (lançamentos em branco / desbalanceados).
  router.get("/fechamento-contabil/:competencia", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const circular = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { fechadoContabilEm: true, fechadoContabilPor: true },
      });
      const validation = await validateFechamentoContabil(prisma, { portalClientId, competencia });
      return res.json({
        ok: true,
        competencia,
        fechado: Boolean(circular?.fechadoContabilEm),
        fechadoEm: circular?.fechadoContabilEm || null,
        fechadoPor: circular?.fechadoContabilPor || null,
        podeFechar: validation.ok,
        blockers: validation.blockers,
      });
    } catch (err) {
      log.error({ err }, "Falha ao consultar fechamento contábil");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST fechar — bloqueia se houver lançamento em branco ou desbalanceado.
  router.post("/fechamento-contabil/:competencia/fechar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      const validation = await validateFechamentoContabil(prisma, { portalClientId, competencia });
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: "fechamento_bloqueado", blockers: validation.blockers });
      }
      // Garante a linha da circular (cria se não existir) e marca o fechamento contábil.
      const existing = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { id: true },
      });
      const data = { fechadoContabilEm: new Date(), fechadoContabilPor: req.auth?.user?.id || null };
      if (existing) {
        await prisma.companyMonthlyCircular.update({ where: { id: existing.id }, data });
      } else {
        await prisma.companyMonthlyCircular.create({ data: { portalClientId, competencia, ...data } });
      }
      return res.json({ ok: true, competencia, fechado: true });
    } catch (err) {
      log.error({ err }, "Falha ao fechar empresa (contábil)");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST reabrir — limpa o fechamento contábil.
  router.post("/fechamento-contabil/:competencia/reabrir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia || "").trim();
    if (!competencia) return res.status(400).json({ error: "competencia_required" });
    try {
      await prisma.companyMonthlyCircular.updateMany({
        where: { portalClientId, competencia },
        data: { fechadoContabilEm: null, fechadoContabilPor: null },
      });
      return res.json({ ok: true, competencia, fechado: false });
    } catch (err) {
      log.error({ err }, "Falha ao reabrir empresa (contábil)");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /firm/companies/:companyId/entries/export/csv
  // Query params:
  //   - competencia=YYYY-MM (m\u00EAs \u00FAnico)  OU
  //   - competenciaInicio=YYYY-MM & competenciaFim=YYYY-MM (intervalo inclusivo)
  //   - tipo, status (opcionais)
  router.get("/entries/export/csv", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, competenciaInicio, competenciaFim, tipo, status } = req.query || {};

    const where = { portalClientId };
    let filenameSuffix = "todos";

    if (competenciaInicio && competenciaFim) {
      where.competencia = { gte: String(competenciaInicio), lte: String(competenciaFim) };
      filenameSuffix = `${competenciaInicio}_a_${competenciaFim}`;
    } else if (competenciaInicio) {
      where.competencia = { gte: String(competenciaInicio) };
      filenameSuffix = `desde_${competenciaInicio}`;
    } else if (competenciaFim) {
      where.competencia = { lte: String(competenciaFim) };
      filenameSuffix = `ate_${competenciaFim}`;
    } else if (competencia) {
      where.competencia = String(competencia);
      filenameSuffix = String(competencia);
    }
    if (tipo) where.tipo = String(tipo).toUpperCase();
    else where.tipo = { not: "PARCELA" }; // Q16: rastreio de parcela não vai pro CSV
    if (status) where.status = String(status).toUpperCase();

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ competencia: "asc" }, { data: "asc" }, { createdAt: "asc" }],
    });

    const csv = entriesToCsv(entries);
    const filename = `lancamentos-${filenameSuffix}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // Q8.A.6: sanitiza filename (defesa contra header injection).
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(filename)}"`);
    return res.send("\uFEFF" + csv);
  });

  // GET /firm/companies/:companyId/entries
  router.get("/entries", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, tipo, subtipo, origem, status, statusPagamento, page = "1", limit = "50" } = req.query || {};

    const where = { portalClientId };
    if (competencia) where.competencia = String(competencia);
    if (tipo) where.tipo = String(tipo).toUpperCase();
    else where.tipo = { not: "PARCELA" }; // Q16: rastreio de parcela fora da lista de lançamentos
    if (subtipo) where.subtipo = String(subtipo).toUpperCase();
    if (origem) where.origem = String(origem).toUpperCase();
    if (status) where.status = String(status).toUpperCase();
    if (statusPagamento) where.statusPagamento = String(statusPagamento).toUpperCase();

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(200, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [entries, total] = await Promise.all([
      prisma.accountingEntry.findMany({
        where,
        include: { lines: { orderBy: { ordem: "asc" } } },
        orderBy: [{ data: "asc" }, { createdAt: "asc" }],
        skip,
        take: limitNum,
      }),
      prisma.accountingEntry.count({ where }),
    ]);

    return res.json({ data: entries.map(entryToResponse), page: pageNum, limit: limitNum, total });
  });

  // ─── Históricos ───────────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/historicos?q=texto
  router.get("/historicos", requireFirmCompanyAccess(), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    if (!userId) return res.json([]);

    const q = String(req.query.q || "").trim();
    const rawLimit = parseInt(String(req.query.limit || "12"), 10);
    const take = Math.min(200, rawLimit > 0 ? rawLimit : 12);

    const where = {
      createdByUserId: userId,
      OR: [
        { companyPortalClientId: companyPortalClientId },
        { companyPortalClientId: null },
      ],
    };
    if (q.length >= 2) {
      where.text = { contains: q, mode: "insensitive" };
    }

    try {
      const results = await prisma.accountingHistorico.findMany({
        where,
        orderBy: [{ usageCount: "desc" }, { text: "asc" }],
        take,
      });

      return res.json(results.map((h) => ({
        id: h.id,
        text: h.text,
        contaDebito: h.contaDebito,
        contaCredito: h.contaCredito,
        scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
        usageCount: h.usageCount,
      })));
    } catch (err) {
      log.warn({ err }, "Falha ao buscar históricos");
      return res.json([]);
    }
  });

  // GET /firm/companies/:companyId/historicos/by-code/:codigo
  router.get("/historicos/by-code/:codigo", requireFirmCompanyAccess(), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const codigo = String(req.params.codigo || "").trim();
    const userId = req.auth?.user?.id;
    if (!userId || !codigo) return res.json([]);

    try {
      const results = await prisma.accountingHistorico.findMany({
        where: {
          createdByUserId: userId,
          AND: [
            { OR: [{ companyPortalClientId: companyPortalClientId }, { companyPortalClientId: null }] },
            { OR: [{ contaDebito: codigo }, { contaCredito: codigo }] },
          ],
        },
        orderBy: [{ usageCount: "desc" }, { text: "asc" }],
        take: 10,
      });

      return res.json(results.map((h) => ({
        id: h.id,
        text: h.text,
        contaDebito: h.contaDebito,
        contaCredito: h.contaCredito,
        scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL",
        usageCount: h.usageCount,
      })));
    } catch (err) {
      log.warn({ err }, "Falha ao buscar históricos por código");
      return res.json([]);
    }
  });

  // POST /firm/companies/:companyId/historicos
  router.post("/historicos", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const body = req.body || {};
    const text = String(body.text || "").trim();
    const scope = String(body.scope || "COMPANY").toUpperCase();
    const contaDebito = body.contaDebito ? String(body.contaDebito).trim() : null;
    const contaCredito = body.contaCredito ? String(body.contaCredito).trim() : null;

    if (!text) return res.status(400).json({ error: "text_required" });

    const compId = scope === "GLOBAL" ? null : companyPortalClientId;

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { createdByUserId: userId, companyPortalClientId: compId, text },
      });

      let historico;
      if (existing) {
        historico = await prisma.accountingHistorico.update({
          where: { id: existing.id },
          data: { contaDebito, contaCredito, usageCount: existing.usageCount + 1, updatedAt: new Date() },
        });
      } else {
        historico = await prisma.accountingHistorico.create({
          data: { createdByUserId: userId, companyPortalClientId: compId, text, contaDebito, contaCredito },
        });
      }

      return res.status(201).json({ ok: true, historico });
    } catch (err) {
      log.error({ err }, "Erro ao salvar histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/historicos/:historicoId
  router.patch("/historicos/:historicoId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const companyPortalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    const historicoId = String(req.params.historicoId);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { id: historicoId, createdByUserId: userId },
      });
      if (!existing) return res.status(404).json({ error: "historico_nao_encontrado" });

      const body = req.body || {};
      const data = {};

      if (body.scope !== undefined) {
        const scope = String(body.scope).toUpperCase();
        data.companyPortalClientId = scope === "GLOBAL" ? null : companyPortalClientId;
      }
      if (body.contaDebito !== undefined) data.contaDebito = body.contaDebito ? String(body.contaDebito).trim() : null;
      if (body.contaCredito !== undefined) data.contaCredito = body.contaCredito ? String(body.contaCredito).trim() : null;

      const updated = await prisma.accountingHistorico.update({
        where: { id: historicoId },
        data: { ...data, updatedAt: new Date() },
      });

      return res.json({
        ok: true,
        historico: { ...updated, scope: updated.companyPortalClientId ? "COMPANY" : "GLOBAL" },
      });
    } catch (err) {
      log.error({ err }, "Erro ao atualizar histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // DELETE /firm/companies/:companyId/historicos/:historicoId
  router.delete("/historicos/:historicoId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const userId = req.auth?.user?.id;
    const historicoId = String(req.params.historicoId);

    try {
      const existing = await prisma.accountingHistorico.findFirst({
        where: { id: historicoId, createdByUserId: userId },
      });
      if (!existing) return res.status(404).json({ error: "historico_nao_encontrado" });

      await prisma.accountingHistorico.delete({ where: { id: historicoId } });
      return res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "Erro ao excluir histórico");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // ─── Lançamentos ─────────────────────────────────────────────────────────

  // POST /firm/companies/:companyId/entries/parcelamento
  // Cria N parcelas de um parcelamento (Simples Nacional, INSS, etc.) em uma transaction.
  // Cada parcela vira 1 AccountingEntry com subtipo=PARC_DAS, tipo=PROVISAO, statusPagamento=ABERTO,
  // com 3 linhas: D principal + D juros + C contrapartida (total = principal + juros).
  // Histórico inclui "N/<numero>" para identificar a parcela ("N/1", "N/2", ..., "N/9").
  router.post(
    "/entries/parcelamento",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const body = req.body || {};

      const principalAccount = String(body.principalAccount || "").trim();
      const jurosAccount = String(body.jurosAccount || "").trim();
      const contraAccount = String(body.contraAccount || "").trim();
      const principalValue = Number(body.principalValue);
      const jurosValue = Number(body.jurosValue || 0);
      const numParcelas = Math.min(60, Math.max(1, Number(body.numParcelas) || 1));
      const competenciaInicial = String(body.competenciaInicial || "").trim();
      const diaPagamento = Math.min(31, Math.max(1, Number(body.diaPagamento) || 1));
      const periodosReferenciados = String(body.periodosReferenciados || "").trim();
      const labelParcelamento = String(body.label || "PARCELAMENTO SIMPLES NACIONAL").trim();

      // Validações
      if (!principalAccount || !contraAccount) {
        return res.status(400).json({ error: "contas_principal_e_contrapartida_obrigatorias" });
      }
      if (!Number.isFinite(principalValue) || principalValue <= 0) {
        return res.status(400).json({ error: "principal_value_invalido" });
      }
      if (!/^\d{4}-\d{2}$/.test(competenciaInicial)) {
        return res.status(400).json({ error: "competencia_inicial_invalida" });
      }
      // Se houver juros, jurosAccount é obrigatório
      if (Number.isFinite(jurosValue) && jurosValue > 0 && !jurosAccount) {
        return res.status(400).json({ error: "juros_account_required" });
      }

      // Helpers locais
      function addMonthsToCompetencia(comp, n) {
        const [yyyy, mm] = comp.split("-").map(Number);
        const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      }
      function buildDate(comp, dayOfMonth) {
        const [yyyy, mm] = comp.split("-").map(Number);
        // Se o dia não existir no mês (ex: 31 em fev), usa o último dia.
        const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
        const dayReal = Math.min(dayOfMonth, lastDay);
        return new Date(Date.UTC(yyyy, mm - 1, dayReal));
      }

      const totalLinha = Number(((principalValue + (jurosValue || 0)) * 100).toFixed(0)) / 100;
      const loteImportacao = `PARC_DAS-${Date.now()}`;
      const created = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < numParcelas; i++) {
            const competenciaN = addMonthsToCompetencia(competenciaInicial, i);
            const dataN = buildDate(competenciaN, diaPagamento);
            const numeroParcela = i + 1;
            const sufixoPeriodos = periodosReferenciados ? ` DE ${periodosReferenciados}` : "";
            const historicoPrincipal =
              `VR REF ${labelParcelamento}${sufixoPeriodos} EM ${numParcelas} PARCELAS N/${numeroParcela}`;
            const historicoJuros =
              `VR REF JUROS S/${labelParcelamento}${sufixoPeriodos} EM ${numParcelas} PARCELAS N/${numeroParcela}`;

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataN,
                competencia: competenciaN,
                historico: historicoPrincipal,
                tipo: "PROVISAO",
                subtipo: "PARC_DAS",
                origem: "MANUAL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "ABERTO",
              },
            });

            const linhas = [
              {
                entryId: entry.id, conta: principalAccount, tipo: "D",
                valor: principalValue, ordem: 0, historico: historicoPrincipal,
              },
            ];
            if (jurosValue > 0) {
              linhas.push({
                entryId: entry.id, conta: jurosAccount, tipo: "D",
                valor: jurosValue, ordem: 1, historico: historicoJuros,
              });
            }
            linhas.push({
              entryId: entry.id, conta: contraAccount, tipo: "C",
              valor: totalLinha, ordem: linhas.length, historico: historicoPrincipal,
            });

            await tx.accountingEntryLine.createMany({ data: linhas });
            created.push({
              parcela: numeroParcela,
              entryId: entry.id,
              competencia: competenciaN,
              data: dataN.toISOString(),
              valor: totalLinha,
            });
          }
        });
        return res.status(201).json({ ok: true, loteImportacao, created, totalParcelas: numParcelas });
      } catch (err) {
        log.error({ err }, "Erro ao criar parcelamento Simples Nacional");
        return res.status(500).json({ ok: false, error: "internal_error", message: err?.message });
      }
    },
  );

  // POST /firm/companies/:companyId/entries
  router.post("/entries", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const body = req.body || {};

    const data = body.data ? new Date(body.data) : null;
    const historico = String(body.historico || "").trim();
    const tipo = String(body.tipo || "DESPESA").toUpperCase();
    const subtipo = body.subtipo ? String(body.subtipo).toUpperCase() : null;
    // statusPagamento é sempre derivado do tipo no backend — nunca aceitar do frontend
    const statusPagamento = tipo === "PROVISAO" ? "ABERTO" : "NA";
    const origem = "MANUAL";
    const lines = body.lines;

    if (!data || isNaN(data.getTime())) return res.status(400).json({ error: "data_invalida" });
    if (!historico) return res.status(400).json({ error: "historico_required" });

    const validation = validateLines(lines);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        totalD: validation.totalD,
        totalC: validation.totalC,
        diferenca: validation.diferenca,
      });
    }

    const competencia = `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;

    try {
      const entry = await prisma.$transaction(async (tx) => {
        const created = await tx.accountingEntry.create({
          data: {
            portalClientId,
            data,
            competencia,
            historico,
            tipo,
            subtipo,
            origem,
            statusPagamento,
            status: "RASCUNHO",
          },
        });
        await tx.accountingEntryLine.createMany({
          data: lines.map((l, idx) => ({
            entryId: created.id,
            conta: String(l.conta).trim(),
            tipo: String(l.tipo).toUpperCase(),
            valor: parseFloat(String(l.valor).replace(",", ".")),
            ordem: idx,
            historico: l.historico ? String(l.historico).trim() : null,
          })),
        });

        // Se for PROVISÃO, criar placeholders para os meses do ano sem cobertura
        if (tipo === "PROVISAO" && subtipo) {
          await createProvisionPlaceholders(tx, {
            portalClientId,
            subtipo,
            competenciaOrigem: competencia,
            historico: historico.length <= 60 ? historico : subtipo,
          });
        }

        return tx.accountingEntry.findUnique({
          where: { id: created.id },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
      });

      // Auto-save do histórico (fora da transaction principal — não é crítico).
      // Para entries automáticos (que vieram do gerador), o body inclui `eventType` —
      // gravamos esse marcador para permitir o lookup futuro (mesma empresa + mesmo eventType
      // já tem D/C memorizados, próxima sync auto-preenche em vez de vir vazio).
      const userId = req.auth?.user?.id;
      const bodyEventType = body?.eventType ? String(body.eventType).trim() : null;
      if (userId && historico) {
        const debitLine = lines.find((l) => String(l.tipo).toUpperCase() === "D");
        const creditLine = lines.find((l) => String(l.tipo).toUpperCase() === "C");
        const contaD = debitLine ? String(debitLine.conta || "").trim() || null : null;
        const contaC = creditLine ? String(creditLine.conta || "").trim() || null : null;
        try {
          const existing = await prisma.accountingHistorico.findFirst({
            where: { createdByUserId: userId, companyPortalClientId: portalClientId, text: historico },
          });
          if (existing) {
            await prisma.accountingHistorico.update({
              where: { id: existing.id },
              data: {
                contaDebito: contaD ?? existing.contaDebito,
                contaCredito: contaC ?? existing.contaCredito,
                eventType: bodyEventType ?? existing.eventType,
                usageCount: existing.usageCount + 1,
                updatedAt: new Date(),
              },
            });
          } else {
            await prisma.accountingHistorico.create({
              data: {
                createdByUserId: userId,
                companyPortalClientId: portalClientId,
                text: historico,
                contaDebito: contaD,
                contaCredito: contaC,
                eventType: bodyEventType,
              },
            });
          }
        } catch (histErr) {
          log.warn({ histErr }, "Falha ao auto-salvar histórico (não crítico)");
        }
      }

      return res.status(201).json({ ok: true, entry: entryToResponse(entry) });
    } catch (err) {
      log.error({ err }, "Erro ao criar lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PUT /firm/companies/:companyId/entries/:entryId
  router.put("/entries/:entryId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);
    const body = req.body || {};

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    const data = {};
    if (body.data) {
      const d = new Date(body.data);
      if (!isNaN(d.getTime())) {
        data.data = d;
        data.competencia = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      }
    }
    if (body.historico !== undefined) data.historico = String(body.historico).trim();
    if (body.tipo !== undefined) data.tipo = String(body.tipo).toUpperCase();
    if (body.subtipo !== undefined) data.subtipo = body.subtipo ? String(body.subtipo).toUpperCase() : null;
    if (body.statusPagamento !== undefined) data.statusPagamento = String(body.statusPagamento).toUpperCase();
    if (body.status !== undefined && ["RASCUNHO", "CONFIRMADO"].includes(String(body.status))) {
      data.status = String(body.status);
    }

    const lines = body.lines;
    const isTemplate = existing.origem === "TEMPLATE";

    if (lines !== undefined) {
      // Template sendo preenchido pela primeira vez: não valida se lines estiver vazio
      const validation = validateLines(lines);
      if (!validation.ok) {
        // Se o entry é um template e não há linhas ainda, isso é válido (continua como template)
        if (!(isTemplate && lines.length === 0)) {
          // Log detalhado para diagnosticar saves rejeitados (lines vazias, conta sem código, etc).
          log.warn(
            {
              entryId,
              portalClientId,
              validationError: validation.error,
              linesSummary: (lines || []).map((l) => ({
                tipo: l?.tipo,
                contaLen: String(l?.conta || "").length,
                valor: l?.valor,
              })),
            },
            "PUT /entries — validação de linhas falhou"
          );
          return res.status(400).json({
            error: validation.error,
            totalD: validation.totalD,
            totalC: validation.totalC,
            diferenca: validation.diferenca,
          });
        }
      } else if (isTemplate && lines.length > 0) {
        // Template sendo preenchido com linhas válidas: promover a MANUAL
        data.origem = "MANUAL";
      }
    }

    // Não permitir CONFIRMADO se for template (sem linhas)
    if (data.status === "CONFIRMADO" && isTemplate && lines === undefined) {
      return res.status(400).json({ error: "template_sem_valor" });
    }

    // statusPagamento é sempre derivado do tipo — ignorar o que vier do frontend
    delete data.statusPagamento;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const entry = await tx.accountingEntry.update({
          where: { id: entryId },
          data,
        });
        if (lines !== undefined && lines.length > 0) {
          await tx.accountingEntryLine.deleteMany({ where: { entryId } });
          await tx.accountingEntryLine.createMany({
            data: lines.map((l, idx) => ({
              entryId,
              conta: String(l.conta).trim(),
              tipo: String(l.tipo).toUpperCase(),
              valor: parseFloat(String(l.valor).replace(",", ".")),
              ordem: idx,
              historico: l.historico ? String(l.historico).trim() : null,
            })),
          });
        }
        return tx.accountingEntry.findUnique({
          where: { id: entryId },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
      });

      // Auto-save do histórico (mesma lógica do POST). Para entries automáticos editados pelo
      // contador, gravamos `eventType` para que sync seguinte da mesma empresa auto-preencha D/C.
      const userId = req.auth?.user?.id;
      const bodyEventType = body?.eventType
        ? String(body.eventType).trim()
        : (updated?.eventType ? String(updated.eventType).trim() : null);
      const finalLines = Array.isArray(updated?.lines) ? updated.lines : [];
      const finalHistorico = updated?.historico || data.historico || null;
      if (userId && finalHistorico) {
        const debitLine = finalLines.find((l) => String(l.tipo).toUpperCase() === "D");
        const creditLine = finalLines.find((l) => String(l.tipo).toUpperCase() === "C");
        const contaD = debitLine ? String(debitLine.conta || "").trim() || null : null;
        const contaC = creditLine ? String(creditLine.conta || "").trim() || null : null;
        // Só auto-saveia se tiver pelo menos uma conta preenchida (evita gravar memória vazia)
        if (contaD || contaC) {
          try {
            const existingHist = await prisma.accountingHistorico.findFirst({
              where: { createdByUserId: userId, companyPortalClientId: portalClientId, text: finalHistorico },
            });
            if (existingHist) {
              await prisma.accountingHistorico.update({
                where: { id: existingHist.id },
                data: {
                  contaDebito: contaD ?? existingHist.contaDebito,
                  contaCredito: contaC ?? existingHist.contaCredito,
                  eventType: bodyEventType ?? existingHist.eventType,
                  usageCount: existingHist.usageCount + 1,
                  updatedAt: new Date(),
                },
              });
            } else {
              await prisma.accountingHistorico.create({
                data: {
                  createdByUserId: userId,
                  companyPortalClientId: portalClientId,
                  text: finalHistorico,
                  contaDebito: contaD,
                  contaCredito: contaC,
                  eventType: bodyEventType,
                },
              });
            }
          } catch (histErr) {
            log.warn({ histErr }, "Falha ao auto-salvar histórico no PUT (não crítico)");
          }
        }
      }

      // Q16: entries de parcelamento (abertura/baixa) memorizam contas POR LINHA, pra a
      // próxima abertura/baixa da mesma empresa (mesmo kind) vir pré-preenchida.
      if (existing.parcelamentoId && Array.isArray(updated?.lines) && updated.lines.length > 0) {
        try {
          const { memorizeParcelamentoLineAccounts } = await import(
            "../../application/accounting/ParcelamentoService.js"
          );
          await memorizeParcelamentoLineAccounts({
            userId: req.auth?.user?.id,
            portalClientId,
            entry: updated,
          });
        } catch (memErr) {
          log.warn({ memErr }, "Falha ao memorizar contas de parcelamento (não crítico)");
        }
      }

      return res.json({ ok: true, entry: entryToResponse(updated) });
    } catch (err) {
      log.error({ err }, "Erro ao atualizar lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // PATCH /firm/companies/:companyId/entries/:entryId/approve
  router.patch("/entries/:entryId/approve", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    const updated = await prisma.accountingEntry.update({
      where: { id: entryId },
      data: { status: "CONFIRMADO" },
      include: { lines: { orderBy: { ordem: "asc" } } },
    });

    return res.json({ ok: true, entry: entryToResponse(updated) });
  });

  // DELETE /firm/companies/:companyId/entries/:entryId
  router.delete("/entries/:entryId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const existing = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!existing) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (existing.status === "EXPORTADO") {
      return res.status(400).json({ error: "lancamento_ja_exportado" });
    }

    if (existing.tipo === "BAIXA" && existing.openEntryId) {
      await prisma.$transaction(async (tx) => {
        await tx.accountingEntry.delete({ where: { id: entryId } });
        await tx.accountingEntry.updateMany({
          where: { id: existing.openEntryId, portalClientId },
          data: { statusPagamento: "ABERTO" },
        });
      });
    } else {
      await prisma.accountingEntry.delete({ where: { id: entryId } });
    }
    return res.json({ ok: true });
  });

  // GET /firm/companies/:companyId/entries/:entryId/baixa-template
  // Resolve a regra de BAIXA para uma provisão, retornando contas/histórico pré-preenchidos.
  router.get("/entries/:entryId/baixa-template", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);

    const entry = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
      include: { lines: { orderBy: { ordem: "asc" } } },
    });
    if (!entry) return res.status(404).json({ error: "lancamento_nao_encontrado" });

    const baixaEventType = entry.eventType ? PROVISAO_TO_BAIXA_EVENT[entry.eventType] : null;
    if (!baixaEventType) {
      return res.json({ ok: true, template: null, reason: "no_baixa_mapping" });
    }

    const company = await prisma.portalClient.findUnique({
      where: { id: portalClientId },
      select: { razao: true, cnpj: true },
    });

    const rule = await resolveRule(prisma, { portalClientId, eventType: baixaEventType });
    if (!rule || !rule.debitAccountCode || !rule.creditAccountCode) {
      return res.json({ ok: true, template: null, reason: "rule_not_configured" });
    }

    const totalD = (entry.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
    const valor = totalD > 0 ? totalD : Number(entry.valor || 0);

    const historico = applyTemplate(rule.descriptionTemplate || "", {
      competencia: entry.competencia,
      competenciaLabel: formatCompetenciaLabel(entry.competencia),
      companyName: company?.razao || "",
      cnpj: company?.cnpj || "",
    });

    return res.json({
      ok: true,
      template: {
        eventType: baixaEventType,
        debitAccountCode: rule.debitAccountCode,
        creditAccountCode: rule.creditAccountCode,
        historico,
        valor,
        ruleId: rule.id || null,
        scope: rule.id ? (rule.portalClientId ? "COMPANY" : "GLOBAL") : "FALLBACK",
      },
    });
  });

  // POST /firm/companies/:companyId/entries/:entryId/baixa
  router.post("/entries/:entryId/baixa", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const entryId = String(req.params.entryId);
    const body = req.body || {};

    const openEntry = await prisma.accountingEntry.findFirst({
      where: { id: entryId, portalClientId },
    });
    if (!openEntry) return res.status(404).json({ error: "lancamento_nao_encontrado" });
    if (openEntry.statusPagamento !== "ABERTO") {
      return res.status(400).json({ error: "lancamento_nao_esta_aberto" });
    }

    const data = body.data ? new Date(body.data) : null;
    const historico = String(body.historico || "").trim();
    const lines = body.lines;

    if (!data || isNaN(data.getTime())) return res.status(400).json({ error: "data_invalida" });
    if (!historico) return res.status(400).json({ error: "historico_required" });

    const validation = validateLines(lines);
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        totalD: validation.totalD,
        totalC: validation.totalC,
        diferenca: validation.diferenca,
      });
    }

    const competencia = `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const baixa = await tx.accountingEntry.create({
          data: {
            portalClientId,
            data,
            competencia,
            historico,
            tipo: "BAIXA",
            openEntryId: entryId,
            origem: "MANUAL",
            statusPagamento: "NA",
            status: "CONFIRMADO",
          },
        });
        await tx.accountingEntryLine.createMany({
          data: lines.map((l, idx) => ({
            entryId: baixa.id,
            conta: String(l.conta).trim(),
            tipo: String(l.tipo).toUpperCase(),
            valor: parseFloat(String(l.valor).replace(",", ".")),
            ordem: idx,
          })),
        });
        const updatedOpen = await tx.accountingEntry.update({
          where: { id: entryId },
          data: { statusPagamento: "PAGO" },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
        const fullBaixa = await tx.accountingEntry.findUnique({
          where: { id: baixa.id },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
        return { entry: fullBaixa, openEntry: updatedOpen };
      });
      return res.status(201).json({
        ok: true,
        entry: entryToResponse(result.entry),
        openEntry: entryToResponse(result.openEntry),
      });
    } catch (err) {
      log.error({ err }, "Erro ao criar baixa");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/entries/import/ofx
  // Modo preview (?preview=1 OU multipart com file): parsea OFX e casa com históricos existentes
  // Modo commit (JSON body com transactions): cria entries enriquecidos linha-a-linha + auto-save de histórico
  router.post(
    "/entries/import/ofx",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const userId = req.auth?.user?.id;
      const isPreview = req.query.preview === "1" || req.body?.preview === true || Boolean(req.file?.buffer);

      // ── Modo preview: parsea arquivo + casa com históricos ────────────────
      if (isPreview) {
        if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

        const parsed = parseOfx(req.file.buffer);
        if (!parsed.length) {
          return res.status(422).json({ error: "nenhuma_transacao_encontrada" });
        }

        // O parser chama o memo do banco de `historico`. Usamos isso como chave de match.
        const descriptions = parsed.map((t) => t.historico);
        const matches = await findHistoricoMatches({ portalClientId, userId, descriptions });

        const transactions = parsed.map((t, i) => ({
          rowIndex: i,
          data: t.data.toISOString().slice(0, 10),
          // Renomeia explicitamente: descricaoOfx é o memo do banco (chave de match).
          descricaoOfx: t.historico,
          valor: t.valor,
          sinal: t.sinal,
          trnType: t.trnType,
          fitId: t.fitId,
          match: matches[i] || null,
        }));

        return res.json({ ok: true, transactions, total: transactions.length });
      }

      // ── Modo commit: cria entries linha-a-linha + auto-saves de histórico ─
      const body = req.body || {};
      const transactions = Array.isArray(body.transactions) ? body.transactions : [];
      if (!transactions.length) return res.status(400).json({ error: "transactions_required" });

      const loteImportacao = `OFX-${Date.now()}`;
      const created = [];
      const failed = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const contaDebito = String(t.contaDebito || "").trim();
            const contaCredito = String(t.contaCredito || "").trim();
            const valor = Number(t.valor);
            const historico = String(t.historico || "").trim();
            const dataStr = String(t.data || "").slice(0, 10);
            if (!contaDebito || !contaCredito || !historico || !valor || !dataStr) {
              failed.push({ rowIndex: t.rowIndex, reason: "campos_obrigatorios" });
              continue;
            }
            const dataDate = new Date(`${dataStr}T00:00:00.000Z`);
            if (Number.isNaN(dataDate.getTime())) {
              failed.push({ rowIndex: t.rowIndex, reason: "data_invalida" });
              continue;
            }
            const competencia = `${dataDate.getUTCFullYear()}-${String(dataDate.getUTCMonth() + 1).padStart(2, "0")}`;
            const tipo = String(t.tipo || "DESPESA").toUpperCase();

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataDate,
                competencia,
                historico,
                tipo,
                origem: "OFX",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: contaDebito, tipo: "D", valor, ordem: 0 },
                { entryId: entry.id, conta: contaCredito, tipo: "C", valor, ordem: 1 },
              ],
            });
            created.push({ rowIndex: t.rowIndex, entryId: entry.id });
          }
        });
      } catch (err) {
        log.error({ err }, "Erro ao importar OFX (commit)");
        return res.status(500).json({ error: "internal_error", message: err?.message });
      }

      // Auto-save de histórico (fora da transaction principal — falha por linha não derruba o batch).
      // text = descrição OFX (chave de match) | historicoSugerido = histórico contábil digitado pelo contador.
      if (userId) {
        for (const t of transactions) {
          const contaDebito = String(t.contaDebito || "").trim();
          const contaCredito = String(t.contaCredito || "").trim();
          const descricaoOfx = String(t.descricaoOfx || "").trim();
          const historico = String(t.historico || "").trim();
          if (!descricaoOfx || !contaDebito || !contaCredito) continue;
          await upsertHistoricoFromImport({
            userId,
            portalClientId,
            text: descricaoOfx,
            contaDebito,
            contaCredito,
            historicoSugerido: historico,
          });
        }
      }

      return res.status(201).json({
        ok: true,
        created: created.length,
        failed: failed.length,
        loteImportacao,
        details: { created, failed },
      });
    }
  );

  // POST /firm/companies/:companyId/entries/import/excel?preview=1
  // Preview: parsea o Excel e tenta casar cada descrição com históricos existentes.
  router.post(
    "/entries/import/excel",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const userId = req.auth?.user?.id;
      const isPreview = req.query.preview === "1" || req.body?.preview === true;

      // ── Modo preview: parsea arquivo + match ────────────────────────────
      if (isPreview) {
        if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });
        let parsed;
        try {
          parsed = parseExcelBuffer(req.file.buffer);
        } catch (err) {
          if (err?.code === "EXCEL_TOO_MANY_ROWS") {
            return res.status(422).json({ error: "excel_too_many_rows", message: err.message });
          }
          log.error({ err }, "Falha ao parsear Excel");
          return res.status(422).json({ error: "excel_parse_failed", message: err?.message });
        }
        if (!parsed.length) {
          return res.status(422).json({ error: "nenhuma_transacao_encontrada" });
        }

        const matches = await findHistoricoMatches({
          portalClientId,
          userId,
          descriptions: parsed.map((t) => t.descricao),
        });

        const transactions = parsed.map((t, i) => ({
          rowIndex: t.rowIndex,
          data: t.data.toISOString().slice(0, 10),
          descricao: t.descricao,
          valor: t.valor,
          match: matches[i] || null,
        }));
        return res.json({ ok: true, transactions, total: transactions.length });
      }

      // ── Modo commit: cria entries + auto-saves de histórico ─────────────
      const body = req.body || {};
      const transactions = Array.isArray(body.transactions) ? body.transactions : [];
      if (!transactions.length) return res.status(400).json({ error: "transactions_required" });

      const loteImportacao = `EXCEL-${Date.now()}`;
      const created = [];
      const failed = [];

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const contaDebito = String(t.contaDebito || "").trim();
            const contaCredito = String(t.contaCredito || "").trim();
            const valor = Number(t.valor);
            const descricao = String(t.descricao || "").trim();
            const dataStr = String(t.data || "").slice(0, 10);
            if (!contaDebito || !contaCredito || !descricao || !valor || !dataStr) {
              failed.push({ rowIndex: t.rowIndex, reason: "campos_obrigatorios" });
              continue;
            }
            const dataDate = new Date(`${dataStr}T00:00:00.000Z`);
            if (Number.isNaN(dataDate.getTime())) {
              failed.push({ rowIndex: t.rowIndex, reason: "data_invalida" });
              continue;
            }
            const competencia = `${dataDate.getUTCFullYear()}-${String(dataDate.getUTCMonth() + 1).padStart(2, "0")}`;
            const tipo = String(t.tipo || "DESPESA").toUpperCase();

            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: dataDate,
                competencia,
                historico: descricao,
                tipo,
                origem: "EXCEL",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: contaDebito, tipo: "D", valor, ordem: 0 },
                { entryId: entry.id, conta: contaCredito, tipo: "C", valor, ordem: 1 },
              ],
            });
            created.push({ rowIndex: t.rowIndex, entryId: entry.id });
          }
        });
      } catch (err) {
        log.error({ err }, "Erro ao importar Excel (commit)");
        return res.status(500).json({ error: "internal_error", message: err?.message });
      }

      // Auto-save de histórico (fora da transaction principal — cada falha não derruba o batch)
      if (userId) {
        for (const t of transactions) {
          const contaDebito = String(t.contaDebito || "").trim();
          const contaCredito = String(t.contaCredito || "").trim();
          const descricao = String(t.descricao || "").trim();
          if (!descricao || !contaDebito || !contaCredito) continue;
          await upsertHistoricoFromImport({
            userId, portalClientId, text: descricao, contaDebito, contaCredito,
          });
        }
      }

      return res.status(201).json({
        ok: true,
        created: created.length,
        failed: failed.length,
        loteImportacao,
        details: { created, failed },
      });
    }
  );

  // ─── Q6: Funções de Lançamento ──────────────────────────────────────────

  // GET /firm/companies/:companyId/accounting-functions  → lista GLOBAL + da empresa
  router.get("/accounting-functions", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const { listAccountingFunctionsForCompany } = await import("../../application/accounting/AccountingFunctionService.js");
      const funcs = await listAccountingFunctionsForCompany(portalClientId);
      return res.json({ ok: true, data: funcs });
    } catch (err) {
      log.error({ err }, "Falha ao listar funções de lançamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/accounting-functions  → cria função
  router.post("/accounting-functions", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    try {
      const { createAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const func = await createAccountingFunction({ portalClientId, userId, payload: req.body || {} });
      return res.status(201).json({ ok: true, data: func });
    } catch (err) {
      const code = err?.message || "internal_error";
      const status = code === "name_required" || code === "entries_required" ? 400 : 500;
      if (status === 500) log.error({ err }, "Falha ao criar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // PUT /firm/companies/:companyId/accounting-functions/:functionId  → atualiza (bloqueia isSystem)
  router.put("/accounting-functions/:functionId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    try {
      const { updateAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const func = await updateAccountingFunction({ portalClientId, functionId, payload: req.body || {} });
      return res.json({ ok: true, data: func });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        function_not_found: 404,
        system_function_immutable: 403,
        function_scope_mismatch: 403,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao atualizar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // DELETE /firm/companies/:companyId/accounting-functions/:functionId
  router.delete("/accounting-functions/:functionId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    try {
      const { deleteAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      await deleteAccountingFunction({ portalClientId, functionId });
      return res.json({ ok: true });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        function_not_found: 404,
        system_function_immutable: 403,
        function_scope_mismatch: 403,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao excluir função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/accounting-functions/:functionId/apply
  // body: { competencia, entryValores: [{ functionEntryId, valor, data? }] }
  router.post("/accounting-functions/:functionId/apply", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const functionId = String(req.params.functionId);
    const { competencia, entryValores } = req.body || {};
    try {
      const { applyAccountingFunction } = await import("../../application/accounting/AccountingFunctionService.js");
      const result = await applyAccountingFunction({ portalClientId, functionId, competencia, entryValores });
      return res.status(201).json(result);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        competencia_required: 400,
        function_not_found: 404,
        function_scope_mismatch: 403,
        company_not_found: 404,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao aplicar função");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // ─── Q9: Parcelamentos ──────────────────────────────────────────────────

  // GET /firm/companies/:companyId/parcelamentos[?status=ATIVO|QUITADO|RESCINDIDO]
  router.get("/parcelamentos", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const status = req.query?.status ? String(req.query.status).toUpperCase() : null;
    try {
      const { listParcelamentos } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await listParcelamentos({ portalClientId, status });
      return res.json({ ok: true, data });
    } catch (err) {
      log.error({ err }, "Falha ao listar parcelamentos");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /firm/companies/:companyId/parcelamentos/:parcId
  router.get("/parcelamentos/:parcId", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    try {
      const { getParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await getParcelamento({ portalClientId, parcelamentoId });
      if (!data) return res.status(404).json({ ok: false, error: "parcelamento_not_found" });
      return res.json({ ok: true, data });
    } catch (err) {
      log.error({ err }, "Falha ao obter parcelamento");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos
  // body: { label, kind, templateOpeningFunctionId, templatePaymentFunctionId, templateRescisionFunctionId,
  //         numEntradas, numParcelas, principalPerParcela, principalTotal, jurosTotal,
  //         dataAbertura, competenciaInicial, diaPagamento, periodosReferenciados,
  //         sourceGuideId, linkGuideAsParcelaNum }
  router.post("/parcelamentos", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const userId = req.auth?.user?.id;
    try {
      const { createParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await createParcelamento({ ...req.body, portalClientId, userId });
      return res.status(201).json({ ok: true, data });
    } catch (err) {
      const code = err?.message || "internal_error";
      const knownErrors = [
        "portal_client_id_required", "label_required", "kind_required",
        "num_parcelas_invalid", "competencia_inicial_invalid", "principal_per_parcela_invalid",
        "company_not_found",
      ];
      const status = knownErrors.includes(code) ? 400 : 500;
      if (status === 500) log.error({ err }, "Falha ao criar parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/link-guide
  // body: { guideId, numeroParcela }
  router.post("/parcelamentos/:parcId/link-guide", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const { guideId, numeroParcela } = req.body || {};
    if (!guideId || !numeroParcela) {
      return res.status(400).json({ ok: false, error: "guideId_and_numeroParcela_required" });
    }
    try {
      const { linkGuideToParcela } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await linkGuideToParcela({ portalClientId, guideId, parcelamentoId, numeroParcela: Number(numeroParcela) });
      return res.json({ ok: true, data });
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        guide_not_found: 404,
        numero_parcela_out_of_range: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao linkar guia ao parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/parcelas/:num/pagar
  // body: { jurosValor, dataPagamento? }
  router.post("/parcelamentos/:parcId/parcelas/:num/pagar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const numeroParcela = Number(req.params.num);
    const { jurosValor, dataPagamento } = req.body || {};
    const userId = req.auth?.user?.id;
    try {
      const { confirmParcelaPayment } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await confirmParcelaPayment({
        portalClientId, parcelamentoId, numeroParcela,
        jurosValor: Number(jurosValor) || 0,
        dataPagamento, userId,
      });
      return res.status(201).json(data);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        parcelamento_not_active: 400,
        parcela_not_found: 404,
        parcela_already_paid: 400,
        payment_template_not_configured: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao confirmar pagamento de parcela");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  // POST /firm/companies/:companyId/parcelamentos/:parcId/rescindir
  // body: { dataRescisao?, observacoes? }
  router.post("/parcelamentos/:parcId/rescindir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const parcelamentoId = String(req.params.parcId);
    const userId = req.auth?.user?.id;
    try {
      const { rescindirParcelamento } = await import("../../application/accounting/ParcelamentoService.js");
      const data = await rescindirParcelamento({
        portalClientId, parcelamentoId,
        dataRescisao: req.body?.dataRescisao,
        observacoes: req.body?.observacoes,
        userId,
      });
      return res.json(data);
    } catch (err) {
      const code = err?.message || "internal_error";
      const map = {
        parcelamento_not_found: 404,
        parcelamento_not_active: 400,
        rescision_template_not_configured: 400,
      };
      const status = map[code] || 500;
      if (status === 500) log.error({ err }, "Falha ao rescindir parcelamento");
      return res.status(status).json({ ok: false, error: code });
    }
  });

  return router;
}
