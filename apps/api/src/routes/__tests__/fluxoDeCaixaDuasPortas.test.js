// ⚠⚠ AS DUAS PORTAS DO FLUXO DE CAIXA SERVEM O MESMO PAYLOAD.
//
// O contador e o cliente veem o mesmo fluxo da mesma empresa. Duas montagens divergiriam na
// primeira correção, e aí as duas telas afirmariam coisas diferentes sobre o mesmo dinheiro — com o
// cliente do lado que ninguém do escritório testa.
//
// ⚠ O que muda entre elas é SÓ o middleware de acesso, que responde a perguntas diferentes.

import express from "express";
import request from "supertest";

const mockMontar = jest.fn();

jest.mock("../../application/fluxo/FluxoDeCaixaService.js", () => {
  const real = jest.requireActual("../../application/fluxo/FluxoDeCaixaService.js");
  return { ...real, montarFluxoDeCaixa: (...a) => mockMontar(...a) };
});

let papelDoContador = "NAO_CHAMADO";
let papelDoCliente = "NAO_CHAMADO";

jest.mock("../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: (opcoes) => (req, _res, next) => {
    papelDoContador = opcoes?.minRole ?? null;
    req.auth = { user: { id: "u-1" } };
    next();
  },
}));

const { responderFluxoDeCaixa } = require("../fluxoDeCaixaHttp.js");
const { requireFirmCompanyAccess } = require("../../middlewares/requireFirmCompanyAccess.js");

/** ⚠ O dublê do lado do cliente é local: montar `routes/client/index.js` inteiro traria dezenas de
 * dependências e provaria menos. O que importa aqui é que o CORPO é o mesmo. */
const requireClientCompanyAccess = (opcoes) => (req, _res, next) => {
  papelDoCliente = opcoes?.minRole ?? null;
  req.auth = { user: { id: "cli-1" } };
  next();
};

const PAYLOAD = {
  cicloAtual: "2026-08",
  horizonte: 12,
  meses: [{ competencia: "2026-08", linhas: [], totais: { fato: { entrada: 0, saida: 0 }, previsao: { entrada: 0, saida: 0 }, desconhecido: { quantas: 0 } } }],
  semMes: [],
  foraDoHorizonte: 0,
  prazoRecebimento: { meses: 1, configurado: false },
  semImposto: null,
  aliquotaUsada: null,
  recorrenciaIndisponivel: false,
  notas: { canceladas: 0 },
};

function app() {
  const a = express();
  a.use(express.json());
  // as DUAS portas, com o MESMO corpo
  a.get("/firm/companies/:companyId/fluxo-de-caixa", requireFirmCompanyAccess(), (req, res) =>
    responderFluxoDeCaixa(req, res, { log: { error: () => {} } }));
  a.get("/client/companies/:companyId/fluxo-de-caixa", requireClientCompanyAccess(), (req, res) =>
    responderFluxoDeCaixa(req, res, { log: { error: () => {} } }));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  papelDoContador = "NAO_CHAMADO";
  papelDoCliente = "NAO_CHAMADO";
  mockMontar.mockResolvedValue(PAYLOAD);
});

describe("⚠⚠ UM CÁLCULO SÓ, DOIS CONSUMIDORES", () => {
  it("as duas portas devolvem payload IDÊNTICO para a mesma empresa", async () => {
    const a = app();
    const doContador = await request(a).get("/firm/companies/emp-1/fluxo-de-caixa?cicloAtual=2026-08");
    const doCliente = await request(a).get("/client/companies/emp-1/fluxo-de-caixa?cicloAtual=2026-08");
    expect(doContador.status).toBe(200);
    expect(doCliente.status).toBe(200);
    expect(doCliente.body).toEqual(doContador.body);
  });

  it("⚠⚠ e as duas chamam o MESMO serviço, com os MESMOS argumentos", async () => {
    const a = app();
    await request(a).get("/firm/companies/emp-1/fluxo-de-caixa?cicloAtual=2026-08");
    await request(a).get("/client/companies/emp-1/fluxo-de-caixa?cicloAtual=2026-08");
    expect(mockMontar).toHaveBeenCalledTimes(2);
    expect(mockMontar.mock.calls[0][0]).toEqual(mockMontar.mock.calls[1][0]);
  });

  it("⚠ o corpo é literalmente o MESMO arquivo — não duas cópias", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const raiz = path.join(__dirname, "..", "..", "..");
    const doContador = fs.readFileSync(path.join(raiz, "src", "routes", "firm", "recorrencia.js"), "utf8");
    const doCliente = fs.readFileSync(path.join(raiz, "src", "routes", "client", "index.js"), "utf8");
    for (const fonte of [doContador, doCliente]) {
      expect(fonte).toMatch(/responderFluxoDeCaixa/);
      // ⚠⚠ Nenhuma das duas monta o fluxo por conta própria.
      expect(fonte).not.toMatch(/montarFluxoDeCaixa/);
    }
  });
});

describe("⚠ o que MUDA entre as portas é só o acesso", () => {
  it("as duas exigem acesso à empresa, e nenhuma exige papel além disso", async () => {
    const a = app();
    await request(a).get("/firm/companies/emp-1/fluxo-de-caixa");
    await request(a).get("/client/companies/emp-1/fluxo-de-caixa");
    // ⚠ Ler o fluxo é LEITURA. Quem lê a fila da empresa lê o fluxo dela; do lado do cliente, o
    // piso das rotas financeiras é "membro ativo".
    expect(papelDoContador).toBeNull();
    expect(papelDoCliente).toBeNull();
  });

  it("⚠ o `companyId` vem do PATH, nos dois", async () => {
    const a = app();
    await request(a).get("/firm/companies/emp-9/fluxo-de-caixa");
    expect(mockMontar.mock.calls[0][0].portalClientId).toBe("emp-9");
  });
});

describe("⚠ o ciclo", () => {
  it("⚠⚠ ciclo malformado RECUSA — os 12 meses e o corte do passado se apoiam nele", async () => {
    const r = await request(app()).get("/firm/companies/emp-1/fluxo-de-caixa?cicloAtual=agosto");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("ciclo_invalido");
    // ⚠ E o serviço NÃO foi chamado: cair no mês corrente em silêncio daria uma resposta certa para
    // uma pergunta diferente da que foi feita.
    expect(mockMontar).not.toHaveBeenCalled();
  });

  it("⚠ sem o parâmetro, o mês corrente — e ele viaja explícito", async () => {
    await request(app()).get("/client/companies/emp-1/fluxo-de-caixa");
    expect(mockMontar.mock.calls[0][0].cicloAtual).toMatch(/^\d{4}-\d{2}$/);
  });

  it("⚠ a mesma recusa nas DUAS portas", async () => {
    const a = app();
    const c = await request(a).get("/client/companies/emp-1/fluxo-de-caixa?cicloAtual=xx");
    expect(c.status).toBe(400);
    expect(c.body.error).toBe("ciclo_invalido");
  });
});

describe("⚠⚠ o payload NÃO tem `total`", () => {
  it("nem no topo, nem dentro dos totais do mês", async () => {
    const r = await request(app()).get("/firm/companies/emp-1/fluxo-de-caixa");
    expect(JSON.stringify(r.body)).not.toMatch(/"total"\s*:/);
  });

  it("⚠ e não tem saldo acumulado — sem saldo inicial não há o que acumular", async () => {
    const r = await request(app()).get("/firm/companies/emp-1/fluxo-de-caixa");
    expect(JSON.stringify(r.body)).not.toMatch(/saldoAcumulado|saldoInicial/i);
  });
});

describe("⚠ a falha", () => {
  it("vira 500 nomeado, sem vazar a mensagem interna", async () => {
    mockMontar.mockRejectedValue(new Error("coluna xpto não existe"));
    const r = await request(app()).get("/firm/companies/emp-1/fluxo-de-caixa");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("fluxo_de_caixa_falhou");
    expect(JSON.stringify(r.body)).not.toMatch(/xpto/);
  });
});

describe("⚠⚠ a rota ANTIGA do cliente fica como está", () => {
  it("`GET /companies/:id/fluxo` continua existindo — `PainelPage` a consome hoje", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "src", "routes", "client", "index.js"), "utf8",
    );
    // ⚠ Ela virou um CONTRIBUINTE deste fluxo (as guias liberadas em aberto), não uma segunda
    // definição dele. Trocá-la quebraria o Painel do cliente sem necessidade.
    expect(fonte).toMatch(/router\.get\(\s*"\/companies\/:companyId\/fluxo"/);
  });
});
