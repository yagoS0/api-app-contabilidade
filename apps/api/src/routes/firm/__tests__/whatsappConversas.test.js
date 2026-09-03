// AS ROTAS DE CONVERSAS DE WHATSAPP — a porta do escritório (F5, 02/09/2026).
//
// O que fica travado: (1) o escopo por CARTEIRA (fio de empresa fora da carteira é 404, nunca
// 403); (2) ASSUMIR grava quem e quando — é o que pausa a IA — e DEVOLVER limpa; (3) RESPONDER fora
// da janela de 24h é 409 SEM chamar a Meta; dentro, envia e registra `autor: HUMANO`; (4) VINCULAR
// cadastra o contato com o telefone DO FIO (o corpo não escolhe o número) e atribui.

import request from "supertest";
import express from "express";

const FIO_DA_CARTEIRA = { id: "cv1", telefoneE164: "5521999998888", portalClientId: "pc-1", atendidaPor: null, atendidaDesde: null, lidaAteEm: null, updatedAt: new Date(), portalClient: { id: "pc-1", razao: "ACME", cnpj: "1" }, atendente: null };
const FIO_DE_FORA = { ...FIO_DA_CARTEIRA, id: "cv2", portalClientId: "pc-9", portalClient: { id: "pc-9", razao: "OUTRA", cnpj: "2" } };
const FIO_NA_FILA = { ...FIO_DA_CARTEIRA, id: "cv3", portalClientId: null, portalClient: null };

const mockConversas = new Map([["cv1", { ...FIO_DA_CARTEIRA }], ["cv2", { ...FIO_DE_FORA }], ["cv3", { ...FIO_NA_FILA }]]);
const mockCenario = { janela: { situacao: "ABERTA", permite: "TEXTO_LIVRE", expiraEm: null, avisos: [] } };

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    portalClient: { findMany: jest.fn(async () => [{ id: "pc-1" }]) },
    companyFirmAccess: { findMany: jest.fn(async () => []) },
    conversaWhatsapp: {
      findUnique: jest.fn(async ({ where }) => mockConversas.get(where.id) || null),
      findMany: jest.fn(async () => [...mockConversas.values()]),
      update: jest.fn(async ({ where, data }) => Object.assign(mockConversas.get(where.id), data)),
    },
    mensagemWhatsapp: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    templateWhatsapp: { findUnique: jest.fn(async () => ({ chave: "reabrir_conversa", statusAprovacao: "DECLARADO", nomeMeta: null })) },
    acaoPendenteWhatsapp: { findFirst: jest.fn(async () => null) },
    chamadaIa: { aggregate: jest.fn(async () => ({ _sum: { custoEstimadoCentavos: 0 }, _count: { _all: 0 } })) },
  };
  return { prisma };
});

jest.mock("../../../application/whatsapp/ConversaWhatsappService.js", () => {
  const real = jest.requireActual("../../../application/whatsapp/ConversaWhatsappService.js");
  return {
    ...real,
    conversasNaoVinculadas: jest.fn(async () => [{ conversa: { id: "cv3" }, motivo: "DESCONHECIDO", empresasCandidatas: [], divergemPeloNonoDigito: false }]),
    listarMensagens: jest.fn(async () => [{ id: "m1", direcao: "in", tipo: "text", corpo: "oi", autor: null, registradaEm: new Date() }]),
    janelaDaConversa: jest.fn(async () => mockCenario.janela),
    atribuirConversa: jest.fn(async ({ conversaId, portalClientId }) => ({ ...mockConversas.get(conversaId), portalClientId })),
    registrarMensagemEnviada: jest.fn(async (args) => ({ mensagem: { id: "out1", ...args }, duplicada: false })),
  };
});
jest.mock("../../../application/whatsapp/ContatoWhatsappService.js", () => ({
  ContatoWhatsappError: class extends Error { constructor(code, m) { super(m); this.code = code; } },
  salvarContato: jest.fn(async (args) => ({ id: "ctt1", ...args })),
  resolverVinculoPorTelefone: jest.fn(async () => ({ situacao: "VINCULADO", empresas: [{ portalClientId: "pc-1" }] })),
}));

import { createWhatsappConversasRouter } from "../whatsappConversas.js";
import { registrarMensagemEnviada } from "../../../application/whatsapp/ConversaWhatsappService.js";
import { salvarContato } from "../../../application/whatsapp/ContatoWhatsappService.js";

const cloud = { enviarTexto: jest.fn(async () => ({ wamid: "wamid.h" })) };

function montarApp(user = { id: "u-contador", role: "contador", accountType: "FIRM" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { user }; next(); });
  app.use("/firm", createWhatsappConversasRouter({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }, cloud }));
  return app;
}

beforeEach(() => {
  cloud.enviarTexto.mockClear();
  registrarMensagemEnviada.mockClear();
  salvarContato.mockClear();
  mockCenario.janela = { situacao: "ABERTA", permite: "TEXTO_LIVRE", expiraEm: null, avisos: [] };
  Object.assign(mockConversas.get("cv1"), { atendidaPor: null, atendidaDesde: null });
});

describe("papel", () => {
  it("quem não é admin|contador é 403 em todas", async () => {
    const app = montarApp({ id: "u", role: "staff" });
    for (const [m, p] of [["get", "/firm/whatsapp/conversas"], ["get", "/firm/whatsapp/conversas/cv1/mensagens"], ["post", "/firm/whatsapp/conversas/cv1/assumir"], ["post", "/firm/whatsapp/conversas/cv1/responder"]]) {
      const r = await request(app)[m](p).send({ texto: "x" });
      expect(r.status).toBe(403);
    }
  });
});

describe("a lista e o fio", () => {
  it("lista: os da carteira + a fila, com a janela e o motivo da não vinculada", async () => {
    const r = await request(montarApp()).get("/firm/whatsapp/conversas");
    expect(r.status).toBe(200);
    const ids = r.body.conversas.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["cv1", "cv3"]));
    const fila = r.body.conversas.find((c) => c.id === "cv3");
    expect(fila.vinculo.motivo).toBe("DESCONHECIDO");
    expect(fila.telefoneMascarado).toBe("+55…8888");
    expect(r.body.conversas.find((c) => c.id === "cv1").janela.situacao).toBe("ABERTA");
  });
  it("⚠ fio de empresa FORA da carteira: 404 (a existência não é informação)", async () => {
    const r = await request(montarApp()).get("/firm/whatsapp/conversas/cv2/mensagens");
    expect(r.status).toBe(404);
  });
  it("o fio da carteira volta com as mensagens em ordem cronológica e marca lidaAteEm", async () => {
    const r = await request(montarApp()).get("/firm/whatsapp/conversas/cv1/mensagens");
    expect(r.status).toBe(200);
    expect(r.body.mensagens[0]).toMatchObject({ id: "m1", direcao: "in", corpo: "oi" });
    expect(mockConversas.get("cv1").lidaAteEm).toBeInstanceOf(Date);
  });
});

describe("assumir e devolver — o que pausa a IA", () => {
  it("assumir grava atendidaPor (quem) e atendidaDesde (quando); devolver limpa os dois", async () => {
    const app = montarApp();
    const a = await request(app).post("/firm/whatsapp/conversas/cv1/assumir");
    expect(a.status).toBe(200);
    expect(mockConversas.get("cv1").atendidaPor).toBe("u-contador");
    expect(mockConversas.get("cv1").atendidaDesde).toBeInstanceOf(Date);
    const d = await request(app).post("/firm/whatsapp/conversas/cv1/devolver");
    expect(d.status).toBe(200);
    expect(mockConversas.get("cv1").atendidaPor).toBeNull();
    expect(mockConversas.get("cv1").atendidaDesde).toBeNull();
  });
});

describe("responder — só dentro da janela", () => {
  it("⚠ janela EXPIRADA: 409 com o motivo, o estado do template reabrir_conversa, e a Meta NÃO é chamada", async () => {
    mockCenario.janela = { situacao: "EXPIRADA", permite: "SOMENTE_TEMPLATE", expiraEm: new Date(0), avisos: ["x"] };
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder").send({ texto: "olá" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("FORA_DA_JANELA");
    expect(r.body.reabrirConversa).toMatchObject({ chave: "reabrir_conversa", statusAprovacao: "DECLARADO", disponivel: false });
    expect(cloud.enviarTexto).not.toHaveBeenCalled();
  });
  it("NUNCA_ABERTA diz que o cliente nunca escreveu", async () => {
    mockCenario.janela = { situacao: "NUNCA_ABERTA", permite: "SOMENTE_TEMPLATE", avisos: [] };
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder").send({ texto: "olá" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/nunca escreveu/);
  });
  it("dentro da janela: envia pela Meta e registra o balão como HUMANO — sem assumir o fio", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder").send({ texto: "Bom dia, já vi aqui." });
    expect(r.status).toBe(200);
    expect(cloud.enviarTexto).toHaveBeenCalledWith({ telefone: "5521999998888", texto: "Bom dia, já vi aqui." });
    expect(registrarMensagemEnviada).toHaveBeenCalledWith(expect.objectContaining({ autor: "HUMANO", corpo: "Bom dia, já vi aqui.", providerMessageId: "wamid.h" }));
    expect(mockConversas.get("cv1").atendidaPor).toBeNull();
  });
  it("texto vazio: 400, sem chamada", async () => {
    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv1/responder").send({ texto: "  " });
    expect(r.status).toBe(400);
    expect(cloud.enviarTexto).not.toHaveBeenCalled();
  });
});

describe("vincular — a fila esvazia por aqui", () => {
  it("⚠ o telefone do contato é o do FIO (o corpo não escolhe o número) e a empresa tem de ser da carteira", async () => {
    const fora = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/vincular").send({ portalClientId: "pc-9", contato: { nome: "X" } });
    expect(fora.status).toBe(404);
    expect(salvarContato).not.toHaveBeenCalled();

    const r = await request(montarApp()).post("/firm/whatsapp/conversas/cv3/vincular").send({ portalClientId: "pc-1", contato: { nome: "Maria", optIn: true, optInOrigem: "verbal", telefone: "+5599999999999" } });
    expect(r.status).toBe(200);
    expect(salvarContato).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "pc-1", telefone: "+5521999998888", nome: "Maria", optIn: true }));
    expect(r.body.vinculo.situacao).toBe("VINCULADO");
  });
});
