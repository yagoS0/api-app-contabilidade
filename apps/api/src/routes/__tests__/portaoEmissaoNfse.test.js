// O PORTÃO NAS ROTAS — a matriz inteira, nos dois atos fiscais, e a prova de que a LEITURA não foi
// apertada.
//
// ⚠ POR QUE ESTA SUÍTE EXISTE. Até 18/08/2026 `POST /nfse/issue` e `POST /nfse/:chave/eventos`
// autorizavam por `ensureLegacyCompanyAccess` — checagem de **VÍNCULO**: qualquer `CompanyClientUser`
// ATIVO passava, do papel mais forte ao mais fraco. Como o caminho está ligado e apontado para o
// sistema nacional de PRODUÇÃO (`NFSE_ENV=producao`, 1 nota real emitida em 17/08/2026), a única
// forma de provar que a recusa acontece ANTES de qualquer coisa sair da máquina é olhar se
// `NfseService.issue` / `NfseService.sendEvent` foram chamados. É isso que cada caso abaixo faz.
//
// A regra em si é testada sozinha em `application/nfse/__tests__/emissaoClienteAutorizacao.test.js`.

import request from "supertest";
import express from "express";

const PORTAL_ID = "portal-1";
const LEGACY_ID = "company-legacy-1";
const CHAVE = "33260811222333000181000010000000001000000001";

// Estado do "banco" deste teste, reconfigurado por cenário.
const cenario = {
  emissaoClienteLiberada: false,
  clientLink: null, // { role, status }
  firmLink: null, // { role, status }
};

jest.mock("../../infrastructure/db/prisma.js", () => {
  const prisma = {
    company: { findUnique: jest.fn(), findMany: jest.fn() },
    portalClient: { findUnique: jest.fn(), findMany: jest.fn() },
    companyClientUser: { findUnique: jest.fn(), findMany: jest.fn() },
    companyFirmAccess: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (arg) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

jest.mock("../../application/nfse/NfseService.js", () => ({
  NfseService: {
    issue: jest.fn(async () => ({ status: "issued", nfse: { id: "nf-1" } })),
    sendEvent: jest.fn(async () => ({ providerData: {} })),
    syncFromProvider: jest.fn(async () => ({ ok: true })),
  },
}));

jest.mock("../../infrastructure/db/NfseRepository.js", () => ({
  NfseRepository: {
    findByChaveAcesso: jest.fn(async () => ({ companyId: "company-legacy-1", status: "issued" })),
    updateByChaveAcesso: jest.fn(async () => ({ id: "nf-1", status: "cancelled" })),
    list: jest.fn(async () => ({ data: [], total: 0 })),
  },
}));

import { createNfseRouter } from "../nfse.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { NfseService } from "../../application/nfse/NfseService.js";
import { NfseRepository } from "../../infrastructure/db/NfseRepository.js";

function montarApp(user) {
  const app = express();
  app.use(express.json());
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const ensureAuthorized = async (req) => {
    req.auth = { user };
    return true;
  };
  app.use("/nfse", createNfseRouter({ ensureAuthorized, log }));
  return app;
}

// Payload mínimo aceito por `validateNfsePayload` — o `companyId` é o **`PortalClient.id`**, que é
// o que o `EmitirNfseWizard` carrega (a rota o traduz com `resolveLegacyCompanyId`).
const PAYLOAD_EMISSAO = {
  companyId: PORTAL_ID,
  tomador: { cnpjCpf: "11222333000181", nome: "TOMADOR LTDA" },
  servico: { descricao: "Serviço de teste", valorServicos: 100 },
};

const PAYLOAD_EVENTO = {
  tipoEvento: "e101101",
  justificativa: "Cancelamento por erro de emissão informado pelo tomador.",
  cnpjAutor: "11222333000181",
};

beforeEach(() => {
  jest.clearAllMocks();
  cenario.emissaoClienteLiberada = false;
  cenario.clientLink = null;
  cenario.firmLink = null;

  // `resolveLegacyCompanyId` tenta `Company` primeiro; o id que chega é o do portal, então não acha.
  prisma.company.findUnique.mockImplementation(async ({ where }) =>
    where?.id === LEGACY_ID ? { id: LEGACY_ID } : null
  );
  prisma.company.findMany.mockResolvedValue([]);

  // ⚠ OS DOIS SENTIDOS DA MESMA TABELA, e eles não podem ser confundidos:
  //   • `where.id`        → `resolveLegacyCompanyId` (PortalClient.id → Company.id)
  //   • `where.companyId` → o PORTÃO (Company.id → PortalClient), porque a permissão mora no portal
  prisma.portalClient.findUnique.mockImplementation(async ({ where }) => {
    if (where?.id === PORTAL_ID) return { id: PORTAL_ID, companyId: LEGACY_ID };
    if (where?.companyId === LEGACY_ID) {
      return { id: PORTAL_ID, emissaoClienteLiberada: cenario.emissaoClienteLiberada };
    }
    return null;
  });
  prisma.portalClient.findMany.mockResolvedValue([{ id: PORTAL_ID, companyId: LEGACY_ID }]);

  prisma.companyClientUser.findMany.mockImplementation(async () =>
    cenario.clientLink?.status === "ACTIVE" ? [{ companyId: PORTAL_ID }] : []
  );
  prisma.companyFirmAccess.findMany.mockImplementation(async () =>
    cenario.firmLink?.status === "ACTIVE" ? [{ companyId: PORTAL_ID }] : []
  );
  prisma.companyClientUser.findUnique.mockImplementation(async () => cenario.clientLink);
  prisma.companyFirmAccess.findUnique.mockImplementation(async () => cenario.firmLink);

  NfseRepository.findByChaveAcesso.mockResolvedValue({ companyId: LEGACY_ID, status: "issued" });
});

function usuarioCliente(role) {
  cenario.clientLink = { role, status: "ACTIVE" };
  return { id: "user-cliente-1", role: "cliente", email: "cliente@empresa.com" };
}

function usuarioEscritorioVinculado() {
  cenario.firmLink = { role: "ACCOUNTANT", status: "ACTIVE" };
  return { id: "user-firm-1", role: "firm", email: "staff@escritorio.com" };
}

// Cada linha da matriz é exercida nas DUAS rotas pelo mesmo helper — "as duas rotas com o mesmo
// comportamento" é requisito, não coincidência.
async function emitir(user) {
  return request(montarApp(user)).post("/nfse/issue").send(PAYLOAD_EMISSAO);
}
async function cancelar(user) {
  return request(montarApp(user)).post(`/nfse/${CHAVE}/eventos`).send(PAYLOAD_EVENTO);
}

describe("usuário do ESCRITÓRIO — a regressão mais cara", () => {
  it("admin/contador emite com a flag DESLIGADA", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await emitir({ id: "u-adm", role: "contador" });
    expect(res.status).toBe(201);
    expect(NfseService.issue).toHaveBeenCalledTimes(1);
  });

  it("admin/contador cancela com a flag DESLIGADA", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await cancelar({ id: "u-adm", role: "contador" });
    expect(res.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalledTimes(1);
  });

  it("usuário com vínculo de escritório (CompanyFirmAccess ATIVO) emite com a flag DESLIGADA", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await emitir(usuarioEscritorioVinculado());
    expect(res.status).toBe(201);
    expect(NfseService.issue).toHaveBeenCalledTimes(1);
  });

  it("usuário com vínculo de escritório cancela com a flag DESLIGADA", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await cancelar(usuarioEscritorioVinculado());
    expect(res.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalledTimes(1);
  });
});

describe("cliente CLIENT_ADMIN com a empresa NÃO liberada", () => {
  it("emissão recusada com o motivo NOMEADO, e nada sai da máquina", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await emitir(usuarioCliente("CLIENT_ADMIN"));
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(res.body.motivos).toEqual(["EMISSAO_CLIENTE_NAO_LIBERADA"]);
    expect(res.body.correcao).toMatch(/escritório/i);
    expect(NfseService.issue).not.toHaveBeenCalled();
  });

  it("cancelamento recusado com o mesmo motivo", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await cancelar(usuarioCliente("CLIENT_ADMIN"));
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

describe("cliente de papel fraco com a empresa LIBERADA", () => {
  it.each(["FINANCEIRO", "CLIENT_USER"])(
    "%s: emissão recusada pelo PAPEL (código distinto do da empresa)",
    async (papel) => {
      cenario.emissaoClienteLiberada = true;
      const res = await emitir(usuarioCliente(papel));
      expect(res.status).toBe(403);
      expect(res.body.codigo).toBe("EMISSAO_CLIENTE_PAPEL_INSUFICIENTE");
      expect(res.body.papel).toBe(papel);
      expect(res.body.papelMinimo).toBe("CLIENT_ADMIN");
      expect(NfseService.issue).not.toHaveBeenCalled();
    }
  );

  it("FINANCEIRO: cancelamento recusado pelo PAPEL", async () => {
    cenario.emissaoClienteLiberada = true;
    const res = await cancelar(usuarioCliente("FINANCEIRO"));
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe("EMISSAO_CLIENTE_PAPEL_INSUFICIENTE");
    expect(NfseService.sendEvent).not.toHaveBeenCalled();
  });
});

describe("cliente OWNER com a empresa LIBERADA", () => {
  it("emite", async () => {
    cenario.emissaoClienteLiberada = true;
    const res = await emitir(usuarioCliente("OWNER"));
    expect(res.status).toBe(201);
    expect(NfseService.issue).toHaveBeenCalledTimes(1);
    // ⚠ E emite pela COMPANY LEGADA, não pelo PortalClient — o portão não podia ter atrapalhado a
    // tradução que já existia (`resolveLegacyCompanyId`).
    expect(NfseService.issue.mock.calls[0][0].data.companyId).toBe(LEGACY_ID);
  });

  it("cancela", async () => {
    cenario.emissaoClienteLiberada = true;
    const res = await cancelar(usuarioCliente("OWNER"));
    expect(res.status).toBe(200);
    expect(NfseService.sendEvent).toHaveBeenCalledTimes(1);
  });
});

describe("cliente CLIENT_ADMIN com a empresa LIBERADA", () => {
  it("emite (o mínimo é exatamente este papel)", async () => {
    cenario.emissaoClienteLiberada = true;
    const res = await emitir(usuarioCliente("CLIENT_ADMIN"));
    expect(res.status).toBe(201);
    expect(NfseService.issue).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ A LEITURA CONTINUA LIVRE — o portão é SÓ dos dois atos fiscais", () => {
  // Ler nota não é ato fiscal, e apertar a leitura quebraria a aba Notas Fiscais do portal do
  // cliente sem que nada tivesse sido decidido sobre leitura.
  it("GET /nfse responde 200 para o FINANCEIRO com a empresa NÃO liberada", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await request(montarApp(usuarioCliente("FINANCEIRO")))
      .get("/nfse")
      .query({ companyId: LEGACY_ID });
    expect(res.status).toBe(200);
    expect(NfseRepository.list).toHaveBeenCalled();
  });

  it("POST /nfse/consulta responde 200 para o FINANCEIRO com a empresa NÃO liberada", async () => {
    cenario.emissaoClienteLiberada = false;
    const res = await request(montarApp(usuarioCliente("FINANCEIRO")))
      .post("/nfse/consulta")
      .send({ companyId: LEGACY_ID });
    expect(res.status).toBe(200);
  });

  it("a consulta NÃO lê a flag de emissão (nenhuma leitura por `where.companyId` no portal)", async () => {
    cenario.emissaoClienteLiberada = false;
    await request(montarApp(usuarioCliente("FINANCEIRO"))).get("/nfse").query({ companyId: LEGACY_ID });
    const consultasAoPortao = prisma.portalClient.findUnique.mock.calls.filter(
      ([args]) => args?.where?.companyId
    );
    expect(consultasAoPortao).toHaveLength(0);
  });
});

describe("empresa legada sem PortalClient", () => {
  it("não é 'liberada por omissão' — recusa nomeada", async () => {
    // Chega pelo ramo `Company.clientId` de `listAccessibleLegacyCompanyIds` (vínculo legado, sem
    // papel). Sem linha de portal não existe a chave que o contador ligaria.
    prisma.company.findUnique.mockResolvedValue({ id: LEGACY_ID });
    prisma.company.findMany.mockResolvedValue([{ id: LEGACY_ID }]);
    prisma.portalClient.findUnique.mockImplementation(async ({ where }) =>
      where?.id === LEGACY_ID ? { id: PORTAL_ID, companyId: LEGACY_ID } : null
    );
    const res = await request(montarApp({ id: "u-legado", role: "cliente" }))
      .post("/nfse/issue")
      .send({ ...PAYLOAD_EMISSAO, companyId: LEGACY_ID });
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(NfseService.issue).not.toHaveBeenCalled();
  });
});

describe("a ordem das duas checagens", () => {
  it("quem não enxerga a empresa é barrado ANTES do portão (403 forbidden, sem tocar no portal)", async () => {
    // Sem vínculo nenhum: `ensureLegacyCompanyAccess` recusa primeiro. O portão nem é consultado —
    // ele é um SEGUNDO passo, não um substituto.
    cenario.emissaoClienteLiberada = true;
    const res = await emitir({ id: "u-estranho", role: "cliente" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
    expect(NfseService.issue).not.toHaveBeenCalled();
  });
});
