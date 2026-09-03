// ⚠⚠ A CLASSIFICAÇÃO POR IA — a LIGAÇÃO (02/09/2026).
//
// A regra pura tem teste em `lib/__tests__/classificacaoPorIa.test.js`. O que se prende AQUI é o
// que o serviço faz com o banco e com a guarda: que ele NUNCA escreva `contaAplicada`/`estado`, que
// NÃO toque em linha com sugestão de regra/histórico, que a guarda recusando ⇒ NADA é chamado nem
// gravado, que erro do modelo vira relatório (e a chamada é registrada), e que a flag OFF recusa
// no SERVIDOR. Cada trava medida por NÃO-CHAMADA.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

const mockListarFila = jest.fn();
jest.mock("../DeclaradoService.js", () => ({
  listarFila: (...a) => mockListarFila(...a),
}));

const mockPlano = jest.fn();
const mockMemoria = jest.fn();
jest.mock("../RegraService.js", () => ({
  planoDaEmpresa: (...a) => mockPlano(...a),
  memoriaDaEmpresa: (...a) => mockMemoria(...a),
}));

// ⚠ O SDK da Anthropic não deve nem ser carregado no teste: o serviço recebe `cliente` injetado.
jest.mock("../../assistente/AssistenteClient.js", () => ({
  AssistenteClient: jest.fn(() => { throw new Error("não deveria construir o cliente real no teste"); }),
  traduzirErro: (err) => ({ codigo: err?.codigo || "IA_DESCONHECIDO", message: String(err?.message || "") }),
}));

jest.mock("../../assistente/GuardaIaService.js", () => ({
  FINALIDADE_IA: { CLASSIFICACAO_LANCAMENTOS: "classificacao_lancamentos" },
  autorizarChamadaIa: jest.fn(),
  concluirChamadaIa: jest.fn(),
}));

import { classificarFila, RECUSA_CLASSIFICACAO } from "../ClassificacaoPorIaService.js";
import { ESTADO } from "../lib/estadosDeclarado.js";
import { PROCEDENCIA } from "../lib/motorDeSugestao.js";
import { LOTE_MAXIMO, MOTIVO_RECUSA } from "../lib/classificacaoPorIa.js";

const AGORA = new Date("2026-09-02T15:00:00.000Z");

const PLANO = [
  { codigo: "403", codigoCompleto: "411020008", nome: "Serviços de terceiros", analitica: true },
  { codigo: "410", codigoCompleto: "411030012", nome: "Software e nuvem", analitica: true },
  { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ", analitica: true },
  { codigo: "12", codigoCompleto: "111020001", nome: "BANCO ITAU", analitica: true },
  { codigo: "300", codigoCompleto: "211010001", nome: "Fornecedores", analitica: true },
];

const linha = (extra = {}) => ({
  id: "d-1",
  estado: ESTADO.AGUARDANDO_PAGAMENTO,
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  cnpjFornecedor: "06990590000123",
  valor: "890.00",
  competencia: "2026-07",
  sugestao: null,
  ...extra,
});

function prismaFalso() {
  const chamadas = [];
  return {
    chamadas,
    lancamentoDeclarado: {
      updateMany: jest.fn(async (args) => { chamadas.push(args); return { count: 1 }; }),
    },
  };
}

function guardaFalsa({ ok = true } = {}) {
  return {
    autorizar: jest.fn(async () => (ok ? { ok: true, contexto: { finalidade: "classificacao_lancamentos", inicio: 1 } } : { ok: false, motivo: "teto_empresa", mensagem: "teto" })),
    concluir: jest.fn(async () => ({})),
  };
}

const respostaBoa = (propostas) => ({
  texto: JSON.stringify({ propostas }),
  usage: { input_tokens: 1000, output_tokens: 200 },
  iteracoes: 1,
  stopReason: "end_turn",
  recusou: false,
});

function clienteFalso(respostas) {
  const fila = [...respostas];
  return { responder: jest.fn(async () => { const r = fila.shift(); if (r instanceof Error) throw r; return r; }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlano.mockResolvedValue(PLANO);
  mockMemoria.mockResolvedValue([{ text: "GOOGLE CLOUD", contaDebito: "410", contaCredito: "12", usageCount: 2 }]);
});

const fila = (itens) => mockListarFila.mockResolvedValue({ itens, total: itens.length, pagina: 1, porPagina: 200, porEstado: {} });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a flag é do SERVIDOR", () => {
  it("desligada ⇒ recusa nomeada, e NADA é lido nem chamado", async () => {
    const client = prismaFalso();
    const guarda = guardaFalsa();
    const cliente = clienteFalso([]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: false, client, cliente, guarda, agora: AGORA });
    expect(r.ok).toBe(false);
    expect(r.recusa).toBe(RECUSA_CLASSIFICACAO.DESLIGADA);
    expect(mockListarFila).not.toHaveBeenCalled();
    expect(guarda.autorizar).not.toHaveBeenCalled();
    expect(cliente.responder).not.toHaveBeenCalled();
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ quem vai — regra > histórico > IA", () => {
  it("fila só com linhas que já têm sugestão ⇒ `semLinhas`, e o modelo NÃO é chamado", async () => {
    fila([
      linha({ id: "a", sugestao: { conta: "411020008", procedencia: PROCEDENCIA.REGRA_CNPJ } }),
      linha({ id: "b", sugestao: { conta: "411030012", procedencia: PROCEDENCIA.HISTORICO } }),
    ]);
    const client = prismaFalso();
    const guarda = guardaFalsa();
    const cliente = clienteFalso([]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda, agora: AGORA });
    expect(r).toMatchObject({ ok: true, semLinhas: true, linhasOlhadas: 2, linhasEnviadas: 0, lotes: 0 });
    expect(guarda.autorizar).not.toHaveBeenCalled();
    expect(cliente.responder).not.toHaveBeenCalled();
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
    // ⚠ e nem o plano é buscado — não há o que perguntar
    expect(mockPlano).not.toHaveBeenCalled();
  });

  it("⚠⚠ só a linha SEM sugestão vai ao modelo; a que tem regra não aparece no pedido", async () => {
    fila([
      linha({ id: "com-regra", descricaoOriginal: "KODA BEAR", sugestao: { conta: "411020008", procedencia: PROCEDENCIA.REGRA_CNPJ } }),
      linha({ id: "sem-nada", descricaoOriginal: "GOOGLE CLOUD BRASIL" }),
    ]);
    const client = prismaFalso();
    const guarda = guardaFalsa();
    const cliente = clienteFalso([respostaBoa([{ id: "sem-nada", debito: "411030012", credito: null, justificativa: "nuvem" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda, agora: AGORA });
    expect(r.linhasEnviadas).toBe(1);
    const conteudo = cliente.responder.mock.calls[0][0].messages[0].content;
    expect(conteudo).toContain('"id":"sem-nada"');
    expect(conteudo).not.toContain('"id":"com-regra"');
    expect(conteudo).not.toContain("KODA BEAR");
  });

  it("a fila é lida com os estados LANÇÁVEIS e a competência pedida", async () => {
    fila([]);
    await classificarFila({ portalClientId: "emp-1", competencia: "2026-07", ligado: true, client: prismaFalso(), cliente: clienteFalso([]), guarda: guardaFalsa(), agora: AGORA });
    expect(mockListarFila).toHaveBeenCalledWith(expect.objectContaining({
      portalClientId: "emp-1",
      competencia: "2026-07",
      estados: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR],
      porPagina: 200,
    }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠⚠ o que é GRAVADO — colunas próprias, e só elas", () => {
  it("grava débito, crédito, justificativa, modelo e o carimbo — e NUNCA contaAplicada/contaCredito/estado", async () => {
    fila([linha({ id: "d-1" })]);
    const client = prismaFalso();
    const cliente = clienteFalso([respostaBoa([{ id: "d-1", debito: "411030012", credito: "111020001", justificativa: "nuvem = software" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda: guardaFalsa(), agora: AGORA });

    expect(r).toMatchObject({ ok: true, propostas: 1, gravadas: 1, recusadas: [], lotes: 1 });
    expect(client.chamadas).toHaveLength(1);
    const [{ where, data }] = client.chamadas;
    expect(data).toEqual({
      contaSugeridaIa: "411030012",
      creditoSugeridoIa: "111020001",
      justificativaIa: "nuvem = software",
      sugeridaIaModelo: expect.any(String),
      sugeridaIaEm: AGORA,
    });
    // ⚠⚠ as chaves do ATO não podem aparecer no `data`, nem como `undefined`
    for (const proibida of ["contaAplicada", "contaCredito", "estado", "contaSugerida", "accountingEntryId", "dataPagamento"]) {
      expect(Object.prototype.hasOwnProperty.call(data, proibida)).toBe(false);
    }
    // ⚠ e o `where` leva escopo + estado lançável — a linha lançada entre a leitura e a escrita não é tocada
    expect(where).toEqual({ id: "d-1", portalClientId: "emp-1", estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR] } });
  });

  it("⚠⚠ conta inventada pelo modelo NÃO é gravada — volta em `recusadas` com motivo", async () => {
    fila([linha({ id: "d-1" }), linha({ id: "d-2" })]);
    const client = prismaFalso();
    const cliente = clienteFalso([respostaBoa([
      { id: "d-1", debito: "499999999", credito: null, justificativa: "inventada" },
      { id: "d-2", debito: "411020008", credito: "211010001", justificativa: "crédito em fornecedores" },
    ])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda: guardaFalsa(), agora: AGORA });
    expect(r.propostas).toBe(0);
    expect(r.gravadas).toBe(0);
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
    expect(r.recusadas.map((x) => x.motivo)).toEqual([MOTIVO_RECUSA.CONTA_FORA_DO_PLANO, MOTIVO_RECUSA.CREDITO_NAO_E_DISPONIBILIDADE]);
  });

  it("`gravadas` conta o que o banco confirmou, não o que foi proposto", async () => {
    fila([linha({ id: "d-1" })]);
    const client = prismaFalso();
    client.lancamentoDeclarado.updateMany.mockResolvedValue({ count: 0 }); // a linha foi lançada no meio
    const cliente = clienteFalso([respostaBoa([{ id: "d-1", debito: "411030012" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda: guardaFalsa(), agora: AGORA });
    expect(r.propostas).toBe(1);
    expect(r.gravadas).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a guarda — falha fechado", () => {
  it("guarda recusa ⇒ modelo NÃO é chamado, nada gravado, relatório diz o motivo", async () => {
    fila([linha({ id: "d-1" })]);
    const client = prismaFalso();
    const guarda = guardaFalsa({ ok: false });
    const cliente = clienteFalso([respostaBoa([{ id: "d-1", debito: "411030012" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda, agora: AGORA });
    expect(cliente.responder).not.toHaveBeenCalled();
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
    expect(r.recusadaPelaGuarda).toMatchObject({ motivo: "teto_empresa", mensagem: "teto", apartirDoLote: 1 });
    expect(r.lotes).toBe(0);
    expect(r.ok).toBe(true); // a fila não caiu — a IA é que não rodou
  });

  it("a guarda é chamada com a FINALIDADE e a empresa", async () => {
    fila([linha({ id: "d-1" })]);
    const guarda = guardaFalsa();
    await classificarFila({ portalClientId: "emp-1", ligado: true, client: prismaFalso(), cliente: clienteFalso([respostaBoa([])]), guarda, agora: AGORA });
    expect(guarda.autorizar).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "emp-1", finalidade: "classificacao_lancamentos" }));
  });

  it("⚠ a chamada é CONCLUÍDA (registrada) quando dá certo — com o usage", async () => {
    fila([linha({ id: "d-1" })]);
    const guarda = guardaFalsa();
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client: prismaFalso(), cliente: clienteFalso([respostaBoa([{ id: "d-1", debito: "411030012" }])]), guarda, agora: AGORA });
    expect(guarda.concluir).toHaveBeenCalledTimes(1);
    expect(guarda.concluir.mock.calls[0][1]).toMatchObject({ usage: { input_tokens: 1000, output_tokens: 200 } });
    expect(r.custoEstimadoCentavos).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ erro do modelo NÃO derruba a fila", () => {
  it("exceção do modelo ⇒ relatório com o erro, chamada registrada com `erroCodigo`, nada gravado", async () => {
    fila([linha({ id: "d-1" })]);
    const client = prismaFalso();
    const guarda = guardaFalsa();
    const erro = Object.assign(new Error("boom"), { codigo: "IA_CONEXAO" });
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente: clienteFalso([erro]), guarda, agora: AGORA });
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([{ lote: 1, codigo: "IA_CONEXAO", mensagem: "boom" }]);
    expect(guarda.concluir).toHaveBeenCalledTimes(1);
    expect(guarda.concluir.mock.calls[0][1]).toMatchObject({ erroCodigo: "IA_CONEXAO" });
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
  });

  it("resposta ilegível ⇒ `ilegiveis` conta, nada gravado, e é OUTRA coisa que `semLinhas`", async () => {
    fila([linha({ id: "d-1" })]);
    const client = prismaFalso();
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente: clienteFalso([{ ...respostaBoa([]), texto: "não sei classificar" }]), guarda: guardaFalsa(), agora: AGORA });
    expect(r.ilegiveis).toBe(1);
    expect(r.semLinhas).toBe(false);
    expect(r.erros[0].codigo).toBe("resposta_ilegivel");
    expect(client.lancamentoDeclarado.updateMany).not.toHaveBeenCalled();
  });

  it("o modelo recusando (`recusou: true`) vira erro nomeado do lote", async () => {
    fila([linha({ id: "d-1" })]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client: prismaFalso(), cliente: clienteFalso([{ ...respostaBoa([]), recusou: true }]), guarda: guardaFalsa(), agora: AGORA });
    expect(r.erros[0].codigo).toBe("recusou");
    expect(r.gravadas).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("os lotes", () => {
  it(`mais de ${LOTE_MAXIMO} linhas ⇒ mais de um lote, cada um com a própria autorização`, async () => {
    const itens = Array.from({ length: LOTE_MAXIMO + 5 }, (_, i) => linha({ id: `d-${i}` }));
    fila(itens);
    const guarda = guardaFalsa();
    const cliente = clienteFalso([respostaBoa([{ id: "d-0", debito: "411030012" }]), respostaBoa([{ id: `d-${LOTE_MAXIMO}`, debito: "411020008" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client: prismaFalso(), cliente, guarda, agora: AGORA });
    expect(r.lotes).toBe(2);
    expect(r.linhasEnviadas).toBe(LOTE_MAXIMO + 5);
    expect(guarda.autorizar).toHaveBeenCalledTimes(2);
    expect(guarda.concluir).toHaveBeenCalledTimes(2);
    expect(r.propostas).toBe(2);
  });

  it("a guarda recusando no SEGUNDO lote guarda o que o primeiro gravou e diz de onde parou", async () => {
    const itens = Array.from({ length: LOTE_MAXIMO + 1 }, (_, i) => linha({ id: `d-${i}` }));
    fila(itens);
    const guarda = {
      autorizar: jest.fn()
        .mockResolvedValueOnce({ ok: true, contexto: {} })
        .mockResolvedValueOnce({ ok: false, motivo: "teto_escritorio", mensagem: "teto" }),
      concluir: jest.fn(async () => ({})),
    };
    const client = prismaFalso();
    const cliente = clienteFalso([respostaBoa([{ id: "d-0", debito: "411030012" }])]);
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client, cliente, guarda, agora: AGORA });
    expect(r.gravadas).toBe(1);
    expect(r.lotes).toBe(1);
    expect(r.recusadaPelaGuarda).toMatchObject({ motivo: "teto_escritorio", apartirDoLote: 2 });
    expect(cliente.responder).toHaveBeenCalledTimes(1);
  });

  it("a fila é paginada até o total", async () => {
    const pagina1 = Array.from({ length: 200 }, (_, i) => linha({ id: `p1-${i}` }));
    const pagina2 = Array.from({ length: 10 }, (_, i) => linha({ id: `p2-${i}` }));
    mockListarFila
      .mockResolvedValueOnce({ itens: pagina1, total: 210, pagina: 1, porPagina: 200 })
      .mockResolvedValueOnce({ itens: pagina2, total: 210, pagina: 2, porPagina: 200 });
    const cliente = clienteFalso(Array.from({ length: 6 }, () => respostaBoa([])));
    const r = await classificarFila({ portalClientId: "emp-1", ligado: true, client: prismaFalso(), cliente, guarda: guardaFalsa(), agora: AGORA });
    expect(mockListarFila).toHaveBeenCalledTimes(2);
    expect(r.linhasOlhadas).toBe(210);
    expect(r.lotes).toBe(Math.ceil(210 / LOTE_MAXIMO));
  });
});
