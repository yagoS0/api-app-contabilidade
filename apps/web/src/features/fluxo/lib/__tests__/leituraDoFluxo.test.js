// A LEITURA DO FLUXO DE CAIXA NA TELA.
//
// ⚠⚠ O bloco que mais importa é a LEI DE COR: ela é o que impede uma PROJEÇÃO de se parecer com um
// FATO. Verde, nesta casa, quer dizer *pago/concluído* — o pior desfecho possível para uma linha
// que ainda não aconteceu.

import {
  DIRECAO,
  FONTE,
  FRASE_DA_PREVISAO,
  FRASE_SEM_TOTAL,
  MESES_ABERTOS_POR_PADRAO,
  PROCEDENCIA,
  TOKEN_PROIBIDO,
  confrontoDaLinha,
  dinheiro,
  evidenciaDaLinha,
  leituraDaProcedencia,
  mesTemAlgo,
  quandoDaLinha,
  ressalvasDoFluxo,
  rotuloDaFonte,
  rotuloDoMes,
  separarMeses,
  totaisParaTela,
  totalDoBloco,
} from "../leituraDoFluxo.js";

const linha = (extra = {}) => ({
  fonte: FONTE.GUIA,
  direcao: DIRECAO.SAIDA,
  procedencia: PROCEDENCIA.FATO,
  competencia: "2026-08",
  dia: 20,
  diaDesconhecido: null,
  valor: 1200,
  rotulo: "SIMPLES",
  base: { frase: "SIMPLES gerada, competência 2026-07" },
  ...extra,
});

const mes = (competencia, totais = {}) => ({
  competencia,
  linhas: [],
  totais: {
    fato: { entrada: 0, saida: 0 },
    previsao: { entrada: 0, saida: 0 },
    desconhecido: { quantas: 0 },
    ...totais,
  },
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A LEI DE COR.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ VERDE nunca aparece neste fluxo", () => {
  it.each(Object.values(PROCEDENCIA))("%s não é verde", (p) => {
    expect(leituraDaProcedencia(p).token).not.toBe(TOKEN_PROIBIDO);
  });

  it("⚠⚠ nem o FATO é verde — uma guia gerada e em aberto NÃO está paga", () => {
    // Verde ali diria "concluído" sobre dinheiro que ainda vai sair.
    expect(leituraDaProcedencia(PROCEDENCIA.FATO).token).toBe("--state-neutral");
  });

  it("⚠⚠ a PREVISÃO é âmbar E a palavra 'previsto' está no RÓTULO", () => {
    // Cor não pode ser a única marca: impressão em preto e branco e daltonismo tiram a cor.
    const r = leituraDaProcedencia(PROCEDENCIA.PREVISAO);
    expect(r.token).toBe("--state-warn");
    expect(r.rotulo).toMatch(/previsto/i);
    expect(r.frase).toMatch(/PREVISÃO/);
    expect(r.frase).toMatch(/ainda não aconteceu/i);
  });

  it("⚠ nenhuma usa vermelho — nada aqui bloqueia o fechamento contábil", () => {
    for (const p of Object.values(PROCEDENCIA)) {
      expect(leituraDaProcedencia(p).token).not.toBe("--state-danger");
    }
  });

  it("⚠ procedência que a tela não conhece não ganha rótulo bonito", () => {
    expect(leituraDaProcedencia("COISA_NOVA").rotulo).toMatch(/desconhecida/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ NÃO EXISTE SOMA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a tela não inventa um total", () => {
  it("os três compartimentos vêm separados", () => {
    const t = totaisParaTela({
      fato: { entrada: 0, saida: 1200 },
      previsao: { entrada: 8000, saida: 130 },
      desconhecido: { quantas: 2 },
    });
    expect(t.fato.saida).toBe(1200);
    expect(t.previsao.entrada).toBe(8000);
    expect(t.desconhecido.quantas).toBe(2);
    expect(t).not.toHaveProperty("total");
  });

  it("⚠⚠ o total do BLOCO recolhido também é por procedência — nunca somado", () => {
    const b = totalDoBloco([
      mes("2026-11", { fato: { entrada: 0, saida: 100 }, previsao: { entrada: 500, saida: 50 } }),
      mes("2026-12", { fato: { entrada: 0, saida: 200 }, previsao: { entrada: 700, saida: 20 } }),
    ]);
    expect(b.fato.saida).toBe(300);
    expect(b.previsao.entrada).toBe(1200);
    expect(b).not.toHaveProperty("total");
  });

  it("⚠ e as frases explicam POR QUE não há soma", () => {
    expect(FRASE_DA_PREVISAO).toMatch(/não são somados/i);
    expect(FRASE_SEM_TOTAL).toMatch(/sem saldo inicial/i);
  });

  it("⚠⚠ valor ausente NÃO vira 'R$ 0,00'", () => {
    expect(dinheiro(null)).toBe("—");
    expect(dinheiro(undefined)).toBe("—");
    expect(dinheiro("abc")).toBe("—");
    expect(dinheiro([])).toBe("—");
    // ⚠ mas zero DECLARADO é um valor
    expect(dinheiro(0)).toMatch(/0,00/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O DIA QUE NÃO EXISTE.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o dia ausente nunca vira um dia inventado", () => {
  it("a guia tem dia próprio", () => {
    const q = quandoDaLinha(linha({ dia: 20 }));
    expect(q.texto).toBe("dia 20");
    expect(q.exato).toBe(true);
  });

  it("⚠⚠ a projeção diz 'no mês', e o motivo vem do SERVIDOR", () => {
    const q = quandoDaLinha(linha({
      dia: null,
      diaDesconhecido: { motivo: "projecao_por_mes", frase: "O prazo é contado em meses." },
    }));
    expect(q.texto).toBe("no mês");
    expect(q.exato).toBe(false);
    // ⚠ A tela não escreve a sua frase — as duas divergiriam na primeira correção.
    expect(q.motivo).toBe("O prazo é contado em meses.");
  });

  it("⚠ sem motivo do servidor, a tela não inventa um", () => {
    expect(quandoDaLinha(linha({ dia: null, diaDesconhecido: null })).motivo).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A EVIDÊNCIA NO TEXTO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a evidência", () => {
  it("a frase do servidor aparece", () => {
    expect(evidenciaDaLinha(linha())).toMatch(/SIMPLES gerada/);
  });

  it("⚠⚠ a FAIXA viaja junto — o CV mediano das despesas é 36,1%", () => {
    const l = linha({ base: { frase: "recorrência marcada", n: 3, min: 120, max: 140 } });
    const e = evidenciaDaLinha(l);
    expect(e).toMatch(/3 observações/);
    expect(e).toMatch(/entre R\$\s*120,00 e R\$\s*140,00/);
  });

  it("⚠ valor constante não inventa faixa", () => {
    const l = linha({ base: { n: 3, min: 130, max: 130 } });
    expect(evidenciaDaLinha(l)).not.toMatch(/entre/);
  });

  it("⚠ sem base nenhuma, devolve null — nada de 'baseado em 0 observações'", () => {
    expect(evidenciaDaLinha(linha({ base: null }))).toBeNull();
  });
});

describe("⚠⚠ o confronto declarado × observado", () => {
  it("mostra os dois números e diz quem vence", () => {
    const l = linha({ base: { valorDeclarado: 1000, valorObservado: 1180 } });
    const c = confrontoDaLinha(l);
    expect(c).toMatch(/1\.000,00/);
    expect(c).toMatch(/1\.180,00/);
    expect(c).toMatch(/observado vence/i);
  });

  it("⚠ diferença de centavos não vira aviso — aviso em toda linha vira paisagem", () => {
    expect(confrontoDaLinha(linha({ base: { valorDeclarado: 1000, valorObservado: 1020 } }))).toBeNull();
  });

  it("⚠ sem os dois valores, não há confronto", () => {
    expect(confrontoDaLinha(linha({ base: { valorDeclarado: 1000 } }))).toBeNull();
    expect(confrontoDaLinha(linha())).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ AS RESSALVAS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as ressalvas do fluxo", () => {
  it("⚠⚠ a guia VENCIDA aparece, com o valor — ela é a linha mais urgente", () => {
    const r = ressalvasDoFluxo({ vencidas: { quantas: 2, valor: 18638.39 } });
    expect(r[0].texto).toMatch(/2 guia\(s\) já venceram/i);
    expect(r[0].texto).toMatch(/18\.638,39/);
    // ⚠ E explica por que ela não está nos meses.
    expect(r[0].texto).toMatch(/o dinheiro ainda tem de sair/i);
  });

  it("⚠⚠ 'ninguém configurou o prazo' aparece — o padrão não pode passar por decisão", () => {
    const r = ressalvasDoFluxo({ prazoRecebimento: { meses: 1, configurado: false } });
    expect(r.some((x) => /ninguém configurou/i.test(x.texto))).toBe(true);
  });

  it("⚠ configurado NÃO gera ressalva", () => {
    const r = ressalvasDoFluxo({ prazoRecebimento: { meses: 2, configurado: true } });
    expect(r.some((x) => /padrão/i.test(x.texto))).toBe(false);
  });

  it("⚠⚠ o que não tem mês sai NOMEADO, com a frase do servidor", () => {
    const r = ressalvasDoFluxo({
      semMes: [{ motivo: "guia_sem_vencimento", frase: "Recapture a guia.", rotulo: "DAS" }],
    });
    expect(r[0].texto).toBe("Recapture a guia.");
    expect(r[0].rotulo).toBe("DAS");
  });

  it("⚠⚠ a ausência do imposto projetado é DITA — nunca uma linha que some", () => {
    const r = ressalvasDoFluxo({ semImposto: { motivo: "sem_apuracao", frase: "Não há apuração." } });
    expect(r.some((x) => x.texto === "Não há apuração.")).toBe(true);
  });

  it("⚠⚠ 'a tabela não existe' ≠ 'esta empresa não tem recorrência'", () => {
    const r = ressalvasDoFluxo({ recorrenciaIndisponivel: true });
    expect(r.some((x) => /tabela não existe no banco/i.test(x.texto))).toBe(true);
  });

  it("⚠ o que ficou fora do horizonte é contado", () => {
    const r = ressalvasDoFluxo({ foraDoHorizonte: 3, horizonte: 12 });
    expect(r.some((x) => /3 linha\(s\) caem fora dos 12 meses/.test(x.texto))).toBe(true);
  });

  it("⚠⚠ fluxo sem ressalva nenhuma devolve LISTA VAZIA — avisos inventados viram paisagem", () => {
    const r = ressalvasDoFluxo({
      vencidas: { quantas: 0, valor: 0 }, semMes: [],
      prazoRecebimento: { meses: 1, configurado: true },
      semImposto: null, recorrenciaIndisponivel: false, foraDoHorizonte: 0,
    });
    expect(r).toEqual([]);
  });

  it("payload vazio não quebra", () => {
    expect(Array.isArray(ressalvasDoFluxo({}))).toBe(true);
    expect(Array.isArray(ressalvasDoFluxo(null))).toBe(true);
  });

  // ⚠⚠ ACHADO NO NAVEGADOR, não no teste (27/08/2026): as três ressalvas do mock saíam empilhadas
  // com o MESMO título — "Sobre este fluxo", escrito na tela. É literalmente o defeito que o
  // `titulo` obrigatório do `Aviso` existe para impedir ("duas caixas âmbar coladas, escritas à
  // mão, indistinguíveis"). O título passou a sair DAQUI, e este bloco é o que impede a volta.
  it("⚠⚠ CADA RESSALVA TEM TÍTULO PRÓPRIO, e nenhum se repete", () => {
    const r = ressalvasDoFluxo({
      vencidas: { quantas: 2, valor: 18638.39 },
      semMes: [{ motivo: "guia_sem_vencimento", frase: "Recapture a guia.", rotulo: "DAS" }],
      prazoRecebimento: { meses: 1, configurado: false },
      semImposto: { motivo: "sem_apuracao", frase: "Não há apuração." },
      recorrenciaIndisponivel: true,
      foraDoHorizonte: 3,
      horizonte: 12,
    });
    expect(r).toHaveLength(6);
    for (const x of r) expect(String(x.titulo || "").trim()).not.toBe("");
    expect(new Set(r.map((x) => x.titulo)).size).toBe(6);
  });

  it("⚠ o rótulo da linha sem mês ENTRA no título — duas guias assim precisam se distinguir", () => {
    const r = ressalvasDoFluxo({
      semMes: [
        { motivo: "guia_sem_vencimento", frase: "Recapture.", rotulo: "DAS" },
        { motivo: "guia_sem_vencimento", frase: "Recapture.", rotulo: "INSS" },
      ],
    });
    expect(r[0].titulo).toBe("Sem mês — DAS");
    expect(r[1].titulo).toBe("Sem mês — INSS");
  });

  it("⚠ sem rótulo, o título ainda existe — a caixa nunca fica sem nome", () => {
    const r = ressalvasDoFluxo({ semMes: [{ motivo: "x", frase: "Falta algo.", rotulo: null }] });
    expect(r[0].titulo).toBe("Sem mês definido");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A TELA ABRE COM 3 MESES.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ os 12 meses, com 3 abertos", () => {
  const doze = Array.from({ length: 12 }, (_, i) => mes(`2026-${String(i + 1).padStart(2, "0")}`));

  it("três abertos, nove recolhidos", () => {
    // O dono escolheu o horizonte de 12; a ressalva é que o 12º mês é extrapolação quase pura. O
    // contrato entrega os 12, e a LEITURA começa onde a evidência está.
    const r = separarMeses(doze);
    expect(MESES_ABERTOS_POR_PADRAO).toBe(3);
    expect(r.proximos).toHaveLength(3);
    expect(r.distantes).toHaveLength(9);
  });

  it("⚠ com menos de três meses, nada fica recolhido", () => {
    const r = separarMeses(doze.slice(0, 2));
    expect(r.proximos).toHaveLength(2);
    expect(r.distantes).toEqual([]);
  });

  it("lista vazia não quebra", () => {
    expect(separarMeses(null)).toEqual({ proximos: [], distantes: [] });
  });
});

describe("⚠ os rótulos", () => {
  it("o mês vira texto legível", () => {
    expect(rotuloDoMes("2026-08")).toBe("agosto de 2026");
    expect(rotuloDoMes("2026-13")).toBe("—");
    expect(rotuloDoMes(null)).toBe("—");
  });

  it("⚠⚠ o imposto projetado se chama PREVISTO, nunca 'calculado' nem 'DAS'", () => {
    const r = rotuloDaFonte(FONTE.IMPOSTO_PROJETADO);
    expect(r).toMatch(/previsto/i);
    expect(r).not.toMatch(/calculado|DAS/i);
  });

  it("⚠ fonte desconhecida não inventa nome", () => {
    expect(rotuloDaFonte("COISA_NOVA")).toMatch(/desconhecida/i);
  });

  it("mês vazio é reconhecido", () => {
    expect(mesTemAlgo(mes("2026-08"))).toBe(false);
    expect(mesTemAlgo({ linhas: [linha()] })).toBe(true);
  });
});
