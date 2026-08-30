// ⚠⚠ O LANÇAMENTO QUE NASCE SEM NINGUÉM CLICAR — o "nível 1" (29/08/2026).
//
// > Dono: *"todo mês que essa nota aparecer ela já é lançada em despesa."*
//
// ⚠⚠ O QUE ESTE ARQUIVO PROTEGE É O QUE `motorDeSugestao.js` ESCREVEU ANTES DE ISTO EXISTIR: *"um
// lançamento contábil nascido sozinho, numa conta errada, erra EM SÉRIE e em silêncio — e o dono é
// contador."* Os testes que mais importam aqui são os de NÃO-CHAMADA: com a flag desligada, com a
// regra não marcada, ou com o valor fora da faixa, **`aplicarTransicao` não pode ser chamada**.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

const mockAplicar = jest.fn();
jest.mock("../DeclaradoService.js", () => ({
  aplicarTransicao: (...a) => mockAplicar(...a),
}));

import {
  FORA_DO_AUTOMATICO,
  dataPresumida,
  desfazerLancadosPorRegra,
  extratoDeLancadosPorRegra,
  lancarPorRegra,
  lancarPorRegraNaEmpresa,
  podeLancarSozinho,
} from "../LancamentoPorRegraService.js";
import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "../lib/estadosDeclarado.js";

const AGORA = new Date("2026-08-29T12:00:00.000Z");

const declarado = (extra = {}) => ({
  id: "d-1",
  estado: ESTADO.AGUARDANDO_PAGAMENTO,
  cnpjFornecedor: "12345678000190",
  valor: "1200.00",
  valorAjustado: null,
  competencia: "2026-08",
  ...extra,
});

const regra = (extra = {}) => ({
  id: "r-1",
  cnpjFornecedor: "12345678000190",
  ativa: true,
  suspensaEm: null,
  lancaSozinha: true,
  diaDoLancamento: 15,
  valorMin: "1000.00",
  valorMax: "1500.00",
  contaDestino: "411030012",
  contaCredito: "111010001",
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAplicar.mockResolvedValue({ id: "d-1", estado: ESTADO.CONTABILIZADO });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS TRÊS TRAVAS — e cada uma é medida por NÃO-CHAMADA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ com a FLAG DESLIGADA, `AccountingEntry` NÃO é criado", () => {
  it("⚠⚠ `aplicarTransicao` não é chamada — nem com a regra `lancaSozinha` e a nota na faixa", async () => {
    // É o teste que prova que quem recusa é o SERVIDOR, e não a tela. Um `curl` bate aqui.
    const r = await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra()], agora: AGORA, ligado: false,
    });
    expect(r.lancou).toBe(false);
    expect(r.motivo).toBe(FORA_DO_AUTOMATICO.DESLIGADO);
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("⚠ e a recusa é NOMEADA — 'desligado' não pode se disfarçar de 'não achei regra'", async () => {
    const v = podeLancarSozinho({ declarado: declarado(), regras: [regra()], ligado: false });
    expect(v.frase).toMatch(/desligado/i);
  });
});

describe("⚠⚠ a regra tem de estar marcada para lançar — fornecedor a fornecedor", () => {
  it("`lancaSozinha: false` não lança, e a nota fica na fila com o motivo", async () => {
    const r = await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra({ lancaSozinha: false })],
      agora: AGORA, ligado: true,
    });
    expect(r.lancou).toBe(false);
    expect(r.motivo).toBe(FORA_DO_AUTOMATICO.REGRA_NAO_LANCA);
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("⚠ regra suspensa ou inativa também não", async () => {
    for (const over of [{ ativa: false }, { suspensaEm: AGORA }]) {
      const v = podeLancarSozinho({ declarado: declarado(), regras: [regra(over)], ligado: true });
      expect(v.pode).toBe(false);
      expect(v.motivo).toBe(FORA_DO_AUTOMATICO.SEM_REGRA);
    }
  });
});

describe("⚠⚠ FORA DA FAIXA a nota CAI NA FILA — nunca lança e nunca some", () => {
  it("valor acima do máximo não lança, e o motivo diz que existe regra", async () => {
    const r = await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado({ valor: "1800.00" }), regras: [regra()],
      agora: AGORA, ligado: true,
    });
    expect(r.lancou).toBe(false);
    expect(r.motivo).toBe(FORA_DO_AUTOMATICO.FORA_DA_FAIXA);
    expect(r.frase).toMatch(/continua na fila/i);
    // ⚠ A regra volta junto: é ela que a tela mostra ao dizer "parecido com a regra X".
    expect(r.regra.id).toBe("r-1");
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("⚠ o valor AJUSTADO vence o original — é o que o contador corrigiu", async () => {
    const v = podeLancarSozinho({
      declarado: declarado({ valor: "9999.00", valorAjustado: "1200.00" }),
      regras: [regra()], ligado: true,
    });
    expect(v.pode).toBe(true);
  });

  it("⚠⚠ SEM VALOR não lança — 'não sei quanto é' nunca vira 'pode lançar'", () => {
    const v = podeLancarSozinho({
      declarado: declarado({ valor: null, valorAjustado: null }), regras: [regra()], ligado: true,
    });
    expect(v.pode).toBe(false);
  });

  it("⚠ as bordas da faixa PASSAM — mínimo e máximo são inclusivos", () => {
    for (const valor of ["1000.00", "1500.00"]) {
      expect(podeLancarSozinho({ declarado: declarado({ valor }), regras: [regra()], ligado: true }).pode).toBe(true);
    }
  });
});

describe("⚠⚠ a ÂNCORA aqui é só o CNPJ", () => {
  it("sem CNPJ no declarado não há regra que sirva", () => {
    // A âncora de DESCRIÇÃO *se parece*; não identifica — e o que está em jogo é um lançamento sem
    // clique. O motor de SUGESTÃO usa as duas porque lá o contador confere.
    const v = podeLancarSozinho({
      declarado: declarado({ cnpjFornecedor: null }), regras: [regra({ cnpjFornecedor: null, padraoDescricao: "X" })],
      ligado: true,
    });
    expect(v.pode).toBe(false);
    expect(v.motivo).toBe(FORA_DO_AUTOMATICO.SEM_REGRA);
  });

  it("⚠ a comparação é por DÍGITOS — a máscara não separa o mesmo fornecedor", () => {
    const v = podeLancarSozinho({
      declarado: declarado({ cnpjFornecedor: "12.345.678/0001-90" }), regras: [regra()], ligado: true,
    });
    expect(v.pode).toBe(true);
  });
});

describe("⚠⚠ o ESTADO decide, e RECUSADO não ressuscita", () => {
  it.each([ESTADO.CONTABILIZADO, ESTADO.RECUSADO])("%s não lança", (estado) => {
    // `CONTABILIZADO` já está no razão; `RECUSADO` foi uma decisão do contador, e ressuscitá-lo por
    // regra desfaria essa decisão.
    const v = podeLancarSozinho({ declarado: declarado({ estado }), regras: [regra()], ligado: true });
    expect(v.pode).toBe(false);
    expect(v.motivo).toBe(FORA_DO_AUTOMATICO.ESTADO_NAO_PERMITE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A DATA PRESUMIDA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ dataPresumida", () => {
  it("o dia configurado, na competência da nota", () => {
    // ⚠⚠ Um `Date`, não uma string: `ehData` da máquina de estados exige `instanceof Date`, e a
    // primeira versão devolvia texto — o lançamento seria recusado com `data_de_pagamento_invalida`
    // e a automação nunca lançaria nada. Foi o teste da transição que pegou.
    expect(dataPresumida("2026-08", 15)).toEqual(new Date(Date.UTC(2026, 7, 15)));
  });

  it("⚠⚠ dia 31 em fevereiro vira o ÚLTIMO dia do mês — nunca o 1º do mês seguinte", () => {
    // A competência do lançamento tem de continuar sendo a da nota, senão a despesa migraria de mês
    // sozinha — e o fechamento do mês passaria a discordar do razão.
    expect(dataPresumida("2026-02", 31)).toEqual(new Date(Date.UTC(2026, 1, 28)));
    expect(dataPresumida("2024-02", 31)).toEqual(new Date(Date.UTC(2024, 1, 29)));
    expect(dataPresumida("2026-04", 31)).toEqual(new Date(Date.UTC(2026, 3, 30)));
  });

  it("⚠ competência ou dia tortos devolvem `null` — a data não se inventa", () => {
    expect(dataPresumida("2026", 15)).toBeNull();
    expect(dataPresumida("2026-08", 0)).toBeNull();
    expect(dataPresumida("2026-08", 32)).toBeNull();
    expect(dataPresumida("2026-08", null)).toBeNull();
  });

  it("⚠⚠ SEM DIA a regra NÃO lança — a data não se arbitra", async () => {
    const r = await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra({ diaDoLancamento: null })],
      agora: AGORA, ligado: true,
    });
    expect(r.lancou).toBe(false);
    expect(r.motivo).toBe(FORA_DO_AUTOMATICO.SEM_DIA);
    expect(mockAplicar).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ QUANDO ELE LANÇA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o lançamento automático", () => {
  it("chama `aplicarTransicao(CONFIRMAR)` — não reescreve a contabilização", async () => {
    // Uma segunda contabilização aqui divergiria da primeira na correção seguinte, e a divergência
    // sairia como lançamento errado no razão.
    const r = await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra()], agora: AGORA, ligado: true,
    });
    expect(r.lancou).toBe(true);
    const arg = mockAplicar.mock.calls[0][0];
    expect(arg.transicao).toBe(TRANSICAO.CONFIRMAR);
    expect(arg.declaradoId).toBe("d-1");
  });

  it("⚠⚠ a origem é PRESUMIDO_POR_REGRA — declaração, nunca prova", async () => {
    await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra()], agora: AGORA, ligado: true,
    });
    expect(mockAplicar.mock.calls[0][0].dados.origemPagamento).toBe(ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA);
  });

  it("⚠ a conta e o crédito da REGRA viajam", async () => {
    await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra()], agora: AGORA, ligado: true,
    });
    const { dados } = mockAplicar.mock.calls[0][0];
    expect(dados.contaAplicada).toBe("411030012");
    expect(dados.contaCredito).toBe("111010001");
    expect(dados.dataPagamento).toEqual(new Date(Date.UTC(2026, 7, 15)));
    expect(dados.regraId).toBe("r-1");
  });

  it("⚠ crédito ausente NÃO vira string vazia — o caminho de hoje (o caixa) segue", async () => {
    await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra({ contaCredito: null })],
      agora: AGORA, ligado: true,
    });
    expect(mockAplicar.mock.calls[0][0].dados.contaCredito).toBeUndefined();
  });

  it("⚠⚠ `usuarioId` NOMEIA A AUTOMAÇÃO — nunca o id de uma pessoa", async () => {
    // Atribuí-lo ao contador diria que ele praticou um ato que não praticou naquele mês.
    await lancarPorRegra({
      portalClientId: "emp-1", declarado: declarado(), regras: [regra()], agora: AGORA, ligado: true,
    });
    expect(mockAplicar.mock.calls[0][0].usuarioId).toBe("regra_automatica");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O EXTRATO — o pré-requisito que o próprio `motorDeSugestao.js` nomeou.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ extratoDeLancadosPorRegra", () => {
  const clienteCom = (linhas) => ({
    lancamentoDeclarado: { findMany: jest.fn(async () => linhas) },
  });

  it("⚠⚠ o critério é a ORIGEM, nunca o `regraId`", async () => {
    // Um lançamento que o contador confirmou À MÃO sobre uma nota com regra também tem `regraId`, e
    // ele não nasceu sozinho. Confundir os dois faria o extrato oferecer "desfazer" sobre o trabalho
    // dele.
    const client = clienteCom([]);
    await extratoDeLancadosPorRegra({ portalClientId: "emp-1", competencia: "2026-08", client });
    const where = client.lancamentoDeclarado.findMany.mock.calls[0][0].where;
    expect(where.origemPagamento).toBe(ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA);
    expect(where.estado).toBe(ESTADO.CONTABILIZADO);
    expect(where).not.toHaveProperty("regraId");
  });

  it("⚠ a soma é a DO EXTRATO — é o número que se confere contra o razão", async () => {
    const client = clienteCom([
      { id: "d-1", valor: "1200.00", valorAjustado: null },
      { id: "d-2", valor: "900.00", valorAjustado: "1000.00" },
    ]);
    const r = await extratoDeLancadosPorRegra({ portalClientId: "emp-1", competencia: "2026-08", client });
    expect(r.total).toBe(2);
    // ⚠ O ajustado vence: é o valor que virou lançamento.
    expect(r.valor).toBe(2200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O DESFAZER EM LOTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ desfazerLancadosPorRegra", () => {
  it("desfaz UM A UM, por dentro da máquina de estados", async () => {
    // Nada de `deleteMany` nem de SQL cru: um caminho próprio deixaria lançamento órfão no razão.
    const r = await desfazerLancadosPorRegra({
      portalClientId: "emp-1", ids: ["d-1", "d-2"], usuarioId: "u-1", agora: AGORA,
    });
    expect(r.desfeitos).toBe(2);
    expect(mockAplicar).toHaveBeenCalledTimes(2);
    expect(mockAplicar.mock.calls[0][0].transicao).toBe(TRANSICAO.DESFAZER);
  });

  it("⚠⚠ o que FALHA volta NOMEADO, e o lote NÃO PARA", async () => {
    // Uma linha em mês fechado não pode impedir o contador de desfazer as outras vinte; e um lote
    // que só dissesse "desfiz 19" faria a vigésima sumir sem ninguém saber por quê.
    mockAplicar
      .mockResolvedValueOnce({ id: "d-1" })
      .mockRejectedValueOnce(Object.assign(new Error("x"), { codigo: "mes_fechado", frase: "O mês está fechado." }))
      .mockResolvedValueOnce({ id: "d-3" });
    const r = await desfazerLancadosPorRegra({
      portalClientId: "emp-1", ids: ["d-1", "d-2", "d-3"], usuarioId: "u-1", agora: AGORA,
    });
    expect(r.desfeitos).toBe(2);
    expect(r.recusados).toEqual([{ id: "d-2", motivo: "mes_fechado", frase: "O mês está fechado." }]);
  });

  it("⚠ ids repetidos são deduplicados — desfazer duas vezes o mesmo é uma recusa inútil", async () => {
    const r = await desfazerLancadosPorRegra({
      portalClientId: "emp-1", ids: ["d-1", "d-1", " ", null], usuarioId: "u-1", agora: AGORA,
    });
    expect(r.pedidos).toBe(1);
    expect(mockAplicar).toHaveBeenCalledTimes(1);
  });

  it("⚠ lista vazia não chama nada", async () => {
    const r = await desfazerLancadosPorRegra({ portalClientId: "emp-1", ids: [], usuarioId: "u-1", agora: AGORA });
    expect(r.pedidos).toBe(0);
    expect(mockAplicar).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a varredura da fonte", () => {
  it("não há `deleteMany`, SQL cru nem uma segunda contabilização", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "LancamentoPorRegraService.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(fonte).not.toMatch(/deleteMany|\$executeRaw|\$queryRaw/);
    // ⚠⚠ Ele NÃO cria `AccountingEntry` por conta própria: quem faz isso é `aplicarTransicao`.
    expect(fonte).not.toMatch(/accountingEntry\.(create|delete)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O LAÇO — o CHAMADOR que faltava (29/08/2026).
//
// Até aqui `lancarPorRegra` existia e **nada a invocava**: a automação estava construída e
// inalcançável. Estes testes protegem o que o ligamento não pode ter trazido junto — varrer a fila
// com a flag desligada, deixar uma linha ruim parar o lote, ou chamar a decisão duas vezes.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ `lancarPorRegraNaEmpresa` — o laço da varredura", () => {
  const clienteCom = ({ regras = [regra()], linhas = [declarado()] } = {}) => ({
    regraContabilizacao: { findMany: jest.fn(async () => regras) },
    lancamentoDeclarado: { findMany: jest.fn(async () => linhas) },
  });

  it("⚠⚠ com a FLAG DESLIGADA não consulta o banco — e não lança nada", async () => {
    // ⚠ A não-consulta é o ponto: varrer a fila inteira para ouvir "desligado" 200 vezes seria
    // custo puro, e mediria a intenção em vez do efeito.
    const client = clienteCom();
    const r = await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: false });

    expect(r.lancados).toBe(0);
    expect(r.desligado).toBe(true);
    expect(client.regraContabilizacao.findMany).not.toHaveBeenCalled();
    expect(client.lancamentoDeclarado.findMany).not.toHaveBeenCalled();
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("lança a linha que passa nas três travas, e devolve o id", async () => {
    const client = clienteCom();
    const r = await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    expect(r.lancados).toBe(1);
    expect(r.ids).toEqual(["d-1"]);
    expect(mockAplicar).toHaveBeenCalledTimes(1);
    expect(mockAplicar.mock.calls[0][0].transicao).toBe(TRANSICAO.CONFIRMAR);
    expect(mockAplicar.mock.calls[0][0].dados.origemPagamento).toBe(ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA);
  });

  it("⚠ só pergunta pelas regras que LANÇAM — a consulta já nasce estreita", async () => {
    const client = clienteCom();
    await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    const where = client.regraContabilizacao.findMany.mock.calls[0][0].where;
    expect(where.lancaSozinha).toBe(true);
    expect(where.ativa).toBe(true);
    expect(where.portalClientId).toBe("emp-1");
  });

  it("⚠⚠ os candidatos são só `AGUARDANDO_PAGAMENTO` e `A_CONFERIR`", async () => {
    // `CONTABILIZADO` já está no razão; `RECUSADO` foi decisão do contador, e ressuscitá-lo por
    // regra desfaria essa decisão.
    const client = clienteCom();
    await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    const where = client.lancamentoDeclarado.findMany.mock.calls[0][0].where;
    expect(where.estado.in).toEqual([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR]);
    expect(where.estado.in).not.toContain(ESTADO.CONTABILIZADO);
    expect(where.estado.in).not.toContain(ESTADO.RECUSADO);
  });

  it("⚠ sem regra marcada, para antes de decidir linha nenhuma", async () => {
    const client = clienteCom({ regras: [] });
    const r = await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    expect(r.semRegraLancadora).toBe(true);
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("⚠⚠ a linha FORA DA FAIXA fica na fila — e NÃO conta como recusa", async () => {
    // Ela não é um erro: é o desfecho certo. Chamá-la de recusa encheria o relatório de linhas
    // normais e esconderia as de verdade.
    const client = clienteCom({ linhas: [declarado({ valor: "9000.00" })] });
    const r = await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    expect(r.lancados).toBe(0);
    expect(r.recusados).toEqual([]);
    expect(mockAplicar).not.toHaveBeenCalled();
  });

  it("⚠⚠ uma linha que FALHA não para o lote, e volta NOMEADA", async () => {
    const linhas = [declarado({ id: "d-1" }), declarado({ id: "d-2" }), declarado({ id: "d-3" })];
    mockAplicar
      .mockResolvedValueOnce({ id: "d-1" })
      .mockRejectedValueOnce(Object.assign(new Error("x"), { codigo: "mes_fechado", frase: "Mês fechado." }))
      .mockResolvedValueOnce({ id: "d-3" });

    const client = clienteCom({ linhas });
    const r = await lancarPorRegraNaEmpresa({ portalClientId: "emp-1", agora: AGORA, client, ligado: true });

    expect(r.lancados).toBe(2);
    expect(r.ids).toEqual(["d-1", "d-3"]);
    expect(r.recusados).toEqual([{ declaradoId: "d-2", codigo: "mes_fechado", motivo: "Mês fechado." }]);
  });

  it("⚠ SEQUENCIAL — nada de `Promise.all` sobre linhas que criam lançamento contábil", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "LancamentoPorRegraService.js"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export async function lancarPorRegraNaEmpresa"));
    expect(corpo).not.toMatch(/Promise\.all\(\s*candidatos/);
    expect(corpo).toMatch(/for \(const declarado of candidatos\)/);
  });
});
