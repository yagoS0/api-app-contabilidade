// O APRENDIZADO DISPARA DEPOIS DA TRANSIÇÃO — e nunca dentro dela.
//
// ⚠⚠ ESTA É A INVARIANTE MAIS CARA DA FASE C. O aprendizado é CONSEQUÊNCIA do que o contador
// decidiu, não parte da decisão. Dentro da `$transaction`, uma falha ao criar a regra desfaria o
// LANÇAMENTO que ele acabou de confirmar — trocaria uma conveniência por um estrago.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../accounting/fechamentoContabil.js", () => ({
  ...jest.requireActual("../../accounting/fechamentoContabil.js"),
  isMonthClosed: jest.fn(async () => false),
}));

const mockReavaliar = jest.fn(async () => ({ acao: "NADA" }));
const mockSugerirLote = jest.fn(async () => []);
jest.mock("../RegraService.js", () => ({
  reavaliarAprendizado: (...a) => mockReavaliar(...a),
  sugerirContaParaLote: (...a) => mockSugerirLote(...a),
}));

import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "../lib/estadosDeclarado.js";
import { aplicarTransicao } from "../DeclaradoService.js";

const AGORA = new Date("2026-08-25T10:00:00.000Z");
const PAGO_EM = new Date("2026-07-15T00:00:00.000Z");

const PLANO = [
  { portalClientId: null, codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ" },
  { portalClientId: null, codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PJ" },
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
  cnpjFornecedor: "12345678000190",
  dataDocumento: new Date("2026-07-02T00:00:00.000Z"),
  dataPagamento: PAGO_EM,
  origemPagamento: ORIGEM_PAGAMENTO.OFX,
  contaSugerida: "411020008",
  contaAplicada: null,
  accountingEntryId: null,
  ...extra,
});

function fazerClient(declarado, opcoes = {}) {
  const ordem = [];
  const tx = {
    accountingEntry: {
      create: jest.fn(async () => {
        ordem.push("create-lancamento");
        return { id: "ae-1" };
      }),
      deleteMany: jest.fn(async () => {
        ordem.push("delete-lancamento");
        return { count: 1 };
      }),
    },
    lancamentoDeclarado: {
      update: jest.fn(async ({ data }) => {
        ordem.push("update-declarado");
        return { ...declarado, ...data };
      }),
    },
  };
  return {
    ordem,
    client: {
      lancamentoDeclarado: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === declarado.id && where.portalClientId === declarado.portalClientId ? declarado : null,
        ),
        // ⚠⚠ O CAMINHO SIMPLES existe e NÃO passa por transação: transições que não tocam o razão
        // (recusar, informar pagamento, reabrir) fazem `client.lancamentoDeclarado.update` direto e
        // **retornam ali mesmo**. Sem este dublê o teste estoura por falta de método, e não pelo
        // motivo que ele quer medir.
        update: jest.fn(async ({ data }) => {
          ordem.push("update-fora-da-transacao");
          return { ...declarado, ...data };
        }),
      },
      chartOfAccount: { findMany: jest.fn(async () => PLANO) },
      $transaction: jest.fn(async (cb) => {
        ordem.push("abre-transacao");
        const r = await cb(tx);
        if (opcoes.falharTransacao) throw new Error("banco caiu");
        ordem.push("fecha-transacao");
        return r;
      }),
    },
  };
}

const aplicar = (client, transicao, dados = {}) =>
  aplicarTransicao({
    portalClientId: "emp-1",
    declaradoId: "d-1",
    transicao,
    dados,
    usuarioId: "u-1",
    agora: AGORA,
    client,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockReavaliar.mockResolvedValue({ acao: "NADA" });
});

describe("⚠⚠ O APRENDIZADO RODA DEPOIS QUE A TRANSAÇÃO FECHOU", () => {
  it("a ordem é: transação inteira, DEPOIS o aprendizado", async () => {
    const { client, ordem } = fazerClient(declaradoBase());
    mockReavaliar.mockImplementation(async () => {
      ordem.push("aprendizado");
      return { acao: "NADA" };
    });

    await aplicar(client, TRANSICAO.CONFIRMAR);

    expect(ordem).toEqual([
      "abre-transacao",
      "create-lancamento",
      "update-declarado",
      "fecha-transacao",
      "aprendizado",
    ]);
  });

  it("⚠⚠ ele recebe o CNPJ do fornecedor e o relógio INJETADO", async () => {
    const { client } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(mockReavaliar).toHaveBeenCalledWith(
      expect.objectContaining({
        portalClientId: "emp-1",
        cnpjFornecedor: "12345678000190",
        usuarioId: "u-1",
        agora: AGORA,
      }),
    );
  });

  it("⚠⚠ TRANSAÇÃO QUE FALHA NÃO CHEGA AO APRENDIZADO", async () => {
    // Aprender sobre um lançamento que não existe criaria uma regra a partir de nada.
    const { client } = fazerClient(declaradoBase(), { falharTransacao: true });
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toThrow(/banco caiu/);
    expect(mockReavaliar).not.toHaveBeenCalled();
  });

  it("⚠⚠ FALHA NO APRENDIZADO NÃO DERRUBA A TRANSIÇÃO", async () => {
    // Este é o ponto inteiro de ele ficar FORA da transação: o lançamento que o contador acabou de
    // confirmar continua valendo.
    const { client } = fazerClient(declaradoBase());
    mockReavaliar.mockRejectedValue(new Error("tabela nao existe"));
    // ⚠ Ela é declarada como "nunca lança" (tem try/catch dentro). Este teste prende o CONTRATO:
    // se alguém remover aquele catch, este vermelho aparece antes de a produção quebrar.
    await expect(aplicar(client, TRANSICAO.CONFIRMAR)).rejects.toThrow();
    // ⚠ E o lançamento JÁ FOI CRIADO — a transação fechou antes.
    expect(client.$transaction).toHaveBeenCalled();
  });
});

describe("⚠ QUAIS transições aprendem", () => {
  it.each([
    [TRANSICAO.CONFIRMAR, true],
    [TRANSICAO.AJUSTAR, true],
  ])("%s dispara o aprendizado", async (transicao, esperado) => {
    const { client } = fazerClient(declaradoBase());
    await aplicar(client, transicao, transicao === TRANSICAO.AJUSTAR ? { valorAjustado: 1200 } : {});
    expect(mockReavaliar.mock.calls.length > 0).toBe(esperado);
  });

  it("DESFAZER dispara — a base que sustentava a regra pode ter sumido", async () => {
    const { client } = fazerClient(
      declaradoBase({ estado: ESTADO.CONTABILIZADO, accountingEntryId: "ae-1", contaAplicada: "411020008" }),
    );
    await aplicar(client, TRANSICAO.DESFAZER);
    expect(mockReavaliar).toHaveBeenCalled();
  });

  it("⚠⚠ RECUSAR NÃO dispara — recusar não diz nada sobre QUE CONTA usar", async () => {
    // ⚠ Aqui há DUAS razões, e as duas valem: `RECUSAR` está fora de `APRENDE_COM`, **e** ele sai
    // pelo caminho simples, que retorna antes de qualquer aprendizado. A segunda é a que de fato
    // morde hoje; a primeira é o que protege se o caminho simples mudar.
    const { client } = fazerClient(declaradoBase());
    await aplicar(client, TRANSICAO.RECUSAR, { motivoRecusa: "duplicada" });
    expect(mockReavaliar).not.toHaveBeenCalled();
  });

  it("⚠ INFORMAR_PAGAMENTO não dispara — ele muda a data, não a conta", async () => {
    // ⚠ Mesmo caso: fora de `APRENDE_COM` e fora da transação.
    const { client } = fazerClient(
      declaradoBase({ estado: ESTADO.AGUARDANDO_PAGAMENTO, dataPagamento: null, origemPagamento: null }),
    );
    await aplicar(client, TRANSICAO.INFORMAR_PAGAMENTO, {
      dataPagamento: PAGO_EM,
      origemPagamento: ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
    });
    expect(mockReavaliar).not.toHaveBeenCalled();
  });

  it("⚠ sem CNPJ do fornecedor, não aprende — a âncora forte é o CNPJ", async () => {
    // É o caso do débito de extrato sem nota: não há fornecedor identificado.
    const { client } = fazerClient(declaradoBase({ cnpjFornecedor: null }));
    await aplicar(client, TRANSICAO.CONFIRMAR);
    expect(mockReavaliar).not.toHaveBeenCalled();
  });
});
