// A REGRA QUE DECIDE QUAL TABELA DE ANEXO A TELA DESENHA — E QUANDO ELA NÃO DESENHA NENHUMA.
//
// ⚠ Cada bloco aqui corresponde a uma armadilha MEDIDA, não a um caso imaginado. Os números das
// faixas e da partilha vêm de `tabelasFiscais.js`, que é a tabela versionada com citação de lei por
// valor — este arquivo não repete nenhum deles à mão, senão as duas cópias divergiriam.

import {
  anexosDaEmpresa,
  tabelaDoAnexo,
  rbt12Conhecido,
  SITUACAO_ANEXO,
  SITUACAO_FAIXA,
} from "../anexoDaEmpresa";
import { ANEXOS, LIMITES_SIMPLES, FATOR_R_LIMITE } from "../../../planejamento/lib/tabelasFiscais";

const comercio = { anexoImplicito: "I", sujeitoFatorR: false };
const servicoIV = { anexoImplicito: "IV", sujeitoFatorR: false };
/** ⚠ A forma REAL do catálogo: as quatro atividades de Fator R têm "III" gravado. */
const servicoFatorR = { anexoImplicito: "III", sujeitoFatorR: true };

describe("qual anexo a empresa usa", () => {
  it("atividade comum: usa o anexo declarado", () => {
    const r = anexosDaEmpresa({ atividades: [comercio], rbt12: 500_000 });
    expect(r.anexos).toEqual(["I"]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.RESOLVIDO);
  });

  it("mais de um anexo sai na ordem I…V, sem repetir", () => {
    const r = anexosDaEmpresa({ atividades: [servicoIV, comercio, comercio], rbt12: 500_000 });
    expect(r.anexos).toEqual(["I", "IV"]);
  });

  it("sem atividade nenhuma não afirma anexo", () => {
    expect(anexosDaEmpresa({ atividades: [], rbt12: 500_000 }).situacao).toBe(SITUACAO_ANEXO.SEM_ATIVIDADE);
    expect(anexosDaEmpresa({}).anexos).toEqual([]);
  });

  it("anexo irreconhecível não vira anexo inventado", () => {
    const r = anexosDaEmpresa({ atividades: [{ anexoImplicito: "IX" }], rbt12: 500_000 });
    expect(r.anexos).toEqual([]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.SEM_ATIVIDADE);
  });
});

describe("⚠⚠ Fator R — o `anexoImplicito` diz III e a resposta pode ser V", () => {
  // A folha de 28% do RBT12 é o limite legal (§ 5º-J). Abaixo dele o anexo é o V.
  const rbt12 = 1_000_000;

  it("folha ACIMA do limite: Anexo III, e o `anexoImplicito` até coincide", () => {
    const r = anexosDaEmpresa({ atividades: [servicoFatorR], folha12m: 350_000, rbt12 });
    expect(r.anexos).toEqual(["III"]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.RESOLVIDO);
    expect(r.fatorR).toBeGreaterThan(FATOR_R_LIMITE);
  });

  // ⚠⚠ ESTE É O TESTE QUE JUSTIFICA O MÓDULO INTEIRO. Lendo `anexoImplicito` a tela desenharia o
  // Anexo III — a alíquota MENOR — para uma empresa que está no V.
  it("folha ABAIXO do limite: Anexo V, contrariando o `anexoImplicito: III` do catálogo", () => {
    const r = anexosDaEmpresa({ atividades: [servicoFatorR], folha12m: 100_000, rbt12 });
    expect(servicoFatorR.anexoImplicito).toBe("III"); // a forma que o catálogo grava
    expect(r.anexos).toEqual(["V"]);                  // a resposta certa
    expect(r.situacao).toBe(SITUACAO_ANEXO.RESOLVIDO);
  });

  it("⚠ folha NÃO INFORMADA: mostra III e V e NÃO escolhe", () => {
    const r = anexosDaEmpresa({ atividades: [servicoFatorR], folha12m: null, rbt12 });
    expect(r.anexos).toEqual(["III", "V"]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.DEPENDE_DO_FATOR_R);
    expect(r.fatorR).toBeNull();
  });

  // ⚠ Folha ZERO é uma afirmação ("não há folha"), ausência não é. A distinção é a mesma de
  // `folhaAusenteNaoEZero.test.js` no planejamento.
  it("folha ZERO informada DECIDE (Anexo V) — zero não é ausência", () => {
    const r = anexosDaEmpresa({ atividades: [servicoFatorR], folha12m: 0, rbt12 });
    expect(r.anexos).toEqual(["V"]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.RESOLVIDO);
  });

  it("sem RBT12 não há Fator R, então também não se escolhe entre III e V", () => {
    const r = anexosDaEmpresa({ atividades: [servicoFatorR], folha12m: 350_000, rbt12: null });
    expect(r.anexos).toEqual(["III", "V"]);
    expect(r.situacao).toBe(SITUACAO_ANEXO.DEPENDE_DO_FATOR_R);
  });
});

describe("⚠⚠ RBT12 ausente não pode marcar a 1ª faixa", () => {
  // A armadilha: `faixaDoRbt12` faz `Number(rbt12) || 0` e a faixa 1 começa em `de: 0`.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string vazia", ""],
    ["zero", 0],
    ["texto", "abc"],
  ])("%s não marca faixa nenhuma", (_rotulo, valor) => {
    expect(rbt12Conhecido(valor)).toBe(false);
    const t = tabelaDoAnexo("I", valor);
    expect(t.faixaDaEmpresa).toBeNull();
    expect(t.situacao).toBe(SITUACAO_FAIXA.RBT12_DESCONHECIDO);
    expect(t.aliquotaEfetiva).toBeNull();
    expect(t.reparticao).toBeNull();
  });

  it("mas a tabela sai INTEIRA — o que falta é a marca, não a referência", () => {
    expect(tabelaDoAnexo("I", null).faixas).toHaveLength(6);
  });

  // ⚠ Contraprova: sem ela o teste acima passaria com uma função que nunca marca nada.
  it("com RBT12 conhecido, a faixa é marcada", () => {
    const t = tabelaDoAnexo("I", 500_000);
    expect(t.faixaDaEmpresa).toBe(3);
    expect(t.situacao).toBe(SITUACAO_FAIXA.RESOLVIDA);
    expect(t.aliquotaEfetiva).toBeGreaterThan(0);
  });
});

describe("RBT12 acima do teto do Simples é uma resposta PRÓPRIA", () => {
  it('não se confunde com "não sabemos"', () => {
    const t = tabelaDoAnexo("I", LIMITES_SIMPLES.epp + 1);
    expect(t.situacao).toBe(SITUACAO_FAIXA.RBT12_ACIMA_DO_LIMITE);
    expect(t.situacao).not.toBe(SITUACAO_FAIXA.RBT12_DESCONHECIDO);
    expect(t.faixaDaEmpresa).toBeNull();
  });

  it("no teto exato ainda há faixa — o limite é inclusivo", () => {
    expect(tabelaDoAnexo("I", LIMITES_SIMPLES.epp).situacao).toBe(SITUACAO_FAIXA.RESOLVIDA);
  });
});

describe("o que a tabela precisa dizer além dos números", () => {
  it("⚠ Anexo IV avisa que a CPP fica FORA do DAS — sem isso o contador soma o INSS patronal", () => {
    expect(tabelaDoAnexo("IV", 500_000).cppForaDoDas).toBe(true);
    expect(tabelaDoAnexo("III", 500_000).cppForaDoDas).toBe(false);
  });

  it("⚠ a 6ª faixa perde ICMS ou ISS, e qual deles é DERIVADO da tabela", () => {
    expect(tabelaDoAnexo("I", 500_000).foraDoDasNaSextaFaixa).toEqual(["icms"]);
    expect(tabelaDoAnexo("III", 500_000).foraDoDasNaSextaFaixa).toEqual(["iss"]);
    // A prova de que é derivado, e não uma lista escrita à mão:
    expect(ANEXOS.I.faixas[5].partilha.icms).toBeUndefined();
    expect(ANEXOS.I.faixas[0].partilha.icms).toBeGreaterThan(0);
  });

  // ⚠ O teto mora na 5ª faixa do Anexo III, mas NÃO vale para a faixa inteira: ele só morde quando
  // a alíquota efetiva passa de `tetoIss.aliquotaEfetivaGatilho` (0,1492537). No começo da faixa a
  // efetiva ainda é menor — por isso o RBT12 aqui é alto DENTRO da 5ª faixa, e não qualquer um dela.
  it("a repartição já vem com o teto de 5% do ISS aplicado, quando ele morde", () => {
    const t = tabelaDoAnexo("III", 3_500_000);
    expect(t.faixaDaEmpresa).toBe(ANEXOS.III.tetoIss.faixa);
    expect(t.aliquotaEfetiva).toBeGreaterThan(ANEXOS.III.tetoIss.aliquotaEfetivaGatilho);
    expect(t.reparticao.tetoIssAplicado).toBe(true);
    expect(t.reparticao.porTributo.iss).toBeCloseTo(0.05, 10);
  });

  // Contraprova: na mesma faixa, abaixo do gatilho, o teto NÃO é aplicado. Sem ela o teste acima
  // passaria com uma implementação que aplicasse o teto na faixa 5 inteira.
  it("na mesma 5ª faixa, abaixo do gatilho, o teto não é aplicado", () => {
    const t = tabelaDoAnexo("III", 2_000_000);
    expect(t.faixaDaEmpresa).toBe(ANEXOS.III.tetoIss.faixa);
    expect(t.aliquotaEfetiva).toBeLessThan(ANEXOS.III.tetoIss.aliquotaEfetivaGatilho);
    expect(t.reparticao.tetoIssAplicado).toBe(false);
  });

  it("anexo desconhecido devolve null, nunca um anexo qualquer", () => {
    expect(tabelaDoAnexo("IX", 500_000)).toBeNull();
    expect(tabelaDoAnexo(null, 500_000)).toBeNull();
  });
});
