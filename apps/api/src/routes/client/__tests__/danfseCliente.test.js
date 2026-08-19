// A PORTA DO DANFSe DO APP DO CLIENTE — `GET /client/companies/:companyId/notas/:notaId/danfse`.
//
// > Pedido do dono (19/08/2026): *"o DANFE da nota deve ser gerado"*, no portal do cliente.
//
// ⚠ POR QUE ESTA SUÍTE EXISTE. A feature inteira já estava construída e testada (o gerador, com 50
// testes) e só faltava a porta deste lado. A rota do escritório não serve: ela é gateada por
// `requireFirmCompanyAccess`. Uma porta nova é onde um vazamento entre lados nasce sem ninguém
// notar — por isso o que se mede aqui é (1) que ela é FACHADA (delega ao MESMO serviço) e (2) que
// ela é escopada pela empresa do PATH.
//
// ⚠⚠ E a segunda coisa medida é a RECUSA: **503 `danfse_sem_qrcode` chega ao cliente com o
// motivo**. Um DANFSe sem QR Code não é um DANFSe (NT 008 §2.2 e §2.4.3); servir um PDF torto, ou
// um erro genérico, seria a mentira que esse 503 existe para impedir.
//
// ⚠ NADA AQUI EMITE, CANCELA OU CONSULTA COISA ALGUMA.

import request from "supertest";
import express from "express";

const PORTAL_ID = "portal-1";
const OUTRO_PORTAL = "portal-2";

const cenario = { clientLink: null, firmLink: null };

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const prisma = {
    company: { findUnique: jest.fn(), findMany: jest.fn() },
    portalClient: { findUnique: jest.fn(), findMany: jest.fn() },
    companyClientUser: { findUnique: jest.fn(), findMany: jest.fn() },
    companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

// ⚠ O SERVIÇO É SIMULADO DE PROPÓSITO: o que esta suíte mede é a PORTA. Que o PDF sai certo já é
// medido em `nfse/danfse/__tests__/danfse.test.js`, sobre o gerador — duplicar aquilo aqui criaria
// uma segunda definição de "DANFSe correto".
jest.mock("../../../application/nfse/danfse/danfseDaNotaDoPortal.js", () => ({
  gerarDanfseDaNota: jest.fn(async () => ({
    pdf: Buffer.from("%PDF-1.4 fake"),
    conformidade: { qrCode: "presente", avisos: [], paginas: 1 },
    marcaDagua: null,
    nomeArquivo: "danfse-33333.pdf",
  })),
}));

import { createClientPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { gerarDanfseDaNota } from "../../../application/nfse/danfse/danfseDaNotaDoPortal.js";

function montarApp(user) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/client", createClientPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

function usuarioCliente(role = "FINANCEIRO") {
  cenario.clientLink = { role, status: "ACTIVE" };
  return { id: "user-cliente-1", role: "cliente", accountType: "CLIENT", email: "cliente@empresa.com" };
}

function baixar(user, { companyId = PORTAL_ID, notaId = "nota-1", query = "" } = {}) {
  return request(montarApp(user)).get(`/client/companies/${companyId}/notas/${notaId}/danfse${query}`);
}

function recusa(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  cenario.clientLink = null;
  cenario.firmLink = null;
  gerarDanfseDaNota.mockResolvedValue({
    pdf: Buffer.from("%PDF-1.4 fake"),
    conformidade: { qrCode: "presente", avisos: [], paginas: 1 },
    marcaDagua: null,
    nomeArquivo: "danfse-33333.pdf",
  });
  prisma.companyClientUser.findUnique.mockImplementation(async ({ where }) =>
    where?.companyId_userId?.companyId === PORTAL_ID ? cenario.clientLink : null
  );
  prisma.companyFirmAccess.findUnique.mockImplementation(async () => cenario.firmLink);
});

describe("quem alcança a porta", () => {
  it("membro ATIVO baixa o PDF — o piso é o mesmo das outras rotas financeiras (sem `minRole`)", async () => {
    const r = await baixar(usuarioCliente("FINANCEIRO"));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
  });

  it("⚠ NÃO exige CLIENT_ADMIN: baixar documento é LEITURA, e o `GET /invoices` que lista a mesma nota não exige", async () => {
    for (const papel of ["FINANCEIRO", "CLIENT_USER", "CLIENT_ADMIN", "OWNER"]) {
      jest.clearAllMocks();
      gerarDanfseDaNota.mockResolvedValue({
        pdf: Buffer.from("%PDF"), conformidade: { qrCode: "presente", avisos: [], paginas: 1 }, nomeArquivo: "d.pdf",
      });
      const r = await baixar(usuarioCliente(papel));
      expect(r.status).toBe(200);
    }
  });

  it("sem vínculo com a empresa: 403, e NADA é gerado", async () => {
    cenario.clientLink = null;
    const r = await baixar({ id: "u", role: "cliente", accountType: "CLIENT" });
    expect(r.status).toBe(403);
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
  });

  it("vínculo INATIVO: 403, e NADA é gerado", async () => {
    cenario.clientLink = { role: "OWNER", status: "INACTIVE" };
    const r = await baixar({ id: "u", role: "cliente", accountType: "CLIENT" });
    expect(r.status).toBe(403);
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
  });
});

describe("⚠ MULTI-TENANCY: o PATH manda, e o serviço recebe as duas metades do escopo", () => {
  it("`companyId` e `notaId` do path descem para o serviço, sempre juntos", async () => {
    await baixar(usuarioCliente(), { notaId: "nota-42" });
    expect(gerarDanfseDaNota).toHaveBeenCalledWith(
      expect.objectContaining({ portalClientId: PORTAL_ID, notaId: "nota-42" })
    );
  });

  it("empresa de OUTRO cliente no path: 403 antes de qualquer geração", async () => {
    usuarioCliente("OWNER"); // vínculo é com PORTAL_ID
    const r = await baixar({ id: "user-cliente-1", role: "cliente", accountType: "CLIENT" }, { companyId: OUTRO_PORTAL });
    expect(r.status).toBe(403);
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ as recusas chegam NOMEADAS, com o motivo", () => {
  it("503 `danfse_sem_qrcode` — com a mensagem do servidor E o `motivo`", async () => {
    gerarDanfseDaNota.mockRejectedValue(
      recusa("DANFSE_SEM_QRCODE", "O QR Code não pôde ser gerado: a chave não está no XML.", { motivo: "chave_ausente" })
    );
    const r = await baixar(usuarioCliente());
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("danfse_sem_qrcode");
    expect(r.body.message).toContain("QR Code");
    expect(r.body.motivo).toBe("chave_ausente");
  });

  it("⚠ o 503 NUNCA vem com PDF — ausência não é resposta", async () => {
    gerarDanfseDaNota.mockRejectedValue(recusa("DANFSE_SEM_QRCODE", "sem QR"));
    const r = await baixar(usuarioCliente());
    expect(r.headers["content-type"]).not.toContain("application/pdf");
  });

  it("404 `xml_indisponivel` diz QUAL é a falta", async () => {
    gerarDanfseDaNota.mockRejectedValue(
      recusa("DANFSE_XML_INDISPONIVEL", "Esta nota não tem o XML guardado, e o DANFSe é gerado a partir dele.")
    );
    const r = await baixar(usuarioCliente());
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("xml_indisponivel");
    expect(r.body.message).toContain("XML");
  });

  it("404 `nota_nao_encontrada` quando a nota não é desta empresa", async () => {
    gerarDanfseDaNota.mockRejectedValue(recusa("DANFSE_NOTA_NAO_ENCONTRADA", "Nota não encontrada nesta empresa."));
    const r = await baixar(usuarioCliente());
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("nota_nao_encontrada");
  });

  it("422 quando o XML guardado não é uma NFS-e", async () => {
    gerarDanfseDaNota.mockRejectedValue(recusa("DANFSE_XML_NAO_E_NFSE", "não é NFS-e"));
    const r = await baixar(usuarioCliente());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("xml_nao_e_nfse");
  });

  it("erro DESCONHECIDO não ganha tradução inventada — 500, sem código fabricado", async () => {
    gerarDanfseDaNota.mockRejectedValue(new Error("boom"));
    const r = await baixar(usuarioCliente());
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("internal_error");
  });
});

describe("os cabeçalhos do PDF", () => {
  it("nome do arquivo, tipo e os selos de conformidade viajam no header", async () => {
    gerarDanfseDaNota.mockResolvedValue({
      pdf: Buffer.from("%PDF"),
      conformidade: { qrCode: "presente", avisos: ["a", "b"], paginas: 1 },
      nomeArquivo: "danfse-99.pdf",
    });
    const r = await baixar(usuarioCliente());
    expect(r.headers["content-disposition"]).toContain("danfse-99.pdf");
    expect(r.headers["x-danfse-qrcode"]).toBe("presente");
    expect(r.headers["x-danfse-pendencias"]).toBe("2");
  });

  it("`?canhoto=1` desce ao serviço; sem ele, `false` — a tela não recebe canhoto por acidente", async () => {
    await baixar(usuarioCliente(), { query: "?canhoto=1" });
    expect(gerarDanfseDaNota).toHaveBeenCalledWith(expect.objectContaining({ incluirCanhoto: true }));
    jest.clearAllMocks();
    gerarDanfseDaNota.mockResolvedValue({ pdf: Buffer.from("%PDF"), conformidade: { qrCode: "presente", avisos: [], paginas: 1 }, nomeArquivo: "d.pdf" });
    await baixar(usuarioCliente(), { query: "" });
    expect(gerarDanfseDaNota).toHaveBeenCalledWith(expect.objectContaining({ incluirCanhoto: false }));
  });
});
