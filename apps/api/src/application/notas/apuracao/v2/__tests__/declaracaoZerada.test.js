// A EMPRESA SEM FATURAMENTO — o que acontece ANTES de gastar a chamada paga ao SERPRO.
//
// O defeito real (produção, 10/08/2026, PHAOS CONSULTORIA LTDA, competência sem uma única nota):
// o modal abriu com UMA atividade de R$ 0,00 — o backend a deriva do CNAE mesmo sem receita, só
// pra trazer o anexo —, o botão Calcular ficou ativo, e cada clique virou chamada PAGA que a RFB
// recusou com "SN-Entregar: O valor da atividade deve ser maior que zero." Duas vezes seguidas.
//
// A guarda perguntava pelo COMPRIMENTO da lista (`atividades.length === 0`), e o payload que sai
// daqui pergunta pela SOMA (`buildDeclaracaoPayload` descarta a linha de valor 0). Enquanto as
// duas discordassem, a empresa zerada com uma linha de R$ 0,00 escapava de TODA a verificação
// anti-zero — inclusive da que impede declarar zerado quem tem nota emitida.
//
// O que estes testes travam: a soma é que decide, e nada chega ao SERPRO sem passar por ela.

jest.mock("../../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    // `findMany` porque o [Calcular] voltou a gravar a segregação por tipo do mês em vez de zerá-la
    // (`receitaPorTipoMercado`) — sem notas, ela é `{}`, que é o correto para o mês vazio.
    portalInvoice: { aggregate: jest.fn(async () => ({ _sum: { total: 0 } })), findMany: jest.fn(async () => []) },
    portalClient: { findUnique: jest.fn(async () => ({ cnpj: "58546710000100" })) },
    apuracaoSnapshot: { findUnique: jest.fn(async () => null), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
  },
}));

const mockSimular = jest.fn();
jest.mock("../../../../fiscal/serpro/PgdasSimulacaoService.js", () => ({
  PgdasSimulacaoService: jest.fn().mockImplementation(() => ({ simular: mockSimular })),
  parseRetornoSimulacao: jest.fn(),
}));
jest.mock("../../../../fiscal/serpro/SerproPgdasdService.js", () => ({ SerproPgdasdService: jest.fn() }));
jest.mock("../../../../fiscal/serpro/SerproRuntimeSettings.js", () => ({
  getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { hasCertificate: true, document: "11111111111111" } })),
}));
jest.mock("../RbtExtratoService.js", () => ({
  getRbt12: jest.fn(async () => ({ rbt12: 0, origem: "teste", detalhePorMes: [] })),
  lerPeriodosAceitos: jest.fn(async () => null),
  gravarPeriodosAceitos: jest.fn(async () => null),
}));
jest.mock("../ApuracaoConfigMemoryService.js", () => ({
  lerConfigMemory: jest.fn(async () => null),
  salvarConfigMemory: jest.fn(async () => null),
}));
jest.mock("../AtividadeResolver.js", () => ({ montarAtividadesDefault: jest.fn(), carregarAtividades: jest.fn() }));
jest.mock("../DisparidadeService.js", () => ({ detectarDisparidades: jest.fn(async () => []) }));
jest.mock("../FolhaDerivadaService.js", () => ({ derivarFolha12m: jest.fn(async () => null) }));

import { prisma } from "../../../../../infrastructure/db/prisma.js";
import { calcularFechamento, traduzirRecusaDeclaracaoZerada } from "../FechamentoService.js";

const BASE = { portalClientId: "p1", competencia: "2026-07" };
// A linha que o CNAE produz numa empresa sem faturamento: atividade real, valor zero.
const ATIVIDADE_ZERADA = [{ idAtividade: 11, valorInterno: 0, valorExterno: 0, sujeitoFatorR: true }];
const RECUSA_RFB = "SN-Entregar: O valor da atividade deve ser maior que zero.";

function comFaturamento(valor) {
  prisma.portalInvoice.aggregate.mockResolvedValue({ _sum: { total: valor } });
}

beforeEach(() => {
  jest.clearAllMocks();
  comFaturamento(0);
  mockSimular.mockResolvedValue({ dasValor: 0, rbt12: null, mensagens: [], raw: {} });
});

describe("calcularFechamento — a declaração zerada é decidida pela SOMA", () => {
  it("⚠ atividade de R$ 0,00 sem marcar 'sem movimento' NÃO vai ao SERPRO", async () => {
    // Era exatamente este clique que virava chamada paga: lista com 1 item, soma 0, sem intenção
    // declarada. Agora recusa aqui, e a mensagem diz as duas saídas.
    await expect(calcularFechamento({ ...BASE, atividades: ATIVIDADE_ZERADA }))
      .rejects.toMatchObject({ code: "NO_ATIVIDADES" });
    expect(mockSimular).not.toHaveBeenCalled();
  });

  it("lista vazia sem 'sem movimento' continua recusada, e também sem gastar chamada", async () => {
    await expect(calcularFechamento({ ...BASE, atividades: [] }))
      .rejects.toMatchObject({ code: "NO_ATIVIDADES" });
    expect(mockSimular).not.toHaveBeenCalled();
  });

  it("⚠ A TRAVA ANTI-ZERO ALCANÇA A LINHA DE R$ 0,00 — e antes do SERPRO", async () => {
    // Este é o caso que escapava por completo: com faturamento na competência e uma atividade
    // zerada, a guarda do comprimento não disparava e a recusa só vinha DEPOIS de pagar.
    comFaturamento(23076.26);
    await expect(calcularFechamento({ ...BASE, atividades: ATIVIDADE_ZERADA, semMovimento: true }))
      .rejects.toMatchObject({ code: "SEM_MOVIMENTO_COM_FATURAMENTO", faturamento: 23076.26 });
    expect(mockSimular).not.toHaveBeenCalled();
  });

  it("sem faturamento e com 'sem movimento' marcado, a chamada SAI — e vai como declaração zerada", async () => {
    // A recusa é da Receita, não nossa: o caminho continua aberto, com `permitirSemMovimento`.
    await calcularFechamento({ ...BASE, atividades: ATIVIDADE_ZERADA, semMovimento: true });
    expect(mockSimular).toHaveBeenCalledTimes(1);
    expect(mockSimular.mock.calls[0][0]).toMatchObject({ permitirSemMovimento: true });
  });

  it("⚠ COM faturamento e SEM marcar a caixa: APURACAO_ZERADA_COM_FATURAMENTO, não o convite genérico", async () => {
    // A guarda anti-zero da Q55 morava DEPOIS da simulação. Com a decisão pela soma, aquela posição
    // ficou inalcançável (soma 0 lança antes; soma > 0 não satisfaz a condição) — cinto que não
    // aperta. Subiu para o gate, e este teste é o que impede que ela volte a virar letra morta.
    //
    // ⚠ E a mensagem importa: dizer "marque Declarar SEM MOVIMENTO" a quem TEM nota aponta para uma
    // ação que a trava seguinte recusa.
    comFaturamento(23076.26);
    await expect(calcularFechamento({ ...BASE, atividades: ATIVIDADE_ZERADA }))
      .rejects.toMatchObject({ code: "APURACAO_ZERADA_COM_FATURAMENTO", faturamento: 23076.26 });
    expect(mockSimular).not.toHaveBeenCalled();
  });

  it("a recusa por faturamento não sugere declarar sem movimento", async () => {
    comFaturamento(23076.26);
    const err = await calcularFechamento({ ...BASE, atividades: ATIVIDADE_ZERADA }).catch((e) => e);
    expect(err.message).not.toMatch(/SEM MOVIMENTO/i);
    expect(err.message).toContain("23076.26");
  });

  it("atividade COM valor não é tratada como zerada", async () => {
    await calcularFechamento({ ...BASE, atividades: [{ idAtividade: 11, valorInterno: 1000, valorExterno: 0 }] });
    expect(mockSimular).toHaveBeenCalledTimes(1);
    expect(mockSimular.mock.calls[0][0]).toMatchObject({ permitirSemMovimento: false });
  });
});

describe("traduzirRecusaDeclaracaoZerada", () => {
  it("a frase da RFB é CITADA, não reescrita — e ganha o contexto que falta", () => {
    const out = traduzirRecusaDeclaracaoZerada(new Error(RECUSA_RFB), true);
    expect(out.code).toBe("DECLARACAO_ZERADA_RECUSADA_RFB");
    expect(out.message).toContain(RECUSA_RFB);
    expect(out.message).toContain("Nada foi transmitido");
    expect(out.rfb).toBe(RECUSA_RFB);
  });

  it("⚠ não mascara rejeição de declaração COM valores — só a zerada é traduzida", () => {
    const original = new Error(RECUSA_RFB);
    expect(traduzirRecusaDeclaracaoZerada(original, false)).toBe(original);
  });

  it("⚠ qualquer OUTRA rejeição da RFB propaga intacta", () => {
    const outra = new Error("SN-Entregar: CNPJ inválido");
    expect(traduzirRecusaDeclaracaoZerada(outra, true)).toBe(outra);
  });
});
