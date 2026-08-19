// A PORTA DE EMISSÃO DO APP DO CLIENTE — a fachada `POST /client/companies/:companyId/nfse`.
//
// ⚠ POR QUE ESTA SUÍTE EXISTE. Até 18/08/2026 o app do cliente **não tinha porta de emissão**: a
// emissão vive em `POST /nfse/issue`, outro router, que não sabe distinguir escritório de cliente —
// foi essa indistinção que criou o buraco de autorização fechado naquele dia. A fachada nova só
// pode existir se ela **passar pelo mesmo portão** e devolver **os mesmos desfechos**; qualquer
// atalho aqui reabre o buraco no lado que ninguém do escritório testa.
//
// ⚠ E o caminho está ligado e apontado para o sistema nacional de PRODUÇÃO (`NFSE_ENV=producao`,
// 1 nota real de 17/08/2026). Por isso cada recusa é medida por **`NfseService.issue` não ter sido
// chamado** — não basta o status HTTP: o que importa é que nada saiu da máquina.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA: o serviço é simulado.

import request from "supertest";
import express from "express";

const PORTAL_ID = "portal-1";
const LEGACY_ID = "company-legacy-1";

const cenario = {
  emissaoClienteLiberada: false,
  clientLink: null, // { role, status }
  firmLink: null,
};

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

jest.mock("../../../application/nfse/NfseService.js", () => ({
  NfseService: {
    issue: jest.fn(async () => ({ status: "issued", nfse: { id: "nf-1" } })),
  },
}));

import { createClientPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { NfseService } from "../../../application/nfse/NfseService.js";

function montarApp(user) {
  const app = express();
  app.use(express.json());
  // `requireAuth()` lê daqui — é o mesmo caminho do servidor real.
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/client", createClientPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

// Payload mínimo aceito por `validateNfsePayload`. ⚠ **Sem `companyId`**: no `/client` ele vem do
// PATH, e é justamente isso que o teste do corpo malicioso (mais abaixo) exercita.
const PAYLOAD = {
  tomador: { cnpjCpf: "11222333000181", nome: "TOMADOR LTDA" },
  servico: { descricao: "Serviço de teste", valorServicos: 100 },
};

beforeEach(() => {
  jest.clearAllMocks();
  cenario.emissaoClienteLiberada = false;
  cenario.clientLink = null;
  cenario.firmLink = null;

  // `resolveLegacyCompanyId` tenta `Company` primeiro; o id do path é o do PORTAL, então não acha.
  prisma.company.findUnique.mockImplementation(async ({ where }) =>
    where?.id === LEGACY_ID ? { id: LEGACY_ID } : null
  );
  prisma.company.findMany.mockResolvedValue([]);

  // ⚠ OS DOIS SENTIDOS DA MESMA TABELA:
  //   • `where.id`        → `resolveLegacyCompanyId` (PortalClient.id → Company.id)
  //   • `where.companyId` → o PORTÃO (Company.id → PortalClient), porque a permissão mora no portal
  prisma.portalClient.findUnique.mockImplementation(async ({ where }) => {
    if (where?.id === PORTAL_ID) return { id: PORTAL_ID, companyId: LEGACY_ID };
    if (where?.companyId === LEGACY_ID) {
      return { id: PORTAL_ID, emissaoClienteLiberada: cenario.emissaoClienteLiberada };
    }
    return null;
  });

  prisma.companyClientUser.findUnique.mockImplementation(async () => cenario.clientLink);
  prisma.companyFirmAccess.findUnique.mockImplementation(async () => cenario.firmLink);
});

function usuarioCliente(role) {
  cenario.clientLink = { role, status: "ACTIVE" };
  return { id: "user-cliente-1", role: "cliente", accountType: "CLIENT", email: "cliente@empresa.com" };
}

async function emitir(user, payload = PAYLOAD) {
  return request(montarApp(user)).post(`/client/companies/${PORTAL_ID}/nfse`).send(payload);
}

describe("⚠ o MESMO portão de `/nfse/issue`, com as MESMAS recusas nomeadas", () => {
  it("empresa NÃO liberada pelo contador: 403 EMISSAO_CLIENTE_NAO_LIBERADA, e nada é emitido", async () => {
    cenario.emissaoClienteLiberada = false;
    const r = await emitir(usuarioCliente("OWNER"));

    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(r.body.correcao).toMatch(/escritório/i);
    expect(NfseService.issue).not.toHaveBeenCalled();
  });

  it("empresa liberada mas papel FRACO: 403 EMISSAO_CLIENTE_PAPEL_INSUFICIENTE", async () => {
    cenario.emissaoClienteLiberada = true;
    const r = await emitir(usuarioCliente("FINANCEIRO"));

    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe("EMISSAO_CLIENTE_PAPEL_INSUFICIENTE");
    expect(r.body.papelMinimo).toBe("CLIENT_ADMIN");
    expect(NfseService.issue).not.toHaveBeenCalled();
  });

  it("faltando as DUAS, o código nomeia a da empresa e `motivos` traz as duas", async () => {
    cenario.emissaoClienteLiberada = false;
    const r = await emitir(usuarioCliente("FINANCEIRO"));

    expect(r.body.codigo).toBe("EMISSAO_CLIENTE_NAO_LIBERADA");
    expect(r.body.motivos).toEqual([
      "EMISSAO_CLIENTE_NAO_LIBERADA",
      "EMISSAO_CLIENTE_PAPEL_INSUFICIENTE",
    ]);
  });

  it("liberada + CLIENT_ADMIN: emite, e o serviço recebe a Company LEGADA", async () => {
    cenario.emissaoClienteLiberada = true;
    const r = await emitir(usuarioCliente("CLIENT_ADMIN"));

    expect(r.status).toBe(201);
    expect(NfseService.issue).toHaveBeenCalledTimes(1);
    // ⚠ O id que chega ao serviço é o da `Company`, nunca o do `PortalClient` — são PKs de
    // entidades diferentes, e o do portal devolveria `company_not_found`.
    expect(NfseService.issue.mock.calls[0][0].data.companyId).toBe(LEGACY_ID);
  });

  it("OWNER também emite (o peso é ≥ CLIENT_ADMIN, não == )", async () => {
    cenario.emissaoClienteLiberada = true;
    expect((await emitir(usuarioCliente("OWNER"))).status).toBe(201);
  });

  it("usuário sem vínculo NENHUM com a empresa não passa nem do primeiro passo", async () => {
    cenario.emissaoClienteLiberada = true;
    cenario.clientLink = null;
    const r = await emitir({ id: "estranho", role: "cliente", accountType: "CLIENT" });

    expect(r.status).toBe(403);
    expect(NfseService.issue).not.toHaveBeenCalled();
  });
});

describe("⚠ o PATH manda, o corpo não", () => {
  it("um `companyId` no corpo NÃO desvia a emissão para outra empresa", async () => {
    // É o furo de multi-tenancy medido na F1 do WhatsApp (`{portalClientId: path, ...body}`):
    // corpo sobrescrevendo path depois de a permissão ter sido conferida no path.
    cenario.emissaoClienteLiberada = true;
    const r = await emitir(usuarioCliente("OWNER"), { ...PAYLOAD, companyId: "portal-de-outra" });

    expect(r.status).toBe(201);
    expect(NfseService.issue.mock.calls[0][0].data.companyId).toBe(LEGACY_ID);
  });
});

describe("os desfechos são OS MESMOS de `/nfse/issue` — três camadas, três respostas", () => {
  beforeEach(() => {
    cenario.emissaoClienteLiberada = true;
  });

  it("RECEITA (recusa fiscal) → 422 nfse_rejected", async () => {
    NfseService.issue.mockResolvedValueOnce({
      status: "rejected",
      camada: "RECEITA",
      codigo: "E0014",
      message: "recusada",
      numeroReutilizavel: true,
    });
    const r = await emitir(usuarioCliente("OWNER"));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: "nfse_rejected", camada: "RECEITA", codigo: "E0014" });
  });

  it("⚠ TRANSPORTE → 502, e a correção manda CONSULTAR antes de reemitir", async () => {
    NfseService.issue.mockResolvedValueOnce({
      status: "falha_envio",
      camada: "TRANSPORTE",
      codigo: "ETIMEDOUT",
      message: "timeout",
      correcao: "Consulte o Id da DPS antes de decidir.",
      numeroReutilizavel: false,
    });
    const r = await emitir(usuarioCliente("OWNER"));
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("nfse_falha_transporte");
    expect(r.body.numeroReutilizavel).toBe(false);
  });

  it("NOSSA → 400 nfse_falha_local (inclusive a trava do código de serviço)", async () => {
    NfseService.issue.mockResolvedValueOnce({
      status: "falha_envio",
      camada: "NOSSA",
      codigo: "NFSE_CODIGO_SERVICO_FORA_DA_LISTA",
      message: "não está entre os cadastrados",
      correcao: "Cadastre este código de serviço na empresa.",
      numeroReutilizavel: true,
    });
    const r = await emitir(usuarioCliente("OWNER"));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      error: "nfse_falha_local",
      codigo: "NFSE_CODIGO_SERVICO_FORA_DA_LISTA",
    });
  });

  it("cadastro incompleto → 400 company_missing_fields com a LISTA do que falta", async () => {
    const err = new Error("company_missing_fields");
    err.code = "COMPANY_MISSING_FIELDS";
    err.missing = ["inscricaoMunicipal", "rpsSerie"];
    NfseService.issue.mockRejectedValueOnce(err);

    const r = await emitir(usuarioCliente("OWNER"));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      error: "company_missing_fields",
      missing: ["inscricaoMunicipal", "rpsSerie"],
    });
  });
});

describe("validação — o MESMO validador, sem segunda cópia", () => {
  beforeEach(() => {
    cenario.emissaoClienteLiberada = true;
  });

  it("⚠ CPF com DV inválido recusa ANTES de qualquer coisa", async () => {
    const r = await emitir(usuarioCliente("OWNER"), {
      ...PAYLOAD,
      tomador: { cnpjCpf: "11144477734", nome: "FULANO" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("tomador_cpf_digito_invalido");
    expect(NfseService.issue).not.toHaveBeenCalled();
  });

  it("o código de serviço escolhido viaja até o serviço", async () => {
    await emitir(usuarioCliente("OWNER"), {
      ...PAYLOAD,
      servico: { ...PAYLOAD.servico, codigoServicoNacional: "310104" },
    });
    expect(NfseService.issue.mock.calls[0][0].data.servico.codigoServicoNacional).toBe("310104");
  });
});

describe("empresa que não resolve", () => {
  it("id de portal sem `Company` legada → 404, sem emitir", async () => {
    cenario.emissaoClienteLiberada = true;
    prisma.portalClient.findUnique.mockImplementation(async ({ where }) =>
      where?.id === PORTAL_ID ? { id: PORTAL_ID, companyId: null } : null
    );
    const r = await emitir(usuarioCliente("OWNER"));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("company_not_found");
    expect(NfseService.issue).not.toHaveBeenCalled();
  });
});

// ── O PORTÃO VIAJA ATÉ O APP — e SÓ ele ───────────────────────────────────────────────────────
//
// ⚠ Antes disto a flag existia no banco e **não aparecia em `GET /client/companies`**: o app só
// descobria o portão pela RECUSA, depois de o usuário preencher a nota inteira.
describe("GET /client/companies — a flag aparece; a auditoria NÃO", () => {
  function montarCarteira({ liberada }) {
    prisma.companyClientUser.findMany.mockImplementation(async (args) => {
      if (args?.where?.role === "OWNER") {
        return [{ companyId: PORTAL_ID, user: { email: "dono@empresa.com" } }];
      }
      return [
        {
          role: "CLIENT_ADMIN",
          company: {
            id: PORTAL_ID,
            razao: "EMPRESA LTDA",
            cnpj: "11222333000181",
            guideNotificationEmail: null,
            inscricaoMunicipal: "123",
            uf: "RJ",
            municipio: "Rio de Janeiro",
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02"),
            companyId: LEGACY_ID,
            emissaoClienteLiberada: liberada,
            // ⚠ Estes NÃO são selecionados pela rota; estão aqui de propósito, para que o teste
            // caia se alguém ampliar o `select` e passar a devolvê-los ao cliente.
            emissaoClienteLiberadaEm: new Date("2026-08-18"),
            emissaoClienteLiberadaPor: "user-do-escritorio-1",
          },
        },
      ];
    });
    prisma.company.findMany.mockResolvedValue([{ id: LEGACY_ID, email: null }]);
  }

  async function listar() {
    const user = { id: "user-cliente-1", role: "cliente", accountType: "CLIENT" };
    return request(montarApp(user)).get("/client/companies");
  }

  it("liberada = true chega ao app", async () => {
    montarCarteira({ liberada: true });
    const r = await listar();
    expect(r.status).toBe(200);
    expect(r.body.data[0].emissaoNfseLiberada).toBe(true);
  });

  it("não liberada chega como `false` — nunca ausente (ausência viraria 'não sei')", async () => {
    montarCarteira({ liberada: false });
    const r = await listar();
    expect(r.body.data[0].emissaoNfseLiberada).toBe(false);
    expect(r.body.data[0]).toHaveProperty("emissaoNfseLiberada");
  });

  it("⚠ os campos de AUDITORIA não viajam — eles são do contador, não do cliente", async () => {
    montarCarteira({ liberada: true });
    const r = await listar();
    const empresa = r.body.data[0];
    const serializado = JSON.stringify(empresa);

    expect(empresa.emissaoClienteLiberadaEm).toBeUndefined();
    expect(empresa.emissaoClienteLiberadaPor).toBeUndefined();
    expect(serializado).not.toContain("LiberadaEm");
    expect(serializado).not.toContain("LiberadaPor");
    // Nem por dentro do `legacyCompany` (que é outro objeto e outro `select`).
    expect(serializado).not.toContain("user-do-escritorio-1");
  });

  it("o resto do payload da empresa continua intacto", async () => {
    montarCarteira({ liberada: true });
    const r = await listar();
    expect(r.body.data[0]).toMatchObject({
      companyId: PORTAL_ID,
      razao: "EMPRESA LTDA",
      cnpj: "11222333000181",
      myRole: "CLIENT_ADMIN",
      ownerEmail: "dono@empresa.com",
      guideNotificationEmail: null,
    });
  });

  // ── A CARGA TRIBUTÁRIA APROXIMADA VIAJA — dono, 19/08/2026 ──────────────────────────────────
  //
  // ⚠ *"o portal do cliente deve enxergar sim, no caso do presumido"*. Antes disto os três
  // percentuais não estavam no `legacyCompanySelect`, e a tela de emissão do cliente **não sabia**
  // se o cadastro do não optante estava completo — o texto dela descrevia as DUAS saídas.
  //
  // ⚠⚠ O QUE ESTE BLOCO PROVA É O `select`, NÃO A REGRA. Um `select` explícito devolve `undefined`
  // para coluna que não está nele, **sem erro nenhum**: a tela reabre vazia e ninguém percebe. É a
  // armadilha que este arquivo já pagou em `codigoMunicipioIbge` e nos `codigosServicoNacional`.
  describe("⚠ os três percentuais da Lei 12.741/2012 chegam ao cliente", () => {
    const CARGA = { pTotTribFed: "11.33", pTotTribEst: "0.00", pTotTribMun: "0.00" };

    it("estão NOMEADOS no `select` da consulta — sem isto a coluna volta `undefined`", async () => {
      montarCarteira({ liberada: true });
      await listar();

      const [{ select }] = prisma.company.findMany.mock.calls[0];
      expect(select.pTotTribFed).toBe(true);
      expect(select.pTotTribEst).toBe(true);
      expect(select.pTotTribMun).toBe(true);
    });

    it("os valores gravados chegam dentro de `legacyCompany`", async () => {
      montarCarteira({ liberada: true });
      prisma.company.findMany.mockResolvedValue([{ id: LEGACY_ID, email: null, ...CARGA }]);
      const r = await listar();

      expect(r.body.data[0].legacyCompany).toMatchObject(CARGA);
    });

    it("⚠ NULL viaja como `null`, e a CHAVE continua presente", async () => {
      // A distinção é o desenho inteiro do lado do cliente: `null` é "o contador não configurou"
      // (a tela nomeia o que falta); chave AUSENTE é "esta tela não recebeu o cadastro" (a tela não
      // afirma nada). Serializar `null` como ausência apagaria os dois textos num só.
      montarCarteira({ liberada: true });
      prisma.company.findMany.mockResolvedValue([
        { id: LEGACY_ID, email: null, pTotTribFed: null, pTotTribEst: null, pTotTribMun: "2.50" },
      ]);
      const r = await listar();

      const legacy = r.body.data[0].legacyCompany;
      expect(legacy).toHaveProperty("pTotTribFed", null);
      expect(legacy).toHaveProperty("pTotTribEst", null);
      expect(legacy.pTotTribMun).toBe("2.50");
    });

    it("⚠ ampliar o `select` NÃO abriu a auditoria do escritório junto", async () => {
      // O critério que barra `emissaoClienteLiberadaEm/Por` é outro: aqueles dizem quem, DO
      // ESCRITÓRIO, autorizou este cliente. Estes três são o conteúdo da nota do próprio cliente.
      montarCarteira({ liberada: true });
      prisma.company.findMany.mockResolvedValue([{ id: LEGACY_ID, email: null, ...CARGA }]);
      const r = await listar();

      const serializado = JSON.stringify(r.body.data[0]);
      expect(serializado).not.toContain("LiberadaEm");
      expect(serializado).not.toContain("LiberadaPor");
      expect(serializado).not.toContain("user-do-escritorio-1");
    });
  });
});
