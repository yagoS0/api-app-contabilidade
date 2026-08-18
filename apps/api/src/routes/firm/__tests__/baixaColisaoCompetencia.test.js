// A BAIXA QUE COLIDIA COM OUTRA BAIXA DA MESMA EMPRESA NO MESMO MÊS DE PAGAMENTO.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// O DEFEITO, MEDIDO EM PRODUÇÃO (18/08/2026)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// `POST /entries/:entryId/baixa` grava o lançamento do PRINCIPAL com a competência da DATA DO
// PAGAMENTO, `eventType` derivado da provisão e `origem: "MANUAL"`. Nada nessa tupla diz QUAL
// provisão está sendo quitada — e `accounting_entries` tinha
// `@@unique([portalClientId, competencia, eventType, origem])`, TOTAL.
//
// Baixa sem comprovante usa a data de HOJE. Então toda provisão em atraso, de qualquer mês, mira a
// competência CORRENTE: a primeira ocupa a tupla, a segunda estoura P2002 dentro do
// `$transaction`, cai no `catch` genérico e volta **500 `internal_error`** — sem motivo na tela.
//
// 16 empresas com 2+ provisões de DAS abertas mirando 2026-08 (ARAUJO BARRETO e TALBOT com 7 meses
// cada; ATIM, FADINI e ALESSANDRO com 6). Script: `scripts/diag-baixa-colisao-competencia.mjs`.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// SÃO DUAS ENTREGAS INDEPENDENTES, E ESTE ARQUIVO COBRE AS DUAS
// ════════════════════════════════════════════════════════════════════════════════════════════
//
//   1. o índice virou PARCIAL (`WHERE "tipo" <> 'BAIXA'`), na migration
//      `20260818160000_unique_competencia_nao_morde_baixa` — as baixas saem de dentro dele e as
//      PROVISÕES continuam guardadas. Isso é DDL: o que se pode travar em teste unitário é o
//      CONTRATO ESTRUTURAL (o predicado existe, o nome do índice é o real, o `@@unique` não
//      voltou ao schema, e a trava de provisão duplicada segue declarada);
//   2. o P2002 desta rota vira **409 NOMEADO**. Vale mesmo com o índice consertado: os outros
//      uniques da tabela continuam mordendo baixas, e `catch` genérico devolvendo 500 é a família
//      de defeito que este projeto já conhece ("o botão não faz nada").
//
// ⚠ ESTE TESTE NÃO PODE PROVAR O ÍNDICE — índice é banco. A prova foi feita no Postgres local
// (`enviar-pg`), dentro de transações com ROLLBACK, e está no relatório da entrega: duas baixas de
// provisões diferentes no mesmo mês passam a conviver; provisão e receita duplicadas continuam
// sendo recusadas; INSS/parcelamento (`eventType` NULL) ficam como estavam; `uq_baixa_guia_linha`
// continua mordendo. O que ESTE arquivo impede é que alguém desfaça o conserto no código.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../application/accounting/fechamentoContabil.js", () => ({
  isMonthClosed: jest.fn(async () => false),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    accountingEntry: {
      create: jest.fn(),
      update: jest.fn(async () => ({ id: "prov1", lines: [], baixas: [] })),
      findUnique: jest.fn(async () => ({ id: "b1", lines: [] })),
    },
    accountingEntryLine: { createMany: jest.fn(async () => ({ count: 2 })) },
  };
  return {
    __tx: tx,
    prisma: {
      accountingEntry: { findFirst: jest.fn() },
      companyMonthlyCircular: { findUnique: jest.fn(async () => null) },
      accountingHistorico: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: "h1" })),
        update: jest.fn(async () => ({ id: "h1" })),
      },
      $transaction: jest.fn(async (cb) => cb(tx)),
    },
  };
});

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { prisma, __tx } from "../../../infrastructure/db/prisma.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
// ⚠ Jest transpila para CJS, então `import.meta.url` não existe aqui. Mesmo idioma de
// `nfse/__tests__/eventoLeiaute.test.js`: a raiz da API é achada a partir do cwd, que muda
// conforme o teste rode com `-w @contabilidade/api` (raiz do monorepo) ou de dentro de `apps/api`.
const RAIZ_API = [
  process.cwd(),
  path.join(process.cwd(), "apps", "api"),
].find((p) => fs.existsSync(path.join(p, "prisma", "schema.prisma")));

if (!RAIZ_API) throw new Error(`Raiz da API não encontrada a partir de ${process.cwd()}.`);

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  return app;
}

// A provisão de DAS de FEVEREIRO, ainda aberta — o contador vai pagá-la em AGOSTO (em atraso).
const provisaoDeFevereiro = {
  id: "prov1",
  portalClientId: "p1",
  competencia: "2026-02",
  eventType: "DAS_SIMPLES",
  subtipo: "DAS",
  tipo: "PROVISAO",
  statusPagamento: "ABERTO",
  lines: [
    { conta: "220", tipo: "D", valor: 1000, ordem: 0 },
    { conta: "111", tipo: "C", valor: 1000, ordem: 1 },
  ],
  baixas: [],
};

// A baixa que o modal monta sem comprovante: data de HOJE (agosto), não a da competência.
const BAIXA_EM_AGOSTO = {
  data: "2026-08-18",
  historico: "PAGO DAS - 02/2026",
  lines: [
    { conta: "220", tipo: "D", valor: 1000 },
    { conta: "111", tipo: "C", valor: 1000 },
  ],
};

// O erro que o Prisma levanta quando o índice único morde.
function p2002(target) {
  const err = new Error("Unique constraint failed");
  err.code = "P2002";
  err.meta = { target };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findFirst.mockResolvedValue(provisaoDeFevereiro);
  __tx.accountingEntry.create.mockResolvedValue({ id: "b1" });
});

const darBaixa = (body = BAIXA_EM_AGOSTO) =>
  request(makeApp()).post("/firm/companies/p1/entries/prov1/baixa").send(body);

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("o defeito relatado: o contador via a palavra `internal_error`", () => {
  it("a colisão de competência NÃO volta mais como 500 internal_error", async () => {
    __tx.accountingEntry.create.mockRejectedValue(
      p2002(["portalClientId", "competencia", "eventType", "origem"]),
    );
    const res = await darBaixa();
    expect(res.status).not.toBe(500);
    expect(res.body.error).not.toBe("internal_error");
  });

  it("vira 409 BAIXA_DUPLICADA_NA_COMPETENCIA", async () => {
    __tx.accountingEntry.create.mockRejectedValue(
      p2002(["portalClientId", "competencia", "eventType", "origem"]),
    );
    const res = await darBaixa();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("BAIXA_DUPLICADA_NA_COMPETENCIA");
  });

  it("a recusa NOMEIA a competência do conflito — que é a do PAGAMENTO, não a da provisão", async () => {
    __tx.accountingEntry.create.mockRejectedValue(
      p2002(["portalClientId", "competencia", "eventType", "origem"]),
    );
    const res = await darBaixa();
    // A provisão é de 2026-02; o conflito é em 2026-08, o mês em que ele está tentando pagar.
    expect(res.body.competencia).toBe("2026-08");
    expect(res.body.tributo).toBe("DAS");
  });

  it("a mensagem diz O QUE FAZER — informar a data de pagamento real", async () => {
    __tx.accountingEntry.create.mockRejectedValue(
      p2002(["portalClientId", "competencia", "eventType", "origem"]),
    );
    const res = await darBaixa();
    expect(res.body.message).toMatch(/data de pagamento/i);
    // E explica POR QUE caiu no mês corrente — senão a instrução parece arbitrária.
    expect(res.body.message).toMatch(/comprovante/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ os OUTROS P2002 também param de sair como 500 — é a família do defeito, não o caso", () => {
  it("`uq_baixa_guia_linha` (baixa duplicada da mesma guia) vira 409 nomeado, não 500", async () => {
    __tx.accountingEntry.create.mockRejectedValue(p2002("uq_baixa_guia_linha"));
    const res = await darBaixa();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("BAIXA_CONFLITO_UNICIDADE");
    expect(res.body.alvo).toBe("uq_baixa_guia_linha");
  });

  it("P2002 de índice DESCONHECIDO (um futuro) também é 409, não 500", async () => {
    __tx.accountingEntry.create.mockRejectedValue(p2002("uq_qualquer_indice_novo"));
    const res = await darBaixa();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("BAIXA_CONFLITO_UNICIDADE");
  });

  it("⚠ o que NÃO é conflito de unicidade CONTINUA sendo 500 — a tradução não engole falha real", async () => {
    __tx.accountingEntry.create.mockRejectedValue(new Error("conexão caiu"));
    const res = await darBaixa();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ A FORMA DO LANÇAMENTO NÃO MUDOU — só o PRINCIPAL carrega o eventType", () => {
  // Isto é regra do dono (memória D/C é do par do TRIBUTO, não de juros/multa). O índice parcial
  // removeu a OUTRA razão que sustentava a mesma linha de código; se alguém afrouxar isto "porque
  // a constraint saiu", a próxima baixa vem pré-preenchida com a conta de juros no lugar da do
  // tributo. Este teste é o que reprova essa "simplificação".
  it("a baixa de principal + juros gera lançamentos SEPARADOS, e só o principal leva o eventType", async () => {
    const ids = [];
    __tx.accountingEntry.create.mockImplementation(async ({ data }) => {
      ids.push(data);
      return { id: `b${ids.length}` };
    });

    await darBaixa({
      data: "2026-08-18",
      historico: "PAGO DAS - 02/2026",
      lines: [
        { conta: "220", tipo: "D", valor: 1000, papel: "PRINCIPAL" },
        { conta: "501", tipo: "D", valor: 50, papel: "JUROS" },
        { conta: "111", tipo: "C", valor: 1050 },
      ],
    });

    expect(ids.length).toBe(2);
    const principal = ids.find((d) => d.tipoLinha === "PRINCIPAL");
    const juros = ids.find((d) => d.tipoLinha === "JUROS");
    expect(principal.eventType).toBe("BAIXA_DAS_SIMPLES");
    expect(juros.eventType).toBeNull();
  });

  it("a competência gravada continua sendo a da DATA DO PAGAMENTO (nada disso mudou)", async () => {
    const ids = [];
    __tx.accountingEntry.create.mockImplementation(async ({ data }) => {
      ids.push(data);
      return { id: "b1" };
    });
    await darBaixa();
    expect(ids[0].competencia).toBe("2026-08");
    expect(ids[0].origem).toBe("MANUAL");
    expect(ids[0].tipo).toBe("BAIXA");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("O CONTRATO ESTRUTURAL — o índice parcial, e a trava que o conserto arriscava", () => {
  const migracao = fs.readFileSync(
    path.join(
      RAIZ_API,
      "prisma/migrations/20260818160000_unique_competencia_nao_morde_baixa/migration.sql",
    ),
    "utf8",
  );
  const schema = fs.readFileSync(path.join(RAIZ_API, "prisma/schema.prisma"), "utf8");

  it("a migration cria o índice PARCIAL, com o predicado que tira as baixas de dentro dele", () => {
    expect(migracao).toMatch(/CREATE UNIQUE INDEX/i);
    expect(migracao).toMatch(/WHERE\s+"tipo"\s*<>\s*'BAIXA'/i);
  });

  it("ela DERRUBA o índice total antes de criar o parcial — senão o defeito continua de pé", () => {
    expect(migracao).toMatch(/DROP INDEX/i);
    // O nome REAL no banco, renomeado em `20260519095906_add_historico_sugerido` porque o gerado
    // pelo Prisma estourava os 63 caracteres do Postgres. Errar o nome = índice novo ao lado do
    // antigo, com o defeito intacto e nenhum erro.
    expect(migracao).toContain(
      "accounting_entries_portalClientId_competencia_eventType_ori_key",
    );
  });

  it("⚠ o `@@unique` de competência NÃO voltou ao schema — declarado, ele vira TOTAL de novo", () => {
    expect(schema).not.toMatch(
      /@@unique\(\s*\[\s*portalClientId\s*,\s*competencia\s*,\s*eventType\s*,\s*origem\s*\]/,
    );
  });

  it("⚠ A TRAVA CONTRA PROVISÃO DUPLICADA POR GUIA CONTINUA DECLARADA — é o que o conserto arriscava", () => {
    expect(schema).toMatch(
      /@@unique\(\s*\[\s*sourceGuideId\s*,\s*eventType\s*\]\s*,\s*name:\s*"uniq_entry_per_guide_event"/,
    );
  });

  it("o schema documenta ONDE o índice foi parar — um unique que some sem rastro volta como bug", () => {
    expect(schema).toContain("20260818160000_unique_competencia_nao_morde_baixa");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ NENHUM CÓDIGO USA A CHAVE COMPOSTA GERADA PELO PRISMA", () => {
  // Era ESTE o risco a medir antes de mexer: tirar o `@@unique` do schema quebraria qualquer
  // `where: { portalClientId_competencia_eventType_origem: … }`. A varredura deu ZERO ocorrências
  // em `apps/` — não havia `upsert` a reescrever, e por isso nenhuma corrida foi aberta. O teste
  // trava a conclusão: quem reintroduzir a chave composta descobre aqui, não em produção.
  function varrer(dir, achados = []) {
    for (const nome of fs.readdirSync(dir)) {
      // `__tests__` fica de fora: a pergunta é sobre CÓDIGO DE PRODUÇÃO, e este próprio arquivo
      // cita a chave composta no texto que explica por que ela não é usada.
      if (["node_modules", "dist", ".git", "__tests__"].includes(nome)) continue;
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) varrer(p, achados);
      else if (/\.(js|mjs|jsx)$/.test(nome)) {
        if (fs.readFileSync(p, "utf8").includes("portalClientId_competencia_eventType_origem")) {
          achados.push(p);
        }
      }
    }
    return achados;
  }

  it("a chave composta não é usada em `apps/api/src` — nada quebrou ao removê-la do schema", () => {
    expect(varrer(path.join(RAIZ_API, "src"))).toEqual([]);
  });
});
