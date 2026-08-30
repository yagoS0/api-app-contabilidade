// A TABELA DO FLUXO — as seis colunas do v3, e o `status` de cada célula.
//
// ⚠⚠ O que este arquivo protege é a diferença entre "o dinheiro saiu" e "o dinheiro vai sair". Ela
// é a coisa toda: um Resultado pintado de preto afirma que o mês fechou naquele número.

import {
  COLUNAS, COLUNAS_EM_PERCENTUAL, MESES_LADO_A_LADO, STATUS, emPercentual, gradeTransposta,
  linhaDoMes, linhasDosDias, navegacaoDoPar, parDeMeses,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FORMA v4 — dois meses lado a lado (em dias) e o horizonte transposto (29/08/2026).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ parDeMeses — os dois blocos da visão de dias", () => {
  const doze = Array.from({ length: 12 }, (_, i) => {
    const t = 2026 * 12 + 3 + i;
    const c = String(Math.floor(t / 12)) + "-" + String((t % 12) + 1).padStart(2, "0");
    return mes([linha({ competencia: c, valor: 100 + i })], c);
  });

  it("são DOIS, e o segundo é o mês seguinte ao primeiro", () => {
    const par = parDeMeses(doze, "2026-08");
    expect(par).toHaveLength(MESES_LADO_A_LADO);
    expect(par.map((b) => b.competencia)).toEqual(["2026-08", "2026-09"]);
    expect(par[0].mes.competencia).toBe("2026-08");
    expect(par[1].mes.competencia).toBe("2026-09");
  });

  it("⚠⚠ o mês que a janela não cobre volta NOMEADO, com `mes: null` — nunca como bloco vazio", () => {
    // Um bloco com todos os dias em traço afirmaria "este mês não tem nada"; o certo é "este mês
    // não está nesta consulta". A tela precisa poder dizer qual dos dois é.
    const par = parDeMeses(doze, "2027-03");
    expect(par[0].mes).not.toBeNull();
    expect(par[1].competencia).toBe("2027-04");
    expect(par[1].mes).toBeNull();
  });

  it("⚠ a virada do ano anda certo", () => {
    expect(parDeMeses([], "2026-12").map((b) => b.competencia)).toEqual(["2026-12", "2027-01"]);
  });

  it("⚠ competência malformada não fabrica bloco nenhum", () => {
    expect(parDeMeses(doze, "").map((b) => b.competencia)).toEqual([]);
    expect(parDeMeses(doze, null)).toEqual([]);
  });
});

describe("⚠⚠ navegacaoDoPar — duas fontes, e confundi-las quebra a seta", () => {
  const lista = ["2026-04", "2026-05", "2026-06", "2026-07"].map((c) => mes([], c));

  it("dentro da janela o passo é de graça — não olha os flags do servidor", () => {
    const n = navegacaoDoPar({ meses: lista, esquerda: "2026-05", janela: { podeVoltar: false, podeAvancar: false } });
    expect(n.podeVoltar).toBe(true);
    expect(n.precisaDeConsultaParaVoltar).toBe(false);
    expect(n.podeAvancar).toBe(true);
    expect(n.precisaDeConsultaParaAvancar).toBe(false);
  });

  it("⚠⚠ na BORDA quem decide é o servidor — a seta não morre numa janela que ele moveria", () => {
    const n = navegacaoDoPar({ meses: lista, esquerda: "2026-04", janela: { podeVoltar: true, podeAvancar: true } });
    expect(n.podeVoltar).toBe(true);
    expect(n.precisaDeConsultaParaVoltar).toBe(true);
  });

  it("⚠ e no limite do servidor ela DESABILITA — nunca some", () => {
    const n = navegacaoDoPar({ meses: lista, esquerda: "2026-04", janela: { podeVoltar: false, podeAvancar: false } });
    expect(n.podeVoltar).toBe(false);
  });

  it("⚠⚠ avançar exige o PAR inteiro, não só o mês seguinte", () => {
    // Com a esquerda no penúltimo, o passo levaria a um bloco da direita ausente — um passo que
    // piora a tela. Ele só é oferecido de graça quando os dois meses cabem.
    const n = navegacaoDoPar({ meses: lista, esquerda: "2026-06", janela: { podeAvancar: false } });
    expect(n.podeAvancar).toBe(false);
    const m = navegacaoDoPar({ meses: lista, esquerda: "2026-06", janela: { podeAvancar: true } });
    expect(m.podeAvancar).toBe(true);
    expect(m.precisaDeConsultaParaAvancar).toBe(true);
  });

  it("⚠ mês fora da lista não trava a tela — cai nos flags do servidor", () => {
    const n = navegacaoDoPar({ meses: lista, esquerda: "2030-01", janela: { podeVoltar: true, podeAvancar: true } });
    expect(n.podeVoltar).toBe(true);
    expect(n.podeAvancar).toBe(true);
  });

  it("payload vazio não quebra", () => {
    expect(navegacaoDoPar()).toEqual({
      podeVoltar: false, podeAvancar: false,
      precisaDeConsultaParaVoltar: true, precisaDeConsultaParaAvancar: true,
    });
  });
});

describe("⚠⚠ gradeTransposta — o horizonte", () => {
  const tres = [
    mes([linha({ valor: 1000, competencia: "2026-08" })], "2026-08"),
    mes([linha({ valor: 2000, competencia: "2026-09" })], "2026-09"),
    mes([linha({ valor: 3000, competencia: "2026-10" })], "2026-10"),
  ];

  it("categoria vira LINHA e mês vira COLUNA", () => {
    const g = gradeTransposta(tres);
    expect(g.competencias).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(g.linhas.map((l) => l.chave)).toEqual(["entrada", "saida", "impostos", "folha", "resultado"]);
    expect(g.linhas[0].celulas.map((c) => c && c.valor)).toEqual([1000, 2000, 3000]);
  });

  it("⚠⚠ NÃO é uma segunda soma: cada coluna é o mesmo `linhaDoMes` da visão de mês", () => {
    const g = gradeTransposta(tres);
    for (let i = 0; i < tres.length; i += 1) {
      const direto = linhaDoMes(tres[i]);
      for (const l of g.linhas) expect(l.celulas[i]).toEqual(direto[l.chave]);
    }
  });

  it("⚠ sem folha lançada a LINHA da folha não existe — quem decide é o servidor", () => {
    expect(gradeTransposta(tres, { comFolha: false }).linhas.map((l) => l.chave))
      .toEqual(["entrada", "saida", "impostos", "resultado"]);
  });

  it("⚠⚠ a entrada de cada coluna viaja junto — a base do modo % é POR MÊS", () => {
    // Usar a entrada de um mês como base de outro produziria um percentual plausível e errado.
    const g = gradeTransposta(tres);
    expect(g.entradas.map((e) => e && e.valor)).toEqual([1000, 2000, 3000]);
  });

  it("⚠ mês sem competência é descartado — coluna sem nome não pode virar `<th>`", () => {
    const g = gradeTransposta([...tres, { linhas: [linha({ valor: 9 })] }]);
    expect(g.competencias).toHaveLength(3);
  });

  it("lista vazia devolve as categorias sem coluna nenhuma", () => {
    const g = gradeTransposta([]);
    expect(g.competencias).toEqual([]);
    expect(g.linhas).toHaveLength(5);
    expect(g.linhas[0].celulas).toEqual([]);
  });
});
