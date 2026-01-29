import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";
import { parseDate } from "../../utils/date.js";

function serializeInvoice(invoice) {
  return {
    id: invoice.id,
    companyId: invoice.companyId,
    clientId: invoice.clientId,
    chave: invoice.chave,
    numero: invoice.numero,
    serie: invoice.serie,
    dhEmi: dateToIso(invoice.dhEmi),
    emitCnpj: invoice.emitCnpj,
    emitNome: invoice.emitNome,
    destDoc: invoice.destDoc,
    destNome: invoice.destNome,
    cfopPrincipal: invoice.cfopPrincipal,
    valorTotal: decimalToNumber(invoice.valorTotal),
    valorProdutos: decimalToNumber(invoice.valorProdutos),
    valorServicos: decimalToNumber(invoice.valorServicos),
    valorImpostos: decimalToNumber(invoice.valorImpostos),
    valorIcms: decimalToNumber(invoice.valorIcms),
    valorPis: decimalToNumber(invoice.valorPis),
    valorCofins: decimalToNumber(invoice.valorCofins),
    valorIss: decimalToNumber(invoice.valorIss),
    status: invoice.status,
    fileKey: invoice.fileKey,
    fileUrl: invoice.fileUrl,
    fileType: invoice.fileType,
    createdAt: dateToIso(invoice.createdAt),
    updatedAt: dateToIso(invoice.updatedAt),
    items: (invoice.items || []).map(serializeItem),
  };
}

function serializeItem(item) {
  return {
    id: item.id,
    invoiceId: item.invoiceId,
    codigo: item.codigo,
    descricao: item.descricao,
    ncm: item.ncm,
    cfop: item.cfop,
    unidade: item.unidade,
    quantidade: decimalToNumber(item.quantidade),
    valorUnitario: decimalToNumber(item.valorUnitario),
    valorTotal: decimalToNumber(item.valorTotal),
    cstIcms: item.cstIcms,
    csosn: item.csosn,
    cstPis: item.cstPis,
    cstCofins: item.cstCofins,
    aliquotaIcms: decimalToNumber(item.aliquotaIcms),
    aliquotaPis: decimalToNumber(item.aliquotaPis),
    aliquotaCofins: decimalToNumber(item.aliquotaCofins),
    createdAt: dateToIso(item.createdAt),
    updatedAt: dateToIso(item.updatedAt),
  };
}

export class InvoiceRepository {
  static async findByChave(companyId, chave) {
    return prisma.invoice.findFirst({
      where: { companyId, chave },
      include: { items: true },
    });
  }

  static async createFromParsed({ companyId, clientId, header, items, fileKey, fileUrl, fileType }) {
    const existing = await this.findByChave(companyId, header.chave);
    if (existing) {
      const err = new Error("invoice_exists");
      err.code = "INVOICE_EXISTS";
      throw err;
    }
    const created = await prisma.invoice.create({
      data: {
        companyId,
        clientId,
        chave: header.chave,
        numero: header.numero,
        serie: header.serie,
        dhEmi: parseDate(header.dhEmi),
        emitCnpj: header.emitCnpj,
        emitNome: header.emitNome,
        destDoc: header.destDoc,
        destNome: header.destNome,
        cfopPrincipal: header.cfopPrincipal,
        valorTotal: header.valorTotal,
        valorProdutos: header.valorProdutos,
        valorServicos: header.valorServicos,
        valorImpostos: header.valorImpostos,
        valorIcms: header.valorIcms,
        valorPis: header.valorPis,
        valorCofins: header.valorCofins,
        valorIss: header.valorIss,
        fileKey: fileKey || null,
        fileUrl: fileUrl || null,
        fileType: fileType || "xml",
        items: {
          create: (items || []).map((it) => ({
            codigo: it.codigo,
            descricao: it.descricao,
            ncm: it.ncm,
            cfop: it.cfop,
            unidade: it.unidade,
            quantidade: it.quantidade,
            valorUnitario: it.valorUnitario,
            valorTotal: it.valorTotal,
            cstIcms: it.cstIcms,
            csosn: it.csosn,
            cstPis: it.cstPis,
            cstCofins: it.cstCofins,
            aliquotaIcms: it.aliquotaIcms,
            aliquotaPis: it.aliquotaPis,
            aliquotaCofins: it.aliquotaCofins,
          })),
        },
      },
      include: { items: true },
    });
    return serializeInvoice(created);
  }

  static async listInvoices({ companyId, clientId, from, to, emitente, chave, limit = 20, offset = 0 }) {
    const where = {
      companyId,
      ...(clientId ? { clientId } : {}),
      ...(chave ? { chave } : {}),
      ...(emitente ? { emitNome: { contains: emitente, mode: "insensitive" } } : {}),
      ...(from || to
        ? {
            dhEmi: {
              ...(from ? { gte: parseDate(from) } : {}),
              ...(to ? { lte: parseDate(to) } : {}),
            },
          }
        : {}),
    };

    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    const [items, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        orderBy: { dhEmi: "desc" },
        skip,
        take,
        include: { items: true },
      }),
      prisma.invoice.count({ where }),
    ]);
    return {
      total,
      limit: take,
      offset: skip,
      items: items.map(serializeInvoice),
    };
  }

  static async getById(id) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    return invoice ? serializeInvoice(invoice) : null;
  }
}

