import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";
import { parseXmlMetadata } from "../../application/nfse/AdnXmlMetadata.js";
import { parseDate } from "../../utils/date.js";

function normalizeAdnStatus({ tipoDocumento, tipoEvento, situacao }) {
  const td = String(tipoDocumento || "").toUpperCase();
  const te = String(tipoEvento || "").toUpperCase();
  const st = String(situacao || "").toUpperCase();

  const any = `${td} ${te} ${st}`.trim();
  if (!any) return null;

  // Rejeição
  if (any.includes("REJEI") || any.includes("REJECT")) return "rejected";

  // Eventos conhecidos (mesma convenção usada no módulo de emissão)
  // - e101101: cancelamento
  // - e105102: cancelamento por substituição
  if (te.includes("E105102")) return "cancelled_substitution";
  if (te.includes("E101101")) return "cancelled";

  // Status numérico do XML (NFS-e Nacional)
  // 1 = Normal/Autorizada
  // 2 = Cancelada
  if (st === "2") return "cancelled";
  if (st === "1") return "authorized";

  // Cancelamento por substituição costuma vir como evento específico ou texto de substituição.
  if (any.includes("SUBST") || any.includes("SUBSTIT")) return "cancelled_substitution";

  // Cancelamento genérico
  if (any.includes("CANCEL")) return "cancelled";

  // Se não bateu em nenhum caso, consideramos "authorized"/"unknown".
  // Preferimos "unknown" quando só temos o tipo de documento mas não a situação.
  if (st) return "authorized";
  return "unknown";
}

function monthToRange(competencia) {
  // competencia: "YYYY-MM"
  const m = String(competencia || "").trim();
  const match = m.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]); // 1..12
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0)); // exclusive
  return { start, end };
}

function normalizeStatusFilter(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;

  // Entradas comuns (pt-BR) -> status normalizado
  if (["autorizada", "autorizado", "authorized", "ok"].includes(v)) return "authorized";
  if (["cancelada", "cancelado", "cancelled", "canceled"].includes(v)) return "cancelled";
  if (
    [
      "substituida",
      "substituída",
      "cancelada_substituicao",
      "cancelled_substitution",
      "substitution",
    ].includes(v)
  )
    return "cancelled_substitution";
  if (["rejeitada", "rejeitado", "rejected"].includes(v)) return "rejected";
  if (["unknown", "desconhecida", "desconhecido"].includes(v)) return "unknown";

  // Já no formato interno
  if (["authorized", "cancelled", "cancelled_substitution", "rejected", "unknown"].includes(v)) {
    return v;
  }
  return null;
}

function serializeDocument(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    nsu: doc.nsu?.toString?.() ?? String(doc.nsu),
    chaveAcesso: doc.chaveAcesso,
    tipoDocumento: doc.tipoDocumento,
    tipoEvento: doc.tipoEvento,
    status: doc.status || normalizeAdnStatus(doc),
    dataHoraGeracao: dateToIso(doc.dataHoraGeracao),
    xmlBase64Gzip: doc.xmlBase64Gzip,
    xmlPlain: doc.xmlPlain,
    dataEmissao: dateToIso(doc.dataEmissao),
    competencia: dateToIso(doc.competencia),
    cnpjPrestador: doc.cnpjPrestador,
    prestadorNome: doc.prestadorNome,
    cnpjTomador: doc.cnpjTomador,
    tomadorNome: doc.tomadorNome,
    numeroNfse: doc.numeroNfse,
    valorServicos: decimalToNumber(doc.valorServicos),
    valorIss: decimalToNumber(doc.valorIss),
    situacao: doc.situacao,
    createdAt: dateToIso(doc.createdAt),
    updatedAt: dateToIso(doc.updatedAt),
  };
}

export class AdnRepository {
  static async getState(cnpj) {
    const normalized = String(cnpj || "").replace(/\D+/g, "");
    if (!normalized) return null;
    return prisma.adnSyncState.findUnique({ where: { cnpj: normalized } });
  }

  static async ensureState(cnpj) {
    const normalized = String(cnpj || "").replace(/\D+/g, "");
    if (!normalized) {
      const err = new Error("adn_cnpj_required");
      err.code = "ADN_CNPJ_REQUIRED";
      throw err;
    }
    const existing = await this.getState(normalized);
    if (existing) return existing;
    return prisma.adnSyncState.create({ data: { cnpj: normalized } });
  }

  static async updateState(cnpj, ultimoNSU) {
    const state = await this.ensureState(cnpj);
    return prisma.adnSyncState.update({
      where: { cnpj: state.cnpj },
      data: { ultimoNSU: BigInt(ultimoNSU) },
    });
  }

  static async upsertDocument(data) {
    const existing = await prisma.adnDocument.findUnique({
      where: { nsu: BigInt(data.nsu) },
    });

    const normalizedStatus = normalizeAdnStatus({
      tipoDocumento: data.tipoDocumento,
      tipoEvento: data.tipoEvento,
      situacao: data.situacao,
    });
    const updateData = {
      chaveAcesso: data.chaveAcesso ?? undefined,
      tipoDocumento: data.tipoDocumento ?? undefined,
      tipoEvento: data.tipoEvento ?? undefined,
      status: normalizedStatus ?? undefined,
      dataHoraGeracao: data.dataHoraGeracao ? parseDate(data.dataHoraGeracao) : undefined,
      xmlBase64Gzip: data.xmlBase64Gzip ?? undefined,
      xmlPlain: data.xmlPlain ?? undefined,
      dataEmissao: data.dataEmissao ? parseDate(data.dataEmissao) : undefined,
      competencia: data.competencia ? parseDate(data.competencia) : undefined,
      cnpjPrestador: data.cnpjPrestador ?? undefined,
      prestadorNome: data.prestadorNome ?? undefined,
      cnpjTomador: data.cnpjTomador ?? undefined,
      tomadorNome: data.tomadorNome ?? undefined,
      numeroNfse: data.numeroNfse ?? undefined,
      valorServicos: data.valorServicos ?? undefined,
      valorIss: data.valorIss ?? undefined,
      situacao: data.situacao ?? undefined,
    };

    if (existing) {
      const updated = await prisma.adnDocument.update({
        where: { id: existing.id },
        data: Object.fromEntries(
          Object.entries(updateData).filter(([, value]) => value !== undefined)
        ),
      });
      return { action: "updated", document: serializeDocument(updated) };
    }

    const created = await prisma.adnDocument.create({
      data: {
        nsu: BigInt(data.nsu),
        chaveAcesso: data.chaveAcesso || null,
        tipoDocumento: data.tipoDocumento || null,
        tipoEvento: data.tipoEvento || null,
        status: normalizedStatus || null,
        dataHoraGeracao: data.dataHoraGeracao ? parseDate(data.dataHoraGeracao) : null,
        xmlBase64Gzip: data.xmlBase64Gzip || null,
        xmlPlain: data.xmlPlain || null,
        dataEmissao: data.dataEmissao ? parseDate(data.dataEmissao) : null,
        competencia: data.competencia ? parseDate(data.competencia) : null,
        cnpjPrestador: data.cnpjPrestador || null,
        prestadorNome: data.prestadorNome || null,
        cnpjTomador: data.cnpjTomador || null,
        tomadorNome: data.tomadorNome || null,
        numeroNfse: data.numeroNfse || null,
        valorServicos: data.valorServicos ?? null,
        valorIss: data.valorIss ?? null,
        situacao: data.situacao || null,
      },
    });
    return { action: "created", document: serializeDocument(created) };
  }

  static async updateByChaveAcesso(chaveAcesso, data) {
    const updateData = {
      situacao: data.situacao ?? undefined,
      tipoEvento: data.tipoEvento ?? undefined,
      status:
        normalizeAdnStatus({
          tipoDocumento: "EVENTO",
          tipoEvento: data.tipoEvento,
          situacao: data.situacao,
        }) ?? undefined,
      xmlPlain: data.xmlPlain ?? undefined,
      xmlBase64Gzip: data.xmlBase64Gzip ?? undefined,
      cnpjPrestador: data.cnpjPrestador ?? undefined,
      prestadorNome: data.prestadorNome ?? undefined,
      cnpjTomador: data.cnpjTomador ?? undefined,
      tomadorNome: data.tomadorNome ?? undefined,
    };
    const updated = await prisma.adnDocument.updateMany({
      where: { chaveAcesso },
      data: Object.fromEntries(
        Object.entries(updateData).filter(([, value]) => value !== undefined)
      ),
    });
    return updated.count;
  }

  static async backfillMissingMetadata({ limit = 200 } = {}) {
    const docs = await prisma.adnDocument.findMany({
      where: {
        xmlPlain: { not: null },
        OR: [
          { cnpjPrestador: null },
          { prestadorNome: null },
          { cnpjTomador: null },
          { tomadorNome: null },
          { dataEmissao: null },
          { competencia: null },
          { numeroNfse: null },
          { valorServicos: null },
          { valorIss: null },
          { situacao: null },
          { status: null },
        ],
      },
      take: Math.max(Number(limit) || 0, 0),
    });

    let updatedCount = 0;
    for (const doc of docs) {
      const metadata = parseXmlMetadata(doc.xmlPlain);
      const normalizedStatus = normalizeAdnStatus({
        tipoDocumento: doc.tipoDocumento,
        tipoEvento: doc.tipoEvento,
        situacao: metadata.situacao ?? doc.situacao,
      });
      const updateData = Object.fromEntries(
        Object.entries({
          cnpjPrestador: metadata.cnpjPrestador ?? undefined,
          prestadorNome: metadata.prestadorNome ?? undefined,
          cnpjTomador: metadata.cnpjTomador ?? undefined,
          tomadorNome: metadata.tomadorNome ?? undefined,
          dataEmissao: metadata.dataEmissao ?? undefined,
          competencia: metadata.competencia ?? undefined,
          numeroNfse: metadata.numeroNfse ?? undefined,
          valorServicos: metadata.valorServicos ?? undefined,
          valorIss: metadata.valorIss ?? undefined,
          situacao: metadata.situacao ?? undefined,
          status: normalizedStatus ?? undefined,
        }).filter(([, value]) => value !== undefined && value !== null)
      );

      if (Object.keys(updateData).length === 0) continue;
      await prisma.adnDocument.update({
        where: { id: doc.id },
        data: updateData,
      });
      updatedCount += 1;
    }

    return updatedCount;
  }

  static async listByPeriodo({
    cnpj,
    tipo,
    inicio,
    fim,
    limit = 50,
    offset = 0,
    includeCancelled = false,
    includeRejected = false,
  }) {
    const normalizedCnpj = String(cnpj || "").replace(/\D+/g, "");
    if (includeCancelled) {
      await this.backfillMissingMetadata({ limit: 500 });
    }
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const skip = Math.max(Number(offset) || 0, 0);
    const cancelFields = ["tipoEvento", "situacao"];
    const buildNotContains = (field, pattern) => ({
      OR: [
        { [field]: null },
        { NOT: { [field]: { contains: pattern, mode: "insensitive" } } },
      ],
    });
    const buildWhere = () => ({
      ...(tipo === "emitidas" ? { cnpjPrestador: normalizedCnpj } : {}),
      ...(tipo === "recebidas" ? { cnpjTomador: normalizedCnpj } : {}),
      ...(inicio || fim
        ? {
            dataEmissao: {
              ...(inicio ? { gte: parseDate(inicio) } : {}),
              ...(fim ? { lte: parseDate(fim) } : {}),
            },
          }
        : {}),
      ...(!includeCancelled || !includeRejected
        ? {
            AND: [
              ...(!includeCancelled
                ? cancelFields.map((field) => buildNotContains(field, "CANCEL"))
                : []),
              ...(!includeRejected
                ? [
                    buildNotContains("tipoEvento", "REJEIT"),
                    buildNotContains("situacao", "REJEIT"),
                    buildNotContains("tipoEvento", "REJECT"),
                    buildNotContains("situacao", "REJECT"),
                  ]
                : []),
            ],
          }
        : {}),
    });
    const runQuery = async () => {
      const where = buildWhere();
      const [items, total, aggregate] = await prisma.$transaction([
        prisma.adnDocument.findMany({
          where,
          orderBy: { dataEmissao: "desc" },
          skip,
          take,
        }),
        prisma.adnDocument.count({ where }),
        prisma.adnDocument.aggregate({
          where,
          _sum: { valorServicos: true },
        }),
      ]);
      return {
        total,
        limit: take,
        offset: skip,
        summary: {
          totalValorServicos: decimalToNumber(aggregate._sum.valorServicos || 0),
        },
        items: items.map(serializeDocument),
      };
    };

    let result = await runQuery();
    if (result.total === 0) {
      const backfilled = await this.backfillMissingMetadata({ limit: 500 });
      if (backfilled > 0) {
        result = await runQuery();
      }
    }

    return result;
  }

  /**
   * Lista notas do ADN com filtro no banco e paginação por cursor (keyset).
   * Ordenação fixa: updatedAt desc, id desc.
   *
   * Cursor: base64(JSON.stringify({ updatedAt: ISO, id: string }))
   */
  static async listNotas({
    cnpj,
    direcao = "todas", // "emitidas" | "recebidas" | "todas"
    competencia, // "YYYY-MM"
    status,
    dateFrom,
    dateTo,
    cursor,
    limit = 50,
  }) {
    const normalizedCnpj = String(cnpj || "").replace(/\D+/g, "");
    if (!normalizedCnpj) {
      const err = new Error("cnpj_required");
      err.code = "CNPJ_REQUIRED";
      throw err;
    }

    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const statusFilter = normalizeStatusFilter(status);
    const monthRange = competencia ? monthToRange(competencia) : null;
    const fromDate = dateFrom ? parseDate(dateFrom) : null;
    const toDate = dateTo ? parseDate(dateTo) : null;

    let cursorObj = null;
    if (cursor) {
      try {
        const decoded = Buffer.from(String(cursor), "base64").toString("utf-8");
        const parsed = JSON.parse(decoded);
        const updatedAt = parsed?.updatedAt ? new Date(parsed.updatedAt) : null;
        const id = parsed?.id ? String(parsed.id) : null;
        if (updatedAt instanceof Date && !Number.isNaN(updatedAt.getTime()) && id) {
          cursorObj = { updatedAt, id };
        }
      } catch {
        // ignore invalid cursor
      }
    }

    const where = {
      ...(direcao === "emitidas" ? { cnpjPrestador: normalizedCnpj } : {}),
      ...(direcao === "recebidas" ? { cnpjTomador: normalizedCnpj } : {}),
      ...(direcao === "todas"
        ? { OR: [{ cnpjPrestador: normalizedCnpj }, { cnpjTomador: normalizedCnpj }] }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(monthRange
        ? { competencia: { gte: monthRange.start, lt: monthRange.end } }
        : {}),
      ...(fromDate || toDate
        ? {
            dataEmissao: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(cursorObj
        ? {
            OR: [
              { updatedAt: { lt: cursorObj.updatedAt } },
              { updatedAt: cursorObj.updatedAt, id: { lt: cursorObj.id } },
            ],
          }
        : {}),
    };

    const items = await prisma.adnDocument.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = items.length > take;
    const pageItems = hasMore ? items.slice(0, take) : items;
    const last = pageItems[pageItems.length - 1] || null;
    const nextCursor =
      hasMore && last
        ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt?.toISOString?.(), id: last.id })).toString(
            "base64"
          )
        : null;

    return {
      limit: take,
      cursor: cursorObj
        ? Buffer.from(JSON.stringify({ updatedAt: cursorObj.updatedAt.toISOString(), id: cursorObj.id })).toString(
            "base64"
          )
        : null,
      nextCursor,
      items: pageItems.map(serializeDocument),
    };
  }
}
