// ⚠⚠ O CORPO HTTP DO FLUXO DE CAIXA — hoje com UMA porta, a do cliente.
//
// ⚠⚠ ESTE ARQUIVO SE CHAMAVA `fluxoDeCaixaDuasPortas.test.js` ATÉ 29/08/2026, e provava que as duas
// portas (`/firm/...` e `/client/...`) serviam payload IDÊNTICO. A do contador foi removida por
// decisão do dono — *"para o contador não vai existir fluxo de caixa, pode eliminar isso da aba"* —,
// junto com a aba e com `apps/web/src/features/fluxo/` inteira.
//
// ⚠ O QUE NÃO PODE CAIR JUNTO, e é a razão de o arquivo continuar existindo: a varredura de que
// **ninguém monta o fluxo por conta própria**. Ela nasceu para impedir duas montagens divergindo na
// primeira correção; com um consumidor só ela continua valendo, porque a segunda montagem pode
// nascer amanhã — e a tela que a usaria é a do CLIENTE, que ninguém do escritório testa.
//
// ⚠ A porta do contador **não deve voltar "porque o serviço existe"**: rota sem chamador é porta
// aberta sem dono, e ressuscitá-la traria de volta a obrigação de manter os dois espelhos de
// `leituraDoFluxo.js` em sincronia — o custo que a remoção elimina. Há um teste abaixo sobre isso.

import express from "express";
import request from "supertest";

const mockMontar = jest.fn();

jest.mock("../../application/fluxo/FluxoDeCaixaService.js", () => {
  const real = jest.requireActual("../../application/fluxo/FluxoDeCaixaService.js");
  return { ...real, montarFluxoDeCaixa: (...a) => mockMontar(...a) };
});

let papelDoCliente = "NAO_CHAMADO";

const { responderFluxoDeCaixa } = require("../fluxoDeCaixaHttp.js");

/** ⚠ O dublê do lado do cliente é local: montar `routes/client/index.js` inteiro traria dezenas de
 * dependências e provaria menos. O que importa aqui é o CORPO. */
const requireClientCompanyAccess = (opcoes) => (req, _res, next) => {
  papelDoCliente = opcoes?.minRole ?? null;
  req.auth = { user: { id: "cli-1" } };
  next();
};

const PAYLOAD = {
  demonstracao: false,
  cicloAtual: "2026-08",
  horizonte: 12,
  meses: [{ competencia: "2026-08", linhas: [], totais: { fato: { entrada: 0, saida: 0 }, previsao: { entrada: 0, saida: 0 }, desconhecido: { quantas: 0 } } }],
  semMes: [],
  foraDoHorizonte: 0,
  semImposto: null,
  aliquotaUsada: null,
  recorrenciaIndisponivel: false,
  notas: { canceladas: 0 },
};

function app() {
  const a = express();
  a.use(express.json());
  a.get("/client/companies/:companyId/fluxo-de-caixa", requireClientCompanyAccess(), (req, res) =>
    responderFluxoDeCaixa(req, res, { log: { error: () => {} } }));
  return a;
}

const lerFonte = (...partes) => {
  const fs = require("node:fs");
  const path = require("node:path");
  return fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", ...partes), "utf8");
};

/**
 * ⚠⚠ TIRA OS COMENTÁRIOS ANTES DE PERGUNTAR "O CÓDIGO FAZ ISSO?".
 *
 * Este teste já se pegou: o comentário que explica a remoção da rota **cita o nome da função
 * removida**, e a varredura casou com a própria explicação. É a mesma armadilha que este projeto já
 * pagou na varredura do LLM (`/llm|extrair/` batendo no comentário que dizia não haver LLM).
 *
 * ⚠ A ORDEM IMPORTA: bloco ANTES de linha. Invertida, um `//` dentro de um `/* … *\/` apaga o
 * fechamento do bloco e o regex não-guloso engole código de verdade — silenciosamente.
 */
const semComentarios = (fonte) => fonte
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

beforeEach(() => {
  jest.clearAllMocks();
  papelDoCliente = "NAO_CHAMADO";
  mockMontar.mockResolvedValue(PAYLOAD);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ UMA MONTAGEM SÓ.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ ninguém monta o fluxo por conta própria", () => {
  it("a rota do cliente chama o corpo compartilhado, e não o serviço", () => {
    const doCliente = lerFonte("routes", "client", "index.js");
    expect(doCliente).toMatch(/responderFluxoDeCaixa/);
    // ⚠⚠ É esta linha que impede a segunda montagem. Uma rota que importasse
    // `montarFluxoDeCaixa` direto poderia passar a decidir ciclo, recusa e forma do erro por conta
    // própria — e divergir da outra na primeira correção.
    expect(doCliente).not.toMatch(/montarFluxoDeCaixa/);
  });

  it("⚠ e o corpo compartilhado é o ÚNICO lugar que o importa", () => {
    const corpo = lerFonte("routes", "fluxoDeCaixaHttp.js");
    expect(corpo).toMatch(/montarFluxoDeCaixa/);
  });
});

describe("⚠⚠ a porta do CONTADOR não existe mais", () => {
  it("`routes/firm/recorrencia.js` não serve mais o fluxo", () => {
    // ⚠ A remoção é de 29/08/2026 e é decisão de produto, não defeito. Se este teste ficar vermelho,
    // alguém reabriu a porta — leia o comentário no lugar onde ela ficava antes de "consertar".
    const codigo = semComentarios(lerFonte("routes", "firm", "recorrencia.js"));
    expect(codigo).not.toMatch(/responderFluxoDeCaixa/);
    expect(codigo).not.toMatch(/["']\/fluxo-de-caixa["']/);
  });

  it("⚠ o comentário que EXPLICA a remoção fica — e é ele que impede a porta de voltar por engano", () => {
    // ⚠⚠ A prova de que a varredura acima olha o CÓDIGO, não o texto: o arquivo cru CITA o nome da
    // função removida, de propósito. Sem `semComentarios`, o teste anterior falharia sobre a própria
    // explicação — e o conserto tentador seria apagar o comentário, que é o oposto do certo.
    expect(lerFonte("routes", "firm", "recorrencia.js")).toMatch(/não vai existir fluxo de caixa/);
  });

  it("⚠ mas as rotas de RECORRÊNCIA ficam — o PainelDeRecorrencias vive na Conferência", () => {
    const codigo = semComentarios(lerFonte("routes", "firm", "recorrencia.js"));
    expect(codigo).toMatch(/router\.get\(\s*["']\/recorrencia["']/);
    expect(codigo).toMatch(/router\.post\(\s*["']\/recorrencia\/marcar["']/);
  });
});

describe("⚠ o acesso", () => {
  it("exige acesso à empresa, e nenhum papel além disso", async () => {
    await request(app()).get("/client/companies/emp-1/fluxo-de-caixa");
    // ⚠ Ler o fluxo é LEITURA, e o piso das rotas financeiras deste arquivo é "membro ativo".
    expect(papelDoCliente).toBeNull();
  });

  it("⚠ o `companyId` vem do PATH", async () => {
    await request(app()).get("/client/companies/emp-9/fluxo-de-caixa");
    expect(mockMontar.mock.calls[0][0].portalClientId).toBe("emp-9");
  });
});

describe("⚠ o ciclo", () => {
  it("⚠⚠ ciclo malformado RECUSA — os meses e o corte do passado se apoiam nele", async () => {
    const r = await request(app()).get("/client/companies/emp-1/fluxo-de-caixa?cicloAtual=agosto");
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
});

describe("⚠⚠ o payload NÃO tem `total`", () => {
  it("nem no topo, nem dentro dos totais do mês", async () => {
    const r = await request(app()).get("/client/companies/emp-1/fluxo-de-caixa");
    expect(JSON.stringify(r.body)).not.toMatch(/"total"\s*:/);
  });

  it("⚠ e não tem saldo acumulado — sem saldo inicial não há o que acumular", async () => {
    const r = await request(app()).get("/client/companies/emp-1/fluxo-de-caixa");
    expect(JSON.stringify(r.body)).not.toMatch(/saldoAcumulado|saldoInicial/i);
  });
});

describe("⚠ a falha", () => {
  it("vira 500 nomeado, sem vazar a mensagem interna", async () => {
    mockMontar.mockRejectedValue(new Error("coluna xpto não existe"));
    const r = await request(app()).get("/client/companies/emp-1/fluxo-de-caixa");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("fluxo_de_caixa_falhou");
    expect(JSON.stringify(r.body)).not.toMatch(/xpto/);
  });
});

describe("⚠⚠ a rota ANTIGA do cliente fica como está", () => {
  it("`GET /companies/:id/fluxo` continua existindo — o Painel a consome hoje", () => {
    // ⚠ Ela virou um CONTRIBUINTE deste fluxo (as guias liberadas em aberto), não uma segunda
    // definição dele. Trocá-la quebraria o Painel do cliente sem necessidade.
    expect(lerFonte("routes", "client", "index.js")).toMatch(/router\.get\(\s*"\/companies\/:companyId\/fluxo"/);
  });
});
