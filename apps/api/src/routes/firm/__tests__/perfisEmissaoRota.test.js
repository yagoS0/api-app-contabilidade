// `/firm/companies/:id/perfis-emissao` — a porta do contador para o perfil de emissão.
//
// ⚠⚠ O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR são três coisas, e nenhuma delas é "o status 200":
//
//   1. **campo aceito e descartado em silêncio** — o defeito que esta base já pagou
//      (`codigoServicoNacional` chegava no corpo, passava pelo Zod e morria na lista de colunas:
//      200 na resposta, campo vazio na recarga);
//   2. **salvar parcial que apaga o que não veio** — `undefined` é "não mexer", nunca "apague";
//   3. **perfil de outra empresa alcançado pelo id** — o furo de multi-tenancy que a F1 do
//      WhatsApp pagou em `salvarContato`/`removerContato`, que escolhiam o alvo só pelo id.
//
// Por isso os casos olham o ARGUMENTO PASSADO AO PRISMA, e não só a resposta.

import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return { ...real, computeGuideComplianceMap: jest.fn(async () => new Map()) };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";

const PORTAL_ID = "portal-1";
const COMPANY_LEGACY_ID = "company-legacy-1";
const CONTADOR = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "c@e.com" };

const COMPANY = {
  codigoServicoNacional: "171901",
  codigosServicoNacional: [],
  codigoServicoMunicipal: "001",
  regimeEspecialTributacao: null,
};

function montarApp(user = CONTADOR) {
  const app = express();
  app.use(express.json());
  // ⚠ O router lê `app.locals.ensureAuthorized`; passar só no construtor devolve
  // `auth_middleware_not_configured` (500) em TODAS as rotas. É como o harness dos testes irmãos
  // monta, e foi essa omissão que fez a primeira execução deste arquivo dar 500 em tudo.
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...user } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

const URL = `/firm/companies/${PORTAL_ID}/perfis-emissao`;

let app;
beforeEach(() => {
  jest.clearAllMocks();
  app = montarApp();
  prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, companyId: COMPANY_LEGACY_ID });
  prismaMock.company.findUnique.mockResolvedValue(COMPANY);
  prismaMock.perfilEmissaoNfse.findMany.mockResolvedValue([]);
  prismaMock.perfilEmissaoNfse.create.mockImplementation(async ({ data }) => ({ id: "pf-novo", ...data }));
  prismaMock.perfilEmissaoNfse.update.mockImplementation(async ({ data }) => ({ id: "pf-1", ...data }));
  prismaMock.perfilEmissaoNfse.updateMany.mockResolvedValue({ count: 0 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("GET — o painel do que a próxima DPS vai levar", () => {
  it("devolve os seis campos com valor e PROCEDÊNCIA", async () => {
    const r = await request(app).get(URL);
    expect(r.status).toBe(200);
    const c = r.body.proximaDps.campos;
    expect(c.codigoServicoNacional).toMatchObject({ valor: "171901", fonte: "COMPANY" });
    expect(c.regApTribSN).toMatchObject({ valor: "1", fonte: "CRAVADO" });
    expect(c.tribISSQN).toMatchObject({ valor: "1", fonte: "CRAVADO" });
  });

  it("⚠⚠ a FLAG viaja — a tela não pode prometer efeito que não existe", async () => {
    // Com a integração desligada o painel é informativo: diz o que MUDARIA, não o que muda.
    const r = await request(app).get(URL);
    expect(r.body.integracaoLigada).toBe(false);
  });

  it("⚠ cada campo diz a TAG e o caminho no XML — é o de-para que o contador lê", async () => {
    const r = await request(app).get(URL);
    const porId = Object.fromEntries(r.body.campos.map((c) => [c.id, c]));
    expect(porId.tribISSQN).toMatchObject({
      tag: "tribISSQN",
      caminhoNoXml: "infDPS/valores/trib/tribMun/tribISSQN",
      cravadoHoje: true,
    });
  });

  it("oferece o derivado do cadastro como ponto de partida — sem gravar nada", async () => {
    const r = await request(app).get(URL);
    expect(r.body.derivadoDoCadastro).toMatchObject({
      origem: "DERIVADO_DO_CADASTRO",
      codigoServicoNacional: "171901",
    });
    expect(prismaMock.perfilEmissaoNfse.create).not.toHaveBeenCalled();
  });

  it("⚠ tabela ainda não criada NÃO derruba a tela", async () => {
    prismaMock.perfilEmissaoNfse.findMany.mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "P2021" }),
    );
    const r = await request(app).get(URL);
    expect(r.status).toBe(200);
    expect(r.body.perfis).toEqual([]);
  });

  it("empresa sem `Company` legada responde 409 nomeando — nunca 200", async () => {
    prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, companyId: null });
    const r = await request(app).get(URL);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("company_legada_ausente");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("POST — cria, e recusa nomeando", () => {
  const VALIDO = { nome: "Consultoria RJ", codigoServicoNacional: "171901" };

  it("cria com `origem: MANUAL` e o autor", async () => {
    const r = await request(app).post(URL).send(VALIDO);
    expect(r.status).toBe(201);
    const data = prismaMock.perfilEmissaoNfse.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      nome: "Consultoria RJ",
      codigoServicoNacional: "171901",
      portalClientId: PORTAL_ID,
      origem: "MANUAL",
      createdByUserId: CONTADOR.id,
    });
  });

  it("⚠⚠ campo de fora é RECUSADO NOMEANDO — nunca aceito e descartado", async () => {
    const r = await request(app).post(URL).send({ ...VALIDO, pTotTribFed: 5, telefone: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("campos_nao_aceitos");
    expect(r.body.campos.sort()).toEqual(["pTotTribFed", "telefone"]);
    expect(prismaMock.perfilEmissaoNfse.create).not.toHaveBeenCalled();
  });

  it("⚠ o nome é obrigatório — é ele que o cliente vê no seletor", async () => {
    const r = await request(app).post(URL).send({ codigoServicoNacional: "171901" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/nome/);
  });

  it("⚠ o `cTribNac` é obrigatório — é ele que a DPS leva", async () => {
    const r = await request(app).post(URL).send({ nome: "X" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/codigoServicoNacional/);
  });

  it("⚠⚠ `cTribMun` fora de 3 dígitos é recusado — o gerador não completa o curto", async () => {
    const r = await request(app).post(URL).send({ ...VALIDO, codigoServicoMunicipal: "12" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/3 dígitos/);
  });

  it("valor fora da enumeração do XSD é recusado, nomeando os aceitos", async () => {
    const r = await request(app).post(URL).send({ ...VALIDO, regEspTrib: "7" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/0, 1, 2, 3, 4, 5, 6, 9/);
  });

  it("⚠⚠ código fora da lista habilitada é recusado — a autoridade é o cadastro", async () => {
    // `escolherCodigoServicoNacional` já recusa isso na emissão. Deixar o perfil gravá-lo faria a
    // tela oferecer o que o servidor recusa, e o contador descobriria na nota recusada.
    prismaMock.company.findUnique.mockResolvedValue({
      ...COMPANY, codigosServicoNacional: ["310104"],
    });
    const r = await request(app).post(URL).send(VALIDO);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/não está entre os habilitados/);
  });

  it("⚠ lista VAZIA não é 'pode tudo' nem recusa — é o estado de 33 de 33 empresas", async () => {
    const r = await request(app).post(URL).send(VALIDO);
    expect(r.status).toBe(201);
  });

  it("⚠ marcar padrão DESMARCA os outros — dois padrões fariam a ordenação decidir", async () => {
    await request(app).post(URL).send({ ...VALIDO, padrao: true });
    expect(prismaMock.perfilEmissaoNfse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ portalClientId: PORTAL_ID, padrao: true }),
        data: { padrao: false },
      }),
    );
  });

  it("nome duplicado responde 409 nomeando o motivo", async () => {
    prismaMock.perfilEmissaoNfse.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const r = await request(app).post(URL).send(VALIDO);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("perfil_nome_duplicado");
  });

  it("⚠ `Boolean(\"false\")` é `true` — booleano só aceita booleano", async () => {
    const r = await request(app).post(URL).send({ ...VALIDO, padrao: "false" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toMatch(/true ou false/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("PATCH — altera SÓ o que veio", () => {
  const ATUAL = {
    id: "pf-1",
    portalClientId: PORTAL_ID,
    nome: "Consultoria",
    codigoServicoNacional: "171901",
    codigoServicoMunicipal: "001",
    tribISSQN: null,
    origem: "DERIVADO_DO_CADASTRO",
  };

  beforeEach(() => prismaMock.perfilEmissaoNfse.findFirst.mockResolvedValue(ATUAL));

  it("⚠⚠ campo AUSENTE não entra no `data` — 'não mexer' nunca vira 'apague'", async () => {
    await request(app).patch(`${URL}/pf-1`).send({ tribISSQN: "3" });
    const data = prismaMock.perfilEmissaoNfse.update.mock.calls[0][0].data;
    expect(data.tribISSQN).toBe("3");
    for (const ausente of ["codigoServicoNacional", "codigoServicoMunicipal", "cLocPrestacao", "nome"]) {
      expect({ c: ausente, tem: Object.prototype.hasOwnProperty.call(data, ausente) })
        .toEqual({ c: ausente, tem: false });
    }
  });

  it("⚠ `null` explícito APAGA — é a outra metade da regra", async () => {
    await request(app).patch(`${URL}/pf-1`).send({ codigoServicoMunicipal: null });
    const data = prismaMock.perfilEmissaoNfse.update.mock.calls[0][0].data;
    expect(data.codigoServicoMunicipal).toBeNull();
  });

  it("⚠⚠ o ESCOPO vai no `where` — perfil de outra empresa não é alcançado pelo id", async () => {
    await request(app).patch(`${URL}/pf-1`).send({ tribISSQN: "3" });
    expect(prismaMock.perfilEmissaoNfse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pf-1", portalClientId: PORTAL_ID } }),
    );
  });

  it("perfil de outra empresa responde 404, não 403 nem 200", async () => {
    prismaMock.perfilEmissaoNfse.findFirst.mockResolvedValue(null);
    const r = await request(app).patch(`${URL}/pf-1`).send({ tribISSQN: "3" });
    expect(r.status).toBe(404);
    expect(prismaMock.perfilEmissaoNfse.update).not.toHaveBeenCalled();
  });

  it("⚠ editar torna o perfil MANUAL, ainda que tenha nascido derivado", async () => {
    await request(app).patch(`${URL}/pf-1`).send({ tribISSQN: "3" });
    expect(prismaMock.perfilEmissaoNfse.update.mock.calls[0][0].data.origem).toBe("MANUAL");
  });

  it("esvaziar o `cTribNac` é recusado — a DPS não sai sem ele", async () => {
    const r = await request(app).patch(`${URL}/pf-1`).send({ codigoServicoNacional: null });
    expect(r.status).toBe(400);
    expect(prismaMock.perfilEmissaoNfse.update).not.toHaveBeenCalled();
  });

  it("corpo sem nenhum campo do perfil responde 400 — não há o que salvar", async () => {
    const r = await request(app).patch(`${URL}/pf-1`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("nenhum_campo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ esta fase NÃO emite e NÃO muda XML", () => {
  it("nenhuma rota de perfil chama o serviço de emissão", () => {
    // Varredura de fonte, no molde de `emissaoLote.js`. A porta é de CONFIGURAÇÃO; um caminho que
    // emitisse por acidente aqui produziria nota fiscal a partir de um clique em "salvar".
    //
    // ⚠ COMENTÁRIO NÃO CONTA, e a primeira versão deste caso caiu por isso: o cabeçalho do arquivo
    // EXPLICA que `buildDpsXml` não consulta o perfil, e a varredura acusou a própria explicação.
    // É a mesma armadilha que `tintaProibidaNaoVolta.test.js` documenta em `semComentarios`.
    // eslint-disable-next-line global-require
    const fs = require("node:fs");
    // eslint-disable-next-line global-require
    const path = require("node:path");
    const fonte = fs.readFileSync(path.resolve(__dirname, "../perfisEmissao.js"), "utf-8");
    const semComentarios = fonte
      .split("\n")
      // ⚠⚠ O `` PRECISA CAIR ANTES, e isto é defeito medido em 02/09/2026, não zelo.
      //
      // Em JavaScript o `.` **não casa terminadores de linha**, e `` é um deles; o `$` sem a
      // flag `m` ancora no fim da STRING. Num arquivo com CRLF, `l.replace(/\/\/.*$/, "")`
      // portanto **não remove nada** — e a varredura passa a acusar os PRÓPRIOS COMENTÁRIOS deste
      // arquivo, que são justamente os que explicam por que `buildDpsXml` não é chamado aqui.
      //
      // ⚠ O desvio é na direção segura (falso POSITIVO, nunca falso negativo) e mesmo assim é
      // ruim: um guarda cujo veredito depende do fim de linha do checkout é um guarda que alguém
      // desliga. Ele só apareceu quando uma edição gravou o arquivo em CRLF.
      .map((l) => l.replace(/\r$/, "").replace(/\/\/.*$/, ""))
      .filter((l) => !/^\s*\*/.test(l))
      .join("\n");

    expect(semComentarios).not.toMatch(/NfseService|\.issue\(|buildDpsXml|axios/);
    // ⚠ E a contraprova: a varredura tem de estar olhando código de verdade.
    expect(semComentarios).toMatch(/router\.(get|post|patch)\(/);
  });
});
