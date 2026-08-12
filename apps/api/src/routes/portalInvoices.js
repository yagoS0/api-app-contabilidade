import { Router } from "express";
import multer from "multer";
import archiver from "archiver";
import { prisma } from "../infrastructure/db/prisma.js";
import { decimalToNumber, dateToIso } from "../utils/serializers.js";
import { parseDate } from "../utils/date.js";
import { parseXmlMetadata } from "../application/nfse/AdnXmlMetadata.js";
// ⚠ O import de XML usa A MESMA ingestão da captura automática. Ver o cabeçalho de `ingestaoNfse.js`:
// a segunda implementação que morava aqui criava linha duplicada para nota que a captura já tinha.
import { upsertNfseFromItem } from "../application/notas/ingestaoNfse.js";
import { ensurePortalClientAccess } from "./middlewares/portalAccess.js";

function normalizeDoc(value) {
  return String(value || "").replace(/\D+/g, "") || null;
}

function formatCompetencia(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function serializeInvoice(inv) {
  return {
    invoiceId: inv.id,
    type: inv.type,
    numero: inv.numero || null,
    competencia: formatCompetencia(inv.competencia),
    issueDate: dateToIso(inv.issueDate),
    status: inv.status,
    total: decimalToNumber(inv.total),
    emitente: { nome: inv.emitenteNome || null, cnpj: inv.emitenteDoc || null },
    tomador: { nome: inv.tomadorNome || null, cnpjCpf: inv.tomadorDoc || null },
    updatedAt: dateToIso(inv.updatedAt),
    hasXml: Boolean(inv.xmlRaw),
    hasPdf: Boolean(inv.pdfUrl),
  };
}

function buildWhereFilters({
  clientId,
  clientCnpj,
  direcao,
  from,
  to,
  competencia,
  status,
  type,
  search,
  incluirCanceladas,
}) {
  const where = { clientId: String(clientId) };
  const and = [];

  // Direção padrão: apenas notas emitidas pelo cliente.
  if (clientCnpj) {
    const normalizedDirection = String(direcao || "emitidas").toLowerCase();
    if (normalizedDirection === "emitidas") {
      and.push({ emitenteDoc: clientCnpj });
    } else if (normalizedDirection === "recebidas") {
      and.push({ tomadorDoc: clientCnpj });
    } else if (normalizedDirection === "todas") {
      and.push({
        OR: [{ emitenteDoc: clientCnpj }, { tomadorDoc: clientCnpj }],
      });
    }
  }

  if (type) and.push({ type: String(type).toUpperCase() });
  if (status) and.push({ status: String(status).toUpperCase() });

  if (competencia) {
    const match = String(competencia).match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      and.push({ competencia: { gte: start, lt: end } });
    }
  }

  if (from || to) {
    and.push({
      issueDate: {
        ...(from ? { gte: parseDate(from) } : {}),
        ...(to ? { lte: parseDate(to) } : {}),
      },
    });
  }

  const q = String(search || "").trim();
  if (q) {
    const doc = normalizeDoc(q);
    and.push({
      OR: [
        { numero: { contains: q, mode: "insensitive" } },
        ...(doc ? [{ tomadorDoc: { contains: doc } }, { emitenteDoc: { contains: doc } }] : []),
        { tomadorNome: { contains: q, mode: "insensitive" } },
        { emitenteNome: { contains: q, mode: "insensitive" } },
        { chaveAcesso: { contains: q, mode: "insensitive" } },
        { idDps: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  // Esconde notas CANCELADAS por padrão (não devem aparecer nem somar) — a menos que peça explícito.
  if (!incluirCanceladas) {
    and.push({ OR: [{ statusEfetivo: null }, { statusEfetivo: { not: "cancelada" } }] });
  }

  if (and.length) where.AND = and;
  return where;
}

export function createPortalInvoicesRouter({ ensureAuthorized, log }) {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  // GET /clients/:clientId/invoices
  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const {
      direcao,
      from,
      to,
      competencia,
      status,
      type,
      search,
      sort,
      order,
      page,
      limit,
    } = req.query || {};

    const take = Math.min(Math.max(Number(limit) || 25, 1), 200);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;

    const sortField = String(sort || "updatedAt");
    const sortKey = sortField === "issueDate" ? "issueDate" : "updatedAt";
    const sortOrderRaw = String(order || "desc").toLowerCase();
    if (!["asc", "desc"].includes(sortOrderRaw)) {
      return res.status(400).json({ error: "order_invalid", allowed: ["asc", "desc"] });
    }
    const sortOrder = sortOrderRaw;

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const portalClient = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        select: { cnpj: true },
      });
      const clientCnpj = normalizeDoc(portalClient?.cnpj);

      const invoiceDirection = String(direcao || "emitidas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(invoiceDirection)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }
      const where = buildWhereFilters({
        clientId,
        clientCnpj,
        direcao: invoiceDirection,
        from,
        to,
        competencia,
        status,
        type,
        search,
        incluirCanceladas: String(req.query.incluirCanceladas || "") === "1",
      });

      const [items, total, totals, sync] = await prisma.$transaction([
        prisma.portalInvoice.findMany({
          where,
          orderBy: { [sortKey]: sortOrder },
          skip,
          take,
        }),
        prisma.portalInvoice.count({ where }),
        prisma.portalInvoice.aggregate({
          where,
          _sum: { total: true },
        }),
        prisma.portalSyncState.findUnique({ where: { clientId: String(clientId) } }),
      ]);

      const sumFiltered = decimalToNumber(totals?._sum?.total);
      const pageAmount = items.reduce((acc, item) => acc + (decimalToNumber(item.total) || 0), 0);

      return res.json({
        data: items.map(serializeInvoice),
        page: pageNum,
        limit: take,
        total,
        summary: {
          totalInvoices: total,
          totalAmount: sumFiltered || 0,
          pageAmount,
        },
        sync: sync
          ? {
              lastSyncAt: dateToIso(sync.lastSyncAt),
              state: sync.state,
              stale: !sync.lastSyncAt || sync.state !== "OK",
              canSync: !sync.lockUntil || new Date(sync.lockUntil).getTime() <= Date.now(),
            }
          : { lastSyncAt: null, state: "OK", stale: true, canSync: true },
      });
    } catch (err) {
      log.error({ err, clientId }, "Falha ao listar invoices do portal");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId
  router.get("/:invoiceId", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const inv = await prisma.portalInvoice.findFirst({
        where: { id: String(invoiceId), clientId: String(clientId) },
      });
      if (!inv) return res.status(404).json({ error: "not_found" });
      const sync = await prisma.portalSyncState.findUnique({ where: { clientId: String(clientId) } });
      return res.json({
        invoiceId: inv.id,
        type: inv.type,
        numero: inv.numero || null,
        competencia: formatCompetencia(inv.competencia),
        issueDate: dateToIso(inv.issueDate),
        status: inv.status,
        total: decimalToNumber(inv.total),
        emitente: { nome: inv.emitenteNome || null, cnpj: inv.emitenteDoc || null, im: null },
        tomador: { nome: inv.tomadorNome || null, cnpjCpf: inv.tomadorDoc || null, im: null },
        items: [],
        taxes: null,
        storage: { xml: Boolean(inv.xmlRaw), pdf: Boolean(inv.pdfUrl) },
        sync: {
          lastSyncAt: dateToIso(sync?.lastSyncAt),
          stale: !sync?.lastSyncAt || sync?.state !== "OK",
        },
      });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao buscar invoice detalhe");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId/xml (attachment)
  router.get("/:invoiceId/xml", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { xmlRaw: true, id: true },
    });
    if (!inv?.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });
    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename=\"invoice-${inv.id}.xml\"`);
    return res.status(200).send(inv.xmlRaw);
  });

  // GET /clients/:clientId/invoices/:invoiceId/xml/raw
  router.get("/:invoiceId/xml/raw", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { xmlRaw: true },
    });
    if (!inv?.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });
    return res.json({ xml: inv.xmlRaw });
  });

  // GET /clients/:clientId/invoices/xml/bulk?competencia=YYYY-MM&direcao=emitidas|recebidas|todas...
  // Retorna ZIP em stream com todos os XMLs filtrados.
  router.get("/xml/bulk", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const {
      direcao,
      from,
      to,
      competencia,
      status,
      type,
      search,
      limit,
    } = req.query || {};

    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;

      const portalClient = await prisma.portalClient.findUnique({
        where: { id: String(clientId) },
        select: { cnpj: true },
      });
      const clientCnpj = normalizeDoc(portalClient?.cnpj);

      const invoiceDirection = String(direcao || "emitidas").toLowerCase();
      if (!["emitidas", "recebidas", "todas"].includes(invoiceDirection)) {
        return res.status(400).json({ error: "direcao_invalid" });
      }

      // Q8.A.8: limite reduzido de 5000 → 500 para evitar DoS (carregar 5000 invoices custa caro).
      // Quem precisar de mais paginação deve quebrar em chamadas menores.
      const maxItems = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const where = buildWhereFilters({
        clientId,
        clientCnpj,
        direcao: invoiceDirection,
        from,
        to,
        competencia,
        status,
        type,
        search,
      });
      where.xmlRaw = { not: null };

      const invoices = await prisma.portalInvoice.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: maxItems,
        select: {
          id: true,
          numero: true,
          chaveAcesso: true,
          issueDate: true,
          xmlRaw: true,
        },
      });

      if (!invoices.length) {
        return res.status(404).json({ error: "XML_NOT_FOUND", message: "Nenhum XML encontrado para o filtro." });
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const comp = safeFilePart(competencia || "all");
      const filename = `xmls-${safeFilePart(clientId)}-${comp}-${stamp}.zip`;

      res.setHeader("content-type", "application/zip");
      res.setHeader("content-disposition", `attachment; filename=\"${filename}\"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        log.error({ err, clientId }, "Falha ao gerar zip de XMLs");
        if (!res.headersSent) {
          res.status(500).json({ error: "zip_generation_failed" });
        } else {
          res.end();
        }
      });

      archive.pipe(res);

      for (const inv of invoices) {
        if (!inv.xmlRaw) continue;
        const n = safeFilePart(inv.numero || "");
        const ch = safeFilePart(inv.chaveAcesso || "");
        const date = inv.issueDate ? safeFilePart(dateToIso(inv.issueDate)?.slice(0, 10)) : "";
        const base = n || ch || safeFilePart(inv.id);
        const entryName = `${base}${date ? `_${date}` : ""}.xml`;
        archive.append(inv.xmlRaw, { name: entryName });
      }

      await archive.finalize();
    } catch (err) {
      log.error({ err, clientId }, "Falha no bulk download de XML");
      if (!res.headersSent) {
        return res.status(500).json({ error: "internal_error" });
      }
      return res.end();
    }
  });

  // POST /clients/:clientId/invoices/:invoiceId/reparse
  router.post("/:invoiceId/reparse", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const inv = await prisma.portalInvoice.findFirst({
        where: { id: String(invoiceId), clientId: String(clientId) },
      });
      if (!inv) return res.status(404).json({ error: "not_found" });
      if (!inv.xmlRaw) return res.status(404).json({ error: "XML_NOT_FOUND" });

      // Por enquanto apenas NFSe (usa parser já existente)
      const meta = parseXmlMetadata(inv.xmlRaw);
      const updatedFields = [];
      const update = {};
      if (meta?.tomadorNome && meta.tomadorNome !== inv.tomadorNome) {
        update.tomadorNome = meta.tomadorNome;
        updatedFields.push("tomador.nome");
      }
      if (meta?.cnpjTomador && meta.cnpjTomador !== inv.tomadorDoc) {
        update.tomadorDoc = meta.cnpjTomador;
        updatedFields.push("tomador.doc");
      }
      if (meta?.cnpjPrestador && meta.cnpjPrestador !== inv.emitenteDoc) {
        update.emitenteDoc = meta.cnpjPrestador;
        updatedFields.push("emitente.doc");
      }
      if (meta?.prestadorNome && meta.prestadorNome !== inv.emitenteNome) {
        update.emitenteNome = meta.prestadorNome;
        updatedFields.push("emitente.nome");
      }
      if (meta?.competencia && dateToIso(meta.competencia) !== dateToIso(inv.competencia)) {
        update.competencia = meta.competencia;
        updatedFields.push("competencia");
      }
      if (meta?.dataEmissao && dateToIso(meta.dataEmissao) !== dateToIso(inv.issueDate)) {
        update.issueDate = meta.dataEmissao;
        updatedFields.push("issueDate");
      }
      if (meta?.numeroNfse && meta.numeroNfse !== inv.numero) {
        update.numero = meta.numeroNfse;
        updatedFields.push("numero");
      }
      if (Object.keys(update).length) {
        await prisma.portalInvoice.update({ where: { id: inv.id }, data: update });
      }
      return res.json({ ok: true, updatedFields });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao reparse invoice");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /clients/:clientId/invoices/:invoiceId/pdf
  router.get("/:invoiceId/pdf", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const inv = await prisma.portalInvoice.findFirst({
      where: { id: String(invoiceId), clientId: String(clientId) },
      select: { pdfUrl: true },
    });
    if (!inv?.pdfUrl) return res.status(404).json({ error: "PDF_NOT_FOUND" });
    return res.redirect(inv.pdfUrl);
  });

  // GET /clients/:clientId/invoices/:invoiceId/events
  router.get("/:invoiceId/events", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId, invoiceId } = req.params || {};
    try {
      const access = await ensurePortalClientAccess(req, res, clientId);
      if (!access.ok) return;
      const items = await prisma.portalInvoiceEvent.findMany({
        where: { clientId: String(clientId), invoiceId: String(invoiceId) },
        orderBy: { date: "desc" },
      });
      return res.json({
        data: items.map((e) => ({
          type: e.type,
          date: dateToIso(e.date),
          protocol: e.protocol || null,
          reason: e.reason || null,
        })),
      });
    } catch (err) {
      log.error({ err, clientId, invoiceId }, "Falha ao listar eventos");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // POST /clients/:clientId/invoices/import/xml (upload)
  router.post("/import/xml", upload.array("files", 50), async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const { clientId } = req.params || {};
    const access = await ensurePortalClientAccess(req, res, clientId);
    if (!access.ok) return;
    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files_required" });
    }

    // CNPJ da empresa — usado p/ verificar titularidade e derivar papel EMIT/DEST
    // (mesmo tratamento do caminho automático em AdnNotasService.upsertNfseFromItem).
    const portalClient = await prisma.portalClient.findUnique({
      where: { id: String(clientId) },
      select: { cnpj: true },
    });
    const companyCnpj = normalizeDoc(portalClient?.cnpj);

    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let rejeitadas = 0;
    const errors = [];

    for (const file of files) {
      try {
        const xml = file.buffer?.toString("utf-8") || "";
        if (!xml.trim().startsWith("<")) {
          errors.push({ file: file.originalname, reason: "invalid_xml" });
          continue;
        }
        const meta = parseXmlMetadata(xml);
        const prestadorDoc = normalizeDoc(meta?.cnpjPrestador);
        const tomadorDoc = normalizeDoc(meta?.cnpjTomador);

        // Verificação de titularidade: a nota tem que pertencer à empresa (emitente OU tomador).
        // Se o CNPJ da empresa não bate com nenhum dos dois, rejeita (não importa nota de terceiro).
        if (!companyCnpj || (prestadorDoc !== companyCnpj && tomadorDoc !== companyCnpj)) {
          rejeitadas += 1;
          errors.push({ file: file.originalname, reason: "nota_nao_pertence" });
          continue;
        }

        // ⚠ LINHA LEGADA SEM CHAVE — deixada para o dono decidir, nunca duplicada aqui.
        //
        // Enquanto o import tinha implementação própria, ele gravava `chaveAcesso: null` e
        // `idNfse = numeroNfse`. Essas linhas continuam na base. Agora que a ingestão é uma só e
        // dedupica pela CHAVE quando o XML tem chave, importar de novo o mesmo XML criaria uma
        // SEGUNDA linha ao lado da legada — exatamente a duplicata que este conserto existe para
        // parar de produzir.
        //
        // Não adotamos a linha antiga (carimbar a chave nela é escrita sobre nota fiscal, e a
        // decisão do que fazer com as duplicatas existentes é do contador) e não criamos a nova:
        // contamos como duplicata e dizemos qual linha está no caminho. O inventário completo sai
        // em `scripts/diag-notas-duplicadas.mjs`.
        //
        // O casamento exige CHAVE no XML + mesmo número + MESMO PRESTADOR: número de NFS-e se
        // repete entre prestadores, e recusar por número solto barraria import legítimo.
        const chaveDoXml = meta?.chaveAcesso || null;
        if (chaveDoXml && meta?.numeroNfse) {
          const legado = await prisma.portalInvoice.findFirst({
            where: {
              clientId: String(clientId),
              idNfse: String(meta.numeroNfse),
              chaveAcesso: null,
            },
            select: { id: true, emitenteDoc: true },
          });
          if (legado && normalizeDoc(legado.emitenteDoc) === prestadorDoc) {
            duplicates += 1;
            errors.push({
              file: file.originalname,
              reason: "duplicata_legado_sem_chave",
              invoiceId: legado.id,
            });
            continue;
          }
        }

        // ⚠ A PERSISTÊNCIA É A MESMA DA CAPTURA — `application/notas/ingestaoNfse.js`.
        //
        // Aqui existia uma segunda implementação, escrita à mão, que gravava `chaveAcesso: null`
        // fixo e dedupicava por `clientId_idNfse`. A captura faz o oposto de propósito (chave
        // quando há chave, `idNfse` só no fallback sem-chave), então o upsert do import NUNCA
        // encontrava a linha da captura: nascia uma segunda linha da mesma nota, as duas
        // `papel:"EMIT"`/`autorizada`, e o faturamento somava a nota duas vezes. Pior, a
        // conferência do ADN (`getNossoConjunto`, que usa `chaveAcesso || idNfse`) passava a
        // acusar `divergente` falso e a TRAVAR o fechamento.
        //
        // A titularidade acima (`nota_nao_pertence`) continua sendo do import e é mais estrita que
        // a guarda de dentro: aqui o arquivo vem de uma pessoa, e metadado sem CNPJ nenhum é
        // recusado. Uma transação por arquivo: nota e itens entram juntos ou não entram.
        const r = await prisma.$transaction(async (tx) => upsertNfseFromItem(tx, {
          portalClientId: String(clientId),
          companyCnpj,
          item: null,
          xmlPlain: xml,
          metadata: meta || {},
        }));

        if (r.status === "rejeitada_outro_cnpj") {
          rejeitadas += 1;
          errors.push({ file: file.originalname, reason: "nota_nao_pertence" });
        } else if (r.status === "skipped") {
          errors.push({ file: file.originalname, reason: r.reason || "sem_identificador" });
        } else if (r.existia) {
          updated += 1;
        } else {
          created += 1;
        }
      } catch (err) {
        errors.push({ file: file.originalname, reason: "import_failed" });
        log.warn({ err }, "Falha ao importar XML");
      }
    }

    return res.json({ created, updated, duplicates, rejeitadas, errors });
  });

  return router;
}

