// O FLUXO DE CAIXA — a regra pura.
//
// ⚠⚠ O bloco que mais importa é "NÃO EXISTE UM TOTAL". Ele não protege um detalhe de contrato:
// protege o fluxo de entregar um número que soma o que aconteceu com o que talvez aconteça — que é
// exatamente o que alguém imprime e leva ao banco.

import {
  DIA_DESCONHECIDO,
  DIRECAO,
  FONTE,
  FRASE_DO_SEM_IMPOSTO,
  FRASE_DO_SEM_MES,
  HORIZONTE_MESES,
  PRAZO_RECEBIMENTO_PADRAO_MESES,
  PROCEDENCIA,
  SEM_IMPOSTO,
  SEM_MES,
  aliquotaEfetiva,
  competenciaDaData,
  competenciaDeMeses,
  diaDaData,
  fraseDaAliquota,
  mesesDaCompetencia,
  montarLinha,
  montarMeses,
  numero,
  ordenarLinhas,
  prazoDeRecebimento,
  projecaoSubstituidaPelaGuia,
  somarMeses,
  totaisDoMes,
} from "../fluxoDeCaixa.js";

const linha = (extra = {}) => montarLinha({
  fonte: FONTE.GUIA,
  direcao: DIRECAO.SAIDA,
  procedencia: PROCEDENCIA.FATO,
  competencia: "2026-08",
  dia: 20,
  valor: 1000,
  rotulo: "DAS",
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ NÃO EXISTE UM `total`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ os totais NÃO somam fato com previsão", () => {
  const linhas = [
    linha({ valor: 1000 }),
    linha({ procedencia: PROCEDENCIA.PREVISAO, fonte: FONTE.SERIE_DESPESA, valor: 130 }),
    linha({ procedencia: PROCEDENCIA.PREVISAO, direcao: DIRECAO.ENTRADA, fonte: FONTE.NOTA_EMITIDA, valor: 8000 }),
  ];

  it("cada procedência tem o seu compartimento", () => {
    const t = totaisDoMes(linhas);
    expect(t.fato.saida).toBe(1000);
    expect(t.previsao.saida).toBe(130);
    expect(t.previsao.entrada).toBe(8000);
  });

  it("⚠⚠ NÃO existe a chave `total` — nem no topo, nem dentro de fato/previsão", () => {
    // No instante em que ela existir, alguma tela a imprime. `docs/dre-fluxo-caixa.md` a proíbe.
    const t = totaisDoMes(linhas);
    expect(t).not.toHaveProperty("total");
    expect(t.fato).not.toHaveProperty("total");
    expect(t.previsao).not.toHaveProperty("total");
    expect(JSON.stringify(t)).not.toMatch(/"total"/);
  });

  it("⚠⚠ `desconhecido` carrega CONTAGEM, nunca valor", () => {
    // Uma guia sem vencimento tem valor conhecido e MÊS desconhecido. Publicar o valor aqui
    // convidaria a somá-lo a um mês que ninguém sabe qual é.
    const t = totaisDoMes([...linhas, linha({ procedencia: PROCEDENCIA.DESCONHECIDO, valor: 5000 })]);
    expect(t.desconhecido).toEqual({ quantas: 1 });
    expect(t.desconhecido).not.toHaveProperty("valor");
  });

  it("⚠⚠ e a própria LINHA desconhecida não carrega valor", () => {
    const l = linha({ procedencia: PROCEDENCIA.DESCONHECIDO, valor: 5000 });
    expect(l.valor).toBeNull();
  });

  it("⚠ mês vazio soma zero — e zero é uma resposta, não uma ausência", () => {
    const t = totaisDoMes([]);
    expect(t.fato).toEqual({ entrada: 0, saida: 0 });
    expect(t.desconhecido.quantas).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ `dia: null` NUNCA VIRA "DIA 20".
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o dia desconhecido vem com o motivo", () => {
  it("a projeção por mês diz que é por mês", () => {
    const l = linha({ dia: null, diaDesconhecido: DIA_DESCONHECIDO.PROJECAO_POR_MES });
    expect(l.dia).toBeNull();
    expect(l.diaDesconhecido.motivo).toBe(DIA_DESCONHECIDO.PROJECAO_POR_MES);
    expect(l.diaDesconhecido.frase).toMatch(/contado em meses/i);
  });

  it("⚠ a guia TEM dia, e então não há motivo nenhum", () => {
    expect(linha({ dia: 20 }).diaDesconhecido).toBeNull();
  });

  it("⚠ cada motivo tem frase própria — os três dizem coisas diferentes", () => {
    const frases = Object.values(DIA_DESCONHECIDO).map(
      (m) => linha({ dia: null, diaDesconhecido: m }).diaDesconhecido.frase,
    );
    expect(new Set(frases).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A GUIA REAL SUBSTITUI A PROJEÇÃO DO MESMO MÊS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as duas nunca coexistem", () => {
  const guia = linha({ fonte: FONTE.GUIA, competencia: "2026-08", valor: 1200 });
  const projetado = linha({
    fonte: FONTE.IMPOSTO_PROJETADO, procedencia: PROCEDENCIA.PREVISAO,
    competencia: "2026-08", valor: 1100, dia: null,
  });

  it("havendo guia no mês, a projeção SAI", () => {
    // Sem isto o mesmo imposto aparece duas vezes no mesmo mês e o contador provisiona o dobro.
    const r = projecaoSubstituidaPelaGuia([guia, projetado]);
    expect(r).toHaveLength(1);
    expect(r[0].fonte).toBe(FONTE.GUIA);
  });

  it("⚠⚠ quem sai é a PROJEÇÃO, nunca a guia — a guia é o fato", () => {
    const r = projecaoSubstituidaPelaGuia([projetado, guia]);
    expect(r.map((l) => l.fonte)).toEqual([FONTE.GUIA]);
  });

  it("⚠ em OUTRO mês, a projeção fica", () => {
    const outroMes = { ...projetado, competencia: "2026-09" };
    expect(projecaoSubstituidaPelaGuia([guia, outroMes])).toHaveLength(2);
  });

  it("⚠ e as outras previsões NÃO são tocadas — só o imposto projetado é substituído", () => {
    const serie = linha({ fonte: FONTE.SERIE_DESPESA, procedencia: PROCEDENCIA.PREVISAO, competencia: "2026-08" });
    expect(projecaoSubstituidaPelaGuia([guia, serie])).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O PRAZO DE RECEBIMENTO — e "ninguém configurou" ≠ "configurado como 1".
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ prazoDeRecebimento", () => {
  it("sem configuração, cai no padrão E DIZ que é o padrão", () => {
    expect(prazoDeRecebimento(null)).toEqual({ meses: PRAZO_RECEBIMENTO_PADRAO_MESES, configurado: false });
    expect(prazoDeRecebimento(undefined).configurado).toBe(false);
  });

  it("configurado vale, e diz que foi configurado", () => {
    expect(prazoDeRecebimento(2)).toEqual({ meses: 2, configurado: true });
  });

  it("⚠⚠ ZERO É UMA CONFIGURAÇÃO LEGÍTIMA — 'recebo à vista' não é 'não configurei'", () => {
    // `Number(null)` é 0 e 0 é finito: uma guarda `!n` colapsaria os dois, e "recebo à vista"
    // viraria o padrão de 1 mês, silenciosamente.
    expect(prazoDeRecebimento(0)).toEqual({ meses: 0, configurado: true });
  });

  it("⚠ valor torto cai no padrão, não em zero", () => {
    for (const v of ["abc", -3, NaN]) expect(prazoDeRecebimento(v).configurado).toBe(false);
  });

  it("⚠ o padrão é 1 mês — decisão do dono (nota de junho entra em julho)", () => {
    expect(PRAZO_RECEBIMENTO_PADRAO_MESES).toBe(1);
  });
});

describe("⚠ a aritmética de competência é de STRING", () => {
  it("soma vira ano sozinha", () => {
    expect(somarMeses("2026-12", 1)).toBe("2027-01");
    expect(somarMeses("2026-06", 1)).toBe("2026-07");
    expect(somarMeses("2026-01", 12)).toBe("2027-01");
  });

  it("⚠ zero meses é a própria competência — o caso 'recebo à vista'", () => {
    expect(somarMeses("2026-06", 0)).toBe("2026-06");
  });

  it("⚠ competência torta não vira mês nenhum", () => {
    for (const c of ["2026-13", "2026-00", "banana", null, ["2026-05"], 202605]) {
      expect(mesesDaCompetencia(c)).toBeNull();
    }
  });

  it("⚠⚠ acessadores UTC — às 22h de Brasília um `toISOString` daria o mês seguinte", () => {
    expect(competenciaDaData(new Date("2026-08-31T23:30:00.000Z"))).toBe("2026-08");
    expect(diaDaData(new Date("2026-08-20T00:00:00.000Z"))).toBe(20);
    expect(competenciaDaData(null)).toBeNull();
    expect(diaDaData("2026-08-20")).toBeNull();
  });

  it("ida e volta", () => {
    expect(competenciaDeMeses(mesesDaCompetencia("2026-08"))).toBe("2026-08");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O ZERO FABRICADO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ `numero` guarda por TIPO", () => {
  it.each([
    ["null", null], ["undefined", undefined], ["vazio", ""], ["texto", "abc"],
    ["objeto", {}], ["NaN", NaN], ["Infinity", Infinity],
    ["⚠⚠ array vazio", []], ["⚠⚠ false", false], ["⚠⚠ só espaço", " "],
  ])("%s NÃO vira número", (_n, v) => {
    expect(numero(v)).toBeNull();
  });

  it("número, string numérica e `Decimal` entram", () => {
    expect(numero(130)).toBe(130);
    expect(numero("130.50")).toBe(130.5);
    expect(numero({ toString: () => "1250.75" })).toBe(1250.75);
    // ⚠ zero DECLARADO é um valor
    expect(numero(0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A ALÍQUOTA EFETIVA — e sem ela NÃO HÁ imposto projetado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ aliquotaEfetiva", () => {
  const snap = (extra = {}) => ({
    competencia: "2026-06", receitaInterna: "10000.00", receitaExterna: "0.00",
    dasRetornadoSerpro: "600.00", dasSimuladoSerpro: null, ...extra,
  });

  it("é DERIVADA: DAS ÷ receita", () => {
    const r = aliquotaEfetiva(snap());
    expect(r.valor).toBeCloseTo(0.06, 6);
    expect(r.competencia).toBe("2026-06");
    expect(r.procedencia).toBe("TRANSMITIDA");
  });

  it("⚠ a TRANSMITIDA vence a simulada — ela existe na Receita", () => {
    const r = aliquotaEfetiva(snap({ dasSimuladoSerpro: "900.00" }));
    expect(r.procedencia).toBe("TRANSMITIDA");
    expect(r.valor).toBeCloseTo(0.06, 6);
  });

  it("⚠ sem transmitida, a SIMULADA serve — e é dito que é simulação", () => {
    const r = aliquotaEfetiva(snap({ dasRetornadoSerpro: null, dasSimuladoSerpro: "900.00" }));
    expect(r.procedencia).toBe("SIMULADA");
  });

  it("⚠⚠ o motor LOCAL não entra — projeção sobre a nossa própria conta é proibida pelo plano", () => {
    const r = aliquotaEfetiva(snap({ dasRetornadoSerpro: null, dasSimuladoSerpro: null, dasCalculadoLocal: "700.00" }));
    expect(r).toBeNull();
  });

  it.each([
    ["sem receita", { receitaInterna: null, receitaExterna: null }],
    ["receita zero", { receitaInterna: "0.00", receitaExterna: "0.00" }],
    ["sem DAS", { dasRetornadoSerpro: null }],
    ["DAS zero", { dasRetornadoSerpro: "0.00" }],
  ])("⚠⚠ %s ⇒ NULL — nunca uma alíquota inventada", (_n, extra) => {
    expect(aliquotaEfetiva(snap(extra))).toBeNull();
  });

  it("snapshot ausente não quebra", () => {
    expect(aliquotaEfetiva(null)).toBeNull();
  });
});

describe("⚠⚠ a frase da alíquota é OBRIGATÓRIA, e nunca diz 'imposto calculado'", () => {
  it("ela NOMEIA o mês e a origem", () => {
    const f = fraseDaAliquota({ competencia: "2026-06", procedencia: "TRANSMITIDA" });
    expect(f).toMatch(/alíquota de 2026-06/);
    expect(f).toMatch(/declaração transmitida/);
  });

  it("⚠⚠ ela NUNCA diz 'imposto calculado' — seria projeção passando por ato fiscal", () => {
    for (const p of ["TRANSMITIDA", "SIMULADA", "OUTRA"]) {
      expect(fraseDaAliquota({ competencia: "2026-06", procedencia: p })).not.toMatch(/imposto calculado/i);
    }
  });

  it("⚠ sem competência não há frase — e sem frase a linha não deve existir", () => {
    expect(fraseDaAliquota({ competencia: null })).toBeNull();
  });

  it("⚠ e as duas ausências de imposto têm motivos DIFERENTES", () => {
    expect(FRASE_DO_SEM_IMPOSTO[SEM_IMPOSTO.SEM_APURACAO]).toMatch(/alíquota que ninguém mediu/i);
    expect(FRASE_DO_SEM_IMPOSTO[SEM_IMPOSTO.SEM_RECEITA_PROJETADA]).toMatch(/não há receita prevista/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// OS MESES DO HORIZONTE
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ os 12 meses", () => {
  it("o horizonte é 12 — decisão do dono", () => {
    expect(HORIZONTE_MESES).toBe(12);
    const r = montarMeses({ linhas: [], cicloAtual: "2026-08" });
    expect(r.meses).toHaveLength(12);
    expect(r.meses[0].competencia).toBe("2026-08");
    expect(r.meses[11].competencia).toBe("2027-07");
  });

  it("⚠⚠ mês VAZIO entra com zero — buraco na série se lê como 'não sei'", () => {
    const r = montarMeses({ linhas: [linha({ competencia: "2026-09" })], cicloAtual: "2026-08" });
    expect(r.meses[0].linhas).toEqual([]);
    expect(r.meses[0].totais.fato.saida).toBe(0);
    expect(r.meses[1].linhas).toHaveLength(1);
  });

  it("⚠⚠ o que ficou FORA do horizonte é contado, não evaporado", () => {
    // Uma guia vencida no mês passado, ou uma projeção 14 meses à frente.
    const passada = linha({ competencia: "2026-07" });
    const distante = linha({ competencia: "2028-01" });
    const r = montarMeses({ linhas: [passada, distante], cicloAtual: "2026-08" });
    expect(r.foraDoHorizonte).toHaveLength(2);
  });

  it("⚠⚠ o DESCONHECIDO não entra em mês nenhum — nem no primeiro", () => {
    // Pô-lo no mês corrente seria escolher o mês por ele, que é o que a procedência existe para
    // impedir. Ele volta em `semMes`, no serviço.
    const r = montarMeses({
      linhas: [linha({ procedencia: PROCEDENCIA.DESCONHECIDO, competencia: null })],
      cicloAtual: "2026-08",
    });
    expect(r.meses.every((m) => m.linhas.length === 0)).toBe(true);
    expect(r.foraDoHorizonte).toHaveLength(0);
  });

  it("⚠ ciclo torto devolve lista vazia, não 12 meses do ano 0", () => {
    expect(montarMeses({ linhas: [], cicloAtual: "banana" })).toEqual([]);
  });
});

describe("⚠ a ordem dentro do mês", () => {
  it("FATO antes de PREVISÃO", () => {
    const r = ordenarLinhas([
      linha({ procedencia: PROCEDENCIA.PREVISAO, rotulo: "previsto", dia: 1 }),
      linha({ procedencia: PROCEDENCIA.FATO, rotulo: "fato", dia: 28 }),
    ]);
    expect(r.map((l) => l.rotulo)).toEqual(["fato", "previsto"]);
  });

  it("⚠ dia conhecido antes de dia desconhecido — o que tem data marcada é mais urgente", () => {
    const r = ordenarLinhas([
      linha({ rotulo: "sem dia", dia: null, diaDesconhecido: DIA_DESCONHECIDO.SERIE_SEM_DIA }),
      linha({ rotulo: "dia 25", dia: 25 }),
    ]);
    expect(r.map((l) => l.rotulo)).toEqual(["dia 25", "sem dia"]);
  });

  it("⚠ não muta a lista recebida", () => {
    const lista = [linha({ rotulo: "A", dia: 28 }), linha({ rotulo: "B", dia: 1 })];
    ordenarLinhas(lista);
    expect(lista.map((l) => l.rotulo)).toEqual(["A", "B"]);
  });
});

describe("⚠ os motivos de não ter mês", () => {
  it("cada um diz o CONSERTO, não só o problema", () => {
    expect(FRASE_DO_SEM_MES[SEM_MES.GUIA_SEM_VENCIMENTO]).toMatch(/recapture a guia/i);
    expect(FRASE_DO_SEM_MES[SEM_MES.NOTA_SEM_COMPETENCIA]).toMatch(/competência/i);
    expect(FRASE_DO_SEM_MES[SEM_MES.SERIE_SEM_VALOR]).toMatch(/valor projetado nem declarado/i);
  });

  it("⚠⚠ e a nota sem competência NÃO é atribuída a um mês", () => {
    expect(FRASE_DO_SEM_MES[SEM_MES.NOTA_SEM_COMPETENCIA]).toMatch(/escolher um mês seria/i);
  });
});

describe("⚠⚠ o módulo é PURO", () => {
  it("não importa prisma, não lê o relógio", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "fluxoDeCaixa.js"), "utf8")
      // ⚠ BLOCO antes de LINHA — um `//` dentro de `/* */` apaga o fechamento e o regex engole o
      // código real até o `*/` seguinte.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/\brequire\s*\(/);
    expect(fonte).not.toMatch(/\bnew\s+Date\s*\(\s*\)|\bDate\.now\s*\(/);
    // ⚠ contraprova
    expect("const agora = new Date();").toMatch(/\bnew\s+Date\s*\(\s*\)/);
  });
});
