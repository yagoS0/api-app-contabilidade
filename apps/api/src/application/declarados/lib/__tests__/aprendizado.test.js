// O APRENDIZADO — quando uma regra nasce sozinha, e quando ela se freia.
//
// ⚠ Módulo puro. O que se prende aqui é o que separa "hábito" de "dúvida", e o que impede a regra
// de se auto-confirmar.

import {
  FOLGA_DA_FAIXA,
  MOTIVO_DA_SUSPENSAO,
  PISO_DE_CONFIRMACOES,
  confirmacoesQueContam,
  decidirAprendizado,
} from "../aprendizado.js";

const confirmado = (extra = {}) => ({
  id: "d-1",
  estado: "CONTABILIZADO",
  contaAplicada: "411030012",
  valor: 1000,
  valorAjustado: null,
  regraId: null,
  ...extra,
});

const decidir = (declarados, regraExistente = null) =>
  decidirAprendizado({ cnpjFornecedor: "12345678000190", declarados, regraExistente });

describe("⚠⚠ O QUE CONTA COMO CONFIRMAÇÃO", () => {
  it("só CONTABILIZADO com conta aplicada", () => {
    const lista = [
      confirmado({ id: "a" }),
      confirmado({ id: "b", estado: "A_CONFERIR" }),
      confirmado({ id: "c", estado: "RECUSADO" }),
      confirmado({ id: "d", estado: "AGUARDANDO_PAGAMENTO" }),
      confirmado({ id: "e", contaAplicada: null }),
    ];
    expect(confirmacoesQueContam(lista).map((d) => d.id)).toEqual(["a"]);
  });

  it("⚠⚠ CONFIRMAÇÃO NASCIDA DE REGRA NÃO REALIMENTA O APRENDIZADO", () => {
    // Sem isto a regra se AUTO-CONFIRMA: ela lança, a própria linha vira "confirmação", e uma conta
    // errada se prova certa sozinha, em série.
    const lista = [confirmado({ id: "a" }), confirmado({ id: "b", regraId: "r-1" })];
    expect(confirmacoesQueContam(lista).map((d) => d.id)).toEqual(["a"]);
  });

  it("lista vazia ou nula não estoura", () => {
    expect(confirmacoesQueContam([])).toEqual([]);
    expect(confirmacoesQueContam(null)).toEqual([]);
  });
});

describe("⚠⚠ UNANIMIDADE **E** PISO — dúvida não vira automação", () => {
  it(`uma confirmação só NÃO cria regra (o piso é ${PISO_DE_CONFIRMACOES})`, () => {
    expect(decidir([confirmado()]).acao).toBe("NADA");
  });

  it("duas confirmações na MESMA conta criam a regra", () => {
    const r = decidir([confirmado({ id: "a" }), confirmado({ id: "b" })]);
    expect(r.acao).toBe("CRIAR");
    expect(r.proposta.contaDestino).toBe("411030012");
  });

  it("⚠⚠ duas confirmações em contas DIFERENTES não criam nada", () => {
    // Isso não é um hábito, é uma dúvida.
    const r = decidir([confirmado({ id: "a" }), confirmado({ id: "b", contaAplicada: "411010004" })]);
    expect(r.acao).toBe("NADA");
  });

  it("⚠ três confirmações com UMA divergente também não criam", () => {
    const r = decidir([
      confirmado({ id: "a" }),
      confirmado({ id: "b" }),
      confirmado({ id: "c", contaAplicada: "411010004" }),
    ]);
    expect(r.acao).toBe("NADA");
  });

  it("⚠ sem CNPJ não há aprendizado — a âncora forte é o CNPJ", () => {
    expect(decidirAprendizado({ cnpjFornecedor: null, declarados: [confirmado(), confirmado()] }).acao).toBe("NADA");
  });

  it("⚠ o CNPJ sai só com dígitos na proposta", () => {
    const r = decidirAprendizado({
      cnpjFornecedor: "12.345.678/0001-90",
      declarados: [confirmado({ id: "a" }), confirmado({ id: "b" })],
    });
    expect(r.proposta.cnpjFornecedor).toBe("12345678000190");
  });
});

describe("⚠⚠ A FAIXA É OBRIGATÓRIA — regra sem faixa erra em série", () => {
  it(`a faixa sai com ±${FOLGA_DA_FAIXA * 100}% sobre o menor e o maior`, () => {
    const r = decidir([confirmado({ id: "a", valor: 1000 }), confirmado({ id: "b", valor: 2000 })]);
    expect(r.proposta.valorMin).toBe(850);
    expect(r.proposta.valorMax).toBe(2300);
  });

  it("⚠ o valor AJUSTADO vence o original — é ele que virou lançamento", () => {
    const r = decidir([
      confirmado({ id: "a", valor: 1000, valorAjustado: 500 }),
      confirmado({ id: "b", valor: 1000 }),
    ]);
    expect(r.proposta.valorMin).toBe(425);
    expect(r.proposta.valorMax).toBe(1150);
  });

  it("⚠⚠ SEM VALOR LEGÍVEL, NADA NASCE — não se inventa faixa", () => {
    // Faixa é obrigatória; fabricá-la a partir de um valor ausente daria uma regra que casa com
    // qualquer coisa.
    expect(decidir([confirmado({ id: "a", valor: null }), confirmado({ id: "b" })]).acao).toBe("NADA");
    expect(decidir([confirmado({ id: "a", valor: 0 }), confirmado({ id: "b" })]).acao).toBe("NADA");
  });

  it("a faixa é arredondada a centavos", () => {
    const r = decidir([confirmado({ id: "a", valor: 333.33 }), confirmado({ id: "b", valor: 333.33 })]);
    expect(r.proposta.valorMin).toBe(283.33);
    expect(r.proposta.valorMax).toBe(383.33);
  });
});

describe("⚠⚠ A TRILHA — aprendizado invisível não se desliga", () => {
  it("a proposta carrega os declarados que a geraram", () => {
    const r = decidir([confirmado({ id: "a" }), confirmado({ id: "b" })]);
    expect(r.proposta.confirmacoesBase).toEqual(["a", "b"]);
  });

  it("⚠ e só os que CONTAM entram na trilha", () => {
    const r = decidir([
      confirmado({ id: "a" }),
      confirmado({ id: "b" }),
      confirmado({ id: "c", regraId: "r-9" }),
    ]);
    expect(r.proposta.confirmacoesBase).toEqual(["a", "b"]);
  });
});

describe("⚠⚠ A SUSPENSÃO — o freio", () => {
  const regra = (extra = {}) => ({
    id: "r-1",
    origemRegra: "APRENDIDA",
    contaDestino: "411030012",
    suspensaEm: null,
    ...extra,
  });

  it("⚠⚠ UMA confirmação em outra conta suspende NA HORA", () => {
    // A unanimidade que gerou a regra deixou de existir: o contador mudou de ideia.
    const r = decidir([confirmado({ id: "a" }), confirmado({ id: "b", contaAplicada: "411010004" })], regra());
    expect(r.acao).toBe("SUSPENDER");
    expect(r.motivo).toBe(MOTIVO_DA_SUSPENSAO.DIVERGENCIA);
    expect(r.frase).toMatch(/outra conta/i);
  });

  it("⚠ o histórico inteiro em OUTRA conta também suspende", () => {
    const r = decidir([confirmado({ id: "a", contaAplicada: "411010004" })], regra());
    expect(r.acao).toBe("SUSPENDER");
    expect(r.motivo).toBe(MOTIVO_DA_SUSPENSAO.DIVERGENCIA);
  });

  it("⚠ base desfeita suspende, com motivo PRÓPRIO", () => {
    // "Desfizeram tudo" e "passaram a lançar em outra conta" são causas diferentes, e o contador
    // conserta cada uma de um jeito.
    const r = decidir([], regra());
    expect(r.acao).toBe("SUSPENDER");
    expect(r.motivo).toBe(MOTIVO_DA_SUSPENSAO.BASE_DESFEITA);
  });

  it("histórico coerente não suspende nada", () => {
    expect(decidir([confirmado({ id: "a" }), confirmado({ id: "b" })], regra()).acao).toBe("NADA");
  });

  it("⚠⚠ REGRA MANUAL NUNCA SE SUSPENDE SOZINHA", () => {
    // Ela foi decisão explícita de uma pessoa; desligá-la por observação seria o sistema revogando
    // essa decisão. Quem a desliga é o contador, na tela.
    const r = decidir(
      [confirmado({ id: "a", contaAplicada: "411010004" })],
      regra({ origemRegra: "MANUAL" }),
    );
    expect(r.acao).toBe("NADA");
  });

  it("⚠ regra JÁ suspensa não se suspende de novo — isso reescreveria a data e o motivo", () => {
    const r = decidir([], regra({ suspensaEm: new Date("2026-08-01") }));
    expect(r.acao).toBe("NADA");
  });

  it("⚠⚠ e uma regra existente NUNCA é recriada — só suspensa ou deixada em paz", () => {
    const acoes = new Set();
    for (const declarados of [[], [confirmado()], [confirmado({ id: "a" }), confirmado({ id: "b" })]]) {
      acoes.add(decidir(declarados, regra()).acao);
    }
    expect(acoes.has("CRIAR")).toBe(false);
  });
});

describe("⚠ o módulo é PURO", () => {
  it("a fonte não importa prisma nem tem relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "aprendizado.js"), "utf8");
    expect(fonte).not.toMatch(/from "@prisma|infrastructure\/db|new Date\(\)/);
  });

  it("⚠ toda suspensão tem frase", () => {
    const { FRASE_DA_SUSPENSAO } = require("../aprendizado.js");
    for (const m of Object.values(MOTIVO_DA_SUSPENSAO)) expect(FRASE_DA_SUSPENSAO[m]).toBeTruthy();
  });
});
