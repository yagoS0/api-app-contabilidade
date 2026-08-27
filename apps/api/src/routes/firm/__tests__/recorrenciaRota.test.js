// AS ROTAS DA RECORRÊNCIA — HTTP, e nada mais.
//
// ⚠ A regra tem teste próprio (`application/fluxo/__tests__/`). O que se prende aqui é o que só se
// vê pela porta: o piso de papel, o vocabulário recusado ANTES de tocar no banco, os códigos de
// status, e que este arquivo não reimplementa nada.

import express from "express";
import request from "supertest";

const mockListar = jest.fn();
const mockMarcar = jest.fn();
const mockSaida = jest.fn();

jest.mock("../../../application/fluxo/SerieRecorrenteService.js", () => {
  const real = jest.requireActual("../../../application/fluxo/SerieRecorrenteService.js");
  return {
    ...real,
    listarSeries: (...a) => mockListar(...a),
    marcarSerie: (...a) => mockMarcar(...a),
    registrarSaidaSugerida: (...a) => mockSaida(...a),
  };
});

let papelExigido = null;
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: (opcoes) => (req, _res, next) => {
    // ⚠ O dublê GUARDA o `minRole` pedido — é assim que se prova o piso sem subir o middleware real.
    papelExigido = opcoes?.minRole ?? null;
    req.auth = { user: { id: "u-1" } };
    next();
  },
}));

const { createRecorrenciaRouter } = require("../recorrencia.js");
const { ESTADO_DA_SERIE, LADO, RECUSA_DA_SERIE, SerieRecusada } = require("../../../application/fluxo/SerieRecorrenteService.js");
const { PERIODICIDADE } = require("../../../application/fluxo/lib/recorrencia.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/firm/companies/:companyId", createRecorrenciaRouter({ log: { error: () => {} } }));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  papelExigido = null;
  mockListar.mockResolvedValue({ series: [], cicloAtual: "2026-08", foraDoAlcance: [], indisponivel: false });
  mockMarcar.mockResolvedValue({ id: "s-1", lado: "DESPESA", chave: "X", estado: "ATIVA" });
  mockSaida.mockResolvedValue({ marcadas: 1 });
});

describe("GET /recorrencia", () => {
  it("devolve as séries e o ciclo lido", async () => {
    const r = await request(app()).get("/firm/companies/emp-1/recorrencia");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, cicloAtual: "2026-08" });
  });

  it("⚠ LER não exige papel — quem lê a fila também lê as recorrências dela", async () => {
    await request(app()).get("/firm/companies/emp-1/recorrencia");
    expect(papelExigido).toBeNull();
  });

  it("⚠⚠ o ciclo é INJETADO no serviço — a rota é quem lê o relógio, não o detector", async () => {
    await request(app()).get("/firm/companies/emp-1/recorrencia?cicloAtual=2026-05");
    expect(mockListar).toHaveBeenCalledWith(expect.objectContaining({ cicloAtual: "2026-05" }));
  });

  it("⚠ sem o parâmetro, cai no mês corrente — e ele viaja explícito", async () => {
    await request(app()).get("/firm/companies/emp-1/recorrencia");
    expect(mockListar.mock.calls[0][0].cicloAtual).toMatch(/^\d{4}-\d{2}$/);
  });

  it("⚠⚠ ciclo malformado RECUSA — a leitura inteira se apoia nele", async () => {
    const r = await request(app()).get("/firm/companies/emp-1/recorrencia?cicloAtual=agosto");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("ciclo_invalido");
    // ⚠ E o serviço NÃO foi chamado: cair no mês corrente em silêncio daria uma resposta certa para
    // uma pergunta diferente da que foi feita.
    expect(mockListar).not.toHaveBeenCalled();
  });

  it("⚠⚠ `indisponivel` chega à tela — 'não tem recorrência' e 'a tabela não existe' são diferentes", async () => {
    mockListar.mockResolvedValue({ series: [], cicloAtual: "2026-08", foraDoAlcance: [], indisponivel: true });
    const r = await request(app()).get("/firm/companies/emp-1/recorrencia");
    expect(r.body.indisponivel).toBe(true);
  });

  it("⚠ `foraDoAlcance` chega junto — o que não é lido sai contado", async () => {
    mockListar.mockResolvedValue({
      series: [], cicloAtual: "2026-08", indisponivel: false,
      foraDoAlcance: [{ motivo: "chave_de_descricao_carrega_data", frase: "…", quantos: 12 }],
    });
    const r = await request(app()).get("/firm/companies/emp-1/recorrencia");
    expect(r.body.foraDoAlcance[0].quantos).toBe(12);
  });
});

describe("POST /recorrencia/marcar", () => {
  const corpo = {
    lado: LADO.DESPESA,
    chave: "98765432000155",
    rotulo: "ANTHROPIC",
    periodicidade: PERIODICIDADE.MENSAL,
    estado: ESTADO_DA_SERIE.ATIVA,
  };

  it("⚠⚠ MARCAR exige ACCOUNTANT — ela decide o que o fluxo projeta", async () => {
    await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send(corpo);
    expect(papelExigido).toBe("ACCOUNTANT");
  });

  it("passa a decisão ao serviço, com o usuário", async () => {
    await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send(corpo);
    expect(mockMarcar).toHaveBeenCalledWith(expect.objectContaining({
      portalClientId: "emp-1", lado: "DESPESA", estado: "ATIVA", usuarioId: "u-1",
    }));
  });

  it("⚠⚠ a EVIDÊNCIA vem do corpo — é a que o contador VIU, não uma recalculada agora", async () => {
    const base = { n: 3, mediana: 130, min: 120, max: 140 };
    await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send({ ...corpo, baseDaObservacao: base });
    expect(mockMarcar.mock.calls[0][0].baseDaObservacao).toEqual(base);
  });

  it.each([
    ["PENDENTE", ESTADO_DA_SERIE.PENDENTE],
    ["inventado", "TALVEZ"],
    ["ausente", undefined],
  ])("⚠⚠ estado %s é RECUSADO antes de tocar no banco", async (_n, estado) => {
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send({ ...corpo, estado });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("estado_invalido");
    expect(mockMarcar).not.toHaveBeenCalled();
  });

  it("⚠ `PENDENTE` fica de fora porque esta rota É a palavra do contador", async () => {
    // O caminho para "ainda não decidi" é não marcar; deixá-lo passar devolveria a série ao limbo.
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send({ ...corpo, estado: "PENDENTE" });
    expect(r.body.message).toMatch(/ATIVA, RECUSADA, SUSPENSA/);
  });

  it.each([ESTADO_DA_SERIE.ATIVA, ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA])(
    "⚠ %s passa — os três são decisões",
    async (estado) => {
      const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send({ ...corpo, estado });
      expect(r.status).toBe(200);
    },
  );

  it("⚠⚠ a recusa do serviço vira o status CERTO — 503 para tabela ausente, não 500", async () => {
    mockMarcar.mockRejectedValue(new SerieRecusada(RECUSA_DA_SERIE.INDISPONIVEL));
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send(corpo);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("recorrencia_indisponivel");
    // ⚠ E a frase diz o que aconteceu, em vez de "erro interno".
    expect(r.body.message).toMatch(/migration não foi aplicada/i);
  });

  it("⚠ vocabulário torto vira 400 nomeado", async () => {
    mockMarcar.mockRejectedValue(new SerieRecusada(RECUSA_DA_SERIE.LADO_INVALIDO));
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send(corpo);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("lado_invalido");
  });

  it("⚠ erro NÃO tipado vira 500 — e não vaza a mensagem interna", async () => {
    mockMarcar.mockRejectedValue(new Error("coluna xpto não existe"));
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/marcar").send(corpo);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/xpto/);
  });
});

describe("POST /recorrencia/:serieId/saida-sugerida", () => {
  it("⚠⚠ registra que o detector sugeriu — e NÃO desmarca", async () => {
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/s-1/saida-sugerida").send({});
    expect(r.status).toBe(200);
    expect(mockSaida).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "emp-1", serieId: "s-1" }));
  });

  it("⚠ zero linhas NÃO é 404 — a saída já tinha sido registrada antes", async () => {
    mockSaida.mockResolvedValue({ marcadas: 0 });
    const r = await request(app()).post("/firm/companies/emp-1/recorrencia/s-1/saida-sugerida").send({});
    expect(r.status).toBe(200);
    expect(r.body.marcadas).toBe(0);
  });

  it("⚠ exige ACCOUNTANT", async () => {
    await request(app()).post("/firm/companies/emp-1/recorrencia/s-1/saida-sugerida").send({});
    expect(papelExigido).toBe("ACCOUNTANT");
  });
});

describe("⚠⚠ NENHUMA REGRA MORA NA ROTA", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "recorrencia.js"), "utf8")
    // ⚠ BLOCO antes de LINHA — ver a lição de 27/08/2026.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("não fala com o Prisma", () => {
    expect(FONTE).not.toMatch(/prisma/i);
    expect(FONTE).not.toMatch(/serieRecorrente\./);
  });

  it("⚠⚠ não reimplementa o detector — nem a mediana, nem o piso, nem a leitura", () => {
    expect(FONTE).not.toMatch(/lerSerie|mediana|coeficienteDeVariacao|PISO_DE_OBSERVACOES/);
  });

  it("⚠ e não escreve texto de tela próprio para a leitura — a frase sai do detector", () => {
    expect(FONTE).not.toMatch(/baseado em/);
  });

  it("⚠ contraprova: a varredura reconhece o padrão quando ele existe", () => {
    expect("const r = lerSerie({});").toMatch(/lerSerie/);
  });
});
