// ⚠⚠ OS CASOS DOURADOS DO IBS/CBS — calculados À MÃO contra os Anexos, no molde de
// `casosDourados.test.js`. Cada número aqui foi conferido no texto oficial versionado em
// `docs/reforma-consumo/`, não copiado da saída do código.

import {
  CENARIO,
  IBS_2027_2028,
  TESTE_2026,
  OPCAO_POR_FORA,
  creditoPorDentro,
  transferidoPorFora,
  ibsCbsDoSimples,
} from "../ibsCbsNoSimples";
import { ANEXOS_SIMPLES_2027 } from "../anexosSimples2027.data";

describe("⚠⚠ 2026: para o optante, IBS e CBS são ZERO — e é a lei que diz", () => {
  it("o cenário de 2026 responde ZERO com fundamento, nunca 'não deu para calcular'", () => {
    const r = ibsCbsDoSimples({ cenario: CENARIO.EM_2026, anexo: "III", faixa: 1, aliquotaEfetivaPct: 6 });
    expect(r.zeroPorLei).toBe(true);
    expect(r.creditoPct).toBe(0);
    expect(r.fundamento).toMatch(/art\. 348, III, "c"/);
  });

  it("⚠ e ele NÃO depende de a empresa ter anexo, faixa ou alíquota", () => {
    // A exclusão é da PESSOA (optante), não da situação dela. Exigir insumo aqui faria a tela
    // dizer "faltam dados" sobre um fato que a lei afirma para todo optante.
    const r = ibsCbsDoSimples({ cenario: CENARIO.EM_2026 });
    expect(r.zeroPorLei).toBe(true);
    expect(r.creditoPct).toBe(0);
  });

  it("⚠ as alíquotas de teste EXISTEM — o que não existe é elas alcançarem o Simples", () => {
    // Guardar os dois lados impede o erro oposto: concluir que não há IBS/CBS em 2026 para ninguém.
    expect(TESTE_2026.ibs).toBe(0.1);
    expect(TESTE_2026.cbs).toBe(0.9);
  });

  it("⚠ o cenário de 2026 aponta para o de 2027 — a decisão de setembro é sobre ELE", () => {
    const r = ibsCbsDoSimples({ cenario: CENARIO.EM_2026 });
    expect(r.proximoPasso).toBe(CENARIO.DE_2027_A_2028);
  });
});

describe("⚠⚠ o crédito 'por dentro' — a conta é EXATA, e sai do Anexo", () => {
  it("CASO DOURADO · Anexo III, 1ª faixa, alíquota efetiva 6,00%", () => {
    // Conferido à mão contra o Anexo XX da LC 214 (= Anexo III da LC 123), vigência 2027-2028:
    //   CBS 15,43% + IBS 0,17% = 15,60%
    //   6,00% × 15,60% = 0,936% da operação
    const r = creditoPorDentro({ anexo: "III", faixa: 1, aliquotaEfetivaPct: 6 });
    expect(r.percentualCbs).toBe(15.43);
    expect(r.percentualIbs).toBe(0.17);
    expect(r.somaPercentual).toBe(15.6);
    expect(r.creditoPct).toBeCloseTo(0.936, 6);
    expect(r.semIbsNoDas).toBe(false);
  });

  it("CASO DOURADO · Anexo I, 1ª faixa, alíquota efetiva 4,00%", () => {
    //   CBS 15,33% + IBS 0,17% = 15,50%   → 4,00% × 15,50% = 0,62%
    // ⚠ E 15,50% é EXATAMENTE o que era COFINS 12,74% + PIS 2,76% na redação de 2026: a soma não
    // mudou, ela só trocou de nome e cedeu 0,17 ao IBS.
    const r = creditoPorDentro({ anexo: "I", faixa: 1, aliquotaEfetivaPct: 4 });
    expect(r.somaPercentual).toBe(15.5);
    expect(r.creditoPct).toBeCloseTo(0.62, 6);
  });

  it("⚠⚠ CASO DOURADO DA 6ª FAIXA · Anexo III — o IBS NÃO está no DAS, e o crédito sai só da CBS", () => {
    // Sublimite (LC 123, art. 13-A): na 6ª faixa o ISS e o IBS saem do regime único.
    //   CBS 19,29%, IBS ausente → 30,00% × 19,29% = 5,787%
    const r = creditoPorDentro({ anexo: "III", faixa: 6, aliquotaEfetivaPct: 30 });
    expect(r.percentualCbs).toBe(19.29);
    expect(r.percentualIbs).toBeNull();
    expect(r.somaPercentual).toBe(19.29);
    expect(r.creditoPct).toBeCloseTo(5.787, 6);
    expect(r.semIbsNoDas).toBe(true);
  });

  it("⚠⚠ e `null` do IBS NÃO é somado como zero por acidente — a marca é o que explica o número", () => {
    // Sem `semIbsNoDas`, a 6ª faixa entregaria um crédito menor que o da 5ª sem nada dizer por quê,
    // e pareceria erro de cálculo.
    const sexta = creditoPorDentro({ anexo: "I", faixa: 6, aliquotaEfetivaPct: 19 });
    expect(sexta.semIbsNoDas).toBe(true);
    expect(sexta.percentualIbs).toBeNull();
    const quinta = creditoPorDentro({ anexo: "I", faixa: 5, aliquotaEfetivaPct: 19 });
    expect(quinta.semIbsNoDas).toBe(false);
    expect(quinta.percentualIbs).toBeGreaterThan(0);
  });

  it("⚠ sem insumo, `null` — nunca um número por omissão", () => {
    expect(creditoPorDentro({ anexo: "III", faixa: 1, aliquotaEfetivaPct: null })).toBeNull();
    expect(creditoPorDentro({ anexo: "III", faixa: 1, aliquotaEfetivaPct: 0 })).toBeNull();
    expect(creditoPorDentro({ anexo: "ZZ", faixa: 1, aliquotaEfetivaPct: 6 })).toBeNull();
    expect(creditoPorDentro({ anexo: "III", faixa: 9, aliquotaEfetivaPct: 6 })).toBeNull();
  });

  it("⚠ a VIGÊNCIA viaja com o número — 2027-2028, e ela sai impressa", () => {
    const r = creditoPorDentro({ anexo: "III", faixa: 1, aliquotaEfetivaPct: 6 });
    expect(r.vigencia.inicio).toBe("2027-01-01");
    expect(r.vigencia.fim).toBe("2028-12-31");
  });
});

describe("⚠⚠ o 'por fora' — o IBS vem da LEI, só a CBS é digitada", () => {
  it("o IBS de 2027-2028 é 0,05% + 0,05% e NÃO se digita", () => {
    expect(IBS_2027_2028.estadual).toBe(0.05);
    expect(IBS_2027_2028.municipal).toBe(0.05);
    expect(IBS_2027_2028.total).toBe(0.1);
    expect(IBS_2027_2028.fundamento).toMatch(/art\. 344/);
  });

  it("com a CBS informada, o total transferido é CBS + 0,1%", () => {
    const r = transferidoPorFora({ cbsEstimadaPct: 8.8 });
    expect(r.ibsPct).toBe(0.1);
    expect(r.totalPct).toBeCloseTo(8.9, 6);
  });

  it("⚠⚠ SEM a CBS digitada NÃO se estima — devolve `null`", () => {
    // É a regra 1 do projeto em pessoa: os números que circulam (27,91% · 18,7% · 26,5%) não estão
    // na lei, e um deles cravado aqui viraria alíquota no PDF do cliente.
    expect(transferidoPorFora({ cbsEstimadaPct: null })).toBeNull();
    expect(transferidoPorFora({ cbsEstimadaPct: 0 })).toBeNull();
    expect(transferidoPorFora({})).toBeNull();
  });

  it("⚠ e o número informado viaja MARCADO como estimativa, com o prazo do Senado", () => {
    const r = transferidoPorFora({ cbsEstimadaPct: 8.8 });
    expect(r.cbsEhEstimativa).toBe(true);
    expect(r.avisoDaCbs).toMatch(/não está em lei/i);
    expect(r.avisoDaCbs).toMatch(/15\/12\/2026/);
  });
});

describe("⚠⚠ a janela da opção — o que a tela pode e o que NÃO pode afirmar", () => {
  it("é setembro e MARÇO (redação da LC 227), para os semestres de janeiro e julho", () => {
    // ⚠ A LC 214 original dizia "setembro e ABRIL". As duas versões estão impressas lado a lado no
    // arquivo do Planalto, e ler a errada anuncia a data errada ao contador.
    expect(OPCAO_POR_FORA.meses).toEqual(["setembro", "março"]);
    expect(OPCAO_POR_FORA.semestres).toEqual(["janeiro", "julho"]);
    expect(OPCAO_POR_FORA.irretratavel).toBe(true);
  });

  it("⚠⚠ ela DEPENDE de regulamentação do CGSN, e isso viaja junto", () => {
    // O § 10 diz "na forma regulamentada pelo CGSN", e não há prova neste repositório de que o ato
    // exista. A tela pode dizer a janela LEGAL; não pode dizer que o procedimento está disponível.
    expect(OPCAO_POR_FORA.dependeDeRegulamentacao).toBe(true);
  });

  it("⚠ a trava de saída é 'corrente ou ANTERIOR' — não 'no ano seguinte'", () => {
    // O art. 41, § 5º fala de quando o ressarcimento foi RECEBIDO, não de quanto tempo a trava dura.
    expect(OPCAO_POR_FORA.travaDeSaida).toMatch(/corrente ou anterior/i);
    expect(OPCAO_POR_FORA.travaDeSaida).not.toMatch(/seguinte/i);
  });
});

describe("⚠ a resposta por cenário", () => {
  it("2027-2028 traz os dois lados e a diferença", () => {
    const r = ibsCbsDoSimples({
      cenario: CENARIO.DE_2027_A_2028,
      anexo: "III",
      faixa: 1,
      aliquotaEfetivaPct: 6,
      cbsEstimadaPct: 8.8,
    });
    expect(r.porDentro.creditoPct).toBeCloseTo(0.936, 6);
    expect(r.porFora.totalPct).toBeCloseTo(8.9, 6);
    expect(r.diferencaPct).toBeCloseTo(7.964, 6);
  });

  it("⚠ sem a CBS, a diferença é `null` — meia comparação não vira número", () => {
    const r = ibsCbsDoSimples({
      cenario: CENARIO.DE_2027_A_2028, anexo: "III", faixa: 1, aliquotaEfetivaPct: 6,
    });
    expect(r.porDentro).not.toBeNull();
    expect(r.porFora).toBeNull();
    expect(r.diferencaPct).toBeNull();
  });

  it("⚠⚠ cenário desconhecido NÃO cai em 2026 nem em 2027 — recusa nomeada", () => {
    // Cair num deles faria uma competência futura ser respondida com a regra do ano errado.
    const r = ibsCbsDoSimples({ cenario: "2035" });
    expect(r.motivo).toBe("cenario_desconhecido");
    expect(r.zeroPorLei).toBe(false);
  });
});

describe("⚠⚠ o DADO GERADO continua sendo o que a lei diz", () => {
  it("os cinco anexos têm CBS e IBS, e seis faixas cada", () => {
    for (const romano of ["I", "II", "III", "IV", "V"]) {
      const a = ANEXOS_SIMPLES_2027[romano];
      expect(a.faixas).toHaveLength(6);
      expect(a.colunas).toContain("CBS");
      expect(a.colunas).toContain("IBS");
    }
  });

  it("⚠⚠ em TODOS eles a 6ª faixa perde o ICMS/ISS **e** o IBS — é o sublimite", () => {
    for (const romano of ["I", "II", "III", "IV", "V"]) {
      const sexta = ANEXOS_SIMPLES_2027[romano].faixas.find((f) => f.faixa === 6);
      expect(sexta.partilha.IBS).toBeNull();
      const subnacional = "ICMS" in sexta.partilha ? "ICMS" : "ISS";
      expect(sexta.partilha[subnacional]).toBeNull();
      // ⚠ E a CBS continua lá: o que sai do DAS é o tributo do ente subnacional e o IBS.
      expect(sexta.partilha.CBS).toBeGreaterThan(0);
    }
  });

  it("⚠ o Anexo IV não tem CPP — a patronal é recolhida por fora (art. 13, § 5º-C)", () => {
    expect(ANEXOS_SIMPLES_2027.IV.colunas).not.toContain("CPP");
    expect(ANEXOS_SIMPLES_2027.II.colunas).toContain("IPI");
  });

  it("as alíquotas NOMINAIS não mudaram em relação a 2026", () => {
    expect(ANEXOS_SIMPLES_2027.I.faixas.map((f) => f.aliquota)).toEqual([4, 7.3, 9.5, 10.7, 14.3, 18.9]);
  });
});
