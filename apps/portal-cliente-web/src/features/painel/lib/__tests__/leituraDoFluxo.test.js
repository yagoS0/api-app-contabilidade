// A LEITURA DO FLUXO DE CAIXA NO PORTAL DO CLIENTE.
//
// ⚠⚠ Quem lê esta tela é o DONO DA EMPRESA, e ele pode decidir caixa em cima do número. Por isso a
// LEI DE COR pesa mais aqui do que no portal do contador: verde, nesta casa, quer dizer
// *pago/concluído*, e uma previsão verde diria que o dinheiro já entrou.

import {
  CLASSES_DA_PROCEDENCIA,
  DIRECAO,
  ESTADO_DA_SAIDA_DO_CLIENTE,
  FONTE,
  FRASE_DA_PREVISAO,
  FRASE_SEM_TOTAL,
  MESES_ABERTOS_POR_PADRAO,
  PROCEDENCIA,
  TOKEN_PROIBIDO,
  confrontoDaLinha,
  evidenciaDaLinha,
  leituraDaProcedencia,
  mesCurto,
  mesTemAlgo,
  quandoDaLinha,
  ressalvasDoFluxo,
  rotuloDaFonte,
  saidasDoClienteNoFluxo,
  rotuloDoMes,
  separarMeses,
  TIPO_DA_SAIDA,
  totaisParaTela,
  totalDoBloco,
} from "../leituraDoFluxo";

const linha = (extra = {}) => ({
  fonte: FONTE.GUIA,
  direcao: "SAIDA",
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
  it.each(Object.values(PROCEDENCIA))("%s não usa a classe do verde", (p) => {
    const r = leituraDaProcedencia(p);
    expect(r.classe).not.toBe("ok");
    expect(CLASSES_DA_PROCEDENCIA).toContain(r.classe);
  });

  it("⚠⚠ o token proibido deste app é `--success` — a paleta é CLARA, não a do contador", () => {
    expect(TOKEN_PROIBIDO).toBe("--success");
  });

  it("⚠⚠ nem o FATO é verde — uma guia gerada e em aberto NÃO está paga", () => {
    expect(leituraDaProcedencia(PROCEDENCIA.FATO).classe).toBe("neutro");
  });

  it("⚠⚠ a PREVISÃO tem a palavra 'previsto' no RÓTULO, não só na cor", () => {
    const r = leituraDaProcedencia(PROCEDENCIA.PREVISAO);
    expect(r.classe).toBe("aviso");
    expect(r.rotulo).toMatch(/previsto/i);
    expect(r.frase).toMatch(/PREVISÃO/);
    expect(r.frase).toMatch(/ainda não aconteceu/i);
  });

  it("⚠ origem que a tela não conhece não ganha rótulo bonito — e manda falar com o contador", () => {
    const r = leituraDaProcedencia("COISA_NOVA");
    expect(r.rotulo).toMatch(/não sabemos/i);
    expect(r.frase).toMatch(/contador/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ NÃO EXISTE SOMA.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a tela não inventa um total", () => {
  it("os três compartimentos vêm separados, e não há chave `total`", () => {
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

  it("⚠⚠ o total do BLOCO recolhido também é por procedência", () => {
    const b = totalDoBloco([
      mes("2026-11", { fato: { entrada: 0, saida: 100 }, previsao: { entrada: 500, saida: 50 } }),
      mes("2026-12", { fato: { entrada: 0, saida: 200 }, previsao: { entrada: 700, saida: 20 } }),
    ]);
    expect(b.fato.saida).toBe(300);
    expect(b.previsao.entrada).toBe(1200);
    expect(b).not.toHaveProperty("total");
  });

  it("⚠ e as frases explicam POR QUE não há soma, no vocabulário de quem paga as contas", () => {
    expect(FRASE_DA_PREVISAO).toMatch(/ainda não aconteceu/i);
    expect(FRASE_DA_PREVISAO).toMatch(/não é somado/i);
    expect(FRASE_SEM_TOTAL).toMatch(/MOVIMENTOS/);
    expect(FRASE_SEM_TOTAL).toMatch(/quanto você tem em conta/i);
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

  it("⚠⚠ a projeção diz 'ao longo do mês', e o motivo vem do SERVIDOR", () => {
    const q = quandoDaLinha(linha({
      dia: null,
      diaDesconhecido: { motivo: "projecao_por_mes", frase: "O prazo é contado em meses." },
    }));
    expect(q.texto).toBe("ao longo do mês");
    expect(q.exato).toBe(false);
    expect(q.motivo).toBe("O prazo é contado em meses.");
  });

  it("⚠ sem motivo do servidor, a tela não inventa um", () => {
    expect(quandoDaLinha(linha({ dia: null, diaDesconhecido: null })).motivo).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A EVIDÊNCIA E O CONFRONTO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ por que esta linha está aqui", () => {
  it("a frase do servidor aparece", () => {
    expect(evidenciaDaLinha(linha())).toMatch(/SIMPLES gerada/);
  });

  it("⚠⚠ a FAIXA viaja junto, e o texto é o do cliente ('visto 3 vezes')", () => {
    const e = evidenciaDaLinha(linha({ base: { frase: "se repete todo mês", n: 3, min: 120, max: 140 } }));
    expect(e).toMatch(/visto 3 vezes/);
    expect(e).toMatch(/entre R\$\s*120,00 e R\$\s*140,00/);
    // ⚠ Nada de "observações", "mediana" ou "competência" na tela do cliente.
    expect(e).not.toMatch(/observaç|mediana|competência/i);
  });

  it("⚠ valor constante não inventa faixa", () => {
    expect(evidenciaDaLinha(linha({ base: { n: 3, min: 130, max: 130 } }))).not.toMatch(/entre/);
  });

  it("⚠ sem base nenhuma, devolve null", () => {
    expect(evidenciaDaLinha(linha({ base: null }))).toBeNull();
  });

  it("⚠⚠ o confronto fala com quem DECLAROU, sem acusar", () => {
    const c = confrontoDaLinha(linha({ base: { valorDeclarado: 1000, valorObservado: 1180 } }));
    expect(c).toMatch(/Você informou/);
    expect(c).toMatch(/1\.000,00/);
    expect(c).toMatch(/1\.180,00/);
    expect(c).toMatch(/valor que apareceu/i);
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
describe("⚠⚠ as ressalvas", () => {
  it("⚠⚠ a guia VENCIDA aparece, com o valor e com o que fazer", () => {
    const r = ressalvasDoFluxo({ vencidas: { quantas: 2, valor: 18638.39 } });
    expect(r[0].texto).toMatch(/2 guia\(s\) já venceram/i);
    expect(r[0].texto).toMatch(/18\.638,39/);
    expect(r[0].texto).toMatch(/o dinheiro ainda tem de sair/i);
    // ⚠ A tela do cliente não pode terminar num beco: ela diz a quem recorrer.
    expect(r[0].texto).toMatch(/contador/i);
  });

  /*
   * ⚠⚠ ESTES DOIS TESTES DIZIAM O CONTRÁRIO ATÉ 29/08/2026, e o que eles pediam era:
   *
   *   • *"'ninguém configurou o prazo' APARECE — o padrão não passa por decisão"* (a ressalva com a
   *     frase "PADRÃO do sistema" para `configurado: false`);
   *   • *"configurado NÃO gera ressalva"*.
   *
   * O argumento deles continua bom e não foi derrubado — o que sumiu foi o OBJETO. O dono decidiu
   * que a entrada da nota cai no **dia 1 do mês seguinte à emissão**, sempre, e o prazo deixou de
   * ser configurável: `FluxoDeCaixaService` não lê mais `PortalClient.prazoRecebimentoMeses` e o
   * campo `prazoRecebimento` não viaja no payload. Uma ressalva mandando o cliente *"falar com o
   * contador"* sobre um ajuste que ninguém pode mais fazer é pior que ressalva nenhuma.
   *
   * ⚠ Ficam invertidos, e não apagados: é o que impede alguém de "consertar" a ausência da ressalva
   * reintroduzindo a leitura do campo.
   */
  it("⚠⚠ o prazo NÃO gera ressalva nenhuma — nem quando o payload antigo ainda o traz", () => {
    expect(ressalvasDoFluxo({ prazoRecebimento: { meses: 1, configurado: false } })).toEqual([]);
    expect(ressalvasDoFluxo({ prazoRecebimento: { meses: 2, configurado: true } })).toEqual([]);
  });

  it("⚠ e a palavra 'prazo' não sobrou em ressalva nenhuma", () => {
    const r = ressalvasDoFluxo({
      vencidas: { quantas: 1, valor: 10 },
      semMes: [{ frase: "x", rotulo: "DAS" }],
      prazoRecebimento: { meses: 1, configurado: false },
      semImposto: { frase: "y" },
      recorrenciaIndisponivel: true,
      foraDoHorizonte: 2,
    });
    for (const x of r) expect(String(x.texto || "")).not.toMatch(/prazo de recebimento/i);
  });

  it("⚠⚠ o que não tem mês sai NOMEADO, com a frase do servidor", () => {
    const r = ressalvasDoFluxo({
      semMes: [{ motivo: "guia_sem_vencimento", frase: "Recapture a guia.", rotulo: "DAS" }],
    });
    expect(r[0].texto).toBe("Recapture a guia.");
    expect(r[0].titulo).toBe("Sem mês — DAS");
  });

  it("⚠⚠ a ausência do imposto previsto é DITA", () => {
    const r = ressalvasDoFluxo({ semImposto: { motivo: "sem_apuracao", frase: "Não há apuração." } });
    expect(r.some((x) => x.texto === "Não há apuração.")).toBe(true);
  });

  it("⚠⚠ 'não pudemos ler' NÃO vira afirmação sobre a empresa", () => {
    const r = ressalvasDoFluxo({ recorrenciaIndisponivel: true });
    expect(r[0].texto).toMatch(/limitação do sistema, não uma afirmação sobre a sua empresa/i);
  });

  it("⚠ o que ficou fora do horizonte é contado", () => {
    const r = ressalvasDoFluxo({ foraDoHorizonte: 3, horizonte: 12 });
    expect(r.some((x) => /3 linha\(s\) caem fora dos 12 meses/.test(x.texto))).toBe(true);
  });

  it("⚠⚠ CADA RESSALVA TEM TÍTULO PRÓPRIO, e nenhum se repete", () => {
    // ⚠ Eram SEIS até 29/08/2026; a do prazo de recebimento saiu (ver a lápide acima). O número é
    // conferido de propósito: uma ressalva a menos aqui só passa depois de alguém explicar qual.
    const r = ressalvasDoFluxo({
      vencidas: { quantas: 2, valor: 100 },
      semMes: [{ frase: "x", rotulo: "DAS" }],
      semImposto: { frase: "y" },
      recorrenciaIndisponivel: true,
      foraDoHorizonte: 3,
    });
    expect(r).toHaveLength(5);
    for (const x of r) expect(String(x.titulo || "").trim()).not.toBe("");
    expect(new Set(r.map((x) => x.titulo)).size).toBe(5);
  });

  it("⚠⚠ fluxo sem ressalva nenhuma devolve LISTA VAZIA", () => {
    const r = ressalvasDoFluxo({
      vencidas: { quantas: 0, valor: 0 }, semMes: [],
      prazoRecebimento: { meses: 1, configurado: true },
      semImposto: null, recorrenciaIndisponivel: false, foraDoHorizonte: 0,
    });
    expect(r).toEqual([]);
  });

  it("payload vazio não quebra", () => {
    expect(ressalvasDoFluxo({})).toEqual([]);
    expect(ressalvasDoFluxo(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ OS 12 MESES, COM 3 ABERTOS.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a tela abre com 3 meses", () => {
  const doze = Array.from({ length: 12 }, (_, i) => mes(`2026-${String(i + 1).padStart(2, "0")}`));

  it("três abertos, nove recolhidos", () => {
    const r = separarMeses(doze);
    expect(MESES_ABERTOS_POR_PADRAO).toBe(3);
    expect(r.proximos).toHaveLength(3);
    expect(r.distantes).toHaveLength(9);
  });

  it("⚠ com menos de três meses, nada fica recolhido", () => {
    expect(separarMeses(doze.slice(0, 2)).distantes).toEqual([]);
  });

  it("lista vazia não quebra", () => {
    expect(separarMeses(null)).toEqual({ proximos: [], distantes: [] });
  });
});

describe("⚠ os rótulos", () => {
  it("o mês vira texto legível, e o curto cabe no celular", () => {
    expect(rotuloDoMes("2026-08")).toBe("agosto de 2026");
    expect(mesCurto("2026-08")).toBe("ago/26");
    expect(rotuloDoMes("2026-13")).toBe("—");
    expect(mesCurto(null)).toBe("—");
  });

  it("⚠⚠ o imposto se chama PREVISTO, nunca 'calculado' nem 'DAS'", () => {
    const r = rotuloDaFonte(FONTE.IMPOSTO_PROJETADO);
    expect(r).toMatch(/previsto/i);
    expect(r).not.toMatch(/calculado|DAS/i);
  });

  it("⚠ as origens falam a língua de quem RECEBE, não a do razão", () => {
    expect(rotuloDaFonte(FONTE.SERIE_DESPESA)).toMatch(/se repete/i);
    expect(rotuloDaFonte(FONTE.NOTA_EMITIDA)).toMatch(/recebimento/i);
    expect(rotuloDaFonte("COISA_NOVA")).toMatch(/desconhecida/i);
  });

  it("mês vazio é reconhecido", () => {
    expect(mesTemAlgo(mes("2026-08"))).toBe(false);
    expect(mesTemAlgo({ linhas: [linha()] })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE O CLIENTE ACRESCENTOU — uma linha por SAÍDA, nunca por ocorrência (29/08/2026).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ saidasDoClienteNoFluxo", () => {
  const avulsa = (extra = {}) => ({
    fonte: FONTE.SAIDA_DO_CLIENTE, direcao: DIRECAO.SAIDA, procedencia: PROCEDENCIA.PREVISAO,
    competencia: "2026-09", dia: 10, valor: 3000, rotulo: "Reforma da sala",
    base: { doCliente: true, estadoDaSaida: "PENDENTE" },
    referencia: { tipo: "saidaAvulsa", id: "sa-1" }, ...extra,
  });
  const declarada = (competencia, extra = {}) => ({
    fonte: FONTE.SERIE_DESPESA, direcao: DIRECAO.SAIDA, procedencia: PROCEDENCIA.PREVISAO,
    competencia, dia: null, valor: 1200, rotulo: "Aluguel",
    base: { origem: "DECLARADA" }, referencia: { tipo: "serie", id: "sr-1" }, ...extra,
  });
  const mesesCom = (...listas) => listas.map((linhas, i) => ({
    competencia: `2026-0${8 + i}`, linhas,
  }));

  it("acha a avulsa e diz o tipo", () => {
    const r = saidasDoClienteNoFluxo(mesesCom([avulsa()]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "sa-1", tipo: TIPO_DA_SAIDA.AVULSA, rotulo: "Reforma da sala", dia: 10 });
  });

  it("⚠⚠ a recorrente é UMA linha, com a contagem — nunca oito", () => {
    // Listá-la uma vez por mês daria oito botões de remover para UMA coisa só, e a pessoa não
    // saberia qual clicar.
    const r = saidasDoClienteNoFluxo(mesesCom(
      [declarada("2026-08")], [declarada("2026-09")], [declarada("2026-10")],
    ));
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe(TIPO_DA_SAIDA.RECORRENTE);
    expect(r[0].ocorrencias).toBe(3);
    // ⚠ `valor` é o de UMA ocorrência (é o que a pessoa digitou); `total` é o do horizonte.
    expect(r[0].valor).toBe(1200);
    expect(r[0].total).toBe(3600);
  });

  it("⚠⚠ a série DETECTADA não é do cliente — ela não entra na lista", () => {
    // Ela é do sistema. Mostrá-la aqui daria ao cliente um botão de remover sobre a observação que
    // o detector levou meses juntando.
    const r = saidasDoClienteNoFluxo(mesesCom([declarada("2026-08", { base: { origem: "DETECTADA" } })]));
    expect(r).toEqual([]);
  });

  it("⚠ e nenhuma outra fonte entra — guia, folha e nota ficam de fora", () => {
    const r = saidasDoClienteNoFluxo(mesesCom([
      { fonte: FONTE.GUIA, valor: 100, referencia: { tipo: "guia", id: "g-1" } },
      { fonte: FONTE.FOLHA, valor: 200, referencia: { tipo: "folha", id: "f-1" } },
      { fonte: FONTE.NOTA_EMITIDA, valor: 300, referencia: { tipo: "nota", id: "n-1" } },
    ]));
    expect(r).toEqual([]);
  });

  it("⚠⚠ estado AUSENTE lê como PENDENTE — errar para o outro lado esconde o botão de quem podia desfazer", () => {
    const r = saidasDoClienteNoFluxo(mesesCom([avulsa({ base: { doCliente: true } })]));
    expect(r[0].estado).toBe(ESTADO_DA_SAIDA_DO_CLIENTE.PENDENTE);
  });

  it("⚠ CONFIRMADA chega como confirmada", () => {
    const r = saidasDoClienteNoFluxo(mesesCom([avulsa({ base: { doCliente: true, estadoDaSaida: "CONFIRMADA" } })]));
    expect(r[0].estado).toBe(ESTADO_DA_SAIDA_DO_CLIENTE.CONFIRMADA);
  });

  it("⚠ linha sem referência é descartada — sem id não há o que remover", () => {
    expect(saidasDoClienteNoFluxo(mesesCom([avulsa({ referencia: null })]))).toEqual([]);
  });

  it("⚠ a ordem é estável: avulsas por data, recorrentes por nome", () => {
    // Sem ordem estável a lista se reordena a cada recarga e o botão troca de lugar embaixo do dedo.
    const r = saidasDoClienteNoFluxo(mesesCom([
      declarada("2026-08", { rotulo: "Zelador", referencia: { tipo: "serie", id: "sr-z" } }),
      declarada("2026-08", { rotulo: "Aluguel", referencia: { tipo: "serie", id: "sr-a" } }),
      avulsa({ competencia: "2026-10", dia: 5, referencia: { tipo: "saidaAvulsa", id: "sa-2" } }),
      avulsa(),
    ]));
    expect(r.map((s) => s.id)).toEqual(["sa-1", "sa-2", "sr-a", "sr-z"]);
  });

  it("payload vazio não quebra", () => {
    expect(saidasDoClienteNoFluxo([])).toEqual([]);
    expect(saidasDoClienteNoFluxo(null)).toEqual([]);
    expect(saidasDoClienteNoFluxo([{ linhas: null }])).toEqual([]);
  });
});
