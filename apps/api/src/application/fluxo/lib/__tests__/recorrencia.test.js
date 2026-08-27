// O DETECTOR DE RECORRÊNCIA — ele SUGERE, e nada do que ele devolve é gravado.
//
// ⚠⚠ O caso que decide o desenho inteiro é a TAXA ANUAL DO CONSELHO (dono, 25/08/2026): qualquer
// regra que conte MESES a expulsa do fluxo na segunda ausência. Por isso a saída conta CICLOS.

import fs from "node:fs";
import path from "node:path";
import {
  CICLOS_PARA_SAIR,
  LEITURA,
  MESES_DO_CICLO,
  PERIODICIDADE,
  PISO_DE_OBSERVACOES,
  ciclosConsecutivosNoFim,
  coeficienteDeVariacao,
  fraseDaBase,
  lerSerie,
  mediana,
  mesesDaCompetencia,
  porCiclo,
} from "../recorrencia.js";

/** A "Claude" do exemplo do dono: 120 a 140, todo mês. */
const claude = (meses = ["2026-05", "2026-06", "2026-07"], valores = [120, 140, 130]) =>
  meses.map((competencia, i) => ({ competencia, valor: valores[i] }));

describe("⚠⚠ o exemplo do dono — 'a Claude sempre aparece com valor de 120 a 140'", () => {
  it("sugere entrada com 3 meses consecutivos, e o valor é a MEDIANA", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.valorProjetado).toBe(130);
  });

  it("⚠⚠ a FAIXA viaja junto — o ponto sozinho se lê como previsão precisa", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-07" });
    expect(r.base.min).toBe(120);
    expect(r.base.max).toBe(140);
    expect(fraseDaBase(r.base)).toBe("baseado em 3 observações, entre 120 e 140");
  });

  it("⚠ com 2 meses NÃO sugere — o piso é 3, decisão do dono", () => {
    const r = lerSerie({ observacoes: claude(["2026-06", "2026-07"], [120, 140]), cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
    // ⚠ mas a evidência viaja MESMO NA RECUSA — senão a tela não sabe dizer quanto falta
    expect(r.base.n).toBe(2);
  });
});

describe("⚠⚠ MEDIANA, nunca MÉDIA", () => {
  it("um mês com cobrança anual embutida NÃO puxa a projeção", () => {
    // 130, 130, 130, e um mês com 1.500 (a anuidade cobrada junto)
    const obs = claude(["2026-04", "2026-05", "2026-06", "2026-07"], [130, 130, 1500, 130]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    expect(r.valorProjetado).toBe(130);
    // ⚠ a média seria 472,50 — e o fluxo mentiria para cima TODO MÊS dali em diante
    const media = (130 + 130 + 1500 + 130) / 4;
    expect(r.valorProjetado).not.toBe(media);
  });

  it("série par: a mediana é a média dos dois centrais", () => {
    expect(mediana([10, 20, 30, 40])).toBe(25);
  });

  it("⚠ lista vazia devolve `null`, não zero — zero é uma afirmação", () => {
    expect(mediana([])).toBeNull();
    expect(mediana(null)).toBeNull();
  });

  it("⚠ valores ilegíveis são descartados, não viram zero", () => {
    expect(mediana([100, "banana", 200])).toBe(150);
  });
});

describe("⚠⚠ 'CONSECUTIVAS' é o piso — 3 salteadas NÃO são recorrência", () => {
  it("jan, mar, mai não sugere — é o mesmo fornecedor aparecendo de vez em quando", () => {
    const obs = claude(["2026-01", "2026-03", "2026-05"], [130, 130, 130]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-05" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    // ⚠ são 3 observações, mas só 1 consecutiva no fim
    expect(r.base.n).toBe(3);
    expect(r.base.consecutivos).toBe(1);
  });

  it("⚠ o buraco no MEIO conta: 4 observações com furo dão 2 consecutivas", () => {
    const obs = claude(["2026-01", "2026-02", "2026-04", "2026-05"], [1, 1, 1, 1]);
    expect(ciclosConsecutivosNoFim(porCiclo(obs))).toBe(2);
  });

  it("as consecutivas são contadas DO FIM — é o presente que importa", () => {
    const obs = claude(["2026-01", "2026-02", "2026-03", "2026-06", "2026-07", "2026-08"], [1, 1, 1, 1, 1, 1]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-08" });
    expect(r.base.consecutivos).toBe(3);
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A TAXA ANUAL DO CONSELHO — o caso que quebra qualquer desenho que conte MESES.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a taxa ANUAL", () => {
  const conselho = [
    { competencia: "2024-03", valor: 900 },
    { competencia: "2025-03", valor: 950 },
    { competencia: "2026-03", valor: 1000 },
  ];

  it("três anos consecutivos SUGEREM entrada — em MESES, ela teria 1 consecutiva", () => {
    const r = lerSerie({ observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2026-03" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.base.consecutivos).toBe(3);
    expect(r.valorProjetado).toBe(950);
  });

  it("⚠⚠ lida como MENSAL, a MESMA série não sugere nada — é o defeito que a periodicidade evita", () => {
    const r = lerSerie({ observacoes: conselho, periodicidade: PERIODICIDADE.MENSAL, cicloAtual: "2026-03" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.base.consecutivos).toBe(1);
  });

  it("⚠⚠ marcada, ela NÃO sai depois de 2 MESES — a saída conta CICLOS", () => {
    // dois meses depois da última cobrança anual
    const r = lerSerie({
      observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2026-05", jaMarcada: true,
    });
    expect(r.leitura).toBe(LEITURA.CONTINUA);
  });

  it("⚠ mas SAI depois de 2 ANOS sem aparecer", () => {
    const r = lerSerie({
      observacoes: conselho, periodicidade: PERIODICIDADE.ANUAL, cicloAtual: "2028-03", jaMarcada: true,
    });
    expect(r.leitura).toBe(LEITURA.SUGERE_SAIDA);
  });

  it("trimestral usa ciclos de 3 meses", () => {
    const obs = [
      { competencia: "2026-01", valor: 300 },
      { competencia: "2026-04", valor: 300 },
      { competencia: "2026-07", valor: 300 },
    ];
    const r = lerSerie({ observacoes: obs, periodicidade: PERIODICIDADE.TRIMESTRAL, cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(MESES_DO_CICLO[PERIODICIDADE.TRIMESTRAL]).toBe(3);
  });
});

describe("⚠⚠ a saída SUGERE, nunca desmarca", () => {
  it("um ciclo faltando é pagamento que escorregou — CONTINUA", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-08", jaMarcada: true });
    expect(r.leitura).toBe(LEITURA.CONTINUA);
  });

  it("dois ciclos faltando SUGEREM a saída", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09", jaMarcada: true });
    expect(r.leitura).toBe(LEITURA.SUGERE_SAIDA);
    expect(CICLOS_PARA_SAIR).toBe(2);
  });

  it("⚠⚠ mesmo sugerindo saída, o valor e a evidência CONTINUAM — o contador precisa decidir", () => {
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09", jaMarcada: true });
    expect(r.valorProjetado).toBe(130);
    expect(r.base.n).toBe(3);
    expect(r.base.ciclosDesdeAUltima).toBe(2);
  });

  it("⚠ série NÃO marcada que parou há 2 ciclos não vira sugestão de entrada", () => {
    // padrão antigo: existiu, mas acabou. Oferecê-lo poria no fluxo dinheiro que não sai.
    const r = lerSerie({ observacoes: claude(), cicloAtual: "2026-09" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
  });
});

describe("⚠⚠ duas notas no MESMO ciclo somam, não contam duas", () => {
  it("o N fala de CICLOS, não de notas", () => {
    const obs = [
      { competencia: "2026-05", valor: 60 }, { competencia: "2026-05", valor: 70 },
      { competencia: "2026-06", valor: 65 }, { competencia: "2026-06", valor: 65 },
      { competencia: "2026-07", valor: 130 },
    ];
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    // 5 notas, 3 ciclos
    expect(r.base.n).toBe(3);
    // ⚠ e a mediana fala de "valor por MÊS" (130), não "valor por nota" (65)
    expect(r.valorProjetado).toBe(130);
  });
});

describe("⚠ o que NÃO vira observação", () => {
  it("⚠⚠ sem competência ou sem valor NÃO vira ciclo com ZERO", () => {
    const obs = [
      { competencia: "2026-05", valor: 130 },
      { competencia: null, valor: 130 },
      { competencia: "2026-06", valor: null },
      { competencia: "banana", valor: 130 },
    ];
    expect(porCiclo(obs)).toHaveLength(1);
  });

  it("⚠ mês fora de 1..12 não é competência", () => {
    expect(mesesDaCompetencia("2026-13")).toBeNull();
    expect(mesesDaCompetencia("2026-00")).toBeNull();
    expect(mesesDaCompetencia("2026-7")).toBeNull();
  });

  it("⚠ a aritmética é de STRING — `Date` às 22h de Brasília daria o mês seguinte", () => {
    expect(mesesDaCompetencia("2026-01")).toBe(2026 * 12);
    expect(mesesDaCompetencia("2026-12") - mesesDaCompetencia("2026-01")).toBe(11);
    expect(mesesDaCompetencia("2027-01") - mesesDaCompetencia("2026-12")).toBe(1);
  });
});

describe("⚠ o coeficiente de variação — evidência, não gatilho", () => {
  it("série estável tem CV baixo", () => {
    expect(coeficienteDeVariacao([130, 130, 130])).toBe(0);
  });

  it("⚠ média ZERO devolve `null`, não Infinity — sem base não há proporção", () => {
    expect(coeficienteDeVariacao([-10, 10])).toBeNull();
  });

  it("⚠ uma observação só não tem variação a medir", () => {
    expect(coeficienteDeVariacao([130])).toBeNull();
  });

  it("⚠⚠ ele NÃO decide nada — série instável ainda SUGERE, com o CV à vista", () => {
    const obs = claude(["2026-05", "2026-06", "2026-07"], [10, 500, 90]);
    const r = lerSerie({ observacoes: obs, cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
    expect(r.base.cv).toBeGreaterThan(1);
  });
});

describe("⚠⚠ o detector é PURO — nada do que ele devolve é gravado", () => {
  const FONTE = fs.readFileSync(path.join(__dirname, "..", "recorrencia.js"), "utf8");

  it("não importa prisma, não escreve, não olha o relógio", () => {
    // ⚠ Os comentários saem ANTES da varredura: este arquivo CITA `new Date()` para explicar por
    // que não o usa, e a primeira versão do teste casou com a própria explicação. Varredura que
    // acusa o comentário que a justifica não prova nada.
    const codigo = FONTE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codigo).not.toMatch(/from\s+["'].*prisma/i);
    expect(codigo).not.toMatch(/\.create\(|\.update\(|\.upsert\(|\$transaction/);
    // ⚠ o "agora" é INJETADO (`cicloAtual`): um relógio aqui faria o mesmo dado dar respostas
    // diferentes em dias diferentes, e `baseDaMarcacao` deixaria de ser reproduzível.
    expect(codigo).not.toMatch(/new Date\(\s*\)/);
    expect(codigo).not.toMatch(/Date\.now\(/);
    // ⚠ contraprova: a varredura reconhece o padrão quando ele existe de verdade
    expect("const agora = new Date();").toMatch(/new Date\(\s*\)/);
  });

  it("⚠ o vocabulário de periodicidade é o do projeto, não um segundo", () => {
    const gerar = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "obrigacoes", "gerarOcorrencias.js"),
      "utf8",
    );
    // amarração textual: `PERIODICIDADES` de lá tem de conter os três daqui
    for (const p of Object.values(PERIODICIDADE)) {
      expect(gerar).toContain(`"${p}"`);
    }
  });

  it("⚠ o piso e a saída são os do plano", () => {
    expect(PISO_DE_OBSERVACOES).toBe(3);
    expect(CICLOS_PARA_SAIR).toBe(2);
  });
});

describe("⚠ o vazio", () => {
  it("sem observações não quebra e não inventa", () => {
    const r = lerSerie({ observacoes: [], cicloAtual: "2026-07" });
    expect(r.leitura).toBe(LEITURA.POUCAS_OBSERVACOES);
    expect(r.valorProjetado).toBeNull();
    expect(r.base.mediana).toBeNull();
    expect(fraseDaBase(r.base)).toBeNull();
  });

  it("⚠ sem `cicloAtual`, `ciclosDesdeAUltima` é `null` — nunca 0", () => {
    const r = lerSerie({ observacoes: claude() });
    // 0 significaria "aconteceu neste ciclo", que é uma afirmação
    expect(r.base.ciclosDesdeAUltima).toBeNull();
    expect(r.leitura).toBe(LEITURA.SUGERE_ENTRADA);
  });

  it("⚠ chamada sem argumento nenhum não estoura", () => {
    expect(() => lerSerie()).not.toThrow();
  });
});
