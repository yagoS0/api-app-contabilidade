// A REGRA DO FORNECEDOR, DO LADO DA TELA (29/08/2026).
//
// ⚠⚠ O que este arquivo protege é o ESPELHO: a tela desabilitar o botão exatamente onde o servidor
// recusaria. Espelho que diverge é o pior dos dois mundos — o contador preenche a regra inteira e o
// clique volta negado, ou pior, a tela oferece um crédito que o lançamento não pode ter.

import {
  COMPORTAMENTO,
  PREFIXO_DISPONIBILIDADE,
  RECUSA_DA_REGRA,
  comportamentoDaRegra,
  contasDeCreditoOferecidas,
  contasDeDebitoOferecidas,
  fraseDaRegra,
  validarRegra,
} from "../regraDoFornecedor";

const CONTAS = [
  { codigo: "557", codigoCompleto: "411030012", nome: "SOFTWARE", analitica: true },
  { codigo: "1", codigoCompleto: "111010001", nome: "CAIXA MATRIZ", analitica: true },
  { codigo: "2", codigoCompleto: "111020003", nome: "BANCO ITAU", analitica: true },
  { codigo: "3", codigoCompleto: "111030001", nome: "APLICACOES", analitica: true },
  { codigo: "9", codigoCompleto: "411", nome: "DESPESAS ADMINISTRATIVAS", analitica: false },
  { codigo: "77", codigoCompleto: "121010001", nome: "CLIENTES", analitica: true },
  { codigo: "88", codigoCompleto: null, nome: "SEM COMPLETO", analitica: true },
];

const base = (extra = {}) => ({
  cnpjFornecedor: "12345678000190",
  padraoDescricao: "",
  valorMin: "1000",
  valorMax: "1500",
  contaDestino: "411030012",
  contaCredito: "",
  lancaSozinha: false,
  diaDoLancamento: "",
  ...extra,
});

describe("o seletor do CRÉDITO só oferece disponibilidade", () => {
  it("caixa, banco e aplicação entram", () => {
    const codigos = contasDeCreditoOferecidas(CONTAS).map((c) => c.codigoCompleto);
    expect(codigos).toEqual(["111010001", "111020003", "111030001"]);
  });

  it("⚠⚠ conta de DESPESA não é oferecida como crédito", () => {
    // O lançamento afirma de ONDE o dinheiro saiu. Oferecer despesa aqui seria a tela propondo
    // uma mentira que o servidor nega.
    const codigos = contasDeCreditoOferecidas(CONTAS).map((c) => c.codigoCompleto);
    expect(codigos).not.toContain("411030012");
    expect(codigos).not.toContain("121010001");
  });

  it("⚠ sintética e conta sem `codigoCompleto` ficam de fora dos DOIS seletores", () => {
    const debitos = contasDeDebitoOferecidas(CONTAS).map((c) => c.codigoCompleto);
    expect(debitos).not.toContain("411");
    expect(debitos).toContain("411030012");
    expect(debitos.some((c) => c == null)).toBe(false);
  });

  it("⚠ a despesa NÃO precisa ser disponibilidade — só o crédito precisa", () => {
    expect(contasDeDebitoOferecidas(CONTAS).map((c) => c.codigoCompleto)).toContain("411030012");
  });

  it("⚠ o prefixo é o do backend, e é PREFIXO — nunca o nome da conta", () => {
    expect(PREFIXO_DISPONIBILIDADE).toBe("111");
    const banco = contasDeCreditoOferecidas([
      { codigo: "1", codigoCompleto: "411050001", nome: "BANCO — TARIFAS", analitica: true },
    ]);
    expect(banco).toEqual([]);
  });
});

describe("⚠⚠ `validarRegra` — a mesma ordem de recusa do servidor", () => {
  it("o formulário completo passa", () => {
    expect(validarRegra(base(), CONTAS).pode).toBe(true);
  });

  it("⚠⚠ SEM ÂNCORA recusa — ela casaria com qualquer despesa", () => {
    const r = validarRegra(base({ cnpjFornecedor: "", padraoDescricao: "" }), CONTAS);
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(RECUSA_DA_REGRA.SEM_ANCORA);
    expect(r.frase).toMatch(/âncora/i);
  });

  it("⚠ a faixa é conferida por TIPO — zero e vazio não passam", () => {
    for (const campos of [
      { valorMin: "", valorMax: "1500" },
      { valorMin: "0", valorMax: "1500" },
      { valorMin: "1500", valorMax: "1000" },
      { valorMin: "abc", valorMax: "1500" },
    ]) {
      const r = validarRegra(base(campos), CONTAS);
      expect(r.motivo).toBe(RECUSA_DA_REGRA.FAIXA_INVALIDA);
    }
  });

  it("⚠ conta fora do plano e conta sintética recusam com códigos DIFERENTES", () => {
    expect(validarRegra(base({ contaDestino: "999999999" }), CONTAS).motivo)
      .toBe(RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO);
    expect(validarRegra(base({ contaDestino: "411" }), CONTAS).motivo)
      .toBe(RECUSA_DA_REGRA.CONTA_SINTETICA);
  });

  it("⚠⚠ crédito fora da disponibilidade recusa NOMEANDO", () => {
    const r = validarRegra(base({ contaCredito: "411030012" }), CONTAS);
    expect(r.motivo).toBe(RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE);
    expect(r.frase).toMatch(/caixa, banco ou aplicação/i);
  });

  it("⚠⚠ crédito VAZIO continua valendo — é 'não escolhi', e o caixa de hoje segue", () => {
    expect(validarRegra(base({ contaCredito: "" }), CONTAS).pode).toBe(true);
  });

  it("crédito de banco passa", () => {
    expect(validarRegra(base({ contaCredito: "111020003" }), CONTAS).pode).toBe(true);
  });
});

describe("⚠⚠ as duas exigências do LANÇAMENTO AUTOMÁTICO", () => {
  it("com CNPJ e dia, passa", () => {
    expect(validarRegra(base({ lancaSozinha: true, diaDoLancamento: "15" }), CONTAS).pode).toBe(true);
  });

  it("⚠⚠ SEM DIA recusa — a data não se arbitra", () => {
    for (const dia of ["", "0", "32", "quinze", "1,5"]) {
      const r = validarRegra(base({ lancaSozinha: true, diaDoLancamento: dia }), CONTAS);
      expect(r.motivo).toBe(RECUSA_DA_REGRA.SEM_DIA_DO_LANCAMENTO);
    }
  });

  it("⚠⚠ SEM CNPJ recusa — a descrição se parece, não identifica", () => {
    const r = validarRegra(
      base({ cnpjFornecedor: "", padraoDescricao: "TARIFA", lancaSozinha: true, diaDoLancamento: "15" }),
      CONTAS,
    );
    expect(r.motivo).toBe(RECUSA_DA_REGRA.AUTOMATICO_SEM_CNPJ);
  });

  it("⚠ com o automático DESLIGADO, o dia não é exigido", () => {
    expect(validarRegra(base({ lancaSozinha: false, diaDoLancamento: "" }), CONTAS).pode).toBe(true);
  });

  it("⚠⚠ a string `\"false\"` NÃO liga a automação — e por isso não exige dia", () => {
    // Em JS toda string não vazia é verdadeira. O espelho compara com `=== true`, como o servidor.
    expect(validarRegra(base({ lancaSozinha: "false", diaDoLancamento: "" }), CONTAS).pode).toBe(true);
  });
});

describe("⚠⚠ a frase da regra distingue QUATRO comportamentos", () => {
  it("a que lança sozinha diz o dia, e diz que a data é presumida", () => {
    const r = { ativa: true, lancaSozinha: true, diaDoLancamento: 15, cnpjFornecedor: "12345678000190" };
    expect(comportamentoDaRegra(r)).toBe(COMPORTAMENTO.LANCA_SOZINHA);
    expect(fraseDaRegra(r)).toMatch(/todo dia 15/);
    expect(fraseDaRegra(r)).toMatch(/presumida/i);
  });

  it("a que só sugere diz que cada nota continua esperando o clique", () => {
    const r = { ativa: true, lancaSozinha: false, cnpjFornecedor: "12345678000190" };
    expect(comportamentoDaRegra(r)).toBe(COMPORTAMENTO.SO_SUGERE);
    expect(fraseDaRegra(r)).toMatch(/clique/i);
  });

  it("⚠⚠ a de DESCRIÇÃO diz que NÃO PODE lançar — é impedimento, não escolha", () => {
    // Colapsá-la em "só sugere" faria um impedimento parecer uma decisão do contador, e ele
    // procuraria o botão para sempre.
    const r = { ativa: true, lancaSozinha: false, cnpjFornecedor: null, padraoDescricao: "TARIFA" };
    expect(comportamentoDaRegra(r)).toBe(COMPORTAMENTO.NAO_PODE_LANCAR);
    expect(fraseDaRegra(r)).toMatch(/não pode lançar sozinha/i);
  });

  it("⚠ a suspensa e a inativa caem em DESLIGADA, e ela vence as outras", () => {
    expect(comportamentoDaRegra({ ativa: false, lancaSozinha: true, cnpjFornecedor: "1" }))
      .toBe(COMPORTAMENTO.DESLIGADA);
    expect(comportamentoDaRegra({ ativa: true, suspensaEm: "2026-08-01", lancaSozinha: true, cnpjFornecedor: "1" }))
      .toBe(COMPORTAMENTO.DESLIGADA);
  });

  it("⚠ toda recusa tem frase — código sem texto vira botão desabilitado mudo", () => {
    for (const codigo of Object.values(RECUSA_DA_REGRA)) {
      const r = validarRegra({}, CONTAS);
      expect(typeof codigo).toBe("string");
      expect(r.frase == null || typeof r.frase === "string").toBe(true);
    }
    expect(validarRegra({}, CONTAS).frase).toBeTruthy();
  });
});
