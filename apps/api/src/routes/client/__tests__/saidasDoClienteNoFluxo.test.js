// ⚠⚠ AS SAÍDAS QUE O CLIENTE ACRESCENTA AO PRÓPRIO FLUXO — a porta, e o que ela NÃO abre.
//
// > Dono, 29/08/2026: *"o cliente pode modificar as saídas, podendo colocar novas saídas, apenas
// > para visualização deles (…) e essas saídas que o cliente digitar aparece para o contador na aba
// > de conferência."*
//
// ⚠⚠ Metade deste arquivo é VARREDURA DE FONTE, e não teste de comportamento — pelo mesmo motivo
// das outras quatro varreduras deste diretório: os defeitos que importam aqui **não aparecem contra
// um dublê**. Um `PATCH` acrescentado amanhã responderia 200 num teste de comportamento; o que ele
// abriria é o cliente editando o que o SISTEMA previu, que o dono recusou com todas as letras.

import express from "express";
import request from "supertest";

const mockCriar = jest.fn();
const mockRemover = jest.fn();
const mockDeclarar = jest.fn();
const mockRemoverSerie = jest.fn();

jest.mock("../../../application/fluxo/SaidaAvulsaService.js", () => {
  const real = jest.requireActual("../../../application/fluxo/SaidaAvulsaService.js");
  return {
    ...real,
    criarSaidaAvulsa: (...a) => mockCriar(...a),
    removerSaidaAvulsa: (...a) => mockRemover(...a),
  };
});

jest.mock("../../../application/fluxo/SerieRecorrenteService.js", () => {
  const real = jest.requireActual("../../../application/fluxo/SerieRecorrenteService.js");
  return {
    ...real,
    declararSerie: (...a) => mockDeclarar(...a),
    removerSerieDeclarada: (...a) => mockRemoverSerie(...a),
  };
});

let papelExigido = "NAO_CHAMADO";
jest.mock("../../../middlewares/requireClientCompanyAccess.js", () => ({
  requireClientCompanyAccess: (opcoes) => (req, _res, next) => {
    papelExigido = opcoes?.minRole ?? null;
    req.auth = { user: { id: "cli-1" } };
    next();
  },
}));

const { RECUSA_DA_SAIDA, SaidaRecusada, FRASE_DA_RECUSA_DA_SAIDA } =
  require("../../../application/fluxo/SaidaAvulsaService.js");
const { LADO } = require("../../../application/fluxo/SerieRecorrenteService.js");
const { requireClientCompanyAccess } = require("../../../middlewares/requireClientCompanyAccess.js");

const fs = require("node:fs");
const path = require("node:path");
const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/**
 * ⚠ O dublê do router é local: montar `routes/client/index.js` inteiro traria dezenas de
 * dependências e provaria menos. O que se mede aqui é o CORPO das duas rotas — e ele é copiado
 * verbatim do arquivo real, com a varredura de fonte abaixo garantindo que os dois não divergiram.
 */
function app() {
  const a = express();
  a.use(express.json());
  const responder = (res, err) => {
    if (err instanceof SaidaRecusada) {
      const status = err.codigo === RECUSA_DA_SAIDA.INDISPONIVEL ? 503
        : err.codigo === RECUSA_DA_SAIDA.NAO_ENCONTRADA ? 404 : 400;
      return res.status(status).json({ ok: false, error: err.codigo, message: err.frase });
    }
    return res.status(500).json({ ok: false, error: "saida_do_cliente_falhou" });
  };
  a.post("/client/companies/:companyId/fluxo/saidas", requireClientCompanyAccess(), async (req, res) => {
    const tipo = String(req.body?.tipo || "").trim().toUpperCase();
    try {
      if (tipo === "AVULSA") {
        const saida = await mockCriar({
          portalClientId: String(req.params.companyId), data: req.body?.data,
          valor: req.body?.valor, descricao: req.body?.descricao, usuarioId: String(req.auth?.user?.id || ""),
        });
        return res.status(201).json({ ok: true, tipo, saida });
      }
      if (tipo === "RECORRENTE") {
        const r = await mockDeclarar({
          portalClientId: String(req.params.companyId), lado: LADO.DESPESA,
          chave: req.body?.descricao, rotulo: req.body?.descricao,
          periodicidade: String(req.body?.periodicidade || "").trim().toUpperCase(),
          valorDeclarado: req.body?.valor, usuarioId: String(req.auth?.user?.id || ""),
        });
        return res.status(201).json({ ok: true, tipo, serie: r.serie, jaDecidida: r.jaDecidida });
      }
      return res.status(400).json({ ok: false, error: "tipo_invalido" });
    } catch (err) { return responder(res, err); }
  });
  a.delete("/client/companies/:companyId/fluxo/saidas/:saidaId", requireClientCompanyAccess(), async (req, res) => {
    const tipo = String(req.query?.tipo || "AVULSA").trim().toUpperCase();
    try {
      if (tipo === "AVULSA") {
        await mockRemover({ portalClientId: String(req.params.companyId), saidaId: String(req.params.saidaId) });
        return res.json({ ok: true, tipo });
      }
      if (tipo === "RECORRENTE") {
        await mockRemoverSerie({ portalClientId: String(req.params.companyId), serieId: String(req.params.saidaId) });
        return res.json({ ok: true, tipo });
      }
      return res.status(400).json({ ok: false, error: "tipo_invalido" });
    } catch (err) { return responder(res, err); }
  });
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  papelExigido = "NAO_CHAMADO";
  mockCriar.mockResolvedValue({ id: "sa-1", estado: "PENDENTE" });
  mockRemover.mockResolvedValue({ ok: true });
  mockDeclarar.mockResolvedValue({ serie: { id: "s-1", estado: "PENDENTE" }, jaDecidida: false });
  mockRemoverSerie.mockResolvedValue({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ UM VERBO SÓ, DOIS DESTINOS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ um POST só despacha os dois tipos — quem escolhe a porta é o SERVIDOR", () => {
  it("`AVULSA` grava a saída com data", async () => {
    const r = await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "AVULSA", data: "2026-09-10", valor: 3000, descricao: "Reforma" });
    expect(r.status).toBe(201);
    expect(mockCriar).toHaveBeenCalledTimes(1);
    expect(mockDeclarar).not.toHaveBeenCalled();
    expect(mockCriar.mock.calls[0][0]).toMatchObject({ portalClientId: "emp-1", data: "2026-09-10" });
  });

  it("`RECORRENTE` declara a série — e NUNCA cria saída avulsa", async () => {
    const r = await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "RECORRENTE", periodicidade: "MENSAL", valor: 1200, descricao: "Aluguel" });
    expect(r.status).toBe(201);
    expect(mockDeclarar).toHaveBeenCalledTimes(1);
    expect(mockCriar).not.toHaveBeenCalled();
  });

  it("⚠⚠ o LADO é CRAVADO em DESPESA — o corpo NÃO o escolhe", async () => {
    // ⚠ O pedido do dono é sobre SAÍDAS. Aceitar `RECEITA` daqui deixaria o cliente pôr receita
    // futura no próprio fluxo, que é outra decisão e nunca foi tomada.
    await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "RECORRENTE", lado: "RECEITA", periodicidade: "MENSAL", valor: 1200, descricao: "x" });
    expect(mockDeclarar.mock.calls[0][0].lado).toBe(LADO.DESPESA);
  });

  it("⚠ `tipo` fora do vocabulário RECUSA — nunca cai no primeiro da lista", async () => {
    for (const tipo of ["", "OUTRA", null, "avulsa "]) {
      jest.clearAllMocks();
      const r = await request(app()).post("/client/companies/emp-1/fluxo/saidas").send({ tipo, valor: 1 });
      if (tipo === "avulsa ") {
        // ⚠ `trim` + `toUpperCase` normalizam a forma; o que se recusa é tipo DESCONHECIDO.
        expect(r.status).toBe(201);
      } else {
        expect(r.status).toBe(400);
        expect(r.body.error).toBe("tipo_invalido");
        expect(mockCriar).not.toHaveBeenCalled();
        expect(mockDeclarar).not.toHaveBeenCalled();
      }
    }
  });

  it("⚠ o `companyId` vem do PATH, nunca do corpo", async () => {
    await request(app())
      .post("/client/companies/emp-9/fluxo/saidas")
      .send({ tipo: "AVULSA", data: "2026-09-10", valor: 10, descricao: "x", portalClientId: "emp-OUTRA" });
    expect(mockCriar.mock.calls[0][0].portalClientId).toBe("emp-9");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS RECUSAS CHEGAM NOMEADAS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a recusa do serviço vira HTTP sem perder o nome", () => {
  it.each([
    [RECUSA_DA_SAIDA.DATA_INVALIDA, 400],
    [RECUSA_DA_SAIDA.VALOR_INVALIDO, 400],
    [RECUSA_DA_SAIDA.NAO_ENCONTRADA, 404],
    [RECUSA_DA_SAIDA.JA_DECIDIDA, 400],
  ])("%s ⇒ %i, com a frase do SERVIÇO", async (codigo, status) => {
    mockCriar.mockRejectedValue(new SaidaRecusada(codigo, FRASE_DA_RECUSA_DA_SAIDA[codigo]));
    const r = await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "AVULSA", data: "x", valor: 1, descricao: "y" });
    expect(r.status).toBe(status);
    expect(r.body.error).toBe(codigo);
    // ⚠ A frase vem do serviço, nunca escrita na rota: duas frases para a mesma recusa divergiriam
    // na primeira correção, e é a de baixo que o cliente lê.
    expect(r.body.message).toBe(FRASE_DA_RECUSA_DA_SAIDA[codigo]);
  });

  it("⚠⚠ tabela ausente é 503, NÃO 400 — o problema é NOSSO, não de quem clicou", async () => {
    const c = RECUSA_DA_SAIDA.INDISPONIVEL;
    mockCriar.mockRejectedValue(new SaidaRecusada(c, FRASE_DA_RECUSA_DA_SAIDA[c]));
    const r = await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "AVULSA", data: "2026-09-10", valor: 1, descricao: "y" });
    // ⚠ 400 mandaria a pessoa conferir o que ela digitou, e não há nada errado no que ela digitou.
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/migration não foi aplicada/i);
  });

  it("erro não classificado vira 500 sem vazar a mensagem interna", async () => {
    mockCriar.mockRejectedValue(new Error("coluna xpto não existe"));
    const r = await request(app())
      .post("/client/companies/emp-1/fluxo/saidas")
      .send({ tipo: "AVULSA", data: "2026-09-10", valor: 1, descricao: "y" });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/xpto/);
  });
});

describe("⚠ apagar", () => {
  it("o cliente desfaz o que escreveu", async () => {
    const r = await request(app()).delete("/client/companies/emp-1/fluxo/saidas/sa-1");
    expect(r.status).toBe(200);
    expect(mockRemover.mock.calls[0][0]).toEqual({ portalClientId: "emp-1", saidaId: "sa-1" });
  });

  it("⚠ já decidida pelo contador ⇒ recusa nomeada, e a tela pode dizer o que houve", async () => {
    const c = RECUSA_DA_SAIDA.JA_DECIDIDA;
    mockRemover.mockRejectedValue(new SaidaRecusada(c, FRASE_DA_RECUSA_DA_SAIDA[c]));
    const r = await request(app()).delete("/client/companies/emp-1/fluxo/saidas/sa-1");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(c);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A VARREDURA — o que a rota REAL não pode virar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a rota REAL: o que ela não abre", () => {
  it("as duas portas existem, no caminho combinado", () => {
    expect(FONTE).toContain('router.post("/companies/:companyId/fluxo/saidas"');
    expect(FONTE).toContain('router.delete("/companies/:companyId/fluxo/saidas/:saidaId"');
  });

  /**
   * ⚠⚠ O `PATCH` PASSOU A EXISTIR EM 31/08/2026 — e isto REVERTE a regra que este teste travava.
   *
   * A regra era: *"NÃO existe PATCH — o dono respondeu 'só acrescentar'"*, escrita em 29/08 porque
   * um PATCH abriria o cliente editando o que o SISTEMA previu. O dono a reverteu com o caso na
   * mão: *"pode ser excluído uma saída pelo usuário. ou alterado a data"* — a linha de 3.200 da
   * SINCROSAT entrou sozinha pela regra dos 10% e ele não tinha como corrigi-la.
   *
   * ⚠⚠ **O QUE A REGRA PROTEGIA CONTINUA PROTEGIDO, e é o que estes três `expect` medem:** o PATCH
   * existe para UM campo — o dia de uma série de despesa — e não alcança guia nem imposto. A
   * diferença entre "corrigir o dia de uma despesa sua" e "reescrever o fluxo" é o escopo, e ele
   * está aqui.
   */
  it("⚠⚠ o `PATCH` existe, e SÓ para o dia da série", () => {
    expect(FONTE).toMatch(/router\.patch\([^)]*fluxo\/saidas\/:saidaId\/dia/);
    // ⚠ Nenhum PATCH genérico de saída: o caminho tem de nomear o que ele muda.
    expect(FONTE).not.toMatch(/router\.patch\("\/companies\/:companyId\/fluxo\/saidas"/);
    // ⚠⚠ E `PUT` continua não existindo: ele diria "substitua a saída inteira", que é justamente o
    // "reescrever o fluxo" que a regra de 29/08 impedia e que o dono NÃO pediu.
    expect(FONTE).not.toMatch(/router\.put\([^)]*fluxo\/saidas/);
  });

  it("⚠⚠ nenhuma rota do cliente esconde, altera ou apaga linha de GUIA do fluxo", () => {
    // ⚠⚠ Guia é dívida com a Receita. Sumir com ela da tela de quem paga é o pior desfecho possível
    // desta tela — e é o único caminho que o "modificar as saídas" NUNCA pode alcançar.
    const codigo = FONTE
      // ⚠ BLOCO antes de LINHA: um `//` dentro de `/* */` apaga o fechamento e o regex engole
      // código de verdade.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/guide\.(update|delete|updateMany|deleteMany)\(/);
    expect(codigo).not.toMatch(/FONTE\.GUIA/);
  });

  it("⚠ o piso é 'membro ativo' — planejar um gasto não é ato fiscal", async () => {
    await request(app()).post("/client/companies/emp-1/fluxo/saidas").send({ tipo: "AVULSA" });
    expect(papelExigido).toBeNull();
    // E a rota real também não pede papel nenhum nestas duas.
    const bloco = FONTE.slice(FONTE.indexOf('router.post("/companies/:companyId/fluxo/saidas"'));
    expect(bloco.slice(0, 200)).toContain("requireClientCompanyAccess()");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ REMOVER A RECORRENTE QUE O CLIENTE DECLAROU (29/08/2026).
//
// A rota nasceu sabendo apagar só a AVULSA, e a recorrente declarada não tinha porta nenhuma. Na
// tela isso apareceria como duas saídas lado a lado, uma removível e outra não, sem motivo visível.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ DELETE despacha por `tipo`", () => {
  it("sem `tipo` ele apaga a AVULSA — o comportamento com que a rota nasceu", async () => {
    const r = await request(app()).delete("/client/companies/emp-1/fluxo/saidas/sa-1");
    expect(r.status).toBe(200);
    expect(mockRemover).toHaveBeenCalledTimes(1);
    expect(mockRemoverSerie).not.toHaveBeenCalled();
  });

  it("`tipo=RECORRENTE` apaga a SÉRIE — e a avulsa não é tocada", async () => {
    const r = await request(app()).delete("/client/companies/emp-1/fluxo/saidas/sr-1?tipo=RECORRENTE");
    expect(r.status).toBe(200);
    expect(mockRemoverSerie).toHaveBeenCalledWith({ portalClientId: "emp-1", serieId: "sr-1" });
    expect(mockRemover).not.toHaveBeenCalled();
  });

  it("⚠⚠ `tipo` FORA da lista RECUSA — nunca cai na avulsa por default", async () => {
    // Um `tipo` desconhecido apagando a avulsa seria a rota escolhendo por conta própria em qual
    // tabela mexer, e o erro só apareceria como uma saída que sumiu sem ninguém ter pedido.
    const r = await request(app()).delete("/client/companies/emp-1/fluxo/saidas/x?tipo=QUALQUER");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("tipo_invalido");
    expect(mockRemover).not.toHaveBeenCalled();
    expect(mockRemoverSerie).not.toHaveBeenCalled();
  });

  it("⚠ e a ROTA REAL despacha do mesmo jeito — varredura da fonte", () => {
    // O dublê é cópia; sem esta varredura ele poderia estar certo com a rota errada.
    // ⚠ `toContain`, não regex: o trecho tem `(`, `{` e `?`, e escapá-los à mão é onde a varredura
    // vira uma expressão que casa com outra coisa — ou com nada, passando por engano.
    // ⚠⚠ TROCADO EM 31/08/2026: a rota deixou de chamar `removerSerieDeclarada` DIRETO. Ela
    // recusava a série DETECTADA com "fale com o seu contador" — coerente com o "só acrescentar" de
    // 29/08, e revertido pelo dono: *"pode ser excluído uma saída pelo usuário."*
    // ⚠ `excluirSerieDoCliente` decide entre APAGAR (a declarada dele, ainda não decidida) e MARCAR
    // como excluída. A regra de quem pode apagar continua morando em `removerSerieDeclarada`, que
    // ele CHAMA — é o que impede a duplicação de virar divergência.
    expect(FONTE).toContain("excluirSerieDoCliente({");
    expect(FONTE).toContain('String(req.query?.tipo || "AVULSA")');
  });
});
