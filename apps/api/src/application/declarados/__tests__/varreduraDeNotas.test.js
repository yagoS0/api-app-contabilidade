// A VARREDURA — as notas recebidas virando fila de despesa.
//
// ⚠ A REGRA (que nota vira e qual não) tem teste em `lib/__tests__/notaViraDeclarado.test.js`. O
// que se prende AQUI é a orquestração: que a situação venha do ciclo, que o corte por data também
// aconteça na QUERY, que rodar duas vezes não duplique, que uma nota recusada não derrube o lote,
// e que **nada saia do relatório em silêncio**.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import { ESTADO } from "../lib/estadosDeclarado.js";
import { NAO_VIRA } from "../lib/notaViraDeclarado.js";
import {
  desligarVarreduraAutomatica,
  lerVarreduraAutomatica,
  ligarVarreduraAutomatica,
  varrerEmpresasComVarreduraAutomatica,
  varrerNotasDaEmpresa,
} from "../VarreduraDeNotasService.js";

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


// -------------------------------------------------------------------------------------------------
// ⚠⚠ A VARREDURA AUTOMÁTICA (01/09/2026) — *"elas devem ser trazidas automaticamente"*.
//
// ⚠⚠ MEDIDO ANTES DE CONSTRUIR: `varrerNotasDaEmpresa` tinha UM chamador, a rota. Nenhum worker.
// As notas chegavam sozinhas à base e paravam ali — virar FILA dependia de alguém clicar.
//
// O que este bloco prende é o que a automação NÃO pode fazer: escolher a data-piso por ninguém,
// varrer empresa que não pediu, e falhar em silêncio.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ A VARREDURA AUTOMÁTICA — a escolha do contador virando decisão permanente", () => {
  /** Um dublê que GUARDA ESTADO — dublê de constante esconderia o `upsert` e o `updateMany`. */
  function fazerBanco(linhas = []) {
    const mapa = new Map(linhas.map((l) => [l.portalClientId, { ...l }]));
    const chamadas = { upsert: [], updateMany: [], deleteMany: [] };
    return {
      mapa,
      chamadas,
      client: {
        varreduraAutomaticaDeNotas: {
          findFirst: jest.fn(async ({ where }) => mapa.get(where.portalClientId) ?? null),
          findMany: jest.fn(async ({ where } = {}) => {
            const todas = [...mapa.values()];
            return where?.portalClientId ? todas.filter((l) => l.portalClientId === where.portalClientId) : todas;
          }),
          upsert: jest.fn(async ({ where, create, update }) => {
            chamadas.upsert.push({ where, create, update });
            const atual = mapa.get(where.portalClientId);
            const nova = atual ? { ...atual, ...update } : { ...create };
            mapa.set(where.portalClientId, nova);
            return nova;
          }),
          updateMany: jest.fn(async ({ where, data }) => {
            chamadas.updateMany.push({ where, data });
            const atual = mapa.get(where.portalClientId);
            if (!atual) return { count: 0 };
            mapa.set(where.portalClientId, { ...atual, ...data });
            return { count: 1 };
          }),
          deleteMany: jest.fn(async ({ where }) => {
            chamadas.deleteMany.push({ where });
            return { count: mapa.delete(where.portalClientId) ? 1 : 0 };
          }),
        },
      },
    };
  }

  const config = (extra = {}) => ({
    portalClientId: "emp-1", dataPiso: dia("2026-07-01"), ligadaEm: dia("2026-08-01"), ligadaPor: "u-1",
    ultimaTentativaEm: null, ultimoResultadoEm: null, ultimoCriados: null, ultimoErro: null, ...extra,
  });

  it("⚠⚠ ligar GUARDA A DATA QUE O CONTADOR ESCOLHEU — é ela que a automação repete", async () => {
    const { client, mapa } = fazerBanco();
    await ligarVarreduraAutomatica({
      portalClientId: "emp-1", dataPiso: dia("2026-07-01"), usuarioId: "u-1", client,
    });
    expect(mapa.get("emp-1")).toMatchObject({ dataPiso: dia("2026-07-01"), ligadaPor: "u-1" });
  });

  it("⚠⚠ religar com OUTRA data ZERA as marcas da decisão anterior", async () => {
    // Mantê-las faria a tela dizer "trouxe 12 notas" sobre um piso que não vale mais.
    const { client, mapa } = fazerBanco([config({ ultimoCriados: 12, ultimoResultadoEm: dia("2026-08-10") })]);
    await ligarVarreduraAutomatica({ portalClientId: "emp-1", dataPiso: dia("2026-05-01"), client });
    expect(mapa.get("emp-1")).toMatchObject({
      dataPiso: dia("2026-05-01"), ultimoCriados: null, ultimoResultadoEm: null, ultimaTentativaEm: null,
    });
  });

  it("⚠⚠ data inválida RECUSA — a automação nunca escolhe o piso", async () => {
    const { client, mapa } = fazerBanco();
    for (const ruim of [null, undefined, "2026-07-01", new Date("nada")]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(ligarVarreduraAutomatica({ portalClientId: "emp-1", dataPiso: ruim, client }))
        .rejects.toThrow(/data_piso_invalida/);
    }
    expect(mapa.size).toBe(0);
  });

  it("⚠⚠ desligar APAGA a linha — não há «ativa: false» a herdar", async () => {
    // Uma linha desligada guardaria uma data que ninguém aplica, e a próxima pessoa religaria sem
    // reescolher, herdando sem saber uma decisão tomada em outro contexto.
    const { client, mapa } = fazerBanco([config()]);
    const r = await desligarVarreduraAutomatica({ portalClientId: "emp-1", client });
    expect(r.desligadas).toBe(1);
    expect(mapa.size).toBe(0);
  });

  it("⚠⚠⚠ EMPRESA SEM ESCOLHA NÃO É VARRIDA — a data-piso é do contador, não do sistema", async () => {
    // ⚠⚠ Este é o teste que impede a automação de virar o muro que a data-piso obrigatória existe
    // para evitar: são 1.897 NFS-e recebidas, e um piso escolhido pelo sistema despejaria a base.
    const { client } = fazerBanco([]);
    const varrer = jest.fn();
    const r = await varrerEmpresasComVarreduraAutomatica({ client, varrer });
    expect(r.varridas).toBe(0);
    expect(varrer).not.toHaveBeenCalled();
  });

  it("⚠⚠ varre com a data GUARDADA, e a auditoria diz que quem criou foi o SISTEMA", async () => {
    // ⚠ Carimbar o contador que ligou atribuiria a ele um ato que ele não praticou naquele instante
    // — a mesma distinção de `PRESUMIDO_POR_REGRA` contra `DECLARADO_PELO_CONTADOR`.
    const { client } = fazerBanco([config()]);
    const varrer = jest.fn(async () => ({ criados: 3, varridas: 10, jaExistiam: 7, fora: [], recusados: [] }));
    await varrerEmpresasComVarreduraAutomatica({ client, varrer, agora: dia("2026-09-02") });
    expect(varrer).toHaveBeenCalledWith(expect.objectContaining({
      portalClientId: "emp-1", dataPiso: dia("2026-07-01"), criadoPor: "sistema:varredura_automatica",
    }));
  });

  it("⚠⚠⚠ «OLHEI» É DIFERENTE DE «TROUXE» — e as duas marcas são gravadas separadas", async () => {
    // ⚠⚠ Confundir as duas custou 29 DIAS de captura parada nesta base sem ninguém perceber: uma
    // empresa legitimamente quieta ficava idêntica a uma com a rotina quebrada.
    const { client, mapa } = fazerBanco([config()]);
    const nada = jest.fn(async () => ({ criados: 0 }));
    await varrerEmpresasComVarreduraAutomatica({ client, varrer: nada, agora: dia("2026-09-02") });
    expect(mapa.get("emp-1").ultimaTentativaEm).toEqual(dia("2026-09-02"));
    // ⚠ Nenhuma nota virou fila: NÃO houve resultado, e a marca de resultado continua nula.
    expect(mapa.get("emp-1").ultimoResultadoEm).toBeNull();

    const algo = jest.fn(async () => ({ criados: 4 }));
    await varrerEmpresasComVarreduraAutomatica({ client, varrer: algo, agora: dia("2026-09-03") });
    expect(mapa.get("emp-1")).toMatchObject({
      ultimaTentativaEm: dia("2026-09-03"), ultimoResultadoEm: dia("2026-09-03"), ultimoCriados: 4,
    });
  });

  it("⚠⚠ falha de UMA empresa não derruba as outras — e o erro FICA gravado", async () => {
    const { client, mapa } = fazerBanco([config(), config({ portalClientId: "emp-2" })]);
    const varrer = jest.fn(async ({ portalClientId }) => {
      if (portalClientId === "emp-1") throw new Error("cert vencido");
      return { criados: 2 };
    });
    const r = await varrerEmpresasComVarreduraAutomatica({ client, varrer, agora: dia("2026-09-02") });
    expect(r.varridas).toBe(2);
    expect(mapa.get("emp-1").ultimoErro).toMatch(/cert vencido/);
    expect(mapa.get("emp-2")).toMatchObject({ ultimoCriados: 2, ultimoErro: null });
  });

  it("⚠ o erro SOME quando a varredura seguinte dá certo — ele descreve a última tentativa", async () => {
    const { client, mapa } = fazerBanco([config({ ultimoErro: "cert vencido" })]);
    await varrerEmpresasComVarreduraAutomatica({
      client, varrer: jest.fn(async () => ({ criados: 1 })), agora: dia("2026-09-02"),
    });
    expect(mapa.get("emp-1").ultimoErro).toBeNull();
  });

  it("⚠ o worker pode pedir UMA empresa — é o fim do ciclo de captura DELA", async () => {
    const { client } = fazerBanco([config(), config({ portalClientId: "emp-2" })]);
    const varrer = jest.fn(async () => ({ criados: 0 }));
    const r = await varrerEmpresasComVarreduraAutomatica({ client, varrer, apenasPortalClientId: "emp-2" });
    expect(r.varridas).toBe(1);
    expect(varrer).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "emp-2" }));
  });

  it("⚠⚠ tabela ausente DEGRADA, e diz que não sabe — nunca afirma «não tem»", async () => {
    // P2021/P2022 é o estado de um banco que ainda não recebeu a migration. `ligada: false` com
    // `indisponivel: true` é *"não sei olhar"*; sem o segundo campo viraria uma AFIRMAÇÃO sobre a
    // empresa.
    const erro = Object.assign(new Error("tabela"), { code: "P2021" });
    const client = { varreduraAutomaticaDeNotas: {
      findFirst: jest.fn(async () => { throw erro; }),
      findMany: jest.fn(async () => { throw erro; }),
    } };
    await expect(lerVarreduraAutomatica({ portalClientId: "emp-1", client }))
      .resolves.toMatchObject({ ligada: false, indisponivel: true });
    await expect(varrerEmpresasComVarreduraAutomatica({ client }))
      .resolves.toMatchObject({ varridas: 0, indisponivel: true });
  });

  it("⚠⚠ e o erro DESCONHECIDO propaga — «o banco caiu» não pode virar «não tem varredura»", async () => {
    const client = { varreduraAutomaticaDeNotas: {
      findFirst: jest.fn(async () => { throw new Error("conexão perdida"); }),
    } };
    await expect(lerVarreduraAutomatica({ portalClientId: "emp-1", client })).rejects.toThrow(/conexão perdida/);
  });

  it("⚠ ler devolve `ligada: false` sem linha — e isso é uma RESPOSTA, não uma falha", async () => {
    const { client } = fazerBanco([]);
    await expect(lerVarreduraAutomatica({ portalClientId: "emp-1", client }))
      .resolves.toMatchObject({ ligada: false, config: null, indisponivel: false });
  });
});
