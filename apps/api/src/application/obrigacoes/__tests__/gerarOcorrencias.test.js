import {
  calcularVencimentos,
  competenciaComDefasagem,
  mesesDaJanela,
  ultimoDiaDoMes,
} from "../gerarOcorrencias.js";
import { ajustarParaDiaUtil, criarConsultorDeFeriados, deISO, paraISO } from "../diaUtil.js";

const semFeriado = () => false;

describe("mesesDaJanela", () => {
  it("mensal ocupa todos os 12 meses da janela", () => {
    const meses = mesesDaJanela("MENSAL", null, { ano: 2026, mes: 8 }, 12);
    expect(meses).toHaveLength(12);
    expect(meses[0]).toEqual({ ano: 2026, mes: 8 });
    // A janela vira o ano sem escorregar: 12 meses a partir de agosto/2026 termina em julho/2027.
    expect(meses[11]).toEqual({ ano: 2027, mes: 7 });
  });

  it("trimestral cai de 3 em 3 a partir do mes de referencia", () => {
    const meses = mesesDaJanela("TRIMESTRAL", 1, { ano: 2026, mes: 1 }, 12);
    expect(meses.map((m) => m.mes)).toEqual([1, 4, 7, 10]);
  });

  it("trimestral acerta o ciclo mesmo comecando a janela fora dele", () => {
    // Janela comeca em maio, ciclo ancorado em janeiro: os meses validos seguem 7 e 10.
    const meses = mesesDaJanela("TRIMESTRAL", 1, { ano: 2026, mes: 5 }, 12);
    expect(meses.map((m) => `${m.ano}-${m.mes}`)).toEqual(["2026-7", "2026-10", "2027-1", "2027-4"]);
  });

  it("anual acontece uma vez", () => {
    const meses = mesesDaJanela("ANUAL", 5, { ano: 2026, mes: 8 }, 12);
    expect(meses).toEqual([{ ano: 2027, mes: 5 }]);
  });

  it("recusa trimestral e anual sem mes de referencia, em vez de assumir janeiro", () => {
    // Assumir um mes produziria uma agenda plausivel e errada — falha silenciosa.
    expect(() => mesesDaJanela("TRIMESTRAL", null, { ano: 2026, mes: 1 }, 12)).toThrow(
      /mes_referencia_obrigatorio/,
    );
    expect(() => mesesDaJanela("ANUAL", null, { ano: 2026, mes: 1 }, 12)).toThrow(
      /mes_referencia_obrigatorio/,
    );
  });
});

describe("dia que o mes nao comporta", () => {
  it("dia 31 em fevereiro vira o ultimo dia de fevereiro, nao marco", () => {
    expect(ultimoDiaDoMes(2026, 2)).toBe(28);
    const [fev] = calcularVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 31, ajusteDiaUtil: "MANTER" },
      { inicio: { ano: 2026, mes: 2 }, quantidadeMeses: 1 },
      semFeriado,
    );
    expect(fev.iso).toBe("2026-02-28");
    expect(fev.mesVencimento).toBe("2026-02");
  });

  it("respeita ano bissexto", () => {
    expect(ultimoDiaDoMes(2028, 2)).toBe(29);
    const [fev] = calcularVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 30, ajusteDiaUtil: "MANTER" },
      { inicio: { ano: 2028, mes: 2 }, quantidadeMeses: 1 },
      semFeriado,
    );
    expect(fev.iso).toBe("2028-02-29");
  });
});

describe("ajuste de dia util", () => {
  // 2026-08-15 e um sabado; 2026-08-16 e domingo.
  it("ANTECIPAR puxa o sabado para a sexta", () => {
    expect(paraISO(ajustarParaDiaUtil(deISO("2026-08-15"), "ANTECIPAR"))).toBe("2026-08-14");
  });

  it("POSTERGAR empurra o domingo para a segunda", () => {
    expect(paraISO(ajustarParaDiaUtil(deISO("2026-08-16"), "POSTERGAR"))).toBe("2026-08-17");
  });

  it("MANTER nao move nada", () => {
    expect(paraISO(ajustarParaDiaUtil(deISO("2026-08-15"), "MANTER"))).toBe("2026-08-15");
  });

  it("nao mexe em dia util", () => {
    expect(paraISO(ajustarParaDiaUtil(deISO("2026-08-14"), "ANTECIPAR"))).toBe("2026-08-14");
  });

  it("pula feriado colado no fim de semana", () => {
    // Sexta 2026-08-14 feriado + sabado + domingo => ANTECIPAR tem que chegar na quinta.
    const ehFeriado = (iso) => iso === "2026-08-14";
    expect(paraISO(ajustarParaDiaUtil(deISO("2026-08-15"), "ANTECIPAR", ehFeriado))).toBe(
      "2026-08-13",
    );
  });

  it("feriado desconhecido simplesmente nao move a data", () => {
    // A falha segura: mostrar a data legal crua e melhor que antecipar por um feriado inventado.
    const quinta = deISO("2026-08-13");
    expect(paraISO(ajustarParaDiaUtil(quinta, "ANTECIPAR", semFeriado))).toBe("2026-08-13");
  });
});

describe("consultor de feriados", () => {
  const feriados = [
    { data: deISO("2026-09-07"), abrangencia: "NACIONAL", municipio: null },
    { data: deISO("2026-08-15"), abrangencia: "MUNICIPAL", municipio: "Belo Horizonte" },
  ];

  it("nacional vale para qualquer empresa", () => {
    expect(criarConsultorDeFeriados(feriados, "Contagem")("2026-09-07")).toBe(true);
  });

  it("municipal so vale no municipio da empresa", () => {
    expect(criarConsultorDeFeriados(feriados, "Belo Horizonte")("2026-08-15")).toBe(true);
    // Antecipar o vencimento de uma empresa de outra cidade por feriado alheio seria erro puro.
    expect(criarConsultorDeFeriados(feriados, "Contagem")("2026-08-15")).toBe(false);
  });

  it("empresa sem municipio cadastrado nao herda feriado municipal de ninguem", () => {
    expect(criarConsultorDeFeriados(feriados, null)("2026-08-15")).toBe(false);
  });
});

describe("competencia de referencia (defasagem)", () => {
  it("recua os meses pedidos e vira o ano corretamente", () => {
    expect(competenciaComDefasagem(2026, 8, 1)).toBe("2026-07");
    expect(competenciaComDefasagem(2026, 1, 1)).toBe("2025-12");
    expect(competenciaComDefasagem(2026, 2, 3)).toBe("2025-11");
    expect(competenciaComDefasagem(2026, 8, 0)).toBe("2026-08");
  });

  it("o vencimento e a competencia do servico sao meses DIFERENTES", () => {
    // "Transmitir a apuracao de julho" vence em agosto. Confundir os dois faria o verificador
    // consultar a competencia errada e concluir (ou nao) a ocorrencia por engano.
    const [ago] = calcularVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER", defasagemMeses: 1 },
      { inicio: { ano: 2026, mes: 8 }, quantidadeMeses: 1 },
      semFeriado,
    );
    expect(ago.mesVencimento).toBe("2026-08");
    expect(ago.competenciaRef).toBe("2026-07");
  });

  it("defasagem 0 serve para servico do proprio mes", () => {
    const [ago] = calcularVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "MANTER", defasagemMeses: 0 },
      { inicio: { ano: 2026, mes: 8 }, quantidadeMeses: 1 },
      semFeriado,
    );
    expect(ago.competenciaRef).toBe("2026-08");
  });
});

describe("janela de 12 meses", () => {
  it("mensal gera 12, trimestral 4 e anual 1", () => {
    const base = { diaVencimento: 20, ajusteDiaUtil: "MANTER" };
    const janela = { inicio: { ano: 2026, mes: 1 }, quantidadeMeses: 12 };
    expect(calcularVencimentos({ ...base, periodicidade: "MENSAL" }, janela, semFeriado)).toHaveLength(12);
    expect(
      calcularVencimentos({ ...base, periodicidade: "TRIMESTRAL", mesReferencia: 1 }, janela, semFeriado),
    ).toHaveLength(4);
    expect(
      calcularVencimentos({ ...base, periodicidade: "ANUAL", mesReferencia: 5 }, janela, semFeriado),
    ).toHaveLength(1);
  });
});
