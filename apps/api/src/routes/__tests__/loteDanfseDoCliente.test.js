// A PORTA DO LOTE DE DANFSe — `GET /clients/:clientId/invoices/danfse/bulk`.
//
// > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote (…) quero o download no
// > portal do cliente, e fazer o download dos DANFSe e não do XML."*
//
// ⚠ POR QUE ESTA SUÍTE EXISTE — e o que ela mede que a suíte do serviço não mede:
//
//   1. ⚠⚠ **A LIGAÇÃO.** "Componente sem chamador" é o defeito favorito desta casa. Aqui se prova
//      que a rota existe, que ela chama `gerarLoteDanfse` e que o zip **sai com os PDFs e com o
//      relatório dentro** — o zip é aberto de verdade, não conferido por contagem de bytes.
//   2. ⚠⚠ **O ESCOPO POR EMPRESA.** Nenhuma lista de ids vem do cliente; o filtro é resolvido no
//      servidor, e o `where` que vai ao Prisma tem de carregar o `clientId` do PATH.
//   3. ⚠ **O TETO, com recusa NOMEADA** — e antes de o primeiro byte do zip sair, porque depois
//      dele não há mais como responder um erro.
//
// ⚠ O SERVIÇO DE UMA NOTA É SIMULADO de propósito: que o PDF sai certo é medido em
// `nfse/danfse/__tests__/danfse.test.js`; duplicar aquilo aqui criaria uma segunda definição de
// "DANFSe correto".
//
// ⚠ NADA AQUI EMITE, CANCELA OU CONSULTA COISA ALGUMA.

import zlib from "node:zlib";
import request from "supertest";
import express from "express";

const CLIENT = "portal-1";
const CNPJ = "12345678000199";

const cenario = { notas: [], portalClient: null, nossas: [] };

jest.mock("../../infrastructure/db/prisma.js", () => {
  const prisma = {
    portalClient: { findUnique: jest.fn() },
    portalInvoice: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    portalSyncState: { findUnique: jest.fn() },
    companyClientUser: { findUnique: jest.fn() },
    companyFirmAccess: { findUnique: jest.fn() },
    $transaction: jest.fn(async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

jest.mock("../../application/notas/notasEmitidasNaoConfirmadas.js", () => ({
  lerEmitidasNaoConfirmadas: jest.fn(async () => []),
}));

// ⚠ O serviço de UMA nota, simulado. O `notaId` decide o desfecho, para que os dois ramos
// (gerou / recusou) sejam exercidos pela rota de verdade.
jest.mock("../../application/nfse/danfse/danfseDaNotaDoPortal.js", () => ({
  gerarDanfseDaNota: jest.fn(async ({ notaId }) => {
    if (notaId === "pi-sem-qr") {
      const err = new Error("O QR Code não pôde ser gerado.");
      err.code = "DANFSE_SEM_QRCODE";
      throw err;
    }
    return { pdf: Buffer.from(`%PDF-1.4 ${notaId}`) };
  }),
}));

import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { lerEmitidasNaoConfirmadas } from "../../application/notas/notasEmitidasNaoConfirmadas.js";
import { gerarDanfseDaNota } from "../../application/nfse/danfse/danfseDaNotaDoPortal.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// UM LEITOR DE ZIP DE ~30 LINHAS
//
// ⚠ Ele existe porque a afirmação central desta entrega é *"a ausência não é descoberta contando
// arquivos"* — e provar isso exige ABRIR o zip e ler o relatório. O projeto não tem biblioteca de
// descompactação; `zlib.inflateRawSync` (nativo) resolve o único formato que o `archiver` usa aqui.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function lerZip(buffer) {
  const fimIdx = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fimIdx < 0) throw new Error("Não é um zip: fim do diretório central não encontrado.");
  const total = buffer.readUInt16LE(fimIdx + 10);
  let p = buffer.readUInt32LE(fimIdx + 16);
  const arquivos = {};
  for (let i = 0; i < total; i += 1) {
    const metodo = buffer.readUInt16LE(p + 10);
    const tamComp = buffer.readUInt32LE(p + 20);
    const nomeLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const comentLen = buffer.readUInt16LE(p + 32);
    const offLocal = buffer.readUInt32LE(p + 42);
    const nome = buffer.slice(p + 46, p + 46 + nomeLen).toString("utf8");

    // No cabeçalho LOCAL os comprimentos de nome/extra podem diferir do central.
    const nomeLocal = buffer.readUInt16LE(offLocal + 26);
    const extraLocal = buffer.readUInt16LE(offLocal + 28);
    const inicio = offLocal + 30 + nomeLocal + extraLocal;
    const cru = buffer.slice(inicio, inicio + tamComp);
    arquivos[nome] = metodo === 0 ? cru : zlib.inflateRawSync(cru);

    p += 46 + nomeLen + extraLen + comentLen;
  }
  return arquivos;
}

function montarApp({ incluirEmitidasNaoConfirmadas = true } = {}) {
  const app = express();
  app.use(express.json());
  const ensureAuthorized = async (req) => {
    req.auth = { user: { id: "u1", role: "cliente", accountType: "CLIENT" } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use(
    "/clients/:clientId/invoices",
    createPortalInvoicesRouter({ ensureAuthorized, log, incluirEmitidasNaoConfirmadas })
  );
  return app;
}

function baixar({ clientId = CLIENT, query = "?competencia=2026-08", app = montarApp() } = {}) {
  return request(app).get(`/clients/${clientId}/invoices/danfse/bulk${query}`).buffer().parse((res, cb) => {
    const pedacos = [];
    res.on("data", (c) => pedacos.push(c));
    res.on("end", () => cb(null, Buffer.concat(pedacos)));
  });
}

function pi(over = {}) {
  return { id: "pi-1", type: "NFSE", numero: "1001", chaveAcesso: null, emitenteDoc: CNPJ, ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  cenario.notas = [pi()];
  cenario.portalClient = { cnpj: CNPJ, razao: "ACME SERVICOS LTDA", companyId: "company-1" };
  cenario.nossas = [];

  prisma.portalClient.findUnique.mockImplementation(async () => cenario.portalClient);
  prisma.companyClientUser.findUnique.mockResolvedValue({ role: "FINANCEIRO", status: "ACTIVE" });
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  prisma.portalInvoice.count.mockImplementation(async () => cenario.notas.length);
  prisma.portalInvoice.findMany.mockImplementation(async () => cenario.notas);
  lerEmitidasNaoConfirmadas.mockImplementation(async () => cenario.nossas);
});

describe("a ligação: a rota existe e o zip sai com os PDFs", () => {
  test("responde um zip com um PDF por nota, nomeado CNPJ_número", async () => {
    cenario.notas = [pi({ id: "pi-1", numero: "1001" }), pi({ id: "pi-2", numero: "1002" })];
    const res = await baixar();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="danfse-.*\.zip"/);

    const zip = lerZip(res.body);
    expect(Object.keys(zip).sort()).toEqual([
      "12345678000199_1001.pdf",
      "12345678000199_1002.pdf",
      "RELATORIO.txt",
    ]);
    expect(zip["12345678000199_1001.pdf"].toString()).toBe("%PDF-1.4 pi-1");
  });

  // ⚠ É o MESMO serviço da porta individual — e é ele que refaz a busca por `{id, clientId}`.
  test("cada PDF sai de `gerarDanfseDaNota`, com o id da empresa do PATH", async () => {
    cenario.notas = [pi({ id: "pi-1" }), pi({ id: "pi-2", numero: "1002" })];
    await baixar();
    expect(gerarDanfseDaNota).toHaveBeenCalledTimes(2);
    expect(gerarDanfseDaNota).toHaveBeenNthCalledWith(1, { portalClientId: CLIENT, notaId: "pi-1" });
    expect(gerarDanfseDaNota).toHaveBeenNthCalledWith(2, { portalClientId: CLIENT, notaId: "pi-2" });
  });
});

describe("⚠⚠ o escopo por empresa — resolvido no SERVIDOR", () => {
  test("o `where` do Prisma carrega o clientId do PATH, nas duas consultas", async () => {
    await baixar();
    for (const chamada of [prisma.portalInvoice.count, prisma.portalInvoice.findMany]) {
      const { where } = chamada.mock.calls[0][0];
      expect(where.clientId).toBe(CLIENT);
    }
  });

  // ⚠ `direcao=emitidas` (o padrão) restringe pelo CNPJ da empresa — é o mesmo recorte da tela.
  test("o filtro é o MESMO da listagem: direção e competência entram no `where`", async () => {
    await baixar({ query: "?competencia=2026-08" });
    const { where } = prisma.portalInvoice.count.mock.calls[0][0];
    expect(where.AND).toEqual(expect.arrayContaining([{ emitenteDoc: CNPJ }]));
    expect(JSON.stringify(where.AND)).toContain("competencia");
  });

  test("quem não tem acesso à empresa recebe 403 e NENHUM PDF é gerado", async () => {
    prisma.companyClientUser.findUnique.mockResolvedValue(null);
    prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
    cenario.portalClient = { cnpj: CNPJ, razao: "ACME", companyId: null };
    const res = await baixar({ clientId: "portal-de-outro" });
    expect(res.status).toBe(403);
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
  });

  test("direção inválida é recusada antes de qualquer geração", async () => {
    const res = await baixar({ query: "?direcao=inventada" });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body.toString()).error).toBe("direcao_invalid");
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
  });
});

describe("⚠ o teto: recusa NOMEADA, antes do primeiro byte do zip", () => {
  test("acima do teto responde 400 `lote_muito_grande`, com os números", async () => {
    prisma.portalInvoice.count.mockResolvedValue(437);
    const res = await baixar();
    expect(res.status).toBe(400);
    const corpo = JSON.parse(res.body.toString());
    expect(corpo).toMatchObject({ error: "lote_muito_grande", encontradas: 437, maximo: 200 });
    expect(corpo.message).toContain("437");
    expect(corpo.message).toContain("200");
    // ⚠ A recusa acontece ANTES de gerar qualquer PDF — senão o teto não protegeria nada.
    expect(gerarDanfseDaNota).not.toHaveBeenCalled();
    expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
  });

  test("filtro vazio responde 404 `lote_vazio`, não um zip com nada dentro", async () => {
    prisma.portalInvoice.count.mockResolvedValue(0);
    const res = await baixar();
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body.toString()).error).toBe("lote_vazio");
  });
});

describe("⚠⚠ o zip NÃO mente: o relatório nomeia o que não gerou", () => {
  test("a nota recusada (503 `danfse_sem_qrcode`) não vira PDF — vira LINHA no relatório", async () => {
    cenario.notas = [pi({ id: "pi-1", numero: "1001" }), pi({ id: "pi-sem-qr", numero: "1002" })];
    const res = await baixar();
    const zip = lerZip(res.body);

    expect(Object.keys(zip)).not.toContain("12345678000199_1002.pdf");
    const relatorio = zip["RELATORIO.txt"].toString("utf8");
    expect(relatorio).toContain("PDFs neste zip ........: 1");
    expect(relatorio).toContain("Notas SEM DANFSe ......: 1");
    expect(relatorio).toContain("• nota 1002 — o QR Code não pôde ser gerado");
  });

  test("a NF-e sai no relatório dizendo que o DANFE não é gerado aqui", async () => {
    cenario.notas = [pi({ id: "pi-1", numero: "1001", type: "NFE" })];
    const res = await baixar();
    const relatorio = lerZip(res.body)["RELATORIO.txt"].toString("utf8");
    expect(relatorio).toContain("• nota 1001 — é NF-e");
  });

  // ⚠⚠ Elas aparecem na TELA do cliente (união na leitura) e não estão em `PortalInvoice`. Sem
  // esta linha, quem vê 2 notas receberia 1 PDF e teria de descobrir a ausência contando arquivos.
  test("a nota emitida e ainda não confirmada pelo ADN entra no relatório", async () => {
    cenario.nossas = [{
      id: "si-1", numeroNfse: null, chaveAcesso: null, rpsSerie: "00001", rpsNumero: "7",
      competencia: new Date("2026-08-01T00:00:00Z"), status: "issued",
      tomadorDoc: "11222333000181", tomadorNome: "T", valorServicos: 10,
      createdAt: new Date("2026-08-02T00:00:00Z"), updatedAt: new Date("2026-08-02T00:00:00Z"),
    }];
    const res = await baixar();
    const relatorio = lerZip(res.body)["RELATORIO.txt"].toString("utf8");
    expect(relatorio).toContain("Notas SEM DANFSe ......: 1");
    expect(relatorio).toContain("sistema nacional ainda não a devolveu");
  });

  // ⚠ O mesmo router é montado em `/firm` e em `server.js`, que NÃO ligam a união na leitura.
  test("sem a flag, a rota não procura as nossas emissões", async () => {
    const res = await baixar({ app: montarApp({ incluirEmitidasNaoConfirmadas: false }) });
    expect(res.status).toBe(200);
    expect(lerEmitidasNaoConfirmadas).not.toHaveBeenCalled();
  });

  // ⚠ Relatório que só aparece quando há problema é indistinguível de relatório não gerado.
  test("mesmo quando tudo dá certo, o relatório vai junto e CONFIRMA", async () => {
    const res = await baixar();
    const relatorio = lerZip(res.body)["RELATORIO.txt"].toString("utf8");
    expect(relatorio).toContain("Todas as notas do filtro geraram DANFSe");
    expect(relatorio).toContain("ACME SERVICOS LTDA");
    expect(relatorio).toContain("2026-08");
  });
});
