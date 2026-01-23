import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";
import { decimalToNumber, dateToIso } from "../../utils/serializers.js";

const clientInclude = {
  companies: {
    include: {
      partners: true,
    },
  },
};

export class ClientRepository {
  static async createClientWithCompany({ client, company }) {
    const partners = company.partners || [];
    const passwordHash = await bcrypt.hash(client.password, 10);
    const login = client.email.toLowerCase();
    const created = await prisma.client.create({
      data: {
        name: client.name,
        email: client.email,
        login,
        passwordHash,
        phone: client.phone,
        cpf: client.cpf,
        companies: {
          create: [
            {
              razaoSocial: company.razaoSocial,
              cnpj: company.cnpj,
              nomeFantasia: company.nomeFantasia,
              atividades: company.atividades || [],
              porte: company.porte,
              tipoTributario: company.tipoTributario,
              anexoSimples: company.anexoSimples,
              endereco: company.endereco,
              email: company.email,
              telefone: company.telefone,
              capitalSocial: company.capitalSocial,
              dataAbertura: company.dataAbertura,
              quantidadeSocios: company.quantidadeSocios ?? partners.length,
              inscricaoMunicipal: company.inscricaoMunicipal,
              codigoServicoNacional: company.codigoServicoNacional,
              codigoServicoMunicipal: company.codigoServicoMunicipal,
              rpsSerie: company.rpsSerie,
              rpsNumero: company.rpsNumero,
              partners: {
                create: partners.map((partner) => ({
                  name: partner.name,
                  phone: partner.phone,
                  email: partner.email,
                  participacao: partner.participacao,
                  documento: partner.documento,
                  representante: partner.representante ?? false,
                })),
              },
            },
          ],
        },
      },
      include: clientInclude,
    });
    return serializeClient(created);
  }

  static async listClients({ offset = 0, limit = 20 } = {}) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    const [items, total] = await prisma.$transaction([
      prisma.client.findMany({
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: clientInclude,
      }),
      prisma.client.count(),
    ]);
    return {
      total,
      limit: take,
      offset: skip,
      items: items.map(serializeClient),
    };
  }

  static async getClientById(id) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: clientInclude,
    });
    return client ? serializeClient(client) : null;
  }

  static async deleteClient(id) {
    // Prisma cascades to related companies/partners per FK onDelete rules
    return prisma.client.delete({ where: { id } });
  }

  static async findByLogin(login) {
    return prisma.client.findUnique({
      where: { login: login.toLowerCase() },
    });
  }
}

function serializeClient(client) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    phone: client.phone,
    cpf: client.cpf,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    companies: (client.companies || []).map(serializeCompany),
  };
}

function serializeCompany(company) {
  return {
    id: company.id,
    clientId: company.clientId,
    razaoSocial: company.razaoSocial,
    cnpj: company.cnpj,
    nomeFantasia: company.nomeFantasia,
    atividades: company.atividades || [],
    porte: company.porte,
    tipoTributario: company.tipoTributario,
    anexoSimples: company.anexoSimples,
    endereco: company.endereco,
    email: company.email,
    telefone: company.telefone,
    capitalSocial: decimalToNumber(company.capitalSocial),
    dataAbertura: dateToIso(company.dataAbertura),
    quantidadeSocios: company.quantidadeSocios,
    inscricaoMunicipal: company.inscricaoMunicipal,
    codigoServicoNacional: company.codigoServicoNacional,
    codigoServicoMunicipal: company.codigoServicoMunicipal,
    rpsSerie: company.rpsSerie,
    rpsNumero: company.rpsNumero,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
    partners: (company.partners || []).map(serializePartner),
  };
}

function serializePartner(partner) {
  return {
    id: partner.id,
    companyId: partner.companyId,
    name: partner.name,
    phone: partner.phone,
    email: partner.email,
    participacao: decimalToNumber(partner.participacao),
    documento: partner.documento,
    representante: partner.representante,
    createdAt: partner.createdAt.toISOString(),
    updatedAt: partner.updatedAt.toISOString(),
  };
}

