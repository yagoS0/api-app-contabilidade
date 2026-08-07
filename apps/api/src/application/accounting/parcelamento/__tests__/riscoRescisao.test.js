// O ALERTA DE RISCO DE RESCISÃO.
//
// ⚠ O que estes testes protegem são os dois erros opostos, e os dois são caros:
//   · alerta que NÃO acende → a empresa perde o parcelamento por acúmulo silencioso (saldo para
//     a Dívida Ativa, reduções de multa restabelecidas);
//   · alerta que acende SEMPRE → ninguém lê, e aí é como se não existisse.

import { avaliarRiscoRescisao, REGRA_RESCISAO_PADRAO, NIVEL } from "../riscoRescisao";

const HOJE = new Date("2026-08-07T12:00:00Z");
const venc = (dia) => new Date(`2026-0${dia}-20T00:00:00Z`);   // 04,05,06,07 = passado; 09 = futuro
const FUTURO = new Date("2026-12-20T00:00:00Z");

const p = (mes, quitada, numeroParcela) => ({ numeroParcela, vencimento: mes, quitada });

describe("contagem — só prestação VENCIDA e NÃO quitada", () => {
  it("parcelamento em dia não acende nada", () => {
    const r = avaliarRiscoRescisao({ parcelas: [p(venc(4), true, 1), p(venc(5), true, 2), p(FUTURO, false, 3)], agora: HOJE });
    expect(r.nivel).toBe(NIVEL.OK);
    expect(r.emAtraso).toBe(0);
  });

  it("⚠ parcela FUTURA não é 'não paga' — é 'ainda não devida'", () => {
    // Contá-la acenderia vermelho em todo parcelamento recém-aberto, e alerta que acende sempre
    // é alerta que ninguém lê.
    const r = avaliarRiscoRescisao({ parcelas: [p(FUTURO, false, 1), p(FUTURO, false, 2), p(FUTURO, false, 3)], agora: HOJE });
    expect(r.nivel).toBe(NIVEL.OK);
    expect(r.vencidas).toBe(0);
  });

  it("uma vencida em aberto → amarelo", () => {
    const r = avaliarRiscoRescisao({ parcelas: [p(venc(4), false, 1), p(venc(5), true, 2), p(FUTURO, false, 3)], agora: HOJE });
    expect(r.nivel).toBe(NIVEL.ATENCAO);
    expect(r.emAtraso).toBe(1);
    expect(r.faltamParaRescindir).toBe(2);
  });

  it("duas em aberto, ainda havendo prestação futura → vermelho, a PRÓXIMA rescinde", () => {
    const r = avaliarRiscoRescisao({ parcelas: [p(venc(4), false, 1), p(venc(5), false, 2), p(FUTURO, false, 3)], agora: HOJE });
    expect(r.nivel).toBe(NIVEL.CRITICO);
    expect(r.faltamParaRescindir).toBe(1);
  });
});

describe("a regra atingida", () => {
  it("caso (I): três em aberto, consecutivas ou não", () => {
    // "consecutivas ou não" — aqui há uma paga no meio, e ainda assim conta.
    const r = avaliarRiscoRescisao({
      parcelas: [p(venc(4), false, 1), p(venc(5), true, 2), p(venc(6), false, 3), p(venc(7), false, 4), p(FUTURO, false, 5)],
      agora: HOJE,
    });
    expect(r.nivel).toBe(NIVEL.RESCINDIVEL);
    expect(r.caso).toBe("I");
    expect(r.emAtraso).toBe(3);
    expect(r.faltamParaRescindir).toBe(0);
  });

  it("⚠ caso (II): duas em aberto quando NÃO HÁ MAIS prestação futura", () => {
    // A diferença que o caso (II) captura: sem parcela futura, não há por onde regularizar, e
    // duas já bastam. Sem ele, a tela mostraria "falta 1" num parcelamento já rescindível.
    const r = avaliarRiscoRescisao({
      parcelas: [p(venc(4), true, 1), p(venc(5), true, 2), p(venc(6), false, 3), p(venc(7), false, 4)],
      agora: HOJE,
    });
    expect(r.nivel).toBe(NIVEL.RESCINDIVEL);
    expect(r.caso).toBe("II");
    expect(r.emAtraso).toBe(2);
  });

  it("duas em aberto com todas as DEMAIS pagas e a última ainda por vencer", () => {
    const r = avaliarRiscoRescisao({
      parcelas: [p(venc(4), false, 1), p(venc(5), false, 2), p(venc(6), true, 3), p(FUTURO, true, 4)],
      agora: HOJE,
    });
    expect(r.nivel).toBe(NIVEL.RESCINDIVEL);
    expect(r.caso).toBe("II");
  });

  it("lista quais parcelas estão em atraso — é o que o contador precisa pagar", () => {
    const r = avaliarRiscoRescisao({ parcelas: [p(venc(4), false, 1), p(venc(5), true, 2), p(venc(6), false, 3)], agora: HOJE });
    expect(r.parcelasEmAtraso.map((x) => x.numeroParcela)).toEqual([1, 3]);
  });
});

describe("⚠ pagamento PARCIAL não quita", () => {
  it("três parcialmente pagas rescindem igual", () => {
    // A divergência mais cara do fluxo: há arrecadação, há comprovante, e a prestação continua
    // inadimplida para a RFB. Quem chama passa `quitada: false` no parcial.
    const r = avaliarRiscoRescisao({
      parcelas: [p(venc(4), false, 1), p(venc(5), false, 2), p(venc(6), false, 3)],
      agora: HOJE,
    });
    expect(r.nivel).toBe(NIVEL.RESCINDIVEL);
  });
});

describe("a regra é DADO da modalidade", () => {
  it("modalidade com regra própria não usa a padrão", () => {
    // RELP/Simples tem limiar próprio; o motor lê a regra cadastrada em vez de assumir uma só.
    const relp = { ...REGRA_RESCISAO_PADRAO, id: "RELP", limiteAbsoluto: 6, limiteComDemaisPagas: 6 };
    const parcelas = [p(venc(4), false, 1), p(venc(5), false, 2), p(venc(6), false, 3)];
    expect(avaliarRiscoRescisao({ parcelas, agora: HOJE }).nivel).toBe(NIVEL.RESCINDIVEL);
    expect(avaliarRiscoRescisao({ parcelas, regra: relp, agora: HOJE }).nivel).toBe(NIVEL.CRITICO);
  });

  it("⚠ a citação legal viaja marcada como NÃO conferida", () => {
    // Enquanto for false, a tela mostra a contagem sem imprimir o artigo. Mesma disciplina do
    // `verificadoTrial` das integrações.
    expect(REGRA_RESCISAO_PADRAO.citacaoConferida).toBe(false);
  });
});

describe("entrada vazia não afirma nada", () => {
  it("sem parcelas, não é avaliável — e não é 'tudo em dia'", () => {
    const r = avaliarRiscoRescisao({ parcelas: [] });
    expect(r.avaliavel).toBe(false);
    expect(r.nivel).toBe(NIVEL.OK);
  });

  it("parcela sem vencimento legível é descartada, não vira atraso", () => {
    const r = avaliarRiscoRescisao({ parcelas: [{ vencimento: null, quitada: false }, { vencimento: "xx", quitada: false }] });
    expect(r.avaliavel).toBe(false);
  });

  it("chamada sem argumento não quebra", () => {
    expect(avaliarRiscoRescisao().nivel).toBe(NIVEL.OK);
  });
});
