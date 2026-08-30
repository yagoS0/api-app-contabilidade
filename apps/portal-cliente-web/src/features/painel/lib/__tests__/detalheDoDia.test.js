// O DETALHE DE UM DIA — a regra que decide o que a GAVETA mostra.
//
// ⚠⚠ O que este arquivo protege é a CONCORDÂNCIA entre a célula e a gaveta que ela abre. Uma
// célula de "Impostos" que mostra R$ 1.234,50 e uma gaveta que abre vazia (ou com outra linha) é a
// tela discordando de si mesma — e quem lê está decidindo o caixa do mês em cima dela.
//
// ⚠ Por isso o teste central não confere uma lista escrita à mão: ele confronta a gaveta com
// `linhaDoMes`, a MESMA função que desenha a tabela. Sem esse confronto, "reusa" é intenção.

import { BALDES_DA_GAVETA, linhasDoDia, rotuloDoBalde } from "../detalheDoDia";
import { COLUNAS, linhaDoMes } from "../tabelaDoFluxo";
import { DIRECAO, FONTE, PROCEDENCIA } from "../leituraDoFluxo";

const linha = (over = {}) => ({
  fonte: FONTE.NOTA_EMITIDA,
  direcao: DIRECAO.ENTRADA,
  procedencia: PROCEDENCIA.PREVISAO,
  competencia: "2026-08",
  dia: null,
  valor: 100,
  rotulo: "Uma linha",
  ...over,
});

const guia = (over = {}) => linha({
  fonte: FONTE.GUIA, direcao: DIRECAO.SAIDA, procedencia: PROCEDENCIA.COMPROMISSO,
  valor: 1234.5, rotulo: "DAS 07/2026", ...over,
});

const doCliente = (over = {}) => linha({
  fonte: FONTE.SAIDA_DO_CLIENTE, direcao: DIRECAO.SAIDA, procedencia: PROCEDENCIA.PREVISAO,
  valor: 3000, rotulo: "Reforma da sala",
  base: { doCliente: true, estadoDaSaida: "PENDENTE" },
  referencia: { tipo: "saidaAvulsa", id: "sa-1" },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o balde sai da MESMA regra que a tabela usa", () => {
  /**
   * ⚠⚠ ESTE É O TESTE QUE SEGURA A REUSA. Ele soma o que a gaveta lista, balde a balde, e exige o
   * MESMO número que a célula da tabela mostra. Escrevendo aqui um `if (fonte === GUIA)` a soma
   * continuaria batendo hoje — e deixaria de bater no dia em que uma fonte nova entrasse em
   * `FONTES_DE_IMPOSTO` sem ninguém lembrar deste arquivo.
   */
  it("⚠⚠ a soma da gaveta bate com a célula da tabela, balde a balde", () => {
    const linhas = [
      guia({ dia: 20 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.IMPOSTO_PROJETADO, valor: 500, dia: 20 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 8000, dia: 20 }),
      doCliente({ dia: 20 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.SERIE_DESPESA, valor: 1200, dia: 20 }),
      linha({ direcao: DIRECAO.ENTRADA, fonte: FONTE.NOTA_EMITIDA, valor: 50000, dia: 20 }),
    ];
    const daTabela = linhaDoMes({ competencia: "2026-08", linhas });

    for (const balde of BALDES_DA_GAVETA) {
      const soma = linhasDoDia(linhas, { dia: 20, balde }).reduce((s, l) => s + l.valor, 0);
      expect(soma).toBe(daTabela[balde].valor);
    }
  });

  it("⚠ guia e imposto projetado caem em `impostos`; folha em `folha`; o resto da saída em `saida`", () => {
    const linhas = [
      guia({ dia: 5 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.IMPOSTO_PROJETADO, valor: 500, dia: 5 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 8000, dia: 5 }),
      doCliente({ dia: 5 }),
    ];
    expect(linhasDoDia(linhas, { dia: 5, balde: "impostos" }).map((l) => l.rotulo))
      .toEqual(["DAS 07/2026", "Uma linha"]);
    expect(linhasDoDia(linhas, { dia: 5, balde: "folha" })).toHaveLength(1);
    expect(linhasDoDia(linhas, { dia: 5, balde: "saida" }).map((l) => l.rotulo))
      .toEqual(["Reforma da sala"]);
  });

  it("⚠⚠ `SAIDA_DO_CLIENTE` cai em SAÍDA — a gaveta de impostos NÃO a mostra", () => {
    // ⚠ É o que sustenta o formulário só existir na gaveta de saída: escrita na de impostos, a
    // linha sumiria da célula clicada e apareceria em outra coluna.
    const linhas = [doCliente({ dia: 9 })];
    expect(linhasDoDia(linhas, { dia: 9, balde: "impostos" })).toHaveLength(0);
    expect(linhasDoDia(linhas, { dia: 9, balde: "saida" })).toHaveLength(1);
  });

  it("⚠ a ENTRADA tem gaveta própria, e ela não traz saída nenhuma", () => {
    const linhas = [linha({ dia: 1, valor: 50000, rotulo: "Notas de julho" }), guia({ dia: 1 })];
    expect(linhasDoDia(linhas, { dia: 1, balde: "entrada" }).map((l) => l.rotulo))
      .toEqual(["Notas de julho"]);
  });

  it("⚠ sem balde, a gaveta do DIA traz os quatro baldes juntos", () => {
    const linhas = [guia({ dia: 3 }), doCliente({ dia: 3 }), linha({ dia: 3 })];
    expect(linhasDoDia(linhas, { dia: 3 })).toHaveLength(3);
  });

  it("⚠⚠ `resultado` NÃO é balde — ele é derivado, e não há linha morando nele", () => {
    expect(BALDES_DA_GAVETA).toEqual(["entrada", "saida", "impostos", "folha"]);
    expect(BALDES_DA_GAVETA).not.toContain("resultado");
  });

  it("⚠ o nome do balde é o RÓTULO DA COLUNA clicada, nunca um mapa novo", () => {
    for (const c of COLUNAS) expect(rotuloDoBalde(c.chave)).toBe(c.rotulo);
    expect(rotuloDoBalde(null)).toBeNull();
    expect(rotuloDoBalde("inexistente")).toBeNull();
  });

  it("⚠ procedência DESCONHECIDA não entra — a célula também não a somou", () => {
    // ⚠ Não é esquecimento: `celula` a descarta, então listá-la aqui faria a gaveta mostrar um
    // dinheiro que a tabela não conta. O lugar dela é a ressalva "Sem mês".
    const linhas = [guia({ dia: 7, procedencia: PROCEDENCIA.DESCONHECIDO })];
    expect(linhasDoDia(linhas, { dia: 7 })).toHaveLength(0);
    expect(linhaDoMes({ linhas }).impostos).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o dia — e o `null` que é um dia legítimo", () => {
  const linhas = [
    guia({ dia: 20 }),
    doCliente({ dia: 20 }),
    linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 8000, dia: null, rotulo: "Folha" }),
    linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.SERIE_DESPESA, valor: 1200, dia: null, rotulo: "Aluguel" }),
    linha({ dia: 1, valor: 50000, rotulo: "Notas de julho" }),
  ];

  it("o dia pedido traz só as linhas daquele dia", () => {
    expect(linhasDoDia(linhas, { dia: 20 }).map((l) => l.rotulo))
      .toEqual(["DAS 07/2026", "Reforma da sala"]);
  });

  it("⚠⚠ `dia: null` é a linha 'no mês' — as projeções SEM dia, e só elas", () => {
    expect(linhasDoDia(linhas, { dia: null }).map((l) => l.rotulo)).toEqual(["Folha", "Aluguel"]);
  });

  it("⚠⚠ os dois conjuntos NUNCA se misturam", () => {
    // Espalhar a folha pelo dia 20 inventaria o dia de um valor que ninguém datou — a regra nº 1
    // deste projeto, do lado da leitura.
    const doDia = linhasDoDia(linhas, { dia: 20 }).map((l) => l.rotulo);
    const doMes = linhasDoDia(linhas, { dia: null }).map((l) => l.rotulo);
    expect(doDia.filter((r) => doMes.includes(r))).toEqual([]);
    expect(doDia.length + doMes.length + linhasDoDia(linhas, { dia: 1 }).length).toBe(linhas.length);
  });

  it("⚠ o `dia` de cada item devolvido é o PEDIDO — a gaveta não renomeia o recorte", () => {
    expect(linhasDoDia(linhas, { dia: 20 }).every((l) => l.dia === 20)).toBe(true);
    expect(linhasDoDia(linhas, { dia: null }).every((l) => l.dia === null)).toBe(true);
  });

  it("⚠⚠ dia 31 num mês de 30 cai em 'no mês' — a MESMA borda de `linhasDosDias`", () => {
    const foraDoMes = [guia({ dia: 31, rotulo: "Guia do dia 31" })];
    expect(linhasDoDia(foraDoMes, { dia: 31, quantosDias: 30 })).toHaveLength(0);
    expect(linhasDoDia(foraDoMes, { dia: null, quantosDias: 30 }).map((l) => l.rotulo))
      .toEqual(["Guia do dia 31"]);
    // ⚠ Sem `quantosDias` a borda não é conferida (a regra não conhece o calendário) — e é por isso
    // que a tela passa o número.
    expect(linhasDoDia(foraDoMes, { dia: 31 })).toHaveLength(1);
  });

  it("⚠ dia que não é inteiro positivo lê como 'no mês' — nenhuma linha fica invisível", () => {
    const tortas = [guia({ dia: 0 }), guia({ dia: "20" }), guia({ dia: 2.5 })];
    expect(linhasDoDia(tortas, { dia: null })).toHaveLength(3);
    expect(linhasDoDia(tortas, { dia: 20 })).toHaveLength(0);
  });

  it("⚠ `dia` ilegível devolve lista vazia — nunca cai em 'no mês' por acidente", () => {
    expect(linhasDoDia(linhas, { dia: "abacaxi" })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("o que cada item carrega", () => {
  it("⚠⚠ a FRASE do servidor viaja — é ela que diz de onde o número veio", () => {
    const linhas = [guia({ dia: 20, base: { frase: "Guia gerada pelo seu contador." } })];
    expect(linhasDoDia(linhas, { dia: 20 })[0].frase).toBe("Guia gerada pelo seu contador.");
  });

  it("⚠ sem frase, `null` — a tela não escreve uma de reserva", () => {
    expect(linhasDoDia([guia({ dia: 20 })], { dia: 20 })[0].frase).toBeNull();
    expect(linhasDoDia([guia({ dia: 20, base: { frase: "   " } })], { dia: 20 })[0].frase).toBeNull();
  });

  it("⚠ a procedência sai CRUA — quem traduz (e aplica a Lei de cor) é a tela", () => {
    expect(linhasDoDia([guia({ dia: 20 })], { dia: 20 })[0].procedencia)
      .toBe(PROCEDENCIA.COMPROMISSO);
  });

  it("⚠ linha sem rótulo ganha o nome da FONTE, nunca um vazio", () => {
    const linhas = [guia({ dia: 20, rotulo: null })];
    expect(linhasDoDia(linhas, { dia: 20 })[0].rotulo).toBe("Guia de imposto");
  });

  it("⚠ a chave de renderização distingue duas ocorrências da MESMA série", () => {
    const serie = { fonte: FONTE.SERIE_DESPESA, referencia: { tipo: "serie", id: "sr-1" } };
    const linhas = [
      linha({ ...serie, direcao: DIRECAO.SAIDA, dia: 4, valor: 1200 }),
      linha({ ...serie, direcao: DIRECAO.SAIDA, dia: 4, valor: 1200 }),
    ];
    const [a, b] = linhasDoDia(linhas, { dia: 4 });
    expect(a.chave).not.toBe(b.chave);
  });

  it("⚠ valor sai como NÚMERO, e o que não é número vira zero (não `NaN` na tela)", () => {
    expect(linhasDoDia([guia({ dia: 2, valor: "1234.5" })], { dia: 2 })[0].valor).toBe(1234.5);
    expect(linhasDoDia([guia({ dia: 2, valor: null })], { dia: 2 })[0].valor).toBe(0);
  });

  it("⚠ entrada torta não explode: sem linhas, lista vazia", () => {
    expect(linhasDoDia(null, { dia: 1 })).toEqual([]);
    expect(linhasDoDia(undefined, { dia: null })).toEqual([]);
    expect(linhasDoDia([null, undefined], { dia: null })).toEqual([]);
    expect(linhasDoDia([])).toEqual([]);
  });
});
