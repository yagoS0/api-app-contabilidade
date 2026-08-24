// QUAL ALÍQUOTA O PAINEL MOSTRA — a escolha pelo regime.
//
// ⚠ O que estes testes prendem é uma decisão do dono (24/08/2026): o Lucro Presumido passa a sair
// dos LANÇAMENTOS e o Simples continua saindo dos PAGAMENTOS. Trocar um pelo outro não quebra a
// tela — só muda o número da carga tributária que o cliente lê, em silêncio.

import { FONTE, MOTIVO, aliquotaDoPainel } from "../aliquotaDoPainel";

const empresaCom = (regimeTributario) => ({ legacyCompany: { regimeTributario } });
const SIMPLES = empresaCom("SIMPLES_NACIONAL");
const PRESUMIDO = empresaCom("LUCRO_PRESUMIDO");
const SEM_REGIME = { legacyCompany: {} };

const linha = (extra = {}) => ({
  competencia: "2026-07",
  faturamento: 100000,
  impostosPagos: 6000,
  dasExtrato: 6000,
  efetiva: 6,
  deReceita: 6,
  deLancamentos: null,
  ...extra,
});

const blocoCalculado = (extra = {}) => ({
  situacao: "CALCULADA",
  aliquota: 7.49,
  base: 100000,
  receitaBruta: 100000,
  devolucoesEDescontos: 0,
  impostos: 7490,
  impostoSobreReceita: 3650,
  impostoSobreResultado: 3840,
  impostosPorConta: [{ codigo: "420", nome: "(-) COFINS", total: 3000 }],
  naoClassificadas: 0,
  ...extra,
});

describe("o SIMPLES continua saindo dos pagamentos", () => {
  it("usa `efetiva` e ignora o bloco de lançamentos, mesmo quando ele existe", () => {
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.PAGAMENTOS);
    expect(r.valor).toBe(6);
  });

  it("⚠ sem faturamento não vira 0% — o backend fabrica o zero e a leitura o desfaz", () => {
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ faturamento: 0, efetiva: 0 }) });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_FATURAMENTO);
  });

  it("⚠ sem guia paga não vira 0% — e o motivo é OUTRO", () => {
    const r = aliquotaDoPainel({ empresa: SIMPLES, linha: linha({ impostosPagos: 0, efetiva: 0 }) });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_IMPOSTO_PAGO);
  });
});

describe("o LUCRO PRESUMIDO passa a sair dos lançamentos", () => {
  it("usa `deLancamentos.aliquota`, NÃO a `efetiva`", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
    expect(r.impostos).toBe(7490);
    expect(r.base).toBe(100000);
  });

  it("o LUCRO REAL vai pelo mesmo caminho", () => {
    const r = aliquotaDoPainel({ empresa: empresaCom("LUCRO_REAL"), linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.LANCAMENTOS);
    expect(r.valor).toBe(7.49);
  });

  it("⚠⚠ o caso REAL: provisão existe e a receita não foi lançada ⇒ NULL, não 0", () => {
    // Medido em produção: KODA BEAR 2026-07, provisão R$ 1.593,00 e nenhuma receita lançada.
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_RECEITA_LANCADA", aliquota: null, base: 0, receitaBruta: 0, impostos: 1593 }) }),
    });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_RECEITA_LANCADA);
    expect(r.impostos).toBe(1593);
  });

  it("⚠ imposto não provisionado é motivo DIFERENTE de receita não lançada", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_IMPOSTO_LANCADO", aliquota: null, impostos: 0 }) }),
    });
    expect(r.motivo).toBe(MOTIVO.SEM_IMPOSTO_LANCADO);
  });

  it("sem lançamento nenhum tem o seu próprio motivo", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SEM_LANCAMENTO", aliquota: null, base: 0, impostos: 0 }) }),
    });
    expect(r.motivo).toBe(MOTIVO.SEM_LANCAMENTO);
  });

  it("⚠ 'o servidor não mandou o bloco' NÃO é 'não há lançamento'", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: linha({ deLancamentos: null }) });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.BLOCO_AUSENTE);
  });

  it("⚠⚠ situação DESCONHECIDA não vira número — falha fechado", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ situacao: "SITUACAO_QUE_NAO_EXISTE_AINDA" }) }),
    });
    expect(r.valor).toBeNull();
  });

  it("⚠ CALCULADA com alíquota ilegível também não vira número", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ aliquota: null }) }),
    });
    expect(r.valor).toBeNull();
  });

  it("⚠ as linhas SEM conta contábil chegam contadas, mesmo com o número calculado", () => {
    const r = aliquotaDoPainel({
      empresa: PRESUMIDO,
      linha: linha({ deLancamentos: blocoCalculado({ naoClassificadas: 11 }) }),
    });
    expect(r.valor).toBe(7.49);
    expect(r.naoClassificadas).toBe(11);
  });
});

describe("⚠ regime desconhecido preserva o comportamento de hoje", () => {
  it("cai nos pagamentos, não na conta nova", () => {
    const r = aliquotaDoPainel({ empresa: SEM_REGIME, linha: linha({ deLancamentos: blocoCalculado() }) });
    expect(r.fonte).toBe(FONTE.PAGAMENTOS);
    expect(r.valor).toBe(6);
    expect(r.regime).toBe("desconhecido");
  });

  it("empresa ausente também", () => {
    expect(aliquotaDoPainel({ empresa: null, linha: linha() }).fonte).toBe(FONTE.PAGAMENTOS);
  });
});

describe("sem linha nenhuma", () => {
  it("responde SEM_DADOS, e não uma das ausências de insumo", () => {
    const r = aliquotaDoPainel({ empresa: PRESUMIDO, linha: null });
    expect(r.valor).toBeNull();
    expect(r.motivo).toBe(MOTIVO.SEM_DADOS);
  });
});
