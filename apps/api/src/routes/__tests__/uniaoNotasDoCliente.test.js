// A LISTA DO CLIENTE JUNTANDO AS DUAS FONTES — `GET /client/companies/:id/invoices`.
//
// > Pedido do dono (19/08/2026): *"ao emitir uma nota, ela deve aparecer para o cliente, e depois
// > que consultar o ADN aí fica confirmada na tela."*
//
// A regra de identidade (a chave de deduplicação) é medida em
// `application/notas/__tests__/notasEmitidasNaoConfirmadas.test.js`. O que se mede AQUI é a
// LIGAÇÃO — e ela tem três armadilhas próprias:
//
//   1. ⚠⚠ **A PAGINAÇÃO.** A lista do ADN é paginada pelo banco; as nossas vêm inteiras, em
//      memória. Somar as duas sem corrigir o `skip` faz a página 2 PULAR tantas notas quantas
//      forem as nossas — e a nota sumida seria uma nota fiscal.
//   2. ⚠ **OS TOTAIS.** O card "Valor total" é somado pelo banco (`aggregate`). Deixar as nossas
//      de fora faria o card e a tabela discordarem sobre a mesma competência.
//   3. ⚠ **A FLAG É OPT-IN.** O mesmo router é montado em `/firm` e em `server.js`; o pedido é
//      sobre a tela do CLIENTE.
//
// ⚠ NADA AQUI EMITE OU CONSULTA COISA ALGUMA.

import request from "supertest";
import express from "express";

const cenario = { doAdn: [], nossas: [], portalClient: null };

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

import { createPortalInvoicesRouter } from "../portalInvoices.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { lerEmitidasNaoConfirmadas } from "../../application/notas/notasEmitidasNaoConfirmadas.js";

const CLIENT = "portal-1";
const LEGACY = "company-legacy-1";
const CNPJ = "00000000000191";

/** Uma linha do ADN. `updatedAt` é a chave de ordenação padrão. */
function pi(n) {
  const dia = String(n).padStart(2, "0");
  return {
    id: `pi-${n}`, type: "NFSE", numero: `${1000 + n}`,
    competencia: new Date("2026-08-01T00:00:00Z"),
    issueDate: new Date(`2026-08-${dia}T00:00:00Z`),
    status: "EMITIDA", total: 100,
    emitenteNome: "EMPRESA", emitenteDoc: CNPJ,
    tomadorNome: `TOMADOR ${n}`, tomadorDoc: "11222333000181",
    updatedAt: new Date(`2026-08-${dia}T00:00:00Z`),
    xmlRaw: "<xml/>", pdfUrl: null,
  };
}

/** Uma linha NOSSA (`ServiceInvoice`), ainda não confirmada. */
function si(n, over = {}) {
  const dia = String(n).padStart(2, "0");
  return {
    id: `si-${n}`, chaveAcesso: null, numeroNfse: null,
    rpsSerie: "00001", rpsNumero: String(n),
    tomadorDoc: "11222333000181", tomadorNome: `TOMADOR NOSSO ${n}`,
    valorServicos: 500,
    competencia: new Date("2026-08-01T00:00:00Z"),
    status: "issued",
    createdAt: new Date(`2026-08-${dia}T00:00:00Z`),
    updatedAt: new Date(`2026-08-${dia}T00:00:00Z`),
    ...over,
  };
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

beforeEach(() => {
  jest.clearAllMocks();
  cenario.doAdn = [];
  cenario.nossas = [];
  cenario.portalClient = { cnpj: CNPJ, razao: "EMPRESA EXEMPLO LTDA", companyId: LEGACY };

  prisma.portalClient.findUnique.mockImplementation(async () => cenario.portalClient);
  prisma.companyClientUser.findUnique.mockResolvedValue({ role: "OWNER", status: "ACTIVE" });
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  prisma.portalSyncState.findUnique.mockResolvedValue(null);
  // ⚠ O falso Prisma HONRA `skip`/`take` e a ordem — sem isso o teste de paginação não mede nada.
  prisma.portalInvoice.findMany.mockImplementation(async ({ orderBy, skip = 0, take = 25 }) => {
    const chave = Object.keys(orderBy)[0];
    const ordem = orderBy[chave];
    const lista = [...cenario.doAdn].sort((a, b) => {
      const cmp = new Date(a[chave]) - new Date(b[chave]);
      return ordem === "asc" ? cmp : -cmp;
    });
    return lista.slice(skip, skip + take);
  });
  prisma.portalInvoice.count.mockImplementation(async () => cenario.doAdn.length);
  prisma.portalInvoice.aggregate.mockImplementation(async () => ({
    _sum: { total: cenario.doAdn.reduce((a, x) => a + x.total, 0) },
  }));
  lerEmitidasNaoConfirmadas.mockImplementation(async () => cenario.nossas);
});

function listar(query = "", opts) {
  return request(montarApp(opts)).get(`/clients/${CLIENT}/invoices${query}`);
}

describe("a nota emitida aparece NA HORA, e vem marcada", () => {
  it("emitida por nós e ainda não capturada: aparece, com `confirmadaPeloAdn: false`", async () => {
    cenario.doAdn = [pi(1)];
    cenario.nossas = [si(9)];
    const r = await listar();
    expect(r.status).toBe(200);
    const nossa = r.body.data.find((x) => x.invoiceId === "si-9");
    expect(nossa).toBeTruthy();
    expect(nossa.confirmadaPeloAdn).toBe(false);
  });

  it("⚠ o STATUS dela é `EMITIDA`, o mesmo das outras — não é rascunho, não é erro, não é cancelada", async () => {
    cenario.nossas = [si(9)];
    const r = await listar();
    expect(r.body.data[0].status).toBe("EMITIDA");
  });

  it("⚠ `hasXml`/`hasPdf` são FALSE: não há rota que sirva o arquivo por este id (é `ServiceInvoice.id`)", async () => {
    cenario.nossas = [si(9)];
    const r = await listar();
    expect(r.body.data[0].hasXml).toBe(false);
    expect(r.body.data[0].hasPdf).toBe(false);
  });

  it("a linha do ADN vem com `confirmadaPeloAdn: true` — o estado existe nos DOIS lados", async () => {
    cenario.doAdn = [pi(1)];
    const r = await listar();
    expect(r.body.data[0].confirmadaPeloAdn).toBe(true);
  });

  it("quando o ADN traz a nota, a NOSSA some da lista — e a linha do ADN fica (é ela que 'acende')", async () => {
    // O dedup roda dentro de `lerEmitidasNaoConfirmadas`, já medida à parte: aqui ela devolve vazio.
    cenario.doAdn = [pi(1)];
    cenario.nossas = [];
    const r = await listar();
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].confirmadaPeloAdn).toBe(true);
    expect(r.body.total).toBe(1);
  });
});

describe("⚠⚠ A PAGINAÇÃO — nenhuma nota pode ser pulada nem repetida", () => {
  it("com 2 nossas e 5 do ADN, limite 3: as duas páginas somam 7 ids DISTINTOS, na ordem", async () => {
    cenario.doAdn = [pi(1), pi(2), pi(3), pi(4), pi(5)];
    cenario.nossas = [si(6), si(7)];

    const p1 = await listar("?page=1&limit=3");
    const p2 = await listar("?page=2&limit=3");
    const p3 = await listar("?page=3&limit=3");

    const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((x) => x.invoiceId);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    // Ordem padrão: `updatedAt desc` — o dia 7 é o mais recente.
    expect(ids).toEqual(["si-7", "si-6", "pi-5", "pi-4", "pi-3", "pi-2", "pi-1"]);
    expect(p1.body.total).toBe(7);
  });

  it("a mesma varredura em ordem CRESCENTE devolve os mesmos 7, invertidos", async () => {
    cenario.doAdn = [pi(1), pi(2), pi(3), pi(4), pi(5)];
    cenario.nossas = [si(6), si(7)];
    const ids = [];
    for (const pag of [1, 2, 3]) {
      const r = await listar(`?page=${pag}&limit=3&sort=issueDate&order=asc`);
      ids.push(...r.body.data.map((x) => x.invoiceId));
    }
    expect(ids).toEqual(["pi-1", "pi-2", "pi-3", "pi-4", "pi-5", "si-6", "si-7"]);
  });

  it("⚠ nossa nota ANTIGA (no meio da lista) cai na página certa, não na primeira", async () => {
    // Se a implementação simplesmente colasse as nossas no topo, este caso quebraria.
    cenario.doAdn = [pi(1), pi(2), pi(4), pi(5)];
    cenario.nossas = [si(3)];
    const p1 = await listar("?page=1&limit=2");
    const p2 = await listar("?page=2&limit=2");
    expect(p1.body.data.map((x) => x.invoiceId)).toEqual(["pi-5", "pi-4"]);
    expect(p2.body.data.map((x) => x.invoiceId)).toEqual(["si-3", "pi-2"]);
  });

  it("nenhuma nossa: a paginação continua exatamente como era", async () => {
    cenario.doAdn = [pi(1), pi(2), pi(3)];
    cenario.nossas = [];
    const r = await listar("?page=2&limit=2");
    expect(r.body.data.map((x) => x.invoiceId)).toEqual(["pi-1"]);
    expect(r.body.total).toBe(3);
  });
});

describe("⚠ OS TOTAIS CONTAM AS NOSSAS — card e tabela não podem discordar", () => {
  it("`total`, `totalInvoices` e `totalAmount` incluem as emitidas não confirmadas", async () => {
    cenario.doAdn = [pi(1), pi(2)]; // 100 + 100
    cenario.nossas = [si(9)]; // 500
    const r = await listar();
    expect(r.body.total).toBe(3);
    expect(r.body.summary.totalInvoices).toBe(3);
    expect(r.body.summary.totalAmount).toBe(700);
  });

  it("`pageAmount` é o da PÁGINA que saiu, e não o do filtro inteiro", async () => {
    cenario.doAdn = [pi(1), pi(2)];
    cenario.nossas = [si(9)];
    const r = await listar("?page=1&limit=1");
    expect(r.body.data).toHaveLength(1);
    expect(r.body.summary.pageAmount).toBe(500);
    expect(r.body.summary.totalAmount).toBe(700);
  });
});

describe("⚠ o MESMO recorte das duas metades (o gêmeo de `buildWhereFilters`)", () => {
  it("competência que não bate: a nossa nota NÃO entra", async () => {
    cenario.nossas = [si(9, { competencia: new Date("2026-07-01T00:00:00Z") })];
    const r = await listar("?competencia=2026-08");
    expect(r.body.data).toHaveLength(0);
    expect(r.body.total).toBe(0);
  });

  it("competência que bate: entra", async () => {
    cenario.nossas = [si(9)];
    const r = await listar("?competencia=2026-08");
    expect(r.body.data.map((x) => x.invoiceId)).toEqual(["si-9"]);
  });

  it("`type=NFE`: a nossa emissão (sempre NFS-e) fica de fora", async () => {
    cenario.nossas = [si(9)];
    const r = await listar("?type=NFE");
    expect(r.body.data).toHaveLength(0);
  });

  it("⚠ `direcao=recebidas`: a nossa NUNCA entra — ela é emitida pela própria empresa", async () => {
    cenario.nossas = [si(9)];
    const r = await listar("?direcao=recebidas");
    expect(r.body.data).toHaveLength(0);
    expect(lerEmitidasNaoConfirmadas).not.toHaveBeenCalled();
  });

  it("busca pelo nome do tomador alcança a nossa nota", async () => {
    cenario.nossas = [si(9)];
    const r = await listar("?search=NOSSO");
    expect(r.body.data.map((x) => x.invoiceId)).toEqual(["si-9"]);
  });

  it("busca que não casa deixa a nossa de fora", async () => {
    cenario.nossas = [si(9)];
    const r = await listar("?search=INEXISTENTE");
    expect(r.body.data).toHaveLength(0);
  });

  it("intervalo `from`/`to` usa a MESMA data que sai em `issueDate`", async () => {
    cenario.nossas = [si(9)];
    const dentro = await listar("?from=2026-08-01&to=2026-08-31");
    expect(dentro.body.data).toHaveLength(1);
    const fora = await listar("?from=2026-09-01&to=2026-09-30");
    expect(fora.body.data).toHaveLength(0);
  });
});

describe("⚠ A FLAG É OPT-IN — `/firm` e o legado não mudam de comportamento", () => {
  it("sem a flag, a lista lê SÓ a projeção do ADN, e nem consulta as nossas", async () => {
    cenario.doAdn = [pi(1)];
    cenario.nossas = [si(9)];
    const r = await listar("", { incluirEmitidasNaoConfirmadas: false });
    expect(r.body.data.map((x) => x.invoiceId)).toEqual(["pi-1"]);
    expect(r.body.total).toBe(1);
    expect(lerEmitidasNaoConfirmadas).not.toHaveBeenCalled();
  });

  it("empresa sem `Company` legada vinculada: não há emissão nossa a juntar, e nada quebra", async () => {
    cenario.portalClient = { cnpj: CNPJ, razao: "EMPRESA", companyId: null };
    cenario.doAdn = [pi(1)];
    const r = await listar();
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(lerEmitidasNaoConfirmadas).not.toHaveBeenCalled();
  });

  it("multi-tenancy: as duas metades do escopo descem juntas para a leitura das nossas", async () => {
    cenario.nossas = [si(9)];
    await listar();
    expect(lerEmitidasNaoConfirmadas).toHaveBeenCalledWith({
      legacyCompanyId: LEGACY,
      portalClientId: CLIENT,
    });
  });
});
