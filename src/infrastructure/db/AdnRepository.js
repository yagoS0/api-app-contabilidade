import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";
import { parseXmlMetadata } from "../../application/nfse/AdnXmlMetadata.js";
import { parseDate } from "../../utils/date.js";

function serializeDocument(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    nsu: doc.nsu?.toString?.() ?? String(doc.nsu),
    chaveAcesso: doc.chaveAcesso,
    tipoDocumento: doc.tipoDocumento,
    tipoEvento: doc.tipoEvento,
    dataHoraGeracao: dateToIso(doc.dataHoraGeracao),
    xmlBase64Gzip: doc.xmlBase64Gzip,
    xmlPlain: doc.xmlPlain,
    dataEmissao: dateToIso(doc.dataEmissao),
    competencia: dateToIso(doc.competencia),
    cnpjPrestador: doc.cnpjPrestador,
    cnpjTomador: doc.cnpjTomador,
    numeroNfse: doc.numeroNfse,
    valorServicos: decimalToNumber(doc.valorServicos),
    valorIss: decimalToNumber(doc.valorIss),
    situacao: doc.situacao,
    createdAt: dateToIso(doc.createdAt),
    updatedAt: dateToIso(doc.updatedAt),
  };
}

export class AdnRepository {
  static async getState() {
    return prisma.adnSyncState.findFirst();
  }

  static async ensureState() {
    const existing = await this.getState();
    if (existing) return existing;
    return prisma.adnSyncState.create({ data: {} });
  }

  static async updateState(ultimoNSU) {
    const state = await this.ensureState();
    return prisma.adnSyncState.update({
      where: { id: state.id },
      data: { ultimoNSU: BigInt(ultimoNSU) },
    });
  }

  static async upsertDocument(data) {
    const existing = await prisma.adnDocument.findUnique({
      where: { nsu: BigInt(data.nsu) },
    });

    const updateData = {
      chaveAcesso: data.chaveAcesso ?? undefined,
      tipoDocumento: data.tipoDocumento ?? undefined,
      tipoEvento: data.tipoEvento ?? undefined,
      dataHoraGeracao: data.dataHoraGeracao ? parseDate(data.dataHoraGeracao) : undefined,
      xmlBase64Gzip: data.xmlBase64Gzip ?? undefined,
      xmlPlain: data.xmlPlain ?? undefined,
      dataEmissao: data.dataEmissao ? parseDate(data.dataEmissao) : undefined,
      competencia: data.competencia ? parseDate(data.competencia) : undefined,
      cnpjPrestador: data.cnpjPrestador ?? undefined,
      cnpjTomador: data.cnpjTomador ?? undefined,
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
        dataHoraGeracao: data.dataHoraGeracao ? parseDate(data.dataHoraGeracao) : null,
        xmlBase64Gzip: data.xmlBase64Gzip || null,
        xmlPlain: data.xmlPlain || null,
        dataEmissao: data.dataEmissao ? parseDate(data.dataEmissao) : null,
        competencia: data.competencia ? parseDate(data.competencia) : null,
        cnpjPrestador: data.cnpjPrestador || null,
        cnpjTomador: data.cnpjTomador || null,
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
      xmlPlain: data.xmlPlain ?? undefined,
      xmlBase64Gzip: data.xmlBase64Gzip ?? undefined,
      cnpjPrestador: data.cnpjPrestador ?? undefined,
      cnpjTomador: data.cnpjTomador ?? undefined,
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
          { cnpjTomador: null },
          { dataEmissao: null },
          { competencia: null },
          { numeroNfse: null },
          { valorServicos: null },
          { valorIss: null },
          { situacao: null },
        ],
      },
      take: Math.max(Number(limit) || 0, 0),
    });

    let updatedCount = 0;
    for (const doc of docs) {
      const metadata = parseXmlMetadata(doc.xmlPlain);
      const updateData = Object.fromEntries(
        Object.entries({
          cnpjPrestador: metadata.cnpjPrestador ?? undefined,
          cnpjTomador: metadata.cnpjTomador ?? undefined,
          dataEmissao: metadata.dataEmissao ?? undefined,
          competencia: metadata.competencia ?? undefined,
          numeroNfse: metadata.numeroNfse ?? undefined,
          valorServicos: metadata.valorServicos ?? undefined,
          valorIss: metadata.valorIss ?? undefined,
          situacao: metadata.situacao ?? undefined,
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
}
