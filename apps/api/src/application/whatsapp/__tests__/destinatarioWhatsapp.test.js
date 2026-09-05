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
    // ⚠ Os dois com TELEFONE: desde 05/09/2026 o destinatário de WhatsApp precisa ter um. A fixture
    // antiga não tinha, e era essa a suposição que deixava passar um contato só de e-mail.
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "sem", nome: "Sócio", telefoneE164: "5521988887777", optInEm: null },
      { id: "com", nome: "Financeiro", telefoneE164: "5521999998888", optInEm: new Date() },
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

// ── ⚠⚠ CONTATO SÓ DE E-MAIL NÃO É DESTINATÁRIO DE WHATSAPP (05/09/2026) ─────────────────────────
//
// Desde que o destinatário passou a poder ter só e-mail, `contatos.find(c => c.optInEm)` — sem
// olhar telefone — fazia a empresa parecer apta ao WhatsApp. A cadeia media inteira: a prévia do
// lote listava a guia como "vai por WhatsApp", o envio montava o destino com `telefoneE164: null`,
// o cliente da Meta recusava, e a guia **não ia por e-mail tampouco** — porque a prévia já a tinha
// classificado como WhatsApp. Guia que não sai por canal nenhum.

describe("⚠⚠ opt-in sem telefone não habilita o WhatsApp", () => {
  it("contato só de e-mail, mesmo com opt-in, NÃO vira destinatário", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "so-email", nome: "Financeiro", telefoneE164: null, email: "fin@empresa.com", optInEm: new Date() },
    ]);
    const r = await destinatarioWhatsapp("p1");
    expect(r.contato).toBeNull();
    // ⚠ E o motivo é PRÓPRIO: "sem telefone" manda cadastrar o número; "sem contato" mandaria
    // cadastrar uma pessoa que já existe, e "sem opt-in" mandaria pedir uma autorização que não
    // resolve. Três consertos diferentes.
    expect(r.motivo).toMatch(/sem telefone/);
  });

  it("⚠ com telefone e sem opt-in, o motivo continua sendo o opt-in", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "c1", nome: "Maria", telefoneE164: "5521999998888", optInEm: null },
    ]);
    expect((await destinatarioWhatsapp("p1")).motivo).toMatch(/opt-in/);
  });

  it("⚠ o contato só de e-mail não atrapalha quem TEM telefone na mesma empresa", async () => {
    prisma.contatoWhatsapp.findMany.mockResolvedValue([
      { id: "so-email", nome: "Financeiro", telefoneE164: null, optInEm: new Date() },
      { id: "com-tel", nome: "Maria", telefoneE164: "5521999998888", optInEm: new Date() },
    ]);
    const r = await destinatarioWhatsapp("p1");
    expect(r.contato.id).toBe("com-tel");
  });
});
