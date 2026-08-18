// A ALÍQUOTA EFETIVA QUE VAI IMPRESSA NA NOTA (`pTotTribSN`) — a regra, sem tela e SEM REDE.
//
// As duas decisões do dono (18/08/2026) que estes casos existem para TRAVAR:
//
//   1. A CONTA É `deReceita` (DAS ÷ receita), NUNCA `efetiva`. A rota devolve as duas na MESMA
//      linha; `efetiva` inclui o INSS de guia separada, que não está dentro do DAS e portanto não é
//      tributo do Simples Nacional — e `pTotTribSN` é, pelo nome, "total de tributos do Simples
//      Nacional". Por isso há um caso em que as duas divergem, com a asserção sobre as DUAS: a que
//      escolhe `deReceita` e a que recusa `efetiva`. Escolher pela primeira sozinha passaria mesmo
//      se o campo lido fosse o outro num dia em que coincidissem (medido em produção: onde não há
//      INSS à parte, as duas dão 6,00%).
//
//   2. ZERO NUNCA É FABRICADO. O backend faz `d > 0 ? n/d*100 : 0`
//      (`apps/api/src/routes/client/index.js:704`, conferido): sem receita, ou sem extrato do
//      PGDAS-D capturado, a resposta é `0` — indistinguível de uma alíquota de zero por cento. Numa
//      nota, 0% é uma AFIRMAÇÃO sobre carga tributária (Lei 12.741/2012), não uma ausência. A lib
//      se recusa a ler `deReceita` sem os DOIS insumos crus, e devolve `valor: null` + motivo.
//
// E a terceira, que é de honestidade: a competência EXATA quando existe; senão a ÚLTIMA APURADA
// **dizendo qual foi**. Nunca extrapolar, projetar, nem repetir o número anterior fingindo ser o do
// mês da nota.

import {
  ORIGEM_ALIQUOTA,
  escolherAliquotaEfetiva,
  janelaDaConsulta,
  textoDaProcedencia,
} from "../aliquotaEfetiva";

/** Uma linha como a rota a devolve, com os dois insumos crus provando o percentual. */
function linha(competencia, { dasExtrato, faturamento, deReceita, efetiva = null }) {
  return {
    competencia,
    faturamento,
    dasExtrato,
    impostosPagos: efetiva === null ? dasExtrato : Number(((efetiva / 100) * faturamento).toFixed(2)),
    deReceita,
    efetiva: efetiva === null ? deReceita : efetiva,
  };
}

const JULHO = linha("2026-07", { dasExtrato: 6000, faturamento: 100000, deReceita: 6 });
const JUNHO = linha("2026-06", { dasExtrato: 6240, faturamento: 100000, deReceita: 6.24 });

describe("zero nunca é fabricado — sem os DOIS insumos crus, o campo fica vazio", () => {
  // ⚠ O caso de produção: empresa cujo extrato do PGDAS-D nunca foi capturado. Faturou, mas o
  // `dasExtrato` é 0 — e o backend responde `deReceita: 0`, que numa nota diria "carga tributária
  // zero" ao tomador.
  test("faturamento sem extrato do PGDAS-D não vira 0%", () => {
    const serie = [linha("2026-07", { dasExtrato: 0, faturamento: 100000, deReceita: 0 })];
    const escolha = escolherAliquotaEfetiva(serie, "2026-07");
    expect(escolha.valor).toBeNull();
    expect(escolha.valor).not.toBe(0);
    expect(escolha.competencia).toBeNull();
    expect(escolha.motivo).toMatch(/receita apurada e extrato do PGDAS-D/);
  });

  test("extrato sem faturamento também não vira 0%", () => {
    const serie = [linha("2026-07", { dasExtrato: 6000, faturamento: 0, deReceita: 0 })];
    expect(escolherAliquotaEfetiva(serie, "2026-07").valor).toBeNull();
  });

  test("mês sem nada (o zero duplo do backend) não vira 0%", () => {
    const serie = [linha("2026-07", { dasExtrato: 0, faturamento: 0, deReceita: 0 })];
    expect(escolherAliquotaEfetiva(serie, "2026-07").valor).toBeNull();
  });

  test("série vazia, nula ou fora de forma devolve ausência com motivo — nunca 0", () => {
    for (const serie of [[], null, undefined, "erro", { data: [] }]) {
      const escolha = escolherAliquotaEfetiva(serie, "2026-07");
      expect(escolha.valor).toBeNull();
      expect(escolha.exata).toBe(false);
      expect(String(escolha.motivo)).toMatch(/não há de onde tirar a alíquota efetiva/);
    }
  });

  // ⚠ A linha SEM prova não é "quase boa": ela sai da conta inteira, e a resposta passa a ser a de
  // outro mês — dizendo que é de outro mês. O zero do mês da nota nunca é oferecido.
  test("a competência da nota, zerada, é IGNORADA e a resposta cai na última apurada", () => {
    const serie = [
      linha("2026-08", { dasExtrato: 0, faturamento: 0, deReceita: 0 }),
      JULHO,
    ];
    const escolha = escolherAliquotaEfetiva(serie, "2026-08");
    expect(escolha.valor).toBe(6);
    expect(escolha.competencia).toBe("2026-07");
    expect(escolha.exata).toBe(false);
  });
});

describe("a conta é `deReceita` (DAS ÷ receita) — `efetiva` inclui INSS e não serve à nota", () => {
  // ⚠ Os dois números da MESMA linha, divergindo como divergem em produção (6,00% × 7,26%). A
  // asserção é dupla de propósito: pegar o valor certo E recusar o errado.
  test("com INSS em guia separada, escolhe o DAS e RECUSA a efetiva total", () => {
    const serie = [linha("2026-07", { dasExtrato: 6000, faturamento: 100000, deReceita: 6, efetiva: 7.26 })];
    const escolha = escolherAliquotaEfetiva(serie, "2026-07");
    expect(escolha.valor).toBe(6);
    expect(escolha.valor).not.toBe(7.26);
    expect(escolha.valor).not.toBe(serie[0].efetiva);
  });

  test("a outra divergência medida em produção (6,24% × 7,01%) tem o mesmo desfecho", () => {
    const serie = [linha("2026-06", { dasExtrato: 6240, faturamento: 100000, deReceita: 6.24, efetiva: 7.01 })];
    expect(escolherAliquotaEfetiva(serie, "2026-06").valor).toBe(6.24);
  });
});

describe("a competência escolhida — exata, ou a última apurada DIZENDO qual foi", () => {
  test("a competência da nota, quando apurada, é a resposta e `exata` é true", () => {
    const escolha = escolherAliquotaEfetiva([JUNHO, JULHO], "2026-07");
    expect(escolha).toMatchObject({ valor: 6, competencia: "2026-07", exata: true, motivo: null });
  });

  // ⚠ Ao emitir, o mês corrente quase nunca está apurado — o DAS só existe depois do PGDAS-D.
  test("sem a competência da nota, usa a mais recente apurada e marca `exata: false`", () => {
    const escolha = escolherAliquotaEfetiva([JUNHO, JULHO], "2026-08");
    expect(escolha.valor).toBe(6);
    expect(escolha.competencia).toBe("2026-07");
    expect(escolha.exata).toBe(false);
  });

  test("a ordem da série não é confiada — a mais recente vence esteja onde estiver", () => {
    const maio = linha("2026-05", { dasExtrato: 5000, faturamento: 100000, deReceita: 5 });
    const embaralhada = [JUNHO, maio, JULHO];
    expect(escolherAliquotaEfetiva(embaralhada, "2026-09").competencia).toBe("2026-07");
    expect(escolherAliquotaEfetiva(embaralhada.reverse(), "2026-09").competencia).toBe("2026-07");
  });

  // ⚠ NÃO SE EXTRAPOLA, NÃO SE PROJETA, NÃO SE MEDIA. O número devolvido é, letra por letra, o da
  // linha escolhida — nenhuma aritmética entre competências acontece aqui.
  test("o valor é o da linha escolhida, nunca uma média ou projeção da série", () => {
    const serie = [JUNHO, JULHO]; // 6,24% e 6,00% — a média seria 6,12%
    const escolha = escolherAliquotaEfetiva(serie, "2026-08");
    expect(escolha.valor).toBe(JULHO.deReceita);
    expect(escolha.valor).not.toBeCloseTo(6.12, 2);
  });

  test("competência da nota como data completa ('YYYY-MM-DD') casa com a linha do mês", () => {
    expect(escolherAliquotaEfetiva([JULHO], "2026-07-18").exata).toBe(true);
  });

  test("competência da nota ausente ou fora de forma não inventa casamento exato", () => {
    for (const alvo of [null, undefined, "", "julho"]) {
      const escolha = escolherAliquotaEfetiva([JULHO], alvo);
      expect(escolha.exata).toBe(false);
      expect(escolha.competencia).toBe("2026-07");
    }
  });
});

describe("a procedência sai em TEXTO, junto do número", () => {
  test("competência exata: diz o mês do DAS e não avisa nada", () => {
    const escolha = escolherAliquotaEfetiva([JULHO], "2026-07");
    const texto = textoDaProcedencia(escolha, "2026-07");
    expect(texto).toBe(
      "DAS de 07/2026 sobre a receita da mesma competência (extrato do PGDAS-D)."
    );
    expect(texto).not.toMatch(/última competência apurada/);
  });

  // ⚠ Usar a última apurada SEM dizer que é de outro mês seria apresentar o número do mês passado
  // como se fosse o deste. A frase carrega os DOIS meses.
  test("competência anterior: nomeia o mês do DAS, o mês da nota e manda conferir", () => {
    const escolha = escolherAliquotaEfetiva([JULHO], "2026-08");
    const texto = textoDaProcedencia(escolha, "2026-08");
    expect(texto).toMatch(/DAS de 07\/2026/);
    expect(texto).toMatch(/última competência apurada/);
    expect(texto).toMatch(/08\/2026/);
    expect(texto).toMatch(/Confira antes de emitir/);
  });

  test("sem valor, o texto é a RECUSA com o motivo — nunca um número sem dono", () => {
    const escolha = escolherAliquotaEfetiva([], "2026-08");
    const texto = textoDaProcedencia(escolha, "2026-08");
    expect(texto).toMatch(/^Não preenchemos: /);
    expect(texto).toMatch(/extrato do PGDAS-D/);
  });

  test("sem escolha nenhuma, ainda assim recusa em vez de afirmar", () => {
    expect(textoDaProcedencia(null, "2026-08")).toBe(
      "Não preenchemos: sem dado para esta empresa."
    );
  });
});

describe("a janela pedida à rota", () => {
  // ⚠ Seis meses, não doze: a rota faz um `aggregate` por competência, em série.
  test("seis competências terminando no mês da nota", () => {
    expect(janelaDaConsulta("2026-08")).toEqual({ from: "2026-03", to: "2026-08" });
  });

  test("vira o ano sem estourar", () => {
    expect(janelaDaConsulta("2026-01")).toEqual({ from: "2025-08", to: "2026-01" });
  });

  test("a largura da janela é parâmetro, e o fim continua sendo o mês da nota", () => {
    expect(janelaDaConsulta("2026-08", { meses: 3 })).toEqual({ from: "2026-06", to: "2026-08" });
  });

  test("competência fora de forma cai no mês corrente, não em uma data inventada", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 18, 12, 0, 0));
    try {
      expect(janelaDaConsulta("")).toEqual({ from: "2026-03", to: "2026-08" });
      expect(janelaDaConsulta(null)).toEqual({ from: "2026-03", to: "2026-08" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("os nomes da origem do campo", () => {
  test("são três, e `AUSENTE` é um deles — ausência tem nome próprio", () => {
    expect(ORIGEM_ALIQUOTA).toEqual({
      AUSENTE: "ausente",
      SUGERIDA: "sugerida",
      DIGITADA: "digitada",
    });
  });
});

// ── A TERCEIRA PROVA: o percentual também precisa ser LEGÍVEL ─────────────────────────
//
// Reportado pelo agente que escreveu esta suíte e REPRODUZIDO antes do conserto: com receita e DAS
// presentes e `deReceita` ausente, `escolherAliquotaEfetiva` devolvia `valor: NaN` — e aí
// `textoDaProcedencia` afirmava a origem NORMALMENTE e o campo da nota escrevia "NaN".
//
// ⚠ Não é alcançável pela rota de hoje (`client/index.js:704` calcula `deReceita` na mesma
// expressão que os insumos). É guarda contra uma mudança no backend que ninguém vai lembrar de
// conferir aqui — e `NaN` é pior que ausente: ausente a tela sabe dizer, `NaN` ela imprime.
describe("percentual ilegível é tratado como ausente, nunca como NaN", () => {
  const comInsumos = (extra) => [
    { competencia: "2026-07", faturamento: 12000, dasExtrato: 720, ...extra },
  ];

  it.each([
    ["ausente", undefined],
    ["nulo", null],
    ["texto", "seis por cento"],
    ["NaN", Number.NaN],
  ])("deReceita %s não vira número", (_rotulo, deReceita) => {
    const r = escolherAliquotaEfetiva(comInsumos({ deReceita }), "2026-07");
    expect(r.valor).toBeNull();
    expect(Number.isNaN(r.valor)).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  it("⚠ a procedencia NÃO afirma origem quando não há número", () => {
    const r = escolherAliquotaEfetiva(comInsumos({}), "2026-07");
    const texto = textoDaProcedencia(r, "2026-07");
    // ⚠ O texto CITA o PGDAS-D — dentro do motivo ("nem receita apurada nem extrato"), que é o
    // certo. O que ele não pode é AFIRMAR procedência: nada de "DAS de 07/2026 sobre a receita".
    expect(texto).toMatch(/^Não preenchemos:/);
    expect(texto).not.toMatch(/DAS de \d{2}\/\d{4}/);
  });

  it("a linha boa continua passando — a guarda não é ampla demais", () => {
    const r = escolherAliquotaEfetiva(comInsumos({ deReceita: 6 }), "2026-07");
    expect(r.valor).toBe(6);
  });

  it("deReceita ZERO é legível e passa — zero declarado ≠ zero fabricado", () => {
    // ⚠ A distinção inteira desta lib: o que se recusa é o zero que o backend INVENTA por falta de
    // insumo. Com receita e DAS provados, um percentual zero é uma LEITURA, e leitura não se descarta.
    const r = escolherAliquotaEfetiva(comInsumos({ deReceita: 0 }), "2026-07");
    expect(r.valor).toBe(0);
  });
});
