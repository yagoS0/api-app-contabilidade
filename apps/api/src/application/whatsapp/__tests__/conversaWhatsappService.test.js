// A CONVERSA — a ligação com o banco. A regra da janela é `janela24h.test.js`; o vínculo é
// `vinculoTelefone.test.js`. Aqui trava-se o FIO entre eles:
//
//   · a idempotência do webhook (reentrega do mesmo `wamid` não vira segunda mensagem);
//   · a atribuição de empresa saindo do VÍNCULO, e só quando ele não tem dúvida;
//   · o escopo de tenant na leitura;
//   · a janela derivada da última mensagem RECEBIDA, nunca de um booleano gravado.
//
// ⚠ O vínculo NÃO é mockado — é o de verdade, alimentado pelo mock do prisma. Uma réplica dele aqui
// deixaria de flagrar o dia em que a regra mudasse.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    contatoWhatsapp: { findMany: jest.fn() },
    companyClientUser: { findMany: jest.fn() },
    conversaWhatsapp: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    mensagemWhatsapp: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  DIRECAO,
  ConversaWhatsappError,
  garantirConversa,
  registrarMensagemRecebida,
  janelaDaConversa,
  listarMensagens,
  conversasNaoVinculadas,
  atribuirConversa,
} from "../ConversaWhatsappService.js";
import { SITUACOES } from "../vinculoTelefone.js";
import { SITUACOES_JANELA, PERMISSOES } from "../janela24h.js";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
  prisma.companyClientUser.findMany.mockResolvedValue([]);
  prisma.conversaWhatsapp.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "conv1", ...create }));
  prisma.mensagemWhatsapp.create.mockImplementation(({ data }) => Promise.resolve({ id: "m1", ...data }));
});

const contato = (over = {}) => ({
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

const evento = (over = {}) => ({
  telefone: "5521999998888",
  providerMessageId: "wamid.AAA",
  tipo: "text",
  corpo: "recebi, obrigado",
  ...over,
});

describe("⚠ A ATRIBUIÇÃO DE EMPRESA SAI DO VÍNCULO — e só quando ele não tem dúvida", () => {
  it("VINCULADO: a mensagem entra no fio já atribuído àquela empresa", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([contato()]);
    const r = await registrarMensagemRecebida(evento());
    expect(r.vinculo.situacao).toBe(SITUACOES.VINCULADO);
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].create.portalClientId).toBe("p1");
  });

  it("⚠ AMBIGUO (o sócio com dois CNPJs): o fio fica SEM empresa — nada entra no histórico do CNPJ errado", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      contato(),
      contato({ id: "c2", portalClientId: "p2", portalClient: { id: "p2", razao: "BETA LTDA", cnpj: "22222222000122" } }),
    ]);
    const r = await registrarMensagemRecebida(evento());
    expect(r.vinculo.situacao).toBe(SITUACOES.AMBIGUO);
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].create.portalClientId).toBeUndefined();
    // ⚠ E a mensagem foi gravada assim mesmo: ambígua não é perdida, é não atribuída.
    expect(prisma.mensagemWhatsapp.create).toHaveBeenCalled();
  });

  it("DESCONHECIDO: mesma coisa — fio sem empresa, mensagem guardada", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    const r = await registrarMensagemRecebida(evento());
    expect(r.vinculo.situacao).toBe(SITUACOES.DESCONHECIDO);
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].create.portalClientId).toBeUndefined();
    expect(prisma.mensagemWhatsapp.create).toHaveBeenCalled();
  });

  it("⚠ ambiguidade de PESSOA (dois contatos da MESMA empresa) NÃO impede a atribuição: a empresa é uma só", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([contato(), contato({ id: "c2", nome: "João" })]);
    const r = await registrarMensagemRecebida(evento());
    expect(r.vinculo.situacao).toBe(SITUACOES.VINCULADO);
    expect(r.vinculo.ambiguidades).toContain("PESSOA");
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].create.portalClientId).toBe("p1");
  });

  it("⚠ uma atribuição existente não é apagada por um evento posterior sem vínculo", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    await registrarMensagemRecebida(evento());
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].update).not.toHaveProperty("portalClientId");
  });
});

describe("⚠ IDEMPOTÊNCIA DO WEBHOOK", () => {
  it("a reentrega do mesmo wamid não vira segunda mensagem — o conflito do banco é lido como 'já processado'", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([contato()]);
    const conflito = Object.assign(new Error("unique"), { code: "P2002" });
    prisma.mensagemWhatsapp.create.mockRejectedValueOnce(conflito);
    prisma.mensagemWhatsapp.findUnique.mockResolvedValue({ id: "m1", providerMessageId: "wamid.AAA" });

    const r = await registrarMensagemRecebida(evento());
    expect(r.duplicada).toBe(true);
    expect(r.mensagem.id).toBe("m1");
  });

  it("⚠ qualquer outro erro do banco NÃO é engolido como duplicata", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([contato()]);
    prisma.mensagemWhatsapp.create.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "P1008" }));
    await expect(registrarMensagemRecebida(evento())).rejects.toThrow("timeout");
  });

  it("mensagem recebida sem o identificador da Meta é RECUSADA — sem ele não há idempotência", async () => {
    await expect(registrarMensagemRecebida(evento({ providerMessageId: "" }))).rejects.toMatchObject({
      code: "SEM_IDENTIFICADOR_DO_PROVEDOR",
    });
    expect(prisma.mensagemWhatsapp.create).not.toHaveBeenCalled();
  });

  it("remetente que não é telefone é recusado antes de gravar qualquer coisa", async () => {
    await expect(registrarMensagemRecebida(evento({ telefone: "abc" }))).rejects.toBeInstanceOf(ConversaWhatsappError);
    expect(prisma.conversaWhatsapp.upsert).not.toHaveBeenCalled();
  });
});

describe("⚠ A JANELA É DERIVADA — não há coluna `aberta`", () => {
  it("lê a última mensagem RECEBIDA (direcao 'in'), nunca as nossas", async () => {
    prisma.mensagemWhatsapp.findFirst.mockResolvedValue(null);
    await janelaDaConversa("conv1");
    expect(prisma.mensagemWhatsapp.findFirst.mock.calls[0][0].where.direcao).toBe(DIRECAO.ENTRADA);
  });

  it("fio sem mensagem recebida: NUNCA_ABERTA, só template", async () => {
    prisma.mensagemWhatsapp.findFirst.mockResolvedValue(null);
    const r = await janelaDaConversa("conv1");
    expect(r.situacao).toBe(SITUACOES_JANELA.NUNCA_ABERTA);
    expect(r.permite).toBe(PERMISSOES.SOMENTE_TEMPLATE);
  });

  it("recebida há 2h: ABERTA, texto livre", async () => {
    const agora = new Date("2026-08-14T12:00:00.000Z");
    const ha2h = new Date("2026-08-14T10:00:00.000Z");
    prisma.mensagemWhatsapp.findFirst.mockResolvedValue({ ocorridaEmProvedor: ha2h, registradaEm: ha2h });
    const r = await janelaDaConversa("conv1", agora);
    expect(r.situacao).toBe(SITUACOES_JANELA.ABERTA);
    expect(r.permite).toBe(PERMISSOES.TEXTO_LIVRE);
  });

  it("recebida há 30h: EXPIRADA", async () => {
    const agora = new Date("2026-08-14T12:00:00.000Z");
    const antes = new Date("2026-08-13T06:00:00.000Z");
    prisma.mensagemWhatsapp.findFirst.mockResolvedValue({ ocorridaEmProvedor: antes, registradaEm: antes });
    expect((await janelaDaConversa("conv1", agora)).situacao).toBe(SITUACOES_JANELA.EXPIRADA);
  });

  it("⚠ ordena pelo NOSSO instante, que nunca é nulo — ordenar pelo do provedor escolheria a linha errada", async () => {
    prisma.mensagemWhatsapp.findFirst.mockResolvedValue(null);
    await janelaDaConversa("conv1");
    expect(prisma.mensagemWhatsapp.findFirst.mock.calls[0][0].orderBy).toEqual({ registradaEm: "desc" });
  });
});

describe("⚠ MULTI-TENANCY — a conversa de uma empresa não é alcançável pelo escopo de outra", () => {
  it("a leitura escopa pela empresa ATRAVÉS da conversa", async () => {
    prisma.mensagemWhatsapp.findMany.mockResolvedValue([]);
    await listarMensagens({ portalClientId: "p1", conversaId: "conv1" });
    expect(prisma.mensagemWhatsapp.findMany.mock.calls[0][0].where).toMatchObject({
      conversaId: "conv1",
      conversa: { portalClientId: "p1" },
    });
  });

  it("sem empresa não se lê mensagem nenhuma — recusa com motivo", async () => {
    await expect(listarMensagens({ conversaId: "conv1" })).rejects.toMatchObject({ code: "SEM_ESCOPO" });
    expect(prisma.mensagemWhatsapp.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠ A FILA DE NÃO VINCULADOS É UMA CONSULTA, e o motivo vem do VÍNCULO", () => {
  it("distingue DESCONHECIDO de AMBIGUO, e traz as candidatas para o canal PERGUNTAR", async () => {
    prisma.conversaWhatsapp.findMany.mockResolvedValue([
      { id: "conv1", telefoneE164: "5521999998888" },
      { id: "conv2", telefoneE164: "5521777776666" },
    ]);
    prisma.contatoWhatsapp.findMany
      .mockResolvedValueOnce([
        contato(),
        contato({ id: "c2", portalClientId: "p2", portalClient: { id: "p2", razao: "BETA LTDA", cnpj: "2" } }),
      ])
      .mockResolvedValueOnce([]);

    const fila = await conversasNaoVinculadas();
    expect(fila[0].motivo).toBe(SITUACOES.AMBIGUO);
    expect(fila[0].empresasCandidatas.map((e) => e.portalClientId)).toEqual(["p1", "p2"]);
    expect(fila[1].motivo).toBe(SITUACOES.DESCONHECIDO);
  });

  it("a consulta pede exatamente os fios sem empresa", async () => {
    prisma.conversaWhatsapp.findMany.mockResolvedValue([]);
    await conversasNaoVinculadas();
    expect(prisma.conversaWhatsapp.findMany.mock.calls[0][0].where).toEqual({ portalClientId: null });
  });
});

describe("⚠ ATRIBUIR NÃO É ESCOLHER LIVREMENTE", () => {
  it("resolve o AMBIGUO para uma das candidatas", async () => {
    prisma.conversaWhatsapp.findUnique.mockResolvedValue({ id: "conv1", telefoneE164: "5521999998888" });
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      contato(),
      contato({ id: "c2", portalClientId: "p2", portalClient: { id: "p2", razao: "BETA LTDA", cnpj: "2" } }),
    ]);
    prisma.conversaWhatsapp.update.mockResolvedValue({ id: "conv1", portalClientId: "p2" });

    const r = await atribuirConversa({ conversaId: "conv1", portalClientId: "p2" });
    expect(r.portalClientId).toBe("p2");
  });

  it("⚠ empresa cujo cadastro NÃO tem o número é recusada — atribuir assim seria casar sem cadastro", async () => {
    prisma.conversaWhatsapp.findUnique.mockResolvedValue({ id: "conv1", telefoneE164: "5521999998888" });
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    await expect(atribuirConversa({ conversaId: "conv1", portalClientId: "p9" })).rejects.toMatchObject({
      code: "EMPRESA_NAO_E_CANDIDATA",
    });
    expect(prisma.conversaWhatsapp.update).not.toHaveBeenCalled();
  });
});

describe("garantirConversa", () => {
  it("normaliza o número antes de abrir o fio — o mesmo E.164 do cadastro", async () => {
    await garantirConversa({ telefone: "(21) 99999-8888" });
    expect(prisma.conversaWhatsapp.upsert.mock.calls[0][0].where).toEqual({ telefoneE164: "5521999998888" });
  });

  it("telefone inválido não abre fio nenhum", async () => {
    await expect(garantirConversa({ telefone: "xyz" })).rejects.toMatchObject({ code: "TELEFONE_INVALIDO" });
  });
});
