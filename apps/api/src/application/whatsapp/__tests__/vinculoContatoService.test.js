// A LIGAÇÃO COM O BANCO — a regra é `vinculoTelefone.js`, testada à parte.
//
// O que se trava aqui é o fio: a rede larga da busca (que é o que permite `divergemPeloNonoDigito`
// acender), o papel vindo do RBAC que já existe, e a recusa de ligar um número a uma pessoa que não
// é membro da empresa.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    contatoWhatsapp: { findMany: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
    companyClientUser: { findMany: jest.fn(), findUnique: jest.fn() },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  resolverVinculoPorTelefone,
  salvarContato,
  removerContato,
  ContatoWhatsappError,
} from "../ContatoWhatsappService.js";
import { SITUACOES, TOLERANCIAS } from "../vinculoTelefone.js";

beforeEach(() => jest.clearAllMocks());

const linha = (over = {}) => ({
  id: "c1",
  portalClientId: "p1",
  nome: "Maria",
  papel: "financeiro",
  telefoneE164: "5521999998888",
  waId: null,
  optInEm: new Date(),
  ativo: true,
  userId: null,
  portalClient: { id: "p1", razao: "ALFA LTDA", cnpj: "11111111000111" },
  ...over,
});

describe("resolverVinculoPorTelefone", () => {
  it("⚠ a QUERY lança a rede LARGA (as duas formas do nono dígito) — quem estreita é a regra", () => {
    // Fosse a query a estreitar, a leitura alternativa ficaria invisível e a discordância entre as
    // duas leituras nunca poderia acender.
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    return resolverVinculoPorTelefone("5521999998888").then(() => {
      const where = prisma.contatoWhatsapp.findMany.mock.calls[0][0].where;
      const numeros = where.OR.flatMap((c) => c.telefoneE164?.in || c.waId?.in || []);
      expect(numeros).toContain("5521999998888");
      expect(numeros).toContain("552199998888");
    });
  });

  it("telefone inválido nem chega ao banco", async () => {
    const r = await resolverVinculoPorTelefone("abc");
    expect(r.situacao).toBe(SITUACOES.TELEFONE_INVALIDO);
    expect(prisma.contatoWhatsapp.findMany).not.toHaveBeenCalled();
  });

  it("sem contato não consulta o RBAC — e responde DESCONHECIDO", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    const r = await resolverVinculoPorTelefone("5521999998888");
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(prisma.companyClientUser.findMany).not.toHaveBeenCalled();
  });

  it("o papel vem do CompanyClientUser da MESMA empresa — não de outra do mesmo usuário", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      linha({ userId: "u1" }),
      linha({
        id: "c2",
        portalClientId: "p2",
        userId: "u1",
        portalClient: { id: "p2", razao: "BETA ME", cnpj: "22222222000122" },
      }),
    ]);
    prisma.companyClientUser.findMany.mockResolvedValue([
      { companyId: "p1", userId: "u1", role: "FINANCEIRO", status: "ACTIVE" },
      { companyId: "p2", userId: "u1", role: "OWNER", status: "ACTIVE" },
    ]);
    const r = await resolverVinculoPorTelefone("5521999998888");
    expect(r.situacao).toBe(SITUACOES.AMBIGUO);
    const porEmpresa = Object.fromEntries(r.empresas.map((e) => [e.portalClientId, e.contatos[0].papelRbac]));
    expect(porEmpresa).toEqual({ p1: "FINANCEIRO", p2: "OWNER" });
  });

  it("contato sem usuário não vira consulta ao RBAC, e sobe sem papel", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([linha()]);
    const r = await resolverVinculoPorTelefone("5521999998888");
    expect(prisma.companyClientUser.findMany).not.toHaveBeenCalled();
    expect(r.empresas[0].contatos[0].papelRbac).toBeNull();
  });

  it("a tolerância atravessa até a regra", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([linha({ telefoneE164: "552199998888" })]);
    expect((await resolverVinculoPorTelefone("5521999998888")).situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(
      (await resolverVinculoPorTelefone("5521999998888", { tolerancia: TOLERANCIAS.NONO_DIGITO })).situacao,
    ).toBe(SITUACOES.VINCULADO);
  });
});

describe("salvarContato — ligar o número a uma PESSOA", () => {
  it("⚠ RECUSA usuário que não é membro ativo da empresa", async () => {
    // Aceitar um `userId` qualquer criaria, pelo cadastro de contato, um vínculo que o RBAC nunca
    // concedeu.
    prisma.companyClientUser.findUnique.mockResolvedValue(null);
    await expect(
      salvarContato({ portalClientId: "p1", nome: "Maria", telefone: "21999998888", userId: "u1" }),
    ).rejects.toThrow(ContatoWhatsappError);
    expect(prisma.contatoWhatsapp.upsert).not.toHaveBeenCalled();
  });

  it("⚠ RECUSA membro REMOVED — vínculo desfeito não identifica ninguém", async () => {
    prisma.companyClientUser.findUnique.mockResolvedValue({ status: "REMOVED" });
    await expect(
      salvarContato({ portalClientId: "p1", nome: "Maria", telefone: "21999998888", userId: "u1" }),
    ).rejects.toMatchObject({ code: "USUARIO_SEM_VINCULO" });
  });

  it("grava o ponteiro quando o usuário é membro ativo", async () => {
    prisma.companyClientUser.findUnique.mockResolvedValue({ status: "ACTIVE" });
    prisma.contatoWhatsapp.upsert.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "p1", nome: "Maria", telefone: "21999998888", userId: "u1" });
    expect(prisma.contatoWhatsapp.upsert.mock.calls[0][0].create.userId).toBe("u1");
  });

  it("sem `userId` no payload, o ponteiro NÃO é tocado — contato sem pessoa é caso normal", async () => {
    prisma.contatoWhatsapp.upsert.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "p1", nome: "Maria", telefone: "21999998888" });
    expect(prisma.companyClientUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.contatoWhatsapp.upsert.mock.calls[0][0].update).not.toHaveProperty("userId");
  });

  it("`userId: null` DESLIGA o ponteiro — e não consulta o RBAC para isso", async () => {
    prisma.contatoWhatsapp.upsert.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "p1", nome: "Maria", telefone: "21999998888", userId: null });
    expect(prisma.companyClientUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.contatoWhatsapp.upsert.mock.calls[0][0].update.userId).toBeNull();
  });
});

describe("⚠ multi-tenancy: o alvo NUNCA é escolhido só pelo id", () => {
  it("editar por id carrega a empresa no `where`", async () => {
    // A rota autoriza sobre a empresa do PATH; sem ela no `where`, um id de contato de OUTRA
    // empresa era atualizado sem que nada conferisse a quem ele pertence.
    prisma.contatoWhatsapp.update.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "p1", id: "c1", nome: "Maria", telefone: "21999998888" });
    expect(prisma.contatoWhatsapp.update.mock.calls[0][0].where).toEqual({ id: "c1", portalClientId: "p1" });
  });

  it("remover carrega a empresa no `where`", async () => {
    prisma.contatoWhatsapp.delete.mockResolvedValue({ id: "c1" });
    await removerContato("p1", "c1");
    expect(prisma.contatoWhatsapp.delete.mock.calls[0][0].where).toEqual({ id: "c1", portalClientId: "p1" });
  });
});
