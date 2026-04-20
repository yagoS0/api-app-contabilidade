import { Router } from "express";
import multer from "multer";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";

// ---------------------------------------------------------------------------
// OFX Parser (SGML v1 e XML v2)
// ---------------------------------------------------------------------------

function parseOfxDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\[.*\]/, "").trim();
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  if (!y || !mo || !d) return null;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

function parseOfxSgml(text) {
  const transactions = [];
  const blockRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>([^<\n\r]*)`, "i");
      const m = r.exec(block);
      return m ? m[1].trim() : null;
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
  const blockRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, "i");
      const m = r.exec(block);
      return m ? m[1].trim() : null;
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
  const text = buffer.toString("utf-8");
  const isXml = /<\?xml/i.test(text) || /<OFX>/i.test(text.slice(0, 500));
  const raw = isXml ? parseOfxXml(text) : parseOfxSgml(text);

  return raw.map((t) => {
    const amount = parseFloat(String(t.trnAmt || "0").replace(",", "."));
    return {
      fitId: t.fitId || null,
      trnType: String(t.trnType || "").toUpperCase(),
      data: parseOfxDate(t.dtPosted),
      valor: Math.abs(amount),
      sinal: amount < 0 ? "DEBITO" : "CREDITO",
      historico: t.memo || "",
    };
  }).filter((t) => t.data && t.valor > 0);
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
  const header = "Data;Tipo D/C;Conta;Historico;Valor";
  const rows = [];
  for (const e of entries) {
    const data = new Date(e.data).toLocaleDateString("pt-BR");
    const historico = String(e.historico || "").replace(/;/g, " ");
    for (const l of (e.lines || [])) {
      const valor = Number(l.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      rows.push(`${data};${l.tipo};${l.conta};${historico};${valor}`);
    }
  }
  return [header, ...rows].join("\r\n");
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
  router.get("/chart-of-accounts", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const accounts = await prisma.chartOfAccount.findMany({
      where: { portalClientId },
      orderBy: [{ tipo: "asc" }, { codigo: "asc" }],
    });
    return res.json({ data: accounts });
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

      const mimeType = req.file.mimetype || "";
      const isPdf = mimeType === "application/pdf" || req.file.originalname?.endsWith(".pdf");

      if (isPdf) {
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const pdfData = await pdfParse(req.file.buffer);
          const rawText = String(pdfData?.text || "");

          // Formato esperado: <reduzido> <conta> <nome> <nivel>
          // ex: "557 4.1.01.001 Deducao de Simples Nacional 4"
          // ou linhas com tabs/espaços múltiplos
          const ROW_RE = /^(\d{1,6})\s+([\d.]+)\s+(.+?)\s+\d\s*$/;
          // Fallback: só reduzido + nome (sem código estruturado)
          const ROW_RE2 = /^(\d{1,6})\s+(.+)$/;

          function tipoFromConta(conta) {
            if (/^4[.\s]|^4$/.test(conta)) return "DESPESA";
            if (/^3[.\s]|^3$/.test(conta)) return "RECEITA";
            if (/^2\.4/.test(conta)) return "PATRIMONIO";
            if (/^2[.\s]|^2$/.test(conta)) return "PASSIVO";
            if (/^1[.\s]|^1$/.test(conta)) return "ATIVO";
            return "DESPESA";
          }

          function naturezaFromTipo(tipo) {
            return ["PASSIVO", "RECEITA", "PATRIMONIO"].includes(tipo) ? "CREDORA" : "DEVEDORA";
          }

          const textLines = rawText.split(/\n/).map((l) => l.trim()).filter(Boolean);
          const accounts = [];
          for (const line of textLines) {
            let m = ROW_RE.exec(line);
            if (m) {
              const [, reduzido, conta, nome] = m;
              const tipo = tipoFromConta(conta);
              accounts.push({ codigo: reduzido, nome: nome.trim(), tipo, natureza: naturezaFromTipo(tipo) });
              continue;
            }
            m = ROW_RE2.exec(line);
            if (m) {
              const [, reduzido, rest] = m;
              // Tentar separar conta estruturada do nome: "4.1.01.001 Nome da Conta"
              const contaM = /^([\d.]{3,})\s+(.+)$/.exec(rest);
              if (contaM) {
                const tipo = tipoFromConta(contaM[1]);
                accounts.push({ codigo: reduzido, nome: contaM[2].trim(), tipo, natureza: naturezaFromTipo(tipo) });
              }
            }
          }

          if (accounts.length === 0) {
            return res.status(422).json({
              error: "pdf_no_accounts_found",
              hint: "Nenhuma conta reconhecida no PDF. Verifique se o arquivo é o Relatório de Plano de Contas exportado do ERP, ou use um CSV (código;nome;tipo;natureza).",
            });
          }

          const created = [];
          const skipped = [];
          for (const acc of accounts) {
            try {
              await prisma.chartOfAccount.upsert({
                where: { portalClientId_codigo: { portalClientId, codigo: acc.codigo } },
                create: { portalClientId, ...acc, status: "CONFIRMADA" },
                update: { nome: acc.nome, tipo: acc.tipo, natureza: acc.natureza },
              });
              created.push(acc.codigo);
            } catch {
              skipped.push(acc.codigo);
            }
          }
          return res.json({ ok: true, created: created.length, skipped: skipped.length });
        } catch (err) {
          log.error({ err }, "Erro ao importar plano de contas via PDF");
          return res.status(500).json({ error: "pdf_import_failed", message: err?.message });
        }
      }

      // CSV: dois formatos suportados
      // 1) Formato padrão:   codigo;nome;tipo;natureza
      // 2) Formato exportado: codigoPadrao;nome;codigoReduzido;0;0;0
      // Detecta encoding: tenta UTF-8 primeiro; se gerar replacement chars, usa latin1 (Windows-1252)
      const utf8Attempt = req.file.buffer.toString("utf-8");
      const text = utf8Attempt.includes("\uFFFD")
        ? req.file.buffer.toString("latin1")
        : utf8Attempt;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const created = [];
      const skipped = [];
      const errors = [];

      // Detecta o formato pelo cabeçalho ou pela estrutura da primeira linha válida
      function detectFormat(lines) {
        for (const line of lines) {
          const sep = line.includes(";") ? ";" : ",";
          const cols = line.split(sep).map((s) => s.replace(/^"|"$/g, "").trim());
          if (cols.length < 2) continue;
          if (cols[0].toLowerCase() === "codigo" || cols[0].toLowerCase() === "código") return "padrao";
          // Formato exportado: col[2] é número puro (código reduzido sequencial)
          if (cols.length >= 3 && /^\d+$/.test(cols[2])) return "exportado";
          return "padrao";
        }
        return "padrao";
      }

      function tipoFromCodigoPadrao(cod) {
        const first = String(cod || "").charAt(0);
        if (first === "1") return "ATIVO";
        if (first === "2") {
          // 24.x = PATRIMÔNIO LÍQUIDO
          if (/^24/.test(cod)) return "PATRIMONIO";
          return "PASSIVO";
        }
        if (first === "3") return "RECEITA";
        if (first === "4" || first === "5") return "DESPESA";
        return "DESPESA";
      }

      function naturezaFromTipo(tipo) {
        return ["PASSIVO", "RECEITA", "PATRIMONIO"].includes(tipo) ? "CREDORA" : "DEVEDORA";
      }

      const formato = detectFormat(lines);

      for (const line of lines) {
        const sep = line.includes(";") ? ";" : ",";
        const cols = line.split(sep).map((s) => s.replace(/^"|"$/g, "").trim());

        let codigo, nome, tipo, natureza;

        if (formato === "exportado") {
          // codigoPadrao;nome;codigoReduzido;0;0;0
          const [codigoPadrao, nomeRaw, codigoReduzido] = cols;
          if (!codigoPadrao || !nomeRaw || !codigoReduzido) continue;
          if (!/^\d+$/.test(codigoReduzido)) continue; // ignora cabeçalhos
          codigo = codigoReduzido;
          nome = nomeRaw;
          tipo = tipoFromCodigoPadrao(codigoPadrao);
          natureza = naturezaFromTipo(tipo);
        } else {
          // codigo;nome;tipo;natureza
          [codigo, nome, tipo = "DESPESA", natureza = "DEVEDORA"] = cols;
          if (!codigo || !nome || codigo.toLowerCase() === "codigo") continue;
          tipo = tipo.toUpperCase();
          natureza = natureza.toUpperCase();
        }

        if (!codigo || !nome) continue;
        try {
          const result = await prisma.chartOfAccount.upsert({
            where: { portalClientId_codigo: { portalClientId, codigo } },
            create: { portalClientId, codigo, nome, tipo, natureza, status: "PENDENTE_ERP" },
            update: { nome, tipo, natureza },
          });
          created.push(result);
        } catch (err) {
          errors.push({ codigo, reason: err?.message });
        }
      }

      return res.json({ ok: true, created: created.length, skipped: skipped.length, errors });
    }
  );

  // ─── Lançamentos ─────────────────────────────────────────────────────────

  // GET /firm/companies/:companyId/entries/circular  (deve vir antes de /entries/:entryId)
  router.get("/entries/circular", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const rawYear = parseInt(String(req.query.year || ""), 10);
    const year = rawYear >= 2000 && rawYear <= 2100 ? rawYear : new Date().getUTCFullYear();

    const meses = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

    const [provisoes, receitas] = await Promise.all([
      prisma.accountingEntry.findMany({
        where: {
          portalClientId,
          tipo: "PROVISAO",
          competencia: { in: meses },
          statusPagamento: { in: ["ABERTO", "PAGO"] },
        },
        include: { lines: { orderBy: { ordem: "asc" } } },
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
    ]);

    const receitasPorComp = {};
    for (const e of receitas) {
      const total = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
      receitasPorComp[e.competencia] = (receitasPorComp[e.competencia] || 0) + total;
    }

    return res.json({
      year,
      provisoes: provisoes.map(entryToResponse),
      receitas: receitasPorComp,
    });
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

  // GET /firm/companies/:companyId/entries/export/csv
  router.get("/entries/export/csv", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, tipo, status } = req.query || {};

    const where = { portalClientId };
    if (competencia) where.competencia = String(competencia);
    if (tipo) where.tipo = String(tipo).toUpperCase();
    if (status) where.status = String(status).toUpperCase();

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: { lines: { orderBy: { ordem: "asc" } } },
      orderBy: [{ data: "asc" }, { createdAt: "asc" }],
    });

    const csv = entriesToCsv(entries);
    const filename = `lancamentos-${competencia || "todos"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send("\uFEFF" + csv);
  });

  // GET /firm/companies/:companyId/entries
  router.get("/entries", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { competencia, tipo, subtipo, origem, status, statusPagamento, page = "1", limit = "50" } = req.query || {};

    const where = { portalClientId };
    if (competencia) where.competencia = String(competencia);
    if (tipo) where.tipo = String(tipo).toUpperCase();
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
      // Auto-save do histórico (fora da transaction principal — não é crítico)
      const userId = req.auth?.user?.id;
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
            })),
          });
        }
        return tx.accountingEntry.findUnique({
          where: { id: entryId },
          include: { lines: { orderBy: { ordem: "asc" } } },
        });
      });
      return res.json({ ok: true, entry: entryToResponse(updated) });
    } catch (err) {
      log.error({ err }, "Erro ao atualizar lançamento");
      return res.status(500).json({ error: "internal_error" });
    }
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

    await prisma.accountingEntry.delete({ where: { id: entryId } });
    return res.json({ ok: true });
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
  router.post(
    "/entries/import/ofx",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    upload.single("file"),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      if (!req.file?.buffer) return res.status(400).json({ error: "file_required" });

      const transactions = parseOfx(req.file.buffer);
      if (!transactions.length) {
        return res.status(422).json({ error: "nenhuma_transacao_encontrada" });
      }

      const preview = req.query.preview === "1" || req.body?.preview === true;
      if (preview) {
        return res.json({ ok: true, transactions, total: transactions.length });
      }

      const contaDebito = String(req.body?.contaDebito || "").trim();
      const contaCredito = String(req.body?.contaCredito || "").trim();
      const tipo = String(req.body?.tipo || "DESPESA").toUpperCase();
      const loteImportacao = `OFX-${Date.now()}`;

      if (!contaDebito || !contaCredito) {
        return res.status(400).json({ error: "contas_required_para_importacao" });
      }

      try {
        await prisma.$transaction(async (tx) => {
          for (const t of transactions) {
            const competencia = `${t.data.getUTCFullYear()}-${String(t.data.getUTCMonth() + 1).padStart(2, "0")}`;
            const entry = await tx.accountingEntry.create({
              data: {
                portalClientId,
                data: t.data,
                competencia,
                historico: t.historico,
                tipo,
                origem: "OFX",
                loteImportacao,
                status: "RASCUNHO",
                statusPagamento: "NA",
              },
            });
            await tx.accountingEntryLine.createMany({
              data: [
                { entryId: entry.id, conta: contaDebito, tipo: "D", valor: t.valor, ordem: 0 },
                { entryId: entry.id, conta: contaCredito, tipo: "C", valor: t.valor, ordem: 1 },
              ],
            });
          }
        });
        return res.status(201).json({ ok: true, created: transactions.length, loteImportacao });
      } catch (err) {
        log.error({ err }, "Erro ao importar OFX");
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  return router;
}
