// A TABELA DO FLUXO — as seis colunas do v3, e o `status` de cada célula.
//
// ⚠⚠ O que este arquivo protege é a diferença entre "o dinheiro saiu" e "o dinheiro vai sair". Ela
// é a coisa toda: um Resultado pintado de preto afirma que o mês fechou naquele número.

import {
  COLUNAS, COLUNAS_EM_PERCENTUAL, STATUS, emPercentual, linhaDoMes, linhasDosDias,
} from "../tabelaDoFluxo";
import { DIRECAO, FONTE, PROCEDENCIA } from "../leituraDoFluxo";
// ⚠⚠ A AUTORIDADE DA DERIVAÇÃO É O BACKEND. Sem importar a função de lá, "espelho" é intenção — e a
// divergência apareceria como a tela pintando de preto o que o servidor chama de previsto.
import { statusDoConjunto } from "../../../../../../api/src/application/fluxo/lib/fluxoDeCaixa.js";

const linha = (over = {}) => ({
  fonte: FONTE.NOTA_EMITIDA, direcao: DIRECAO.ENTRADA, procedencia: PROCEDENCIA.FATO,
  competencia: "2026-08", dia: null, valor: 100, ...over,
});

const mes = (linhas, competencia = "2026-08") => ({ competencia, linhas });

describe("as seis colunas", () => {
  it("⚠ a ordem é a do spec, e o Mês não é coluna de valor", () => {
    expect(COLUNAS.map((c) => c.chave)).toEqual(["entrada", "saida", "impostos", "folha", "resultado"]);
  });

  it("⚠⚠ Impostos e Folha saem de dentro da SAÍDA, pela FONTE — não são dado novo", () => {
    const r = linhaDoMes(mes([
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, valor: 10 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.IMPOSTO_PROJETADO, valor: 5 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 20 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.SERIE_DESPESA, valor: 7 }),
    ]));
    expect(r.impostos.valor).toBe(15);
    expect(r.folha.valor).toBe(20);
    expect(r.saida.valor).toBe(7);
  });

  it("⚠⚠ fonte DESCONHECIDA cai em Saída, e é por isso que a lista é FECHADA e não um `else`", () => {
    // Uma fonte nova de imposto cairia em "Saída" em silêncio. O teste não impede isso — ele
    // DOCUMENTA onde ela cai, para que a próxima fonte seja classificada de propósito.
    const r = linhaDoMes(mes([linha({ direcao: DIRECAO.SAIDA, fonte: "COISA_NOVA", valor: 9 })]));
    expect(r.saida.valor).toBe(9);
  });

  /**
   * ⚠⚠ A FONTE NOVA DE 29/08/2026 — e este teste é a "classificação de propósito" que o caso acima
   * pede.
   *
   * `SAIDA_DO_CLIENTE` **cai em Saída pelo `else`**, que é o balde certo. Sem esta afirmação, ela
   * estaria certa por ACIDENTE — e no dia em que alguém trocasse a ordem das listas fechadas ela
   * mudaria de coluna sem nada quebrar.
   */
  it("⚠⚠ `SAIDA_DO_CLIENTE` cai em SAÍDA — nunca em Impostos nem em Folha", () => {
    const r = linhaDoMes(mes([
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.SAIDA_DO_CLIENTE, valor: 3000 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, valor: 10 }),
    ]));
    expect(r.saida.valor).toBe(3000);
    expect(r.impostos.valor).toBe(10);
    expect(r.folha).toBeNull();
  });

  it("⚠ e ela é uma FONTE de verdade no vocabulário, não uma string solta na tela", () => {
    // ⚠ Se ela sumir do `FONTE`, o teste acima passaria com `undefined` caindo no `else` — e a
    // tela renderizaria "Origem desconhecida" na linha que o próprio cliente escreveu.
    expect(FONTE.SAIDA_DO_CLIENTE).toBe("SAIDA_DO_CLIENTE");
  });
});

describe("⚠⚠ o status é o do ELO MAIS FRACO", () => {
  it("tudo pago ⇒ confirmado", () => {
    const r = linhaDoMes(mes([linha({ procedencia: PROCEDENCIA.FATO })]));
    expect(r.entrada.status).toBe(STATUS.CONFIRMADO);
  });

  it("⚠⚠ uma parcela prevista basta para a célula inteira virar prevista", () => {
    // Uma célula que soma uma guia paga com uma guia em aberto NÃO é um fato. Pintá-la de preto
    // afirmaria que o dinheiro já saiu.
    const r = linhaDoMes(mes([
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, procedencia: PROCEDENCIA.FATO, valor: 10 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, procedencia: PROCEDENCIA.COMPROMISSO, valor: 10 }),
    ]));
    expect(r.impostos.valor).toBe(20);
    expect(r.impostos.status).toBe(STATUS.PREVISTO);
  });

  it("⚠ COMPROMISSO e PREVISAO pintam igual — três níveis por dentro, duas cores por fora", () => {
    const c = linhaDoMes(mes([linha({ procedencia: PROCEDENCIA.COMPROMISSO })])).entrada;
    const p = linhaDoMes(mes([linha({ procedencia: PROCEDENCIA.PREVISAO })])).entrada;
    expect(c.status).toBe(p.status);
    expect(c.status).toBe(STATUS.PREVISTO);
  });

  it("⚠⚠ ESPELHO: a derivação bate com a do BACKEND, caso a caso", () => {
    const casos = [
      [PROCEDENCIA.FATO],
      [PROCEDENCIA.COMPROMISSO],
      [PROCEDENCIA.PREVISAO],
      [PROCEDENCIA.FATO, PROCEDENCIA.FATO],
      [PROCEDENCIA.FATO, PROCEDENCIA.COMPROMISSO],
      [PROCEDENCIA.FATO, PROCEDENCIA.PREVISAO],
      [PROCEDENCIA.COMPROMISSO, PROCEDENCIA.PREVISAO],
    ];
    for (const procedencias of casos) {
      const linhas = procedencias.map((p) => linha({ procedencia: p }));
      expect(linhaDoMes(mes(linhas)).entrada.status).toBe(statusDoConjunto(linhas));
    }
  });

  it("⚠ o DESCONHECIDO não entra na soma nem decide cor — ele é contagem, nunca valor", () => {
    const r = linhaDoMes(mes([
      linha({ procedencia: PROCEDENCIA.FATO, valor: 100 }),
      linha({ procedencia: PROCEDENCIA.DESCONHECIDO, valor: null }),
    ]));
    expect(r.entrada.valor).toBe(100);
    expect(r.entrada.status).toBe(STATUS.CONFIRMADO);
  });
});

describe("⚠⚠ ausência não é zero", () => {
  it("mês sem nada devolve `null` em toda coluna — a tela desenha traço", () => {
    const r = linhaDoMes(mes([]));
    expect(r.entrada).toBeNull();
    expect(r.saida).toBeNull();
    expect(r.resultado).toBeNull();
  });

  it("⚠⚠ `null` ≠ `{ valor: 0 }` — zero é uma afirmação, ausência não é", () => {
    const semNada = linhaDoMes(mes([]));
    const comZero = linhaDoMes(mes([linha({ valor: 0 })]));
    expect(semNada.entrada).toBeNull();
    expect(comZero.entrada).toEqual({ valor: 0, status: STATUS.CONFIRMADO });
  });
});

describe("⚠⚠ Resultado = Entrada − (Saída + Impostos + Folha)", () => {
  it("a conta fecha, e é do PERÍODO — nunca acumulada", () => {
    const r = linhaDoMes(mes([
      linha({ valor: 1000 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.SERIE_DESPESA, valor: 100 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, valor: 200 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 300 }),
    ]));
    expect(r.resultado.valor).toBe(400);
  });

  it("⚠⚠ ele HERDA previsto de qualquer parcela — é o que sustenta a reversão nº 1", () => {
    // `docs/dre-fluxo-caixa.md` proibia um número que somasse fato com previsão: *"é o que alguém
    // imprime e leva ao banco"*. A mitigação é esta: o número existe, e nunca se apresenta como certo.
    const r = linhaDoMes(mes([
      linha({ procedencia: PROCEDENCIA.FATO, valor: 1000 }),
      linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.GUIA, procedencia: PROCEDENCIA.COMPROMISSO, valor: 200 }),
    ]));
    expect(r.resultado.status).toBe(STATUS.PREVISTO);
  });

  it("⚠ mês só com saída dá resultado NEGATIVO — e ele existe, não vira `null`", () => {
    const r = linhaDoMes(mes([linha({ direcao: DIRECAO.SAIDA, fonte: FONTE.FOLHA, valor: 500 })]));
    expect(r.resultado.valor).toBe(-500);
  });
});

describe("⚠⚠ a visão de dias — e a linha 'no mês'", () => {
  it("o que TEM dia vai para o dia", () => {
    const r = linhasDosDias(mes([linha({ dia: 3, valor: 50 })]), 31);
    expect(r.dias[2].entrada.valor).toBe(50);
    expect(r.semDia).toBeNull();
  });

  it("⚠⚠ o que NÃO tem dia vai para uma linha própria — nunca é espalhado pelos dias", () => {
    // Distribuir a projeção pelos dias fabricaria precisão que ninguém informou. O `diaDesconhecido`
    // existe exatamente para impedir isso.
    const r = linhasDosDias(mes([linha({ dia: null, valor: 900 })]), 31);
    expect(r.semDia.entrada.valor).toBe(900);
    expect(r.dias.every((d) => d.entrada === null)).toBe(true);
  });

  it("⚠ dia FORA do mês não some — cai em 'no mês' em vez de evaporar", () => {
    // Dia 31 num mês de 30 não existe. Um `get` confiante devolveria `undefined` e a linha sumiria.
    const r = linhasDosDias(mes([linha({ dia: 31, valor: 70 })]), 30);
    expect(r.dias).toHaveLength(30);
    expect(r.semDia.entrada.valor).toBe(70);
  });

  it("⚠ todo dia do mês tem linha, mesmo vazio — v3 §3.7", () => {
    expect(linhasDosDias(mes([]), 28).dias).toHaveLength(28);
  });
});

describe("⚠ o modo %", () => {
  it("só Saída, Impostos e Folha viram percentual", () => {
    expect(COLUNAS_EM_PERCENTUAL).toEqual(["saida", "impostos", "folha"]);
  });

  it("a conta é sobre a Entrada do mesmo mês", () => {
    expect(emPercentual({ valor: 200 }, { valor: 1000 })).toBe(20);
  });

  it("⚠⚠ Entrada ZERO devolve `null` — nunca `0%` nem `Infinity`", () => {
    // Dividir por zero não produz uma proporção, produz uma mentira. A tela desenha traço.
    expect(emPercentual({ valor: 200 }, { valor: 0 })).toBeNull();
    expect(emPercentual({ valor: 200 }, null)).toBeNull();
  });

  it("⚠ célula ausente continua ausente no modo %", () => {
    expect(emPercentual(null, { valor: 1000 })).toBeNull();
  });
});
