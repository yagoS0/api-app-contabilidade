// A LIGAÇÃO COM O BANCO — a regra é `vinculoTelefone.js`, testada à parte.
//
// O que se trava aqui é o fio: a rede larga da busca (que é o que permite `divergemPeloNonoDigito`
// acender), o papel vindo do RBAC que já existe, e a recusa de ligar um número a uma pessoa que não
// é membro da empresa.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    contatoWhatsapp: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
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
import { SITUACOES, LEITURAS } from "../vinculoTelefone.js";

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

  it("⚠ a query pesca largo, mas quem RESPONDE é o cadastro — e a divergência acende", async () => {
    // A busca usa `variantesE164` de propósito: sem trazer a linha do formato antigo, a divergência
    // ficaria invisível e ninguém saberia que aquele cadastro precisa ser corrigido. O que a rede
    // larga NÃO faz é decidir — a regra casa dígito a dígito e recusa.
    prisma.contatoWhatsapp.findMany.mockResolvedValue([linha({ telefoneE164: "552199998888" })]);
    const r = await resolverVinculoPorTelefone("5521999998888");
    expect(r.situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(r.divergemPeloNonoDigito).toBe(true);
    expect(r.leituras[LEITURAS.NONO_DIGITO].situacao).toBe(SITUACOES.VINCULADO);
    // A linha foi buscada com as DUAS formas — é isso que torna o aviso possível.
    const where = prisma.contatoWhatsapp.findMany.mock.calls.at(-1)[0].where;
    expect(where.OR[0].telefoneE164.in.sort()).toEqual(["552199998888", "5521999998888"]);
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

// ── ⚠⚠ O QUE NÃO VEIO NÃO SE TOCA (05/09/2026) ──────────────────────────────────────────────────
//
// `salvarContato` montava `dados` com os cinco campos SEMPRE e mandava o mesmo objeto para o
// `update` e para o `upsert.update`. Salvar sem telefone APAGAVA o telefone; sem e-mail, o e-mail;
// sem `ativo`, o contato era REATIVADO. E o pior: a tela manda `optIn: optIn === true` sempre, e
// ela não tem edição — todo salvamento é upsert pelo telefone —, então recadastrar o mesmo número
// para corrigir um nome APAGAVA o consentimento e tirava a empresa do lote de WhatsApp.

describe("⚠⚠ atualização parcial: undefined = não mexer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("salvar só o nome NÃO apaga telefone nem e-mail", async () => {
    prisma.contatoWhatsapp.update.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "emp1", id: "c1", nome: "Maria Silva" });

    const { data } = prisma.contatoWhatsapp.update.mock.calls.at(-1)[0];
    expect(data.nome).toBe("Maria Silva");
    expect(data).not.toHaveProperty("telefoneE164");
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("ativo");
  });

  it("⚠ e NÃO reativa um contato desativado", async () => {
    prisma.contatoWhatsapp.update.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "emp1", id: "c1", nome: "Maria" });
    const { data } = prisma.contatoWhatsapp.update.mock.calls.at(-1)[0];
    // `ativo: true` aqui é o que fazia "desativar" não sobreviver ao salvamento seguinte.
    expect(data.ativo).toBeUndefined();
  });

  it("⚠ apagar continua possível — string vazia é ato explícito", async () => {
    prisma.contatoWhatsapp.findFirst.mockResolvedValue({ telefoneE164: "5521999998888", email: "a@b.com" });
    prisma.contatoWhatsapp.update.mockResolvedValue({ id: "c1" });
    await salvarContato({ portalClientId: "emp1", id: "c1", nome: "Maria", email: "" });
    const { data } = prisma.contatoWhatsapp.update.mock.calls.at(-1)[0];
    expect(data.email).toBeNull();
  });

  it("⚠⚠ mas não dá para ficar SEM canal nenhum", async () => {
    prisma.contatoWhatsapp.findFirst.mockResolvedValue({ telefoneE164: null, email: "a@b.com" });
    await expect(
      salvarContato({ portalClientId: "emp1", id: "c1", nome: "Maria", email: "" }),
    ).rejects.toMatchObject({ code: "SEM_CANAL" });
  });

  it("criar sem canal nenhum continua recusado", async () => {
    await expect(
      salvarContato({ portalClientId: "emp1", nome: "Maria" }),
    ).rejects.toMatchObject({ code: "SEM_CANAL" });
  });
});

describe("⚠⚠ o opt-in não se apaga sozinho", () => {
  beforeEach(() => jest.clearAllMocks());

  it("`optIn: false` NÃO zera o consentimento já registrado", async () => {
    prisma.contatoWhatsapp.upsert.mockResolvedValue({ id: "c1" });
    await salvarContato({
      portalClientId: "emp1", nome: "Maria", telefone: "21999998888", optIn: false,
    });
    const { update } = prisma.contatoWhatsapp.upsert.mock.calls.at(-1)[0];
    // Era `optInEm: null` + `optInOrigem: null` — o recadastro tirava a empresa do lote.
    expect(update).not.toHaveProperty("optInEm");
    expect(update).not.toHaveProperty("optInOrigem");
  });

  it("⚠ e `optIn: true` continua gravando DATA e ORIGEM — o registro do consentimento não afrouxou", async () => {
    prisma.contatoWhatsapp.upsert.mockResolvedValue({ id: "c1" });
    await salvarContato({
      portalClientId: "emp1", nome: "Maria", telefone: "21999998888",
      optIn: true, optInOrigem: "contrato",
    });
    const { update } = prisma.contatoWhatsapp.upsert.mock.calls.at(-1)[0];
    expect(update.optInEm).toBeInstanceOf(Date);
    expect(update.optInOrigem).toBe("contrato");
  });
});

describe("⚠ o zero de operadora não entra no cadastro", () => {
  it("`021 99999-8888` é recusado com TELEFONE_INVALIDO", async () => {
    await expect(
      salvarContato({ portalClientId: "emp1", nome: "Maria", telefone: "021 99999-8888" }),
    ).rejects.toMatchObject({ code: "TELEFONE_INVALIDO" });
  });
});
