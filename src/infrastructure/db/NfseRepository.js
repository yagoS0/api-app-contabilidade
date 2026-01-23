import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";

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

  static async findById(id) {
    const invoice = await prisma.serviceInvoice.findUnique({
      where: { id },
    });
    return serialize(invoice);
  }
}
