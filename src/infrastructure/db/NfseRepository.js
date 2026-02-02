import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";
import { parseDate } from "../../utils/date.js";

function serialize(invoice) {
  if (!invoice) return null;
  return {
    id: invoice.id,
    companyId: invoice.companyId,
    clientId: invoice.clientId,
    tomadorDoc: invoice.tomadorDoc,
    tomadorNome: invoice.tomadorNome,
    valorServicos: decimalToNumber(invoice.valorServicos),
    aliquota: decimalToNumber(invoice.aliquota),
    issRetido: invoice.issRetido,
    competencia: dateToIso(invoice.competencia),
    idDps: invoice.idDps,
    chaveAcesso: invoice.chaveAcesso,
    numeroNfse: invoice.numeroNfse,
    codigoVerificacao: invoice.codigoVerificacao,
    rpsNumero: invoice.rpsNumero,
    rpsSerie: invoice.rpsSerie,
    status: invoice.status,
    xml: invoice.xml,
    pdfUrl: invoice.pdfUrl,
    createdAt: dateToIso(invoice.createdAt),
    updatedAt: dateToIso(invoice.updatedAt),
  };
}

function buildUpdateData(data) {
  const update = {
    tomadorDoc: data.tomadorDoc ?? undefined,
    tomadorNome: data.tomadorNome ?? undefined,
    valorServicos: data.valorServicos ?? undefined,
    aliquota: data.aliquota ?? undefined,
    issRetido: data.issRetido ?? undefined,
    competencia: data.competencia ? parseDate(data.competencia) : undefined,
    idDps: data.idDps ?? undefined,
    chaveAcesso: data.chaveAcesso ?? undefined,
    numeroNfse: data.numeroNfse ?? undefined,
    codigoVerificacao: data.codigoVerificacao ?? undefined,
    rpsNumero: data.rpsNumero ?? undefined,
    rpsSerie: data.rpsSerie ?? undefined,
    status: data.status ?? undefined,
    xml: data.xml ?? undefined,
    pdfUrl: data.pdfUrl ?? undefined,
  };
  return Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined)
  );
}

export class NfseRepository {
  static async createPending(data) {
    const created = await prisma.serviceInvoice.create({
      data,
    });
    return serialize(created);
  }

  static async markIssued(id, data) {
    const updated = await prisma.serviceInvoice.update({
      where: { id },
      data,
    });
    return serialize(updated);
  }

  static async updateByChaveAcesso(chaveAcesso, data) {
    if (!chaveAcesso) return null;
    const existing = await prisma.serviceInvoice.findFirst({
      where: { chaveAcesso },
    });
    if (!existing) return null;
    const updated = await prisma.serviceInvoice.update({
      where: { id: existing.id },
      data: buildUpdateData(data),
    });
    return serialize(updated);
  }

  static async findById(id) {
    const invoice = await prisma.serviceInvoice.findUnique({
      where: { id },
    });
    return serialize(invoice);
  }

  static async findByChaveAcesso(chaveAcesso) {
    if (!chaveAcesso) return null;
    const invoice = await prisma.serviceInvoice.findFirst({
      where: { chaveAcesso },
    });
    return serialize(invoice);
  }

  static async upsertFromProvider({ companyId, data }) {
    const hasChaveAcesso = Boolean(data.chaveAcesso);
    const hasIdDps = Boolean(data.idDps);
    const hasNumeroNfse = Boolean(data.numeroNfse);
    const hasRps = Boolean(data.rpsNumero && data.rpsSerie);
    const lookup = hasChaveAcesso
      ? { companyId, chaveAcesso: data.chaveAcesso }
      : hasIdDps
        ? { companyId, idDps: data.idDps }
        : hasNumeroNfse
          ? { companyId, numeroNfse: data.numeroNfse }
          : hasRps
            ? { companyId, rpsNumero: data.rpsNumero, rpsSerie: data.rpsSerie }
            : null;

    if (!lookup) {
      return { action: "skipped", reason: "missing_keys" };
    }

    const existing = await prisma.serviceInvoice.findFirst({ where: lookup });
    const updateData = buildUpdateData(data);

    if (existing) {
      const updated = await prisma.serviceInvoice.update({
        where: { id: existing.id },
        data: updateData,
      });
      return { action: "updated", invoice: serialize(updated) };
    }

    if (!data.tomadorDoc || !data.tomadorNome || data.valorServicos === null || data.valorServicos === undefined) {
      return { action: "skipped", reason: "missing_required_fields" };
    }

    const created = await prisma.serviceInvoice.create({
      data: {
        companyId,
        clientId: data.clientId || null,
        tomadorDoc: data.tomadorDoc,
        tomadorNome: data.tomadorNome,
        valorServicos: data.valorServicos,
        aliquota: data.aliquota ?? null,
        issRetido: data.issRetido ?? false,
        competencia: data.competencia ? parseDate(data.competencia) : null,
        idDps: data.idDps || null,
        chaveAcesso: data.chaveAcesso || null,
        numeroNfse: data.numeroNfse || null,
        codigoVerificacao: data.codigoVerificacao || null,
        rpsNumero: data.rpsNumero || null,
        rpsSerie: data.rpsSerie || null,
        status: data.status || "issued",
        xml: data.xml || null,
        pdfUrl: data.pdfUrl || null,
      },
    });
    return { action: "created", invoice: serialize(created) };
  }

  static async list({
    companyId,
    status,
    numeroNfse,
    chaveAcesso,
    idDps,
    from,
    to,
    dateField = "competencia",
    limit = 20,
    offset = 0,
  }) {
    const dateFilterField = dateField === "createdAt" ? "createdAt" : "competencia";
    const dateFilter =
      from || to
        ? {
            [dateFilterField]: {
              ...(from ? { gte: parseDate(from) } : {}),
              ...(to ? { lte: parseDate(to) } : {}),
            },
          }
        : {};
    const where = {
      companyId,
      ...(status ? { status } : {}),
      ...(chaveAcesso ? { chaveAcesso } : {}),
      ...(idDps ? { idDps } : {}),
      ...(numeroNfse ? { numeroNfse } : {}),
      ...(status
        ? {}
        : {
            NOT: {
              OR: [
                { status: { contains: "cancel", mode: "insensitive" } },
                { status: { contains: "reject", mode: "insensitive" } },
              ],
            },
          }),
      ...dateFilter,
    };

    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    const [items, total, aggregate] = await prisma.$transaction([
      prisma.serviceInvoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.serviceInvoice.count({ where }),
      prisma.serviceInvoice.aggregate({
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
      items: items.map(serialize),
    };
  }
}
