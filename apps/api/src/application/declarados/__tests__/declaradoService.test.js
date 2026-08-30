// A LIGAÇÃO DA CONFERÊNCIA COM O BANCO.
//
// ⚠ A REGRA tem teste próprio (`lib/__tests__/`). O que se prende aqui é a LIGAÇÃO: que a
// transição consulte a regra em vez de reimplementá-la, que o lançamento nasça DENTRO da mesma
// transação que muda o estado, que o escopo por empresa esteja no `where`, e que mês fechado
// recuse nos dois sentidos.
//
// ⚠⚠ LIMITE DECLARADO DESTE ARQUIVO: com um dublê, `$transaction` não faz ROLLBACK de verdade —
// isso é trabalho do Postgres e não é exercido aqui. O que estes testes provam é (a) que as duas
// escritas acontecem dentro do MESMO `$transaction`, e (b) que uma falha no meio impede a segunda.
// Um teste que afirmasse atomicidade sobre um dublê estaria mentindo.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
// ⚠ Só `isMonthClosed` é dublada — ela consulta o prisma do MÓDULO e não aceita client injetado.
// `competenciasFechadas` fica REAL de propósito: ela recebe o client, então o dublê já a exercita
// de ponta a ponta, e um stub aqui esconderia a query que o pré-voo da fila faz.
jest.mock("../../accounting/fechamentoContabil.js", () => ({
  ...jest.requireActual("../../accounting/fechamentoContabil.js"),
  isMonthClosed: jest.fn(async () => false),
}));

import { isMonthClosed } from "../../accounting/fechamentoContabil.js";
import { ESTADO, ORIGEM_PAGAMENTO, RECUSA, TRANSICAO } from "../lib/estadosDeclarado.js";
import { DeclaradoRecusado, RECUSA_DO_SERVICO, aplicarTransicao, listarFila, varrerInvariantes } from "../DeclaradoService.js";

const AGORA = new Date("2026-08-24T10:00:00.000Z");
const PAGO_EM = new Date("2026-07-15T00:00:00.000Z");

/** O plano REAL, na parte que importa. `portalClientId: null` = global. */
const PLANO = [
  { portalClientId: null, codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  { portalClientId: null, codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PRESTADOS POR PJ" },
];

const declaradoBase = (extra = {}) => ({
  id: "d-1",
  portalClientId: "emp-1",
  estado: ESTADO.A_CONFERIR,
  origem: "NOTA_RECEBIDA",
  tipo: "SAIDA",
  competencia: "2026-07",
  valor: 1500,
  valorAjustado: null,
  descricaoOriginal: "KODA BEAR",
  dataDocumento: new Date("2026-07-02T00:00:00.000Z"),
  dataPagamento: PAGO_EM,
  origemPagamento: ORIGEM_PAGAMENTO.OFX,
  contaSugerida: "411020008",
  contaAplicada: null,
  accountingEntryId: null,
  ...extra,
});

/**
 * Um dublê que GUARDA ESTADO — dublê que só devolve constante esconde o que importa aqui.
 *
 * ⚠⚠ O `tx` e o `client` têm funções DIFERENTES, de propósito. Compartilhando a mesma `jest.fn`,
 * um `update` escrito fora da transação seria indistinguível de um escrito dentro — e a asserção
 * "as duas escritas no mesmo `$transaction`" estaria afirmando o que não prova.
 */
function fazerClient(declarado, opcoes = {}) {
  const chamadas = {
    create: [],
    /** escritas feitas com o `tx` que o `$transaction` entregou */
    update: [],
    /** ⚠ escritas feitas com o client de FORA */
    updateForaDaTransacao: [],
    deleteMany: [],
    transacao: 0,
    findFirst: [],
    competenciasConsultadas: [],
  };
  const entriesVivos = new Map(opcoes.entriesVivos || []);

  const updateEm = (registro) =>
    jest.fn(async ({ where, data }) => {
      if (opcoes.falharNoUpdate) throw new Error("banco caiu no update");
      registro.push({ where, data });
      return { ...declarado, ...data };
    });

  const tx = {
    accountingEntry: {
      create: jest.fn(async ({ data }) => {
        if (opcoes.falharNoCreate) throw new Error("banco caiu no meio");
        chamadas.create.push(data);
        return { id: "ae-novo" };
      }),
      deleteMany: jest.fn(async ({ where }) => {
        chamadas.deleteMany.push(where);
        const tinha = entriesVivos.delete(where.id);
        return { count: tinha ? 1 : 0 };
      }),
    },
    lancamentoDeclarado: { update: updateEm(chamadas.update) },
  };

  return {
    chamadas,
    entriesVivos,
    client: {
      lancamentoDeclarado: {
        findFirst: jest.fn(async ({ where }) => {
          chamadas.findFirst.push(where);
          return where.id === declarado.id && where.portalClientId === declarado.portalClientId ? declarado : null;
        }),
        update: updateEm(chamadas.updateForaDaTransacao),
        findMany: jest.fn(async () => opcoes.fila || []),
        count: jest.fn(async () => (opcoes.fila || []).length),
        groupBy: jest.fn(async () => opcoes.porEstado || []),
      },
      companyMonthlyCircular: {
        findMany: jest.fn(async ({ where }) => {
          chamadas.competenciasConsultadas.push(where);
          return (opcoes.fechadas || []).map((c) => ({ competencia: c, fechadoContabilEm: new Date("2026-08-01") }));
        }),
      },
      accountingEntry: {
        // ⚠ Fora da transação, escrever é PROIBIDO neste serviço: se alguém trocar `tx` por
        // `client` no caminho do razão, o teste estoura em vez de passar silenciosamente.
        create: jest.fn(async () => {
          throw new Error("accountingEntry.create FORA da transacao");
        }),
        deleteMany: jest.fn(async () => {
          throw new Error("accountingEntry.deleteMany FORA da transacao");
        }),
        findMany: jest.fn(async ({ where }) =>
          [...entriesVivos.keys()].filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
        ),
      },
      chartOfAccount: { findMany: jest.fn(async () => PLANO) },
      $transaction: jest.fn(async (cb) => {
        chamadas.transacao += 1;
        return cb(tx);
      }),
    },
  };
}

const aplicar = (client, transicao, dados = {}, id = "d-1") =>
  aplicarTransicao({
    portalClientId: "emp-1",
    declaradoId: id,
    transicao,
    dados,
    usuarioId: "u-1",
    agora: AGORA,
    client,
  });

beforeEach(() => {
  jest.clearAllMocks();
  isMonthClosed.mockResolvedValue(false);
});

describe("⚠⚠ CONFIRMAR — o lançamento nasce DENTRO da transação", () => {
  it("cria o AccountingEntry na forma medida e amarra o id ao declarado", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);

    expect(chamadas.transacao).toBe(1);
    expect(chamadas.create).toHaveLength(1);
    expect(chamadas.create[0]).toMatchObject({
      portalClientId: "emp-1",
      tipo: "DESPESA",
      origem: "CONFERENCIA",
      status: "RASCUNHO",
      statusPagamento: "NA",
      eventType: null,
      competencia: "2026-07",
      historico: "KODA BEAR",
    });
    expect(chamadas.create[0].lines.create).toEqual([
      { conta: "464", tipo: "D", valor: 1500, ordem: 0 },
      { conta: "5", tipo: "C", valor: 1500, ordem: 1 },
    ]);
  });

  it("⚠⚠ a data do lançamento é a do PAGAMENTO, não a do documento nem a do clique", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(chamadas.create[0].data).toBe(PAGO_EM);
    expect(chamadas.create[0].data).not.toBe(AGORA);
  });

  it("o declarado fica CONTABILIZADO apontando para o lançamento", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(chamadas.update[0].data).toMatchObject({
      estado: ESTADO.CONTABILIZADO,
      accountingEntryId: "ae-novo",
      decididoPor: "u-1",
      decididoEm: AGORA,
    });
  });

  it("⚠ a CONTA escolhida no próprio ato chega ao lançamento", async () => {
    // O declarado tem `contaSugerida` e nenhuma aplicada; a forma é montada sobre o declarado JÁ
    // com a transição aplicada. Sem isso o contador trocaria a conta e o razão receberia a antiga.
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR, { contaAplicada: "111010001" });
    expect(chamadas.create[0].lines.create[0].conta).toBe("5");
  });

  it("⚠ AJUSTAR leva o valor ajustado aos DOIS lados", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.AJUSTAR, { valorAjustado: 900 });
    expect(chamadas.create[0].lines.create.map((l) => l.valor)).toEqual([900, 900]);
  });
});

describe("⚠⚠ FALHA INJETADA NO MEIO DA TRANSAÇÃO", () => {
  it("o lançamento falha ⇒ o declarado NÃO muda de estado", async () => {
    const { client, chamadas } = fazerClient(declaradoBase(), { falharNoCreate: true });
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toThrow("banco caiu no meio");
    expect(chamadas.update).toHaveLength(0);
  });

  it("⚠ o update falha ⇒ a exceção PROPAGA, e o rollback é do Postgres", async () => {
    // ⚠ Com dublê não há rollback de verdade. O que se prova aqui é que a exceção não é engolida —
    // engoli-la deixaria o lançamento no razão com o declarado dizendo que nada foi feito.
    const { client } = fazerClient(declaradoBase(), { falharNoUpdate: true });
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toThrow("banco caiu no update");
  });

  it("⚠⚠ as DUAS escritas acontecem no MESMO `$transaction`, com o `tx` — não com o client de fora", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(chamadas.transacao).toBe(1);
    expect(chamadas.create).toHaveLength(1);
    expect(chamadas.update).toHaveLength(1);
    // ⚠ Esta é a linha que dá sentido às de cima: o `tx` e o client têm funções DIFERENTES no
    // dublê, então um `update` escrito fora da transação apareceria aqui.
    expect(chamadas.updateForaDaTransacao).toHaveLength(0);
  });

  it("⚠⚠ o DESFAZER também apaga com o `tx`", async () => {
    const { client, chamadas } = fazerClient(
      declaradoBase({ estado: ESTADO.CONTABILIZADO, accountingEntryId: "ae-9", contaAplicada: "411020008" }),
      { entriesVivos: [["ae-9", true]] },
    );
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(chamadas.deleteMany).toHaveLength(1);
    expect(chamadas.updateForaDaTransacao).toHaveLength(0);
  });
});

describe("DESFAZER", () => {
  const contabilizado = () =>
    declaradoBase({ estado: ESTADO.CONTABILIZADO, accountingEntryId: "ae-9", contaAplicada: "411020008" });

  it("apaga o lançamento e solta o ponteiro", async () => {
    const { client, chamadas } = fazerClient(contabilizado(), { entriesVivos: [["ae-9", true]] });
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(chamadas.deleteMany[0]).toEqual({ id: "ae-9", portalClientId: "emp-1" });
    expect(chamadas.update[0].data).toMatchObject({ estado: ESTADO.A_CONFERIR, accountingEntryId: null });
  });

  it("⚠⚠ apaga com o `portalClientId` NO WHERE — nunca só pelo id", async () => {
    const { client, chamadas } = fazerClient(contabilizado(), { entriesVivos: [["ae-9", true]] });
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(chamadas.deleteMany[0]).toHaveProperty("portalClientId", "emp-1");
  });

  it("⚠⚠ lançamento JÁ APAGADO por fora não trava o desfazer", async () => {
    // Com `delete` isto seria P2025 e o declarado ficaria preso em CONTABILIZADO para sempre,
    // apontando para nada. `deleteMany` solta o registro de qualquer jeito.
    const { client, chamadas } = fazerClient(contabilizado(), { entriesVivos: [] });
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(chamadas.update[0].data.estado).toBe(ESTADO.A_CONFERIR);
  });

  it("⚠ desfazer NÃO apaga a declaração da data", async () => {
    const { client, chamadas } = fazerClient(contabilizado(), { entriesVivos: [["ae-9", true]] });
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(chamadas.update[0].data).not.toHaveProperty("dataPagamento");
    expect(chamadas.update[0].data).not.toHaveProperty("origemPagamento");
  });
});

describe("⚠ mês fechado", () => {
  it("recusa CONTABILIZAR", async () => {
    isMonthClosed.mockResolvedValue(true);
    const { client, chamadas } = fazerClient(declaradoBase());
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.MES_FECHADO,
    });
    expect(chamadas.create).toHaveLength(0);
  });

  it("⚠⚠ recusa DESFAZER também — apagaria lançamento que o fechamento já conferiu", async () => {
    isMonthClosed.mockResolvedValue(true);
    const { client, chamadas } = fazerClient(
      declaradoBase({ estado: ESTADO.CONTABILIZADO, accountingEntryId: "ae-9" }),
    );
    await expect(aplicar(client, TRANSICAO.DESFAZER)).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.MES_FECHADO,
    });
    expect(chamadas.deleteMany).toHaveLength(0);
  });

  it("⚠ NÃO é consultado para transição que não toca o razão — recusar não escreve no livro", async () => {
    const { client } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.RECUSAR, { motivoRecusa: "despesa do sócio" });
    expect(isMonthClosed).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ escopo por empresa", () => {
  it("declarado de OUTRA empresa não é encontrado", async () => {
    const { client } = fazerClient(declaradoBase({ portalClientId: "emp-2" }));
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.NAO_ENCONTRADO,
    });
  });

  it("o `portalClientId` está no WHERE, não numa conferência depois da leitura", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(chamadas.findFirst[0]).toEqual({ id: "d-1", portalClientId: "emp-1" });
  });
});

describe("a regra pura é CONSULTADA, não reimplementada", () => {
  it("a recusa da regra chega ao chamador com o código dela", async () => {
    const { client, chamadas } = fazerClient(declaradoBase({ dataPagamento: null, origemPagamento: null }));
    const erro = await aplicar(client, TRANSICAO.CONFIRMAR).catch((e) => e);
    expect(erro).toBeInstanceOf(DeclaradoRecusado);
    expect(erro.codigo).toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
    expect(erro.frase).toMatch(/caixa/i);
    expect(chamadas.create).toHaveLength(0);
    expect(chamadas.transacao).toBe(0);
  });

  it("⚠ transição simples NÃO abre transação nem carrega o plano", async () => {
    const { client, chamadas } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.RECUSAR, { motivoRecusa: "não é da empresa" });
    expect(chamadas.transacao).toBe(0);
    expect(client.chartOfAccount.findMany).not.toHaveBeenCalled();
  });
});

describe("a fila", () => {
  it("⚠ pagina desde o dia 1, e o teto é 200", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", pagina: 3, porPagina: 5000, client });
    const args = client.lancamentoDeclarado.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(args.skip).toBe(400);
  });

  it("⚠ ordena da mais ANTIGA para a mais nova — quem espera há mais tempo aparece primeiro", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].orderBy).toEqual([
      { dataDocumento: "asc" },
      { criadoEm: "asc" },
    ]);
  });

  it("página e tamanho tortos caem no padrão, nunca em skip negativo", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", pagina: -3, porPagina: 0, client });
    const args = client.lancamentoDeclarado.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });

  it("sempre escopa por empresa", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", estados: [ESTADO.A_CONFERIR], competencia: "2026-07", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where).toEqual({
      portalClientId: "emp-1",
      estado: { in: [ESTADO.A_CONFERIR] },
      competencia: "2026-07",
    });
  });
});

describe("⚠⚠ a varredura das invariantes", () => {
  const fakeVarredura = (linhas, entries = []) => ({
    lancamentoDeclarado: {
      findMany: jest.fn(async ({ where }) => {
        if (where.accountingEntryId) return linhas.foraDeContabilizado || [];
        if (where.dataPagamento === null) return linhas.semData || [];
        return linhas.contabilizados || [];
      }),
    },
    accountingEntry: { findMany: jest.fn(async () => entries.map((id) => ({ id }))) },
  });

  it("base limpa responde ok", async () => {
    const r = await varrerInvariantes({ portalClientId: "emp-1", client: fakeVarredura({}) });
    expect(r.ok).toBe(true);
  });

  it("pega lançamento vinculado FORA de CONTABILIZADO", async () => {
    const client = fakeVarredura({ foraDeContabilizado: [{ id: "d-1", estado: ESTADO.RECUSADO, accountingEntryId: "ae-1" }] });
    const r = await varrerInvariantes({ portalClientId: "emp-1", client });
    expect(r.ok).toBe(false);
    expect(r.lancamentoForaDeContabilizado).toHaveLength(1);
  });

  it("pega CONTABILIZADO sem lançamento", async () => {
    const client = fakeVarredura({ contabilizados: [{ id: "d-2", accountingEntryId: null }] });
    const r = await varrerInvariantes({ client });
    expect(r.contabilizadoSemLancamento).toHaveLength(1);
  });

  it("⚠⚠ pega PONTEIRO PENDURADO — é o que só existe porque NÃO há FK", async () => {
    // Com `SET NULL` o id sumiria e o apagamento por fora seria invisível.
    const client = fakeVarredura({ contabilizados: [{ id: "d-3", accountingEntryId: "ae-morto" }] }, []);
    const r = await varrerInvariantes({ client });
    expect(r.ponteiroPendurado.map((d) => d.id)).toEqual(["d-3"]);
  });

  it("⚠⚠ pega A_CONFERIR / CONTABILIZADO SEM data de pagamento — a invariante do caixa", async () => {
    const client = fakeVarredura({ semData: [{ id: "d-4", estado: ESTADO.CONTABILIZADO }] });
    const r = await varrerInvariantes({ client });
    expect(r.ok).toBe(false);
    expect(r.semDataDePagamento).toHaveLength(1);
  });
});

describe("⚠ o serviço NÃO lê o relógio", () => {
  it("`agora` é injetado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "DeclaradoService.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fonte).not.toMatch(/Date\.now\(/);
    expect(fonte).not.toMatch(/new Date\(\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A CRIAÇÃO
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("criarDeclarado", () => {
  const { criarDeclarado } = require("../DeclaradoService.js");

  const fakeCriacao = (opcoes = {}) => {
    const criados = [];
    return {
      criados,
      client: {
        lancamentoDeclarado: {
          create: jest.fn(async ({ data }) => {
            if (opcoes.duplicado) {
              const e = new Error("unique");
              e.code = "P2002";
              throw e;
            }
            criados.push(data);
            return { id: "d-novo", ...data };
          }),
          findFirst: jest.fn(async () => ({ id: "d-existente", estado: ESTADO.RECUSADO })),
        },
      },
    };
  };

  const base = (extra = {}) => ({
    portalClientId: "emp-1",
    origem: "NOTA_RECEBIDA",
    valor: 1500,
    competencia: "2026-07",
    descricaoOriginal: "  KODA BEAR  ",
    hashDedupe: "NOTA:pi-1",
    criadoPor: "worker",
    ...extra,
  });

  it("⚠⚠ SEM data de pagamento nasce AGUARDANDO_PAGAMENTO", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base(), client });
    expect(criados[0].estado).toBe(ESTADO.AGUARDANDO_PAGAMENTO);
    expect(criados[0].dataPagamento).toBeNull();
  });

  it("⚠⚠ COM data de pagamento nasce A_CONFERIR", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({
      ...base({ dataPagamento: PAGO_EM, origemPagamento: ORIGEM_PAGAMENTO.OFX }),
      client,
    });
    expect(criados[0].estado).toBe(ESTADO.A_CONFERIR);
  });

  it("⚠⚠ o ESTADO NÃO É PARÂMETRO — quem chama não pode forjar A_CONFERIR sem data", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base({ estado: ESTADO.CONTABILIZADO }), client });
    expect(criados[0].estado).toBe(ESTADO.AGUARDANDO_PAGAMENTO);
  });

  it("⚠ data de pagamento SEM procedência recusa — nem na criação prova vira declaração", async () => {
    const { client } = fakeCriacao();
    await expect(criarDeclarado({ ...base({ dataPagamento: PAGO_EM }), client })).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.PAGAMENTO_SEM_PROCEDENCIA,
    });
  });

  it("⚠ o ORIGINAL fica intocado; a normalizada é ÍNDICE", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base(), client });
    expect(criados[0].descricaoOriginal).toBe("KODA BEAR");
    expect(criados[0].descricaoNormalizada).toBe("koda bear");
  });

  it("⚠ o CNPJ do fornecedor é guardado só com dígitos", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base({ cnpjFornecedor: "12.345.678/0001-90" }), client });
    expect(criados[0].cnpjFornecedor).toBe("12345678000190");
  });

  it("⚠ competência NULA é preservada como nula — não se deduz o mês", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base({ competencia: null }), client });
    expect(criados[0].competencia).toBeNull();
  });

  it("⚠⚠ IDEMPOTENTE POR PULAR, NUNCA POR SOBRESCREVER", async () => {
    // Um `upsert` devolveria um RECUSADO ao início da fila a cada varredura, apagando a decisão do
    // contador. Aqui a linha existente volta INTACTA.
    const { client } = fakeCriacao({ duplicado: true });
    const r = await criarDeclarado({ ...base(), client });
    expect(r.jaExistia).toBe(true);
    expect(r.declarado.estado).toBe(ESTADO.RECUSADO);
    expect(client.lancamentoDeclarado.findFirst).toHaveBeenCalledWith({
      where: { portalClientId: "emp-1", hashDedupe: "NOTA:pi-1" },
    });
  });

  it("⚠ erro que NÃO é P2002 propaga — engoli-lo esconderia falha de banco", async () => {
    const client = {
      lancamentoDeclarado: {
        create: jest.fn(async () => { throw new Error("disco cheio"); }),
        findFirst: jest.fn(),
      },
    };
    await expect(criarDeclarado({ ...base(), client })).rejects.toThrow("disco cheio");
    expect(client.lancamentoDeclarado.findFirst).not.toHaveBeenCalled();
  });

  it("recusa o que falta, nomeando", async () => {
    const { client } = fakeCriacao();
    const casos = [
      [{ descricaoOriginal: "  " }, RECUSA_DO_SERVICO.SEM_DESCRICAO],
      [{ valor: 0 }, RECUSA_DO_SERVICO.SEM_VALOR],
      [{ valor: null }, RECUSA_DO_SERVICO.SEM_VALOR],
      [{ hashDedupe: "" }, RECUSA_DO_SERVICO.SEM_IDENTIDADE],
      [{ origem: "SEI_LA" }, RECUSA_DO_SERVICO.ORIGEM_INVALIDA],
    ];
    for (const [extra, codigo] of casos) {
      await expect(criarDeclarado({ ...base(extra), client })).rejects.toMatchObject({ codigo });
    }
  });

  it("⚠ sem `agora`, o default do banco responde — não se inventa carimbo", async () => {
    const { client, criados } = fakeCriacao();
    await criarDeclarado({ ...base(), client });
    expect(criados[0]).not.toHaveProperty("criadoEm");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// AS QUATRO LACUNAS QUE UMA REVISÃO DA TELA APONTOU
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ Cada uma custa "uma linha de backend agora, muito mais depois que a tela existir".

describe("⚠⚠ o RESUMO POR ESTADO", () => {
  const { COMPETENCIA_AUSENTE } = require("../DeclaradoService.js");

  it("conta cada estado, e estado sem linha vem ZERO — não ausente", async () => {
    // ⚠ Campo que só existe quando é diferente de zero obriga o consumidor a adivinhar o que a
    // ausência quer dizer. Mesma disciplina do `viradaDeMes` da auditoria de notas.
    const { client } = fazerClient(declaradoBase(), {
      porEstado: [
        { estado: ESTADO.AGUARDANDO_PAGAMENTO, _count: { _all: 229 } },
        { estado: ESTADO.A_CONFERIR, _count: { _all: 12 } },
      ],
    });
    const r = await listarFila({ portalClientId: "emp-1", client });
    expect(r.porEstado).toEqual({
      AGUARDANDO_PAGAMENTO: 229,
      A_CONFERIR: 12,
      CONTABILIZADO: 0,
      RECUSADO: 0,
      FUNDIDO: 0,
    });
  });

  it("⚠⚠ o resumo IGNORA o filtro de estado — senão ele só contaria a própria página filtrada", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", estados: [ESTADO.A_CONFERIR], client });
    const whereDoGroupBy = client.lancamentoDeclarado.groupBy.mock.calls[0][0].where;
    expect(whereDoGroupBy).not.toHaveProperty("estado");
    // ...mas a lista em si continua filtrada.
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where.estado).toEqual({
      in: [ESTADO.A_CONFERIR],
    });
  });

  it("⚠ o resumo RESPEITA a competência — ela é o recorte, não o filtro", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", competencia: "2026-07", estados: [ESTADO.A_CONFERIR], client });
    expect(client.lancamentoDeclarado.groupBy.mock.calls[0][0].where).toEqual({
      portalClientId: "emp-1",
      competencia: "2026-07",
    });
  });

  it("⚠ a contagem NÃO sai do tamanho da página", async () => {
    // Lista truncada como total mentiria exatamente na empresa em que o problema é grande.
    const { client } = fazerClient(declaradoBase(), {
      fila: [declaradoBase()],
      porEstado: [{ estado: ESTADO.A_CONFERIR, _count: { _all: 900 } }],
    });
    const r = await listarFila({ portalClientId: "emp-1", client });
    expect(r.porEstado.A_CONFERIR).toBe(900);
    expect(r.itens).toHaveLength(1);
  });
});

describe("⚠⚠ COMPETÊNCIA NULA — o recorte que a torna alcançável", () => {
  const { COMPETENCIA_AUSENTE } = require("../DeclaradoService.js");

  it("o recorte `sem-competencia` busca `competencia: null`", async () => {
    // ⚠ `where.competencia = "2026-07"` não casa com NULL em SQL: sem este recorte a nota que
    // chegou sem competência ficaria invisível PARA SEMPRE. É o defeito que a auditoria de notas
    // já pagou ("a consulta que fabricava buraco").
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", competencia: COMPETENCIA_AUSENTE, client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where.competencia).toBeNull();
  });

  it("⚠ e o RESUMO acompanha o mesmo recorte", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", competencia: COMPETENCIA_AUSENTE, client });
    expect(client.lancamentoDeclarado.groupBy.mock.calls[0][0].where.competencia).toBeNull();
  });

  it("competência normal continua sendo texto", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", competencia: "2026-07", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where.competencia).toBe("2026-07");
  });

  it("sem competência nenhuma, o recorte não entra no where", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where).not.toHaveProperty("competencia");
  });
});

describe("⚠⚠ O PRÉ-VOO DO MÊS FECHADO", () => {
  it("marca a linha cuja competência está fechada", async () => {
    const { client } = fazerClient(declaradoBase(), {
      fila: [declaradoBase({ id: "a", competencia: "2026-06" }), declaradoBase({ id: "b", competencia: "2026-07" })],
      fechadas: ["2026-06"],
    });
    const r = await listarFila({ portalClientId: "emp-1", client });
    expect(r.itens.map((d) => [d.id, d.mesFechado])).toEqual([["a", true], ["b", false]]);
  });

  it("⚠ UMA query para a página inteira, não uma por linha", async () => {
    // Uma tela de 50 linhas faria 50 chamadas a `isMonthClosed`.
    const { client, chamadas } = fazerClient(declaradoBase(), {
      fila: Array.from({ length: 10 }, (_, i) => declaradoBase({ id: `d${i}`, competencia: "2026-07" })),
    });
    await listarFila({ portalClientId: "emp-1", client });
    expect(chamadas.competenciasConsultadas).toHaveLength(1);
    expect(chamadas.competenciasConsultadas[0].competencia.in).toEqual(["2026-07"]);
  });

  it("⚠ linha SEM competência nunca é 'mês fechado' — não há mês a fechar", async () => {
    const { client } = fazerClient(declaradoBase(), {
      fila: [declaradoBase({ id: "sem", competencia: null })],
      fechadas: [],
    });
    const r = await listarFila({ portalClientId: "emp-1", client });
    expect(r.itens[0].mesFechado).toBe(false);
  });

  it("⚠⚠ é ANTECIPAÇÃO, não a guarda — quem recusa continua sendo `aplicarTransicao`", async () => {
    // O pré-voo lê o estado do momento da LISTAGEM; o mês pode fechar entre a tela e o clique.
    isMonthClosed.mockResolvedValue(true);
    const { client, chamadas } = fazerClient(declaradoBase());
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.MES_FECHADO,
    });
    expect(chamadas.create).toHaveLength(0);
  });
});

describe("⚠ o NÚMERO DA NOTA chega à fila", () => {
  it("o `include` traz número, série e chave", async () => {
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", client });
    const inc = client.lancamentoDeclarado.findMany.mock.calls[0][0].include;
    expect(inc.notaRecebida.select).toMatchObject({ numero: true, serie: true, chaveAcesso: true, type: true });
  });

  it("⚠ e os anexos continuam vindo — ainda que hoje sejam sempre vazios", async () => {
    // ⚠⚠ `AnexoDeclarado` NÃO TEM ESCRITOR: nenhuma rota, nenhum serviço. A tela NÃO pode oferecer
    // "anexar comprovante" — desenhar o botão prometeria um caminho que não existe.
    const { client } = fazerClient(declaradoBase());
    await listarFila({ portalClientId: "emp-1", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].include.anexos).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O CASAMENTO DÉBITO × NOTA
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("⚠⚠ FUNDIR — o débito DATA a nota, e some absorvido", () => {
  const { fundirPagamentoNaNota, sugestoesDePagamento } = require("../DeclaradoService.js");

  const debito = {
    id: "ofx-1",
    portalClientId: "emp-1",
    origem: "OFX_CLIENTE",
    estado: ESTADO.A_CONFERIR,
    valor: 1500,
    dataPagamento: PAGO_EM,
    origemPagamento: ORIGEM_PAGAMENTO.OFX,
    descricaoOriginal: "PAGTO GOOGLE CLOUD",
    ofxImportId: "imp-1",
    fitId: "F1",
    contaBancariaRef: "12345-6",
    // ⚠ Débito ainda não fundido — é a pré-condição que a escrita atômica confere.
    parDeclaradoId: null,
  };
  const notaAguardando = {
    id: "n-1",
    portalClientId: "emp-1",
    origem: "NOTA_RECEBIDA",
    estado: ESTADO.AGUARDANDO_PAGAMENTO,
    valor: 1500,
    dataDocumento: new Date("2026-07-15T00:00:00.000Z"),
    descricaoOriginal: "GOOGLE CLOUD BRASIL COMPUTACAO LTDA",
    cnpjFornecedor: "12345678000190",
    dataPagamento: null,
    origemPagamento: null,
  };

  function clientDaFusao(par = { debito, nota: notaAguardando }) {
    const updates = [];
    let transacoes = 0;
    // ⚠⚠ O DUBLÊ HONRA O `where` INTEIRO do `updateMany` — não só o id.
    //
    // A escrita passou a carregar o ESTADO (e `parDeclaradoId: null` no débito) como pré-condição,
    // porque a leitura acontece FORA da transação: sem isso, dois cliques concorrentes fundiam o
    // mesmo débito em DUAS notas. Um dublê que ignorasse o `where` deixaria essa proteção sem
    // prova nenhuma.
    const registros = new Map([
      [par.debito.id, { ...par.debito }],
      [par.nota.id, { ...par.nota }],
    ]);
    const tx = {
      lancamentoDeclarado: {
        updateMany: jest.fn(async ({ where, data }) => {
          const atual = registros.get(where.id);
          const casa =
            atual &&
            atual.portalClientId === where.portalClientId &&
            (where.estado === undefined || atual.estado === where.estado) &&
            (where.parDeclaradoId === undefined || (atual.parDeclaradoId ?? null) === where.parDeclaradoId);
          if (!casa) return { count: 0 };
          registros.set(where.id, { ...atual, ...data });
          updates.push({ id: where.id, data });
          return { count: 1 };
        }),
        findFirst: jest.fn(async ({ where }) => registros.get(where.id) ?? null),
      },
    };
    return {
      updates,
      contarTransacoes: () => transacoes,
      client: {
        lancamentoDeclarado: {
          // ⚠⚠ O DUBLÊ HONRA O `portalClientId` DO `where`. Casando só pelo id, ele deixaria passar
          // um vazamento real entre empresas — e o teste de escopo abaixo passaria sem provar nada.
          findFirst: jest.fn(async ({ where }) => {
            const achado = [par.debito, par.nota].find((d) => d.id === where.id) || null;
            return achado && achado.portalClientId === where.portalClientId ? achado : null;
          }),
          update: jest.fn(async () => {
            throw new Error("update FORA da transacao");
          }),
        },
        // ⚠ Sem `accountingEntry`: a fusão NÃO pode tocar no razão. Se algum dia tocar, estoura.
        $transaction: jest.fn(async (cb) => {
          transacoes += 1;
          return cb(tx);
        }),
      },
    };
  }

  const fundir = (client, extra = {}) =>
    fundirPagamentoNaNota({
      portalClientId: "emp-1",
      declaradoOfxId: "ofx-1",
      declaradoNotaId: "n-1",
      usuarioId: "u-1",
      agora: AGORA,
      client,
      ...extra,
    });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ A PROVA SUBSTITUI A DECLARAÇÃO — decisão do dono, 27/08/2026: *"a prova vence"*.
  //
  // A nota cujo pagamento o contador informou À MÃO está em `A_CONFERIR` com
  // `DECLARADO_PELO_CONTADOR`. Antes deste alargamento ela saía do conjunto de candidatas, o débito
  // do extrato que a pagou voltava "sem nota correspondente", e os dois viravam lançamento —
  // **despesa em dobro**, pela porta que este casamento existe para fechar.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  describe("⚠⚠ a nota com data DECLARADA à mão", () => {
    const notaDeclarada = {
      ...notaAguardando,
      estado: ESTADO.A_CONFERIR,
      dataPagamento: new Date("2026-07-16T00:00:00.000Z"),
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    };

    it("⚠⚠ a data do EXTRATO entra por cima, e a procedência vira PROVA", async () => {
      const { client, updates } = clientDaFusao({ debito, nota: notaDeclarada });
      await fundir(client);
      const naNota = updates.find((u) => u.id === "n-1");
      expect(naNota.data).toMatchObject({
        estado: ESTADO.A_CONFERIR,
        // ⚠ A data do débito, NÃO a que o contador tinha declarado.
        dataPagamento: PAGO_EM,
        origemPagamento: ORIGEM_PAGAMENTO.OFX,
        fitId: "F1",
      });
      expect(naNota.data.dataPagamento).not.toEqual(notaDeclarada.dataPagamento);
    });

    it("⚠ o débito é absorvido igual — nada muda do lado dele", async () => {
      const { client, updates } = clientDaFusao({ debito, nota: notaDeclarada });
      await fundir(client);
      expect(updates.find((u) => u.id === "ofx-1").data).toMatchObject({
        estado: ESTADO.FUNDIDO,
        parDeclaradoId: "n-1",
      });
    });

    it("⚠⚠ e NENHUM lançamento nasce — fundir continua não contabilizando", async () => {
      const { client } = clientDaFusao({ debito, nota: notaDeclarada });
      await fundir(client);
      expect(client.accountingEntry).toBeUndefined();
    });

    it("⚠⚠ a nota que JÁ TEM PROVA recusa — trocar uma evidência por outra é erro, não upgrade", async () => {
      // Ela já foi fundida com algum débito. Sobrescrever apagaria a evidência conferida e deixaria
      // o primeiro débito sem par, sem ninguém entender por quê.
      const jaProvada = { ...notaDeclarada, origemPagamento: ORIGEM_PAGAMENTO.OFX };
      const { client } = clientDaFusao({ debito, nota: jaProvada });
      await expect(fundir(client)).rejects.toMatchObject({ codigo: "pagamento_ja_provado" });
    });
  });

  it("⚠⚠ a NOTA recebe a data do pagamento e vai a A_CONFERIR", async () => {
    const { client, updates } = clientDaFusao();
    await fundir(client);
    const naNota = updates.find((u) => u.id === "n-1");
    expect(naNota.data).toMatchObject({
      estado: ESTADO.A_CONFERIR,
      dataPagamento: PAGO_EM,
      // ⚠ A PROVA viaja junto: a nota deixa de ser palpite porque o EXTRATO a datou.
      origemPagamento: ORIGEM_PAGAMENTO.OFX,
      fitId: "F1",
      contaBancariaRef: "12345-6",
      ofxImportId: "imp-1",
    });
  });

  it("⚠⚠ o DÉBITO vira FUNDIDO apontando para a nota", async () => {
    const { client, updates } = clientDaFusao();
    await fundir(client);
    const noDebito = updates.find((u) => u.id === "ofx-1");
    expect(noDebito.data).toMatchObject({ estado: ESTADO.FUNDIDO, parDeclaradoId: "n-1" });
  });

  it("⚠⚠ NENHUM LANÇAMENTO É CRIADO — fundir não é contabilizar", async () => {
    // O débito preenche o pagamento; quem leva ao razão continua sendo o contador, num segundo ato.
    const { client } = clientDaFusao();
    await fundir(client);
    expect(client.accountingEntry).toBeUndefined();
  });

  it("⚠⚠ AS DUAS ESCRITAS SÃO UM ATO", async () => {
    // Meio caminho deixaria o débito absorvido com a nota ainda esperando pagamento — a despesa
    // some da fila e ninguém a acha.
    const { client, updates, contarTransacoes } = clientDaFusao();
    await fundir(client);
    expect(contarTransacoes()).toBe(1);
    expect(updates).toHaveLength(2);
    expect(client.lancamentoDeclarado.update).not.toHaveBeenCalled();
  });

  it("⚠⚠ A REGRA É RECONFERIDA NO SERVIDOR — sugestão envelhecida é recusada", async () => {
    // A tela pode ter visto a sugestão minutos antes: o valor pode ter sido ajustado, a nota
    // recusada, outro débito fundido nela. Quem decide no instante do clique é o servidor.
    const { client, updates } = clientDaFusao({ debito, nota: { ...notaAguardando, valor: 999 } });
    await expect(fundir(client)).rejects.toMatchObject({ codigo: RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE });
    expect(updates).toHaveLength(0);
  });

  it("⚠ nota que NÃO está aguardando pagamento é recusada pela máquina de estados", async () => {
    const { client, updates } = clientDaFusao({
      debito,
      nota: { ...notaAguardando, estado: ESTADO.CONTABILIZADO },
    });
    await expect(fundir(client)).rejects.toBeInstanceOf(DeclaradoRecusado);
    expect(updates).toHaveLength(0);
  });

  it("⚠ declarado de OUTRA empresa não é encontrado", async () => {
    const { client } = clientDaFusao({ debito: { ...debito, portalClientId: "emp-2" }, nota: notaAguardando });
    await expect(fundir(client)).rejects.toMatchObject({ codigo: RECUSA_DO_SERVICO.NAO_ENCONTRADO });
  });

  it("quem decidiu e quando ficam gravados nos DOIS lados", async () => {
    const { client, updates } = clientDaFusao();
    await fundir(client);
    for (const u of updates) expect(u.data).toMatchObject({ decididoPor: "u-1", decididoEm: AGORA });
  });
});

describe("⚠ as SUGESTÕES — derivadas na leitura, nunca coluna", () => {
  const { sugestoesDePagamento } = require("../DeclaradoService.js");

  it("busca débitos A_CONFERIR sem par, e as notas que o débito pode estar pagando", async () => {
    const chamadas = [];
    const client = {
      lancamentoDeclarado: {
        findMany: jest.fn(async (args) => {
          chamadas.push(args.where);
          return [];
        }),
      },
    };
    await sugestoesDePagamento({ portalClientId: "emp-1", client });
    expect(chamadas[0]).toEqual({
      portalClientId: "emp-1",
      origem: "OFX_CLIENTE",
      estado: ESTADO.A_CONFERIR,
      parDeclaradoId: null,
    });
    // ⚠⚠ O CONJUNTO FOI ALARGADO — decisão do dono, 27/08/2026: *"a prova vence, alargue o
    // casamento"*. Só `AGUARDANDO_PAGAMENTO` era um BURACO: a nota cujo pagamento o contador
    // informou À MÃO vira `A_CONFERIR`, saía da lista, e o débito do extrato que a pagou voltava
    // "sem nota correspondente" — entrando no lote de contabilização como despesa sem nota. Os dois
    // viravam lançamento: **despesa em dobro**, pela porta que este casamento existe para fechar.
    expect(chamadas[1]).toEqual({
      portalClientId: "emp-1",
      // ⚠ Por EXCLUSÃO do extrato, não por inclusão de `NOTA_RECEBIDA`: o lançamento manual do
      // cliente também é uma despesa que um débito pode estar pagando.
      origem: { not: "OFX_CLIENTE" },
      estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR, ESTADO.CONTABILIZADO] },
    });
  });

  it("⚠⚠ débito já CONTABILIZADO fica de fora — sugerir fusão ali convidaria à contagem dupla", async () => {
    const client = { lancamentoDeclarado: { findMany: jest.fn(async () => []) } };
    await sugestoesDePagamento({ portalClientId: "emp-1", client });
    expect(client.lancamentoDeclarado.findMany.mock.calls[0][0].where.estado).toBe(ESTADO.A_CONFERIR);
  });

  it("⚠ é SÓ LEITURA — nenhum método de escrita existe no client", async () => {
    const client = { lancamentoDeclarado: { findMany: jest.fn(async () => []) } };
    const r = await sugestoesDePagamento({ portalClientId: "emp-1", client });
    expect(r).toMatchObject({ totalDebitos: 0, totalNotas: 0 });
    expect(client.lancamentoDeclarado.update).toBeUndefined();
    expect(client.$transaction).toBeUndefined();
  });
});

describe("⚠⚠ OS DOIS BUGS DA FUSÃO ACHADOS POR AUDITORIA (25/08/2026)", () => {
  const { fundirPagamentoNaNota } = require("../DeclaradoService.js");

  const debitoOfx = (extra = {}) => ({
    id: "ofx-1", portalClientId: "emp-1", origem: "OFX_CLIENTE", estado: ESTADO.A_CONFERIR,
    valor: 1500, dataPagamento: PAGO_EM, origemPagamento: ORIGEM_PAGAMENTO.OFX,
    descricaoOriginal: "PAGTO GOOGLE CLOUD", ofxImportId: "imp-1", fitId: "F1",
    contaBancariaRef: "12345-6", parDeclaradoId: null, ...extra,
  });
  const notaRecebida = (extra = {}) => ({
    id: "n-1", portalClientId: "emp-1", origem: "NOTA_RECEBIDA", estado: ESTADO.AGUARDANDO_PAGAMENTO,
    valor: 1500, dataDocumento: new Date("2026-07-15T00:00:00.000Z"),
    descricaoOriginal: "GOOGLE CLOUD BRASIL COMPUTACAO LTDA", cnpjFornecedor: "12345678000190",
    dataPagamento: null, origemPagamento: null, parDeclaradoId: null, ...extra,
  });

  /** Um dublê que HONRA o `where` do `updateMany` — sem isso a proteção não teria prova. */
  function clientReal(registros) {
    const mapa = new Map(registros.map((r) => [r.id, { ...r }]));
    const tx = {
      lancamentoDeclarado: {
        updateMany: jest.fn(async ({ where, data }) => {
          const atual = mapa.get(where.id);
          const casa =
            atual &&
            atual.portalClientId === where.portalClientId &&
            (where.estado === undefined || atual.estado === where.estado) &&
            (where.parDeclaradoId === undefined || (atual.parDeclaradoId ?? null) === where.parDeclaradoId);
          if (!casa) return { count: 0 };
          mapa.set(where.id, { ...atual, ...data });
          return { count: 1 };
        }),
        findFirst: jest.fn(async ({ where }) => mapa.get(where.id) ?? null),
      },
    };
    return {
      mapa,
      client: {
        lancamentoDeclarado: {
          findFirst: jest.fn(async ({ where }) => {
            const r = mapa.get(where.id);
            return r && r.portalClientId === where.portalClientId ? r : null;
          }),
        },
        $transaction: jest.fn(async (cb) => cb(tx)),
      },
    };
  }

  const fundir = (client, ofx, nota) =>
    fundirPagamentoNaNota({
      portalClientId: "emp-1", declaradoOfxId: ofx, declaradoNotaId: nota,
      usuarioId: "u-1", agora: AGORA, client,
    });

  it("sequencialmente, a segunda fusão do mesmo débito já era recusada pela máquina de estados", async () => {
    const { client, mapa } = clientReal([debitoOfx(), notaRecebida({ id: "n-1" }), notaRecebida({ id: "n-2" })]);
    await fundir(client, "ofx-1", "n-1");
    // ⚠ Aqui o débito já está FUNDIDO, e `podeTransitar` o pega antes de qualquer escrita.
    await expect(fundir(client, "ofx-1", "n-2")).rejects.toMatchObject({
      codigo: RECUSA.TRANSICAO_INVALIDA_NESTE_ESTADO,
    });
    expect([...mapa.values()].filter((r) => r.fitId === "F1" && r.origem === "NOTA_RECEBIDA")).toHaveLength(1);
  });

  it("⚠⚠ NA CORRIDA — dois requests que LERAM ANTES — o segundo não paga a segunda nota", async () => {
    // ⚠⚠ ESTE É O BUG QUE A AUDITORIA PROVOU, e a recusa sequencial acima NÃO o cobria: a leitura
    // e a reconferência acontecem FORA da transação. Dois cliques simultâneos liam ambos o débito
    // em `A_CONFERIR`, passavam pela máquina de estados, e ambos escreviam — deixando DUAS notas
    // com o mesmo `fitId` e a mesma data, as duas podendo virar lançamento. O caixa creditado
    // DUAS VEZES pela mesma saída, em silêncio.
    //
    // O dublê congela a LEITURA no estado original (é o que os dois requests concorrentes veem) e
    // deixa a ESCRITA enxergar o estado real — que é exatamente a assimetria do Postgres.
    const { client, mapa } = clientReal([debitoOfx(), notaRecebida({ id: "n-1" }), notaRecebida({ id: "n-2" })]);
    const leituraCongelada = new Map([...mapa.entries()].map(([k, v]) => [k, { ...v }]));
    client.lancamentoDeclarado.findFirst = jest.fn(async ({ where }) => {
      const r = leituraCongelada.get(where.id);
      return r && r.portalClientId === where.portalClientId ? r : null;
    });

    await fundir(client, "ofx-1", "n-1");
    // ⚠ O segundo request "não sabe" que o primeiro já aconteceu — e mesmo assim é barrado, pelo
    // `count` do `updateMany`.
    await expect(fundir(client, "ofx-1", "n-2")).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE,
    });

    const pagasPeloMesmoDebito = [...mapa.values()].filter((r) => r.fitId === "F1" && r.origem === "NOTA_RECEBIDA");
    expect(pagasPeloMesmoDebito).toHaveLength(1);
    expect(mapa.get("n-2").dataPagamento).toBeNull();
  });

  it("⚠⚠ UMA NOTA NÃO É FUNDIDA DENTRO DE OUTRA NOTA — a despesa sumiria", async () => {
    // Provado em auditoria: `FUNDIR` sai de `A_CONFERIR`, e uma nota datada à mão está aí. O
    // resultado era a despesa de fevereiro DESAPARECENDO dentro da de janeiro.
    const jan = notaRecebida({
      id: "nf-jan", estado: ESTADO.A_CONFERIR, dataPagamento: PAGO_EM,
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    });
    const fev = notaRecebida({
      id: "nf-fev", estado: ESTADO.A_CONFERIR, dataPagamento: PAGO_EM,
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    });
    const { client, mapa } = clientReal([jan, fev]);

    await expect(fundir(client, "nf-fev", "nf-jan")).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE,
    });
    // ⚠ NADA sumiu: a despesa de fevereiro continua viva.
    expect(mapa.get("nf-fev").estado).toBe(ESTADO.A_CONFERIR);
  });

  it("⚠ e o lado direito não pode ser um débito de extrato", async () => {
    const { client } = clientReal([debitoOfx({ id: "ofx-1" }), debitoOfx({ id: "ofx-2" })]);
    await expect(fundir(client, "ofx-1", "ofx-2")).rejects.toMatchObject({
      codigo: RECUSA_DO_SERVICO.CASAMENTO_NAO_CONFERE,
    });
  });

  it("o caminho normal continua funcionando", async () => {
    const { client, mapa } = clientReal([debitoOfx(), notaRecebida()]);
    await fundir(client, "ofx-1", "n-1");
    expect(mapa.get("n-1")).toMatchObject({ estado: ESTADO.A_CONFERIR, fitId: "F1", origemPagamento: ORIGEM_PAGAMENTO.OFX });
    expect(mapa.get("ofx-1")).toMatchObject({ estado: ESTADO.FUNDIDO, parDeclaradoId: "n-1" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O EXTRATO CORRIGE A DATA QUE A REGRA PRESUMIU (29/08/2026) — a fusão LIGADA.
//
// A nota nasceu contabilizada sozinha, na data fixa que a regra do fornecedor configurou; ninguém
// viu o dinheiro sair naquele dia. Quando o débito REAL chega, ele diz o dia certo.
//
// ⚠⚠ O QUE MAIS IMPORTA AQUI É A NÃO-CRIAÇÃO: a despesa já está no razão, e um segundo
// `AccountingEntry` seria a contagem dupla pela porta dos fundos. É por isso que o dublê deste
// bloco TEM `accountingEntry` — e conta as chamadas de `create`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ FUNDIR sobre nota de DATA PRESUMIDA — corrige, e não cria um segundo lançamento", () => {
  const { fundirPagamentoNaNota } = require("../DeclaradoService.js");
  const { LEITURA_DA_CANDIDATA, lerCandidata } = require("../lib/estadosDeclarado.js");

  const DIA_REAL = new Date("2026-07-22T00:00:00.000Z");

  const debito = {
    id: "ofx-9",
    portalClientId: "emp-1",
    origem: "OFX_CLIENTE",
    estado: ESTADO.A_CONFERIR,
    valor: 1500,
    dataPagamento: DIA_REAL,
    origemPagamento: ORIGEM_PAGAMENTO.OFX,
    descricaoOriginal: "PAGTO ALESSANDRO NIGRO",
    ofxImportId: "imp-9",
    fitId: "F9",
    contaBancariaRef: "12345-6",
    parDeclaradoId: null,
  };

  const notaPresumida = (extra = {}) => ({
    id: "n-9",
    portalClientId: "emp-1",
    origem: "NOTA_RECEBIDA",
    estado: ESTADO.CONTABILIZADO,
    competencia: "2026-07",
    valor: 1500,
    dataDocumento: new Date("2026-07-02T00:00:00.000Z"),
    descricaoOriginal: "ALESSANDRO NIGRO",
    cnpjFornecedor: "12345678000190",
    // ⚠ O dia 15 é a data FIXA da regra — presunção, nunca prova.
    dataPagamento: new Date("2026-07-15T00:00:00.000Z"),
    origemPagamento: ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
    contaAplicada: "411020008",
    accountingEntryId: "ae-9",
    ...extra,
  });

  function montar(nota = notaPresumida()) {
    const registros = new Map([[debito.id, { ...debito }], [nota.id, { ...nota }]]);
    const entradas = [];
    const criados = jest.fn();
    const tx = {
      lancamentoDeclarado: {
        updateMany: jest.fn(async ({ where, data }) => {
          const atual = registros.get(where.id);
          const casa = atual
            && atual.portalClientId === where.portalClientId
            && (where.estado === undefined || atual.estado === where.estado)
            && (where.parDeclaradoId === undefined || (atual.parDeclaradoId ?? null) === where.parDeclaradoId);
          if (!casa) return { count: 0 };
          registros.set(where.id, { ...atual, ...data });
          return { count: 1 };
        }),
        findFirst: jest.fn(async ({ where }) => registros.get(where.id) ?? null),
      },
      accountingEntry: {
        updateMany: jest.fn(async ({ where, data }) => {
          entradas.push({ where, data });
          return { count: 1 };
        }),
        create: criados,
      },
    };
    return {
      registros,
      entradas,
      criados,
      client: {
        lancamentoDeclarado: {
          findFirst: jest.fn(async ({ where }) => {
            const achado = [registros.get(debito.id), registros.get(nota.id)].find((d) => d.id === where.id) || null;
            return achado && achado.portalClientId === where.portalClientId ? achado : null;
          }),
          update: jest.fn(async () => { throw new Error("update FORA da transacao"); }),
        },
        $transaction: jest.fn(async (cb) => cb(tx)),
      },
    };
  }

  const fundir = (client) => fundirPagamentoNaNota({
    portalClientId: "emp-1",
    declaradoOfxId: "ofx-9",
    declaradoNotaId: "n-9",
    usuarioId: "u-1",
    agora: AGORA,
    client,
  });

  beforeEach(() => { isMonthClosed.mockResolvedValue(false); });

  it("⚠⚠ a nota de data presumida É FUSÍVEL — a leitura da candidata diz isso à tela", () => {
    const r = lerCandidata(notaPresumida());
    expect(r.leitura).toBe(LEITURA_DA_CANDIDATA.DATA_PRESUMIDA);
    expect(r.podeFundir).toBe(true);
  });

  it("⚠⚠ a nota que uma PESSOA contabilizou continua NÃO sendo fusível", () => {
    // A distinção é a ORIGEM, por igualdade exata. Com `!ehProvaDePagamento`, a data que o contador
    // declarou seria sobrescrita em silêncio por este caminho.
    const r = lerCandidata(notaPresumida({ origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR }));
    expect(r.leitura).toBe(LEITURA_DA_CANDIDATA.JA_CONTABILIZADA);
    expect(r.podeFundir).toBe(false);
  });

  it("a data do declarado passa a ser a do extrato, e a procedência deixa de ser presunção", async () => {
    const m = montar();
    await fundir(m.client);

    expect(m.registros.get("n-9")).toMatchObject({
      estado: ESTADO.CONTABILIZADO,
      dataPagamento: DIA_REAL,
      origemPagamento: ORIGEM_PAGAMENTO.OFX,
    });
    expect(m.registros.get("ofx-9")).toMatchObject({ estado: ESTADO.FUNDIDO, parDeclaradoId: "n-9" });
  });

  it("⚠⚠ o `AccountingEntry` que EXISTE é atualizado, e NENHUM é criado", async () => {
    const m = montar();
    await fundir(m.client);

    expect(m.criados).not.toHaveBeenCalled();
    expect(m.entradas).toHaveLength(1);
    expect(m.entradas[0].where).toMatchObject({ id: "ae-9", portalClientId: "emp-1" });
  });

  it("⚠⚠ SÓ A DATA muda no lançamento — valor, contas e histórico não são tocados", async () => {
    // O extrato prova QUANDO o dinheiro saiu, nunca quanto nem de onde.
    const m = montar();
    await fundir(m.client);

    expect(Object.keys(m.entradas[0].data)).toEqual(["data"]);
    expect(m.entradas[0].data.data).toEqual(DIA_REAL);
  });

  it("⚠ a correção acontece DENTRO da mesma transação que muda o declarado", async () => {
    const m = montar();
    await fundir(m.client);
    expect(m.client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("⚠⚠ MÊS FECHADO recusa — mudar a data de lançamento já conferido é escrever sem rastro", async () => {
    isMonthClosed.mockResolvedValue(true);
    const m = montar();

    await expect(fundir(m.client)).rejects.toMatchObject({ codigo: RECUSA_DO_SERVICO.MES_FECHADO });
    // ⚠ E nada foi escrito: a recusa é antes da transação.
    expect(m.client.$transaction).not.toHaveBeenCalled();
    expect(m.entradas).toHaveLength(0);
  });

  it("⚠ lançamento apagado por fora não derruba a fusão — o declarado se acerta assim mesmo", async () => {
    // Não há FK, de propósito. Um `update` pelo id estouraria P2025, o débito voltaria à fila e
    // seria contabilizado à parte — que é a contagem dupla.
    const m = montar(notaPresumida({ accountingEntryId: null }));
    await fundir(m.client);

    expect(m.entradas).toHaveLength(0);
    expect(m.registros.get("n-9")).toMatchObject({ dataPagamento: DIA_REAL });
  });
});
