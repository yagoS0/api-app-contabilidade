// O PERÍODO DO RELATÓRIO.
//
// Dois comportamentos aqui produzem número que vai para o CLIENTE do contador, e por isso têm
// teste: o período anterior precisa ter o MESMO tamanho (senão a variação não significa nada), e
// variação sobre base zero não pode virar percentual (senão a linha mais chamativa do relatório
// nasce de uma divisão por zero).

import {
  parse, deslocar, meses, intervalosDisponiveis, periodoAnterior, variacao, somaPorTipo, somaTotal,
} from "../periodoRelatorio";

describe("deslocar", () => {
  it("anda meses para frente e para trás", () => {
    expect(deslocar("2026-07", 1)).toBe("2026-08");
    expect(deslocar("2026-07", -1)).toBe("2026-06");
  });

  it("vira o ano nas duas direções", () => {
    expect(deslocar("2026-12", 1)).toBe("2027-01");
    expect(deslocar("2026-01", -1)).toBe("2025-12");
  });

  it("recua 12 meses sem escorregar", () => {
    expect(deslocar("2026-03", -12)).toBe("2025-03");
  });
});

describe("intervalos oferecidos", () => {
  const i = (chave) => intervalosDisponiveis("2026-07").find((x) => x.chave === chave);

  it("trimestre são TRÊS meses contando a referência", () => {
    expect(i("trimestre")).toMatchObject({ de: "2026-05", ate: "2026-07" });
    expect(meses("2026-05", "2026-07")).toBe(3);
  });

  it("ano-calendário começa em janeiro do ano da referência", () => {
    expect(i("ano")).toMatchObject({ de: "2026-01", ate: "2026-07" });
  });

  it("últimos 12 meses são 12, não 13", () => {
    // Um erro de ±1 aqui compara 12 meses com 13 e produz variação falsa em todo relatório.
    expect(i("doze")).toMatchObject({ de: "2025-08", ate: "2026-07" });
    expect(meses("2025-08", "2026-07")).toBe(12);
  });

  it("⚠ nenhum intervalo passa da competência de referência", () => {
    // A referência é o mês FECHADO. Incluir o mês corrente mostraria queda em toda linha, todo
    // mês, e ensinaria o contador a ignorar o último ponto do gráfico.
    for (const x of intervalosDisponiveis("2026-07")) expect(x.ate).toBe("2026-07");
  });
});

describe("⚠ período anterior tem o MESMO tamanho", () => {
  it("mês compara com o mês anterior", () => {
    expect(periodoAnterior("2026-07", "2026-07")).toEqual({ de: "2026-06", ate: "2026-06" });
  });

  it("trimestre compara com o trimestre anterior, não com um mês", () => {
    // Comparar um trimestre com "o mês passado" produz variação que não significa nada — e é o
    // tipo de número que vai para o cliente sem ninguém conferir.
    expect(periodoAnterior("2026-05", "2026-07")).toEqual({ de: "2026-02", ate: "2026-04" });
  });

  it("doze meses comparam com os doze anteriores", () => {
    expect(periodoAnterior("2025-08", "2026-07")).toEqual({ de: "2024-08", ate: "2025-07" });
  });

  it("intervalo inválido não inventa período", () => {
    expect(periodoAnterior("2026-07", "2026-05")).toBeNull();
    expect(periodoAnterior("lixo", "2026-07")).toBeNull();
  });
});

describe("variação", () => {
  it("calcula absoluta e percentual", () => {
    const v = variacao(120_000, 100_000);
    expect(v.absoluta).toBe(20_000);
    expect(v.percentual).toBeCloseTo(0.2, 10);
  });

  it("queda vem negativa nos dois", () => {
    const v = variacao(80_000, 100_000);
    expect(v.absoluta).toBe(-20_000);
    expect(v.percentual).toBeCloseTo(-0.2, 10);
  });

  it("⚠ base ZERO não vira percentual — vira frase", () => {
    // Sair de R$ 0 para R$ 10.000 não é "crescimento de ∞%" nem de "100%": é aparecimento.
    const v = variacao(10_000, 0);
    expect(v.percentual).toBeNull();
    expect(v.leitura).toBe("não havia movimento no período anterior");
    expect(v.absoluta).toBe(10_000);
  });

  it("⚠ zero nos DOIS períodos é caso próprio, não 'sem crescimento'", () => {
    const v = variacao(0, 0);
    expect(v.percentual).toBeNull();
    expect(v.leitura).toBe("sem movimento nos dois períodos");
  });
});

describe("somas", () => {
  const linhas = [
    { competencia: "2026-05", porTipo: { RECEITA: 100, DESPESA: 40 }, total: 140 },
    { competencia: "2026-06", porTipo: {}, total: 0, semLancamento: true },
    { competencia: "2026-07", porTipo: { RECEITA: 200, DESPESA: 50 }, total: 250 },
  ];

  it("soma por tipo ao longo do período", () => {
    expect(somaPorTipo(linhas, "RECEITA")).toBe(300);
    expect(somaPorTipo(linhas, "DESPESA")).toBe(90);
  });

  it("tipo inexistente soma zero, não quebra", () => {
    expect(somaPorTipo(linhas, "FOLHA")).toBe(0);
  });

  it("⚠ o mês SEM lançamento entra na série com zero — não some", () => {
    // Série que pula meses esconde justamente o mês em que ninguém lançou nada, que é o que o
    // relatório deveria gritar.
    expect(linhas).toHaveLength(3);
    expect(somaTotal(linhas)).toBe(390);
  });
});
