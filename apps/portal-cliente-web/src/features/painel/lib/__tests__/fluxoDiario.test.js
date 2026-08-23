// ⚠⚠ A SÉRIE DE DEMONSTRAÇÃO TEM DE ALCANÇAR TODOS OS RAMOS QUE A TELA DESENHA.
//
// É regra desta casa, e ela tem número: *"este projeto foi mordido QUATRO vezes por ramo que só
// existia em produção"*. Cada caso abaixo é um desenho que alguém precisa poder conferir ANTES —
// e um gerador que não os produza faz a tela parecer certa até o dia em que não está.
//
// ⚠ E os ramos não podem depender do SEED: eles valem para qualquer empresa, ou não valem.

import { diasDoMes, fluxoDeCaixaDeDemonstracao } from "../dadosDeDemonstracao";

const EMPRESAS = ["pc-001", "pc-002", "pc-005", "pc-007", "zzz-999"];

describe("diasDoMes", () => {
  it("conta os dias certos, inclusive em fevereiro e em ano bissexto", () => {
    expect(diasDoMes("2026-08")).toHaveLength(31);
    expect(diasDoMes("2026-04")).toHaveLength(30);
    expect(diasDoMes("2026-02")).toHaveLength(28);
    expect(diasDoMes("2024-02")).toHaveLength(29); // bissexto
  });

  it("as pontas são o dia 1 e o último, em `YYYY-MM-DD`", () => {
    const d = diasDoMes("2026-02");
    expect(d[0]).toBe("2026-02-01");
    expect(d[d.length - 1]).toBe("2026-02-28");
  });

  it("⚠ competência ilegível devolve lista vazia — não um mês inventado", () => {
    for (const ruim of ["", null, undefined, "2026", "2026-13", "abacaxi"]) {
      expect(diasDoMes(ruim)).toEqual([]);
    }
  });
});

describe("⚠⚠ os sete ramos, para QUALQUER empresa", () => {
  describe.each(EMPRESAS)("empresa %s", (companyId) => {
    const r = fluxoDeCaixaDeDemonstracao(companyId, "2026-08");
    const dias = r.dias;
    const comMovimento = dias.filter((d) => d.lancamentos.length > 0);

    it("tem dia VAZIO — e é a maioria, como num mês de verdade", () => {
      const vazios = dias.filter((d) => d.lancamentos.length === 0);
      expect(vazios.length).toBeGreaterThan(dias.length / 2);
    });

    it("tem dia SÓ COM ENTRADA", () => {
      expect(comMovimento.some((d) => d.entradas > 0 && d.saidas === 0)).toBe(true);
    });

    it("tem dia SÓ COM SAÍDA", () => {
      expect(comMovimento.some((d) => d.saidas > 0 && d.entradas === 0)).toBe(true);
    });

    it("tem dia com OS DOIS", () => {
      expect(comMovimento.some((d) => d.entradas > 0 && d.saidas > 0)).toBe(true);
    });

    it("⚠⚠ tem dia em que o SALDO VIRA NEGATIVO — é ele que decide cor e sinal", () => {
      expect(dias.some((d) => d.saldo < 0)).toBe(true);
    });

    it("⚠ tem dia com MUITOS lançamentos — é o que faz o painel rolar", () => {
      expect(Math.max(...dias.map((d) => d.lancamentos.length))).toBeGreaterThanOrEqual(5);
    });

    it("⚠ tem movimento no PRIMEIRO e no ÚLTIMO dia — são as bordas do ‹ › do painel", () => {
      expect(dias[0].lancamentos.length).toBeGreaterThan(0);
      expect(dias[dias.length - 1].lancamentos.length).toBeGreaterThan(0);
    });
  });
});

describe("a aritmética fecha", () => {
  const r = fluxoDeCaixaDeDemonstracao("pc-001", "2026-08");

  it("entradas e saídas do dia são a soma dos lançamentos dele", () => {
    for (const d of r.dias) {
      const e = d.lancamentos.filter((l) => l.tipo === "entrada").reduce((n, l) => n + l.valor, 0);
      const s = d.lancamentos.filter((l) => l.tipo === "saida").reduce((n, l) => n + l.valor, 0);
      expect(d.entradas).toBe(e);
      expect(d.saidas).toBe(s);
    }
  });

  it("o saldo é ACUMULADO a partir do saldo inicial, nunca o resultado do dia", () => {
    let esperado = r.saldoInicial;
    for (const d of r.dias) {
      esperado += d.entradas - d.saidas;
      expect(d.saldo).toBe(esperado);
    }
  });

  it("os totais do mês batem, e o saldo final é o do último dia", () => {
    expect(r.totais.entradas).toBe(r.dias.reduce((n, d) => n + d.entradas, 0));
    expect(r.totais.saidas).toBe(r.dias.reduce((n, d) => n + d.saidas, 0));
    expect(r.totais.saldoFinal).toBe(r.dias[r.dias.length - 1].saldo);
  });

  it("⚠ todo valor de lançamento é POSITIVO — quem dá o sinal é o `tipo`", () => {
    // Assim não existe o caso de um valor negativo numa linha de entrada, que a tela leria como
    // saída com sinal trocado.
    for (const d of r.dias) {
      for (const l of d.lancamentos) {
        expect(l.valor).toBeGreaterThan(0);
        expect(["entrada", "saida"]).toContain(l.tipo);
        expect(l.descricao.trim()).not.toBe("");
      }
    }
  });

  it("⚠ os ids dos lançamentos não se repetem dentro do mês", () => {
    const ids = r.dias.flatMap((d) => d.lancamentos.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("⚠ determinístico — recarregar não pode mudar o desenho", () => {
  it("a mesma empresa e a mesma competência dão exatamente o mesmo", () => {
    // É a razão de o mock deste app usar seed: *"para que 'a nota 41 sumiu' seja um defeito e não
    // o acaso do recarregamento"*.
    const a = fluxoDeCaixaDeDemonstracao("pc-001", "2026-08");
    const b = fluxoDeCaixaDeDemonstracao("pc-001", "2026-08");
    expect(a).toEqual(b);
  });

  it("empresas diferentes não recebem os mesmos números", () => {
    const a = fluxoDeCaixaDeDemonstracao("pc-001", "2026-08");
    const b = fluxoDeCaixaDeDemonstracao("pc-002", "2026-08");
    expect(a.totais).not.toEqual(b.totais);
  });
});

describe("⚠ o selo e a borda", () => {
  it("carimba `demonstracao: true` — é o que a tela lê para mostrar o aviso", () => {
    expect(fluxoDeCaixaDeDemonstracao("pc-001", "2026-08").demonstracao).toBe(true);
  });

  it("competência ilegível não explode: devolve mês vazio, ainda carimbado", () => {
    const r = fluxoDeCaixaDeDemonstracao("pc-001", "nada");
    expect(r.dias).toEqual([]);
    expect(r.demonstracao).toBe(true);
    expect(r.totais).toEqual({ entradas: 0, saidas: 0, saldoFinal: 0 });
  });

  it("⚠ os números são REDONDOS de propósito — múltiplos de 50", () => {
    // `R$ 47.312,88` pede para ser lido como real; `R$ 1.250,00` não.
    const r = fluxoDeCaixaDeDemonstracao("pc-005", "2026-08");
    for (const d of r.dias) {
      for (const l of d.lancamentos) expect(l.valor % 50).toBe(0);
    }
  });
});
