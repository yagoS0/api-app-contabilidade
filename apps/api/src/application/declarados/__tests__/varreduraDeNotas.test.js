// A VARREDURA — as notas recebidas virando fila de despesa.
//
// ⚠ A REGRA (que nota vira e qual não) tem teste em `lib/__tests__/notaViraDeclarado.test.js`. O
// que se prende AQUI é a orquestração: que a situação venha do ciclo, que o corte por data também
// aconteça na QUERY, que rodar duas vezes não duplique, que uma nota recusada não derrube o lote,
// e que **nada saia do relatório em silêncio**.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import { ESTADO } from "../lib/estadosDeclarado.js";
import { NAO_VIRA } from "../lib/notaViraDeclarado.js";
import { varrerNotasDaEmpresa } from "../VarreduraDeNotasService.js";

const dia = (s) => new Date(`${s}T00:00:00.000Z`);

const nota = (extra = {}) => ({
  id: "pi-1",
  type: "NFSE",
  papel: "DEST",
  total: 1500,
  issueDate: dia("2026-07-15"),
  competencia: dia("2026-07-01"),
  emitenteNome: "KODA BEAR",
  emitenteDoc: "12345678000190",
  xDescServ: "consultoria",
  statusEfetivo: "autorizada",
  chaveAcesso: "ch-1",
  chaveSubstituida: null,
  motivoSubstituicao: null,
  ...extra,
});

function fazerClient(notas, opcoes = {}) {
  const criados = [];
  const queries = { notas: [], eventos: [] };
  return {
    criados,
    queries,
    client: {
      portalInvoice: {
        findMany: jest.fn(async (args) => {
          queries.notas.push(args);
          return notas;
        }),
      },
      portalInvoiceEvent: {
        findMany: jest.fn(async (args) => {
          queries.eventos.push(args);
          return opcoes.eventos || [];
        }),
      },
      lancamentoDeclarado: {
        create: jest.fn(async ({ data }) => {
          if (opcoes.duplicados?.includes(data.hashDedupe)) {
            const e = new Error("unique");
            e.code = "P2002";
            throw e;
          }
          if (opcoes.explodeEm?.includes(data.hashDedupe)) throw new Error("disco cheio");
          criados.push(data);
          return { id: `d-${criados.length}`, ...data };
        }),
        findFirst: jest.fn(async () => ({ id: "d-ja", estado: ESTADO.RECUSADO })),
      },
    },
  };
}

const varrer = (client, extra = {}) =>
  varrerNotasDaEmpresa({ portalClientId: "emp-1", criadoPor: "u-1", client, ...extra });

describe("⚠⚠ a varredura NÃO cria lançamento — cria fila esperando o pagamento", () => {
  it("todo declarado nasce AGUARDANDO_PAGAMENTO, sem data de pagamento", async () => {
    const { client, criados } = fazerClient([nota(), nota({ id: "pi-2" })]);
    const r = await varrer(client);
    expect(r.criados).toBe(2);
    for (const d of criados) {
      expect(d.estado).toBe(ESTADO.AGUARDANDO_PAGAMENTO);
      expect(d.dataPagamento).toBeNull();
      expect(d.origemPagamento).toBeNull();
    }
  });

  it("⚠ e nenhum AccountingEntry é tocado — o client nem tem esse model", async () => {
    const { client } = fazerClient([nota()]);
    await varrer(client);
    expect(client.accountingEntry).toBeUndefined();
  });

  it("a nota vira o declarado com o que ela sabe", async () => {
    const { client, criados } = fazerClient([nota()]);
    await varrer(client);
    expect(criados[0]).toMatchObject({
      origem: "NOTA_RECEBIDA",
      tipo: "SAIDA",
      valor: 1500,
      competencia: "2026-07",
      descricaoOriginal: "KODA BEAR",
      cnpjFornecedor: "12345678000190",
      notaRecebidaId: "pi-1",
      hashDedupe: "NOTA:pi-1",
    });
  });
});

describe("⚠⚠ a data-piso corta na QUERY, não só na regra", () => {
  it("o `where` leva `issueDate >= piso`", async () => {
    const { client, queries } = fazerClient([nota()]);
    await varrer(client, { dataPiso: dia("2026-07-01") });
    expect(queries.notas[0].where).toMatchObject({
      clientId: "emp-1",
      papel: "DEST",
      issueDate: { gte: dia("2026-07-01") },
    });
  });

  it("⚠ sem piso, o `where` não inventa corte", async () => {
    const { client, queries } = fazerClient([nota()]);
    await varrer(client);
    expect(queries.notas[0].where).not.toHaveProperty("issueDate");
  });

  it("⚠ carregar 1.897 notas para descartar 1.595 é o que o corte na query evita", async () => {
    // A regra MANTÉM o corte (ela é a autoridade e nomeia o motivo), mas quem não deve trafegar
    // é o dado. Aqui se prova que os dois existem.
    const { client } = fazerClient([nota({ issueDate: dia("2026-06-01") })]);
    const r = await varrer(client, { dataPiso: dia("2026-07-01") });
    expect(r.criados).toBe(0);
    expect(r.fora.find((g) => g.motivo === NAO_VIRA.ANTES_DA_DATA_PISO)?.n).toBe(1);
  });
});

describe("⚠⚠ NADA SOME EM SILÊNCIO", () => {
  it("o relatório traz varridas, criadas e o que ficou de fora POR MOTIVO", async () => {
    const { client } = fazerClient([
      nota({ id: "a" }),
      nota({ id: "b", total: null }),
      nota({ id: "c", total: 0 }),
      nota({ id: "d", papel: "EMIT" }),
    ]);
    const r = await varrer(client);
    expect(r).toMatchObject({ varridas: 4, criados: 1, jaExistiam: 0 });
    const porMotivo = Object.fromEntries(r.fora.map((g) => [g.motivo, g.n]));
    expect(porMotivo[NAO_VIRA.SEM_VALOR]).toBe(2);
    expect(porMotivo[NAO_VIRA.NAO_E_RECEBIDA]).toBe(1);
  });

  it("⚠ base sem nota devolve relatório zerado, não vazio — 'não veio nada' ≠ 'deu erro'", async () => {
    const { client } = fazerClient([]);
    const r = await varrer(client);
    expect(r).toEqual({ varridas: 0, criados: 0, jaExistiam: 0, fora: [], recusados: [] });
  });
});

describe("⚠⚠ idempotência", () => {
  it("nota já enfileirada conta como `jaExistiam`, e NADA é tocado", async () => {
    const { client, criados } = fazerClient([nota({ id: "pi-1" }), nota({ id: "pi-2" })], {
      duplicados: ["NOTA:pi-1"],
    });
    const r = await varrer(client);
    expect(r).toMatchObject({ criados: 1, jaExistiam: 1 });
    expect(criados.map((d) => d.notaRecebidaId)).toEqual(["pi-2"]);
  });

  it("⚠⚠ um declarado que o contador já RECUSOU não volta para a fila", async () => {
    // Um `upsert` o devolveria a AGUARDANDO_PAGAMENTO a cada varredura, apagando a decisão dele —
    // e a captura de notas roda sozinha, então isso aconteceria toda noite.
    const { client } = fazerClient([nota()], { duplicados: ["NOTA:pi-1"] });
    const r = await varrer(client);
    expect(r.jaExistiam).toBe(1);
    expect(client.lancamentoDeclarado.create).toHaveBeenCalledTimes(1);
  });
});

describe("⚠ uma nota recusada não derruba o lote", () => {
  it("as outras entram, e a recusada vira linha NOMEADA", async () => {
    const { client, criados } = fazerClient(
      [nota({ id: "pi-1" }), nota({ id: "pi-2" }), nota({ id: "pi-3" })],
      { explodeEm: ["NOTA:pi-2"] },
    );
    const r = await varrer(client);
    expect(r.criados).toBe(2);
    expect(criados.map((d) => d.notaRecebidaId)).toEqual(["pi-1", "pi-3"]);
    expect(r.recusados).toHaveLength(1);
    expect(r.recusados[0]).toMatchObject({ notaId: "pi-2" });
    expect(r.recusados[0].motivo).toMatch(/disco cheio/);
  });
});

describe("⚠⚠ a situação vem do CICLO", () => {
  it("os eventos da nota são consultados", async () => {
    const { client, queries } = fazerClient([nota({ id: "pi-1" }), nota({ id: "pi-2" })]);
    await varrer(client);
    expect(queries.eventos[0].where).toEqual({ invoiceId: { in: ["pi-1", "pi-2"] } });
  });

  it("nota cancelada não vira despesa", async () => {
    const { client } = fazerClient([nota({ statusEfetivo: "cancelada" })]);
    const r = await varrer(client);
    expect(r.criados).toBe(0);
    expect(r.fora[0].motivo).toBe(NAO_VIRA.CANCELADA);
  });

  it("⚠⚠ SUBSTITUÍDA é o que só o CICLO enxerga — `statusEfetivo` não tem esse valor", async () => {
    // A coluna guarda apenas `autorizada|cancelada`. Quem separa cancelamento de substituição é
    // `derivarCiclo`, e uma das evidências dele é OUTRA NOTA da base declarando substituir esta
    // (`chaveSubstituida` apontando para a chave dela) -- o caminho que salva os casos em que o
    // evento se perdeu. Lendo a coluna crua, as duas sairiam com o mesmo motivo, e o contador
    // leria "cancelada" sobre uma nota que foi substituída.
    const substituida = nota({ id: "pi-1", chaveAcesso: "ch-1", statusEfetivo: "cancelada" });
    const substituta = nota({ id: "pi-2", chaveAcesso: "ch-2", chaveSubstituida: "ch-1" });
    const { client } = fazerClient([substituida, substituta]);
    const r = await varrer(client);
    const porMotivo = Object.fromEntries(r.fora.map((g) => [g.motivo, g.n]));
    expect(porMotivo[NAO_VIRA.SUBSTITUIDA]).toBe(1);
    expect(porMotivo[NAO_VIRA.CANCELADA]).toBeUndefined();
    // ⚠ E a SUBSTITUTA, que está viva, entra normalmente.
    expect(r.criados).toBe(1);
  });
});

describe("⚠ o `select` da nota é explícito", () => {
  it("traz as colunas que a regra lê", async () => {
    const { client, queries } = fazerClient([nota()]);
    await varrer(client);
    // Coluna fora de um `select` explícito volta `undefined` SEM ERRO — a armadilha do
    // `legacyCompanySelect`, que já mordeu três vezes nesta base. Aqui o efeito seria a nota
    // inteira cair em "sem valor" ou "sem emitente".
    for (const c of ["total", "issueDate", "competencia", "emitenteNome", "emitenteDoc", "papel", "xDescServ"]) {
      expect(queries.notas[0].select[c]).toBe(true);
    }
  });
});

describe("⚠ a varredura é SEQUENCIAL", () => {
  it("não há `Promise.all` sobre as criações", () => {
    // Parâmetro de concorrência é como alguém põe 20 nele depois; a corrida entre duas varreduras
    // é justamente o que o `@@unique` do dedupe existe para pegar.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "VarreduraDeNotasService.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/Promise\.all/);
    expect(fonte).not.toMatch(/concorrencia|concurrency/i);
  });
});
