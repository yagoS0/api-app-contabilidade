// QUEM APURA PELO LUCRO PRESUMIDO — três respostas, e a terceira é a que importa.
//
// Enquanto o regime só ESCONDIA a aba, errar custava uma aba a menos. Agora ele decide QUAL das
// duas telas renderiza e qual rota calcula: errar passa a mostrar a apuração de outro regime.

import { APURACAO, apuracaoDoRegime, podeApurarPresumido } from "../regimeDoPresumido.js";

describe("⚠ os valores que EXISTEM em produção", () => {
  // Medido em 27/08/2026 (`scripts/diag-regime-para-aba-lp.mjs`): `Company.regimeTributario` tem
  // exatamente dois valores — SIMPLES (23) e LUCRO_PRESUMIDO (11) —, e zero nulos.
  it("`LUCRO_PRESUMIDO` apura pelo Presumido", () => {
    expect(apuracaoDoRegime("LUCRO_PRESUMIDO")).toBe(APURACAO.PRESUMIDO);
  });

  it("`SIMPLES` apura pelo Simples", () => {
    expect(apuracaoDoRegime("SIMPLES")).toBe(APURACAO.SIMPLES);
  });
});

describe("⚠ OS DOIS VOCABULÁRIOS — a `Company` e o `CadastroFiscal` escrevem diferente", () => {
  it("`SIMPLES_NACIONAL` (o do CadastroFiscal) é lido igual a `SIMPLES` (o da Company)", () => {
    // Comparar por igualdade faria a mesma empresa ser de dois regimes conforme a fonte lida.
    expect(apuracaoDoRegime("SIMPLES_NACIONAL")).toBe(apuracaoDoRegime("SIMPLES"));
  });

  it("caixa e espaço não mudam a resposta", () => {
    for (const v of ["lucro_presumido", "  Lucro Presumido  ", "LUCRO PRESUMIDO"]) {
      expect(apuracaoDoRegime(v)).toBe(APURACAO.PRESUMIDO);
    }
  });

  it("LUCRO REAL cai na mesma tela do Presumido — os dois apuram por trimestre", () => {
    expect(apuracaoDoRegime("LUCRO_REAL")).toBe(APURACAO.PRESUMIDO);
  });

  it("⚠ MEI é lido ANTES de SIMPLES — o MEI É optante, e um texto com as duas palavras é MEI", () => {
    expect(apuracaoDoRegime("MEI")).toBe(APURACAO.SIMPLES);
    expect(apuracaoDoRegime("SIMPLES NACIONAL - MEI")).toBe(APURACAO.SIMPLES);
  });
});

describe("⚠⚠ O TERCEIRO ESTADO — e ele NUNCA colapsa nos outros dois", () => {
  it("ausente, vazio e em branco respondem DESCONHECIDO", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(apuracaoDoRegime(v)).toBe(APURACAO.DESCONHECIDO);
    }
    expect(apuracaoDoRegime()).toBe(APURACAO.DESCONHECIDO);
  });

  it("⚠⚠ texto que EXISTE e não se reconhece não vira Simples por descarte", () => {
    // `mapRegime` da rota v2 termina em `return "SIMPLES_NACIONAL"` porque lá o default é
    // inofensivo. Copiá-lo aqui recusaria a tela do Presumido a partir de um chute.
    for (const v of ["LUCRO ARBITRADO", "IMUNE", "xyz", "0"]) {
      expect(apuracaoDoRegime(v)).toBe(APURACAO.DESCONHECIDO);
    }
  });
});

describe("⚠⚠ A PORTA — o que passa, o que recusa, e o que a recusa diz", () => {
  it("Presumido e Real passam, sem aviso", () => {
    for (const v of ["LUCRO_PRESUMIDO", "LUCRO_REAL"]) {
      const r = podeApurarPresumido(v);
      expect(r.pode).toBe(true);
      expect(r.aviso).toBeNull();
    }
  });

  it("⚠⚠ Simples e MEI são RECUSADOS — a apuração deles é o PGDAS-D", () => {
    for (const v of ["SIMPLES", "SIMPLES_NACIONAL", "MEI"]) {
      expect(podeApurarPresumido(v).pode).toBe(false);
    }
  });

  it("⚠ e a recusa diz PARA ONDE IR, não só que não pode", () => {
    // "Não permitido" mandaria o contador procurar defeito onde há uma outra tela certa.
    const r = podeApurarPresumido("SIMPLES");
    expect(r.motivo).toMatch(/PGDAS-D/);
    expect(r.motivo).toMatch(/aba Apuração do Simples/i);
    expect(r.apuracao).toBe(APURACAO.SIMPLES);
  });

  it("⚠⚠ DESCONHECIDO PASSA — bloquear por falta de dado é o erro caro nesta direção", () => {
    // Mesmo critério da guarda da EFD em `routes/firm/obrigacoes.js`.
    const r = podeApurarPresumido(null);
    expect(r.pode).toBe(true);
    expect(r.apuracao).toBe(APURACAO.DESCONHECIDO);
  });

  it("⚠⚠ mas PASSAR não é AFIRMAR que a empresa é do Presumido — o aviso viaja junto", () => {
    // Sem ele, um cálculo feito sobre um regime que ninguém cadastrou se leria como apuração
    // conferida. É o mesmo desenho de `NAO_CONFERIVEL` da auditoria de notas.
    const r = podeApurarPresumido("");
    expect(r.aviso).toMatch(/não está cadastrado/i);
    expect(r.aviso).toMatch(/confirme o regime/i);
  });
});
