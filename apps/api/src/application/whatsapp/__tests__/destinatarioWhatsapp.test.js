// QUEM RECEBE — e por que, quando ninguém recebe.
//
// A função devolve o MOTIVO em vez de só `null`. "Sem contato" e "sem opt-in" são problemas
// diferentes, com consertos diferentes (cadastrar × pedir autorização), e somi-los num `null` faria
// a empresa cair para e-mail em silêncio no lote — o defeito que já custou 29 dias na captura de
// notas e que o plano proíbe explicitamente.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    contatoWhatsapp: { findMany: jest.fn() },
    portalClient: { findUnique: jest.fn() },
  },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { destinatarioWhatsapp, canaisParaEnvio } from "../ContatoWhatsappService.js";

beforeEach(() => jest.clearAllMocks());

describe("destinatarioWhatsapp", () => {
  it("sem contato: diz que falta CADASTRAR", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([]);
    const r = await destinatarioWhatsapp("p1");
    expect(r.contato).toBeNull();
    expect(r.motivo).toMatch(/sem contato/i);
  });

  it("com contato mas SEM opt-in: bloqueia, e diz que falta a autorização", async () => {
    // Não é formalidade: sem opt-in o cliente pode denunciar como spam, e denúncia derruba a
    // qualidade do número — que é o canal de TODOS os clientes.
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "c1", nome: "Maria", telefoneE164: "5521999998888", optInEm: null },
    ]);
    const r = await destinatarioWhatsapp("p1");
    expect(r.contato).toBeNull();
    expect(r.motivo).toMatch(/opt-in/i);
  });

  it("com opt-in: devolve o contato e nenhum motivo", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "c1", nome: "Maria", telefoneE164: "5521999998888", optInEm: new Date() },
    ]);
    const r = await destinatarioWhatsapp("p1");
    expect(r.contato.id).toBe("c1");
    expect(r.motivo).toBeNull();
  });

  it("entre vários, escolhe o que TEM opt-in — não o primeiro", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "sem", nome: "Sócio", optInEm: null },
      { id: "com", nome: "Financeiro", optInEm: new Date() },
    ]);
    expect((await destinatarioWhatsapp("p1")).contato.id).toBe("com");
  });
});

describe("canaisParaEnvio", () => {
  it("PERGUNTAR não é resolvido no backend — sobe para a tela decidir", async () => {
    // Escolher um canal por conta própria quando o cadastro diz "pergunte" seria decidir no lugar
    // do contador.
    prisma.portalClient.findUnique.mockResolvedValue({ canalPadraoEnvio: "PERGUNTAR", guideNotificationEmail: "a@b.com" });
    const r = await canaisParaEnvio("p1");
    expect(r.padrao).toBe("PERGUNTAR");
    expect(r.escolha).toBeNull();
  });

  it("padrão da empresa vale quando não há escolha explícita", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ canalPadraoEnvio: "WHATSAPP", guideNotificationEmail: null });
    expect((await canaisParaEnvio("p1")).escolha).toBe("WHATSAPP");
  });

  it("escolha explícita vence o padrão", async () => {
    prisma.portalClient.findUnique.mockResolvedValue({ canalPadraoEnvio: "WHATSAPP", guideNotificationEmail: "a@b.com" });
    expect((await canaisParaEnvio("p1", "EMAIL")).escolha).toBe("EMAIL");
  });

  it("empresa sem cadastro de canal cai em EMAIL — ninguém migra à revelia", async () => {
    prisma.portalClient.findUnique.mockResolvedValue(null);
    expect((await canaisParaEnvio("p1")).escolha).toBe("EMAIL");
  });
});
