// ⚠⚠ OS CASOS DOURADOS DO IBS/CBS — calculados À MÃO contra os Anexos, no molde de
// `casosDourados.test.js`. Cada número aqui foi conferido no texto oficial versionado em
// `docs/reforma-consumo/`, não copiado da saída do código.

import {
  CENARIO,
  IBS_2027_2028,
  TESTE_2026,
  OPCAO_POR_FORA,
  creditoPorDentro,
  impostoDaEmpresa,
  mudancaDaNominal,
  transferidoPorFora,
  ibsCbsDoSimples,
} from "../ibsCbsNoSimples";
import { ANEXOS_SIMPLES_2027 } from "../anexosSimples2027.data";
import { ANEXOS } from "../tabelasFiscais";

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

  it("⚠⚠ as nominais das faixas 1 a 5 não mudaram — e a 6ª MUDOU", () => {
    // ⚠⚠ ESTE TESTE SE CHAMAVA "as alíquotas NOMINAIS não mudaram em relação a 2026" E O TÍTULO
    // MENTIA: ele comparava contra um literal que JÁ trazia `18.9`, ou seja afirmava a igualdade
    // enquanto media a diferença. Passava verde sobre a frase errada.
    expect(ANEXOS_SIMPLES_2027.I.faixas.map((f) => f.aliquota)).toEqual([4, 7.3, 9.5, 10.7, 14.3, 18.9]);
    expect(ANEXOS.I.faixas[5].aliquota * 100).toBeCloseTo(19, 2); // hoje
    expect(ANEXOS_SIMPLES_2027.I.faixas[5].aliquota).toBeCloseTo(18.9, 2); // 2027-2028
  });
});

describe("⚠⚠⚠ O DAS MUDA NA 6ª FAIXA — a frase mais valiosa da tela não valia para todo mundo", () => {
  // Medido na fonte versionada (`docs/reforma-consumo/lcp214.htm`, Anexos do art. 519): a 6ª faixa
  // cai 0,10 pp na vigência 1º/1/2027–31/12/2028 e VOLTA ao valor de hoje a partir de 1º/1/2029.
  // A lei traz as duas tabelas, com as vigências escritas. Nas faixas 1 a 5 nada muda.
  const SEXTA = { I: [19, 18.9], II: [30, 29.9], III: [33, 32.9], IV: [33, 32.9], V: [30.5, 30.4] };

  it.each(Object.keys(SEXTA))("Anexo %s: faixas 1 a 5 idênticas — alíquota E parcela a deduzir", (anexo) => {
    for (let faixa = 1; faixa <= 5; faixa += 1) {
      const m = mudancaDaNominal(anexo, faixa);
      expect(m.mudou).toBe(false);
      expect(m.nominal2027).toBeCloseTo(m.nominalHoje, 2);
      expect(m.deduzir2027).toBe(m.deduzirHoje);
    }
  });

  it.each(Object.entries(SEXTA))("Anexo %s: a 6ª faixa cai de %s para o valor de 2027-2028", (anexo, [hoje, dep]) => {
    const m = mudancaDaNominal(anexo, 6);
    expect(m.mudou).toBe(true);
    expect(m.nominalHoje).toBeCloseTo(hoje, 2);
    expect(m.nominal2027).toBeCloseTo(dep, 2);
    // ⚠ A PARCELA A DEDUZIR NÃO MUDA — é o que faz a diferença ser exatamente a alíquota.
    expect(m.deduzir2027).toBe(m.deduzirHoje);
  });

  it("⚠ a queda é de 0,10 ponto percentual, nos CINCO — não é ruído de leitura", () => {
    for (const anexo of Object.keys(SEXTA)) {
      const m = mudancaDaNominal(anexo, 6);
      expect(Number((m.nominalHoje - m.nominal2027).toFixed(2))).toBe(0.1);
    }
  });

  it("⚠ anexo ou faixa que não existem devolvem `null` — nunca «não mudou» por omissão", () => {
    expect(mudancaDaNominal("IX", 1)).toBeNull();
    expect(mudancaDaNominal("I", 9)).toBeNull();
    expect(mudancaDaNominal(undefined, undefined)).toBeNull();
  });
});

describe("⚠⚠⚠ e a TELA deixa de afirmar «o DAS não muda» para quem ele muda", () => {
  const base = { anexo: "III", faixa: 1, aliquotaEfetivaPct: 6, dasAnual: 6000, receitaAnual: 100000 };

  it("faixa 1: continua dizendo que não muda — vale para a maioria da carteira", () => {
    const r = impostoDaEmpresa(base);
    expect(r.porDentro.mudaEmRelacaoAHoje).toBe(false);
    expect(r.porDentro.explicacao).toMatch(/não muda/i);
    expect(r.porDentro.novoDasNaoCalculado).toBe(false);
  });

  it("⚠⚠ 6ª faixa: diz que MUDA, para menos, e nomeia as duas alíquotas", () => {
    const r = impostoDaEmpresa({ ...base, faixa: 6, aliquotaEfetivaPct: 30, dasAnual: 30000 });
    expect(r.porDentro.mudaEmRelacaoAHoje).toBe(true);
    expect(r.porDentro.explicacao).toMatch(/muda, e para MENOS/i);
    expect(r.porDentro.explicacao).toContain("33,00%");
    expect(r.porDentro.explicacao).toContain("32,90%");
  });

  it("⚠⚠ e ela NÃO inventa o DAS novo — ele depende do RBT12, que esta simulação não recebe", () => {
    // Recompor o RBT12 a partir da receita anual suporia que os dois são o mesmo número, o que é
    // falso em início de atividade (o RBT12 é proporcionalizado). Melhor ausência que número torto.
    const r = impostoDaEmpresa({ ...base, faixa: 6, aliquotaEfetivaPct: 30, dasAnual: 30000 });
    expect(r.porDentro.novoDasNaoCalculado).toBe(true);
    expect(r.porDentro.dasAnual).toBe(30000); // o de HOJE, e a frase diz que é o de hoje
    expect(r.porDentro.explicacao).toMatch(/não é calculado aqui/i);
  });

  it("⚠ a explicação diz que em 2029 volta ao valor de hoje — a lei já traz a tabela", () => {
    const r = impostoDaEmpresa({ ...base, faixa: 6, aliquotaEfetivaPct: 30, dasAnual: 30000 });
    expect(r.porDentro.explicacao).toMatch(/2029/);
  });
});

describe("⚠⚠⚠ QUANTO A EMPRESA VAI PAGAR — a metade que faltava", () => {
  // > Dono, 01/09/2026: "o que não ficou claro no CBS e IBS é quanto meu cliente vai pagar de
  // > imposto; no caso ela só diz quanto de crédito ele vai gerar."
  const base = { anexo: "III", faixa: 1, aliquotaEfetivaPct: 6, dasAnual: 6000, receitaAnual: 100000 };

  it("⚠⚠ POR DENTRO, O DAS NÃO MUDA — e é medição, não opinião", () => {
    // As alíquotas nominais e as parcelas a deduzir dos Anexos são as MESMAS de 2026. Alíquota
    // efetiva igual ⇒ DAS igual. É a coisa mais valiosa a dizer ao contador: ficar como está não
    // aumenta o imposto da empresa dele.
    const r = impostoDaEmpresa(base);
    expect(r.porDentro.dasAnual).toBe(6000);
    expect(r.porDentro.mudaEmRelacaoAHoje).toBe(false);
    expect(r.porDentro.explicacao).toMatch(/não muda/i);
  });

  it("e ele mostra QUANTO do DAS já é CBS e IBS hoje", () => {
    //   CBS 15,43% de 6.000 = 925,80   ·   IBS 0,17% de 6.000 = 10,20
    const r = impostoDaEmpresa(base);
    expect(r.porDentro.cbsDentroDoDas).toBeCloseTo(925.8, 2);
    expect(r.porDentro.ibsDentroDoDas).toBeCloseTo(10.2, 2);
  });

  it("⚠ na 6ª faixa não há IBS dentro do DAS — e o campo sai `null`, não zero", () => {
    const r = impostoDaEmpresa({ ...base, faixa: 6, aliquotaEfetivaPct: 30, dasAnual: 30000 });
    expect(r.porDentro.ibsDentroDoDas).toBeNull();
    expect(r.porDentro.semIbsNoDas).toBe(true);
  });

  it("⚠⚠ POR FORA: a PARCELA QUE SAI do DAS é exata — a lei diz que ela não é cobrada", () => {
    //   15,60% de 6.000 = 936,00
    const r = impostoDaEmpresa({ ...base, cbsEstimadaPct: 8.8 });
    expect(r.porFora.parcelaQueSaiDoDas).toBeCloseTo(936, 2);
    expect(r.porFora.fundamentoDaSaida).toMatch(/art\. 13, § 9º/);
  });

  it("o débito no regime regular é sobre a RECEITA, e sai marcado como BRUTO", () => {
    //   8,90% de 100.000 = 8.900,00
    const r = impostoDaEmpresa({ ...base, cbsEstimadaPct: 8.8 });
    expect(r.porFora.debitoSobreAReceita).toBeCloseTo(8900, 2);
  });

  it("⚠⚠⚠ E A CONTA NÃO FECHA — dizer isso É o produto", () => {
    // Faltam os créditos das compras (a tela não sabe o que a empresa compra) e a forma de
    // recomposição do DAS (a lei não a traz — varrido o texto). Um "total por fora" cravado seria
    // número inventado num documento que vai ao cliente.
    const r = impostoDaEmpresa({ ...base, cbsEstimadaPct: 8.8 });
    expect(r.porFora.liquidoNaoCalculavel).toBe(true);
    expect(r.porFora.porQueNaoFecha).toHaveLength(2);
    expect(r.porFora.porQueNaoFecha.join(" ")).toMatch(/folha não gera crédito/i);
    expect(r.porFora.porQueNaoFecha.join(" ")).toMatch(/não traz a fórmula de recomposição/i);
    // ⚠ E NÃO existe um campo de total: se existisse, alguém o mostraria.
    expect(r.porFora.totalPorFora).toBeUndefined();
    expect(r.porFora.dasFinal).toBeUndefined();
  });

  it("⚠ sem a CBS digitada, o lado 'por fora' inteiro é `null` — nada é estimado", () => {
    const r = impostoDaEmpresa(base);
    expect(r.porDentro).not.toBeNull();
    expect(r.porFora).toBeNull();
  });

  it("⚠ sem DAS não se responde nada — nunca um número por omissão", () => {
    expect(impostoDaEmpresa({ ...base, dasAnual: null })).toBeNull();
    expect(impostoDaEmpresa({ ...base, dasAnual: 0 })).toBeNull();
  });
});
