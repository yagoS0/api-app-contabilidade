// A LEITURA DA RECORRÊNCIA NA TELA.
//
// ⚠ A regra de DETECÇÃO mora no servidor (`application/fluxo/lib/recorrencia.js`) e tem teste
// próprio. O que se prende aqui é a leitura: rótulo, cor, ordem, o confronto, e qual botão aparece.

import {
  ACAO,
  ESTADO_DA_ACAO,
  ESTADO_DA_SERIE,
  LEITURA,
  ORIGEM_DA_SERIE,
  acoesDaSerie,
  confrontoDaDeclaracao,
  dinheiro,
  evidenciaDaSerie,
  leituraDaOrigem,
  leituraNaTela,
  motivoDeBloqueio,
  ordenarSeries,
  pedemResposta,
  rotuloDaPeriodicidade,
  rotuloDoLado,
  valorComFaixa,
} from "../recorrenciaTela.js";

const serie = (extra = {}) => ({
  lado: "DESPESA",
  chave: "98765432000155",
  rotulo: "ANTHROPIC",
  periodicidade: "MENSAL",
  estado: null,
  origem: null,
  valorDeclarado: null,
  leitura: LEITURA.SUGERE_ENTRADA,
  valorProjetado: 130,
  base: { n: 3, min: 120, max: 140, cv: 0.08 },
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A LEI DE COR — e ela é o que impede uma PROJEÇÃO de se parecer com um FATO.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ nenhuma leitura é verde, e nenhuma é vermelha", () => {
  it.each(Object.values(LEITURA))("%s não usa verde nem vermelho", (l) => {
    const t = leituraNaTela(l).token;
    // ⚠⚠ VERDE quer dizer CONCLUÍDO nesta casa. Uma série recorrente é PROJEÇÃO — ela não aconteceu.
    expect(t).not.toBe("--state-ok");
    // ⚠⚠ VERMELHO bloqueia o fechamento contábil, e nenhuma resposta do detector bloqueia nada.
    expect(t).not.toBe("--state-danger");
  });

  it("⚠ leitura desconhecida não inventa rótulo bonito", () => {
    const r = leituraNaTela("coisa_nova_do_servidor");
    expect(r.rotulo).toMatch(/desconhecida/i);
    expect(r.token).toBe("--state-neutral");
  });

  it("⚠ 'sem padrão ainda' é NEUTRO, não âmbar — não ter padrão não é pendência de ninguém", () => {
    expect(leituraNaTela(LEITURA.POUCAS_OBSERVACOES).token).toBe("--state-neutral");
  });

  it("⚠ 'parece se repetir' e 'parou de aparecer' são ÂMBAR — os dois esperam decisão", () => {
    expect(leituraNaTela(LEITURA.SUGERE_ENTRADA).token).toBe("--state-warn");
    expect(leituraNaTela(LEITURA.SUGERE_SAIDA).token).toBe("--state-warn");
  });

  it("⚠⚠ a frase da sugestão diz SUGERE, nunca afirma", () => {
    // O piso é 3 (decisão do dono), e um trimestre coincidente alcança isso — o que segura o
    // desenho é a marcação, não o número.
    expect(leituraNaTela(LEITURA.SUGERE_ENTRADA).frase).toMatch(/sugere/i);
    expect(leituraNaTela(LEITURA.SUGERE_ENTRADA).rotulo).toMatch(/parece/i);
  });

  it("⚠⚠ a saída diz que o sistema NÃO desmarca", () => {
    expect(leituraNaTela(LEITURA.SUGERE_SAIDA).frase).toMatch(/não a desmarca/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O VALOR SAI COM A FAIXA — nunca o ponto sozinho.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ valorComFaixa", () => {
  it("o ponto vem com a faixa observada", () => {
    const r = valorComFaixa(serie());
    expect(r).toMatch(/≈/);
    expect(r).toMatch(/130,00/);
    expect(r).toMatch(/120,00/);
    expect(r).toMatch(/140,00/);
  });

  it("⚠⚠ havendo faixa, ela NUNCA é omitida — o CV mediano das despesas é 36,1%", () => {
    // A mediana sozinha erraria por um terço rotineiramente, e o fluxo diria um número inútil.
    expect(valorComFaixa(serie({ valorProjetado: 200, base: { n: 3, min: 100, max: 300 } })))
      .toMatch(/entre/);
  });

  it("⚠ valor constante não inventa faixa", () => {
    expect(valorComFaixa(serie({ valorProjetado: 130, base: { n: 3, min: 130, max: 130 } })))
      .not.toMatch(/entre/);
  });

  it("⚠⚠ sem valor devolve NULL — nunca 'R$ 0,00'", () => {
    // Zero fabricado é a armadilha que já custou um "0%" na tela do cliente.
    expect(valorComFaixa(serie({ valorProjetado: null }))).toBeNull();
    expect(valorComFaixa(null)).toBeNull();
  });

  it("⚠ `Decimal` como string é aceito — é como o valor viaja do Prisma", () => {
    expect(valorComFaixa(serie({ valorProjetado: "130.00", base: { n: 3, min: "120.00", max: "140.00" } })))
      .toMatch(/130,00/);
  });

  it("⚠ zero DECLARADO é um valor, e aparece", () => {
    expect(dinheiro(0)).toMatch(/0,00/);
    // ⚠ mas o que não é número não vira zero
    expect(dinheiro(null)).toBe("—");
    expect(dinheiro("abc")).toBe("—");
    expect(dinheiro([])).toBe("—");
    expect(dinheiro(" ")).toBe("—");
  });
});

describe("⚠⚠ a evidência vai no TEXTO", () => {
  it("o `n` aparece — `title` não existe no teclado nem no toque", () => {
    expect(evidenciaDaSerie(serie())).toMatch(/3 observações/);
  });

  it("⚠ o CV é EVIDÊNCIA, não gatilho — ele aparece, e não decide nada", () => {
    expect(evidenciaDaSerie(serie())).toMatch(/variação de 8%/);
  });

  it("⚠ série instável AINDA aparece, com o CV à vista", () => {
    expect(evidenciaDaSerie(serie({ base: { n: 4, cv: 0.61 } }))).toMatch(/variação de 61%/);
  });

  it("⚠ sem base, devolve null — não se inventa 'baseado em 0 observações'", () => {
    expect(evidenciaDaSerie(serie({ base: null }))).toBeNull();
    expect(evidenciaDaSerie(serie({ base: { n: 0 } }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ DETECTADA E DECLARADA NÃO SE PARECEM.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a origem", () => {
  it("a declarada diz que é AFIRMAÇÃO, não observação", () => {
    const r = leituraDaOrigem(ORIGEM_DA_SERIE.DECLARADA);
    expect(r.ehObservada).toBe(false);
    expect(r.frase).toMatch(/afirmou/i);
  });

  it("a detectada diz de onde o padrão saiu", () => {
    expect(leituraDaOrigem(ORIGEM_DA_SERIE.DETECTADA).ehObservada).toBe(true);
  });

  it("⚠ série sem marcação é CANDIDATA — diferente de declarada", () => {
    expect(leituraDaOrigem(null).rotulo).toBe("Candidata");
  });
});

describe("⚠⚠ o confronto — o OBSERVADO vence", () => {
  const declarada = (extra = {}) => serie({
    origem: ORIGEM_DA_SERIE.DECLARADA,
    estado: ESTADO_DA_SERIE.PENDENTE,
    valorDeclarado: 1000,
    ...extra,
  });

  it("⚠⚠ declaração SEM observação nenhuma é CONFRONTADA, não confiada", () => {
    // Sem isto o fluxo projeta dinheiro saindo que não sai — e ninguém descobre.
    const r = confrontoDaDeclaracao(declarada({ valorProjetado: null, base: { n: 0 } }));
    expect(r.tipo).toBe("sem_observacao");
    expect(r.frase).toMatch(/não localizamos nenhuma observação/i);
    expect(r.frase).toMatch(/1\.000,00/);
  });

  it("⚠⚠ divergindo, a frase mostra OS DOIS números e diz quem vence", () => {
    const r = confrontoDaDeclaracao(declarada({ valorProjetado: 1180, base: { n: 3 } }));
    expect(r.tipo).toBe("diverge");
    expect(r.frase).toMatch(/1\.000,00/);
    expect(r.frase).toMatch(/1\.180,00/);
    expect(r.frase).toMatch(/observado vence/i);
    expect(r.frase).toMatch(/3 observações/);
  });

  it("⚠ diferença de centavos NÃO é divergência — aviso em toda linha vira paisagem", () => {
    expect(confrontoDaDeclaracao(declarada({ valorProjetado: 1020, base: { n: 3 } }))).toBeNull();
  });

  it("⚠⚠ série DETECTADA não é confrontada — não há declaração para confrontar", () => {
    expect(confrontoDaDeclaracao(serie({ origem: ORIGEM_DA_SERIE.DETECTADA }))).toBeNull();
    expect(confrontoDaDeclaracao(serie())).toBeNull();
  });

  it("⚠ declarada sem valor declarado não gera confronto", () => {
    expect(confrontoDaDeclaracao(declarada({ valorDeclarado: null }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AS AÇÕES
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ o que a tela oferece", () => {
  it("candidata: confirmar ou recusar", () => {
    expect(acoesDaSerie(serie())).toEqual([ACAO.CONFIRMAR, ACAO.RECUSAR]);
  });

  it("⚠ ATIVA só oferece TIRAR do fluxo — confirmar de novo não faz nada", () => {
    expect(acoesDaSerie(serie({ estado: ESTADO_DA_SERIE.ATIVA }))).toEqual([ACAO.SUSPENDER]);
  });

  it("⚠ RECUSADA e SUSPENSA NÃO são becos — voltam a poder entrar", () => {
    for (const estado of [ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA]) {
      expect(acoesDaSerie(serie({ estado }))).toContain(ACAO.CONFIRMAR);
    }
  });

  it("⚠⚠ estado que a tela não conhece nasce SEM ação nenhuma — mapa de INCLUSÃO", () => {
    expect(acoesDaSerie(serie({ estado: "CONGELADA" }))).toEqual([]);
  });

  it("⚠ cada ação grava um dos TRÊS estados que a rota aceita — a tela não inventa estado", () => {
    expect(Object.values(ESTADO_DA_ACAO).sort())
      .toEqual([ESTADO_DA_SERIE.ATIVA, ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA].sort());
    // ⚠⚠ `PENDENTE` NÃO é escrito pela tela do contador: ela É a palavra dele.
    expect(Object.values(ESTADO_DA_ACAO)).not.toContain(ESTADO_DA_SERIE.PENDENTE);
  });
});

describe("⚠ o pré-voo", () => {
  it("quem não pode escrever não marca nada", () => {
    expect(motivoDeBloqueio(ACAO.CONFIRMAR, serie(), { podeEscrever: false }))
      .toMatch(/não pode marcar/i);
  });

  it("⚠⚠ sem a tabela, o motivo aparece ANTES do clique — o POST voltaria 503", () => {
    expect(motivoDeBloqueio(ACAO.CONFIRMAR, serie(), { indisponivel: true }))
      .toMatch(/migration não foi aplicada/i);
  });

  it("⚠⚠ confirmar SEM valor nenhum é bloqueado — poria uma linha MUDA no fluxo", () => {
    const semValor = serie({ valorProjetado: null, valorDeclarado: null });
    expect(motivoDeBloqueio(ACAO.CONFIRMAR, semValor)).toMatch(/não tem valor/i);
  });

  it("⚠ mas o valor DECLARADO basta — é o caso da taxa anual", () => {
    const soDeclarado = serie({ valorProjetado: null, valorDeclarado: 1200 });
    expect(motivoDeBloqueio(ACAO.CONFIRMAR, soDeclarado)).toBeNull();
  });

  it("⚠ RECUSAR não precisa de valor — recusar é dizer que não é recorrente", () => {
    const semValor = serie({ valorProjetado: null, valorDeclarado: null });
    expect(motivoDeBloqueio(ACAO.RECUSAR, semValor)).toBeNull();
  });

  it("⚠ em regime normal, nada bloqueia", () => {
    expect(motivoDeBloqueio(ACAO.CONFIRMAR, serie())).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O QUE PEDE RESPOSTA — é o número que decide se o painel aparece.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ pedemResposta", () => {
  it("candidata com padrão pede", () => {
    expect(pedemResposta([serie()])).toHaveLength(1);
  });

  it("⚠ candidata SEM padrão não pede — 94 linhas mudas afogariam as 3 que pedem", () => {
    expect(pedemResposta([serie({ leitura: LEITURA.POUCAS_OBSERVACOES })])).toHaveLength(0);
  });

  it("⚠ PENDENTE sempre pede — é o estado de quem espera a palavra do contador", () => {
    expect(pedemResposta([serie({ estado: ESTADO_DA_SERIE.PENDENTE, leitura: LEITURA.POUCAS_OBSERVACOES })]))
      .toHaveLength(1);
  });

  it("⚠ ATIVA que continua NÃO pede nada — ela está funcionando", () => {
    expect(pedemResposta([serie({ estado: ESTADO_DA_SERIE.ATIVA, leitura: LEITURA.CONTINUA })]))
      .toHaveLength(0);
  });

  it("⚠⚠ ATIVA que sumiu ou ficou sem observação VOLTA a pedir", () => {
    for (const leitura of [LEITURA.SUGERE_SAIDA, LEITURA.SEM_OBSERVACAO]) {
      expect(pedemResposta([serie({ estado: ESTADO_DA_SERIE.ATIVA, leitura })])).toHaveLength(1);
    }
  });

  it("⚠⚠ RECUSADA e SUSPENSA NÃO voltam a perguntar — alguém já decidiu", () => {
    // Perguntar de novo todo mês é o oposto de uma decisão.
    for (const estado of [ESTADO_DA_SERIE.RECUSADA, ESTADO_DA_SERIE.SUSPENSA]) {
      expect(pedemResposta([serie({ estado })])).toHaveLength(0);
    }
  });

  it("lista vazia não quebra", () => {
    expect(pedemResposta(null)).toEqual([]);
  });
});

describe("⚠ a ordem: quem espera decisão primeiro", () => {
  it("sugestões antes do que não tem padrão", () => {
    const r = ordenarSeries([
      serie({ rotulo: "SEM PADRAO", leitura: LEITURA.POUCAS_OBSERVACOES }),
      serie({ rotulo: "CONTINUA", leitura: LEITURA.CONTINUA }),
      serie({ rotulo: "SUGERE", leitura: LEITURA.SUGERE_ENTRADA }),
    ]);
    expect(r.map((s) => s.rotulo)).toEqual(["SUGERE", "CONTINUA", "SEM PADRAO"]);
  });

  it("⚠ empate desempata pelo VALOR — a que move mais dinheiro primeiro", () => {
    const r = ordenarSeries([
      serie({ rotulo: "PEQUENA", valorProjetado: 50 }),
      serie({ rotulo: "GRANDE", valorProjetado: 5000 }),
    ]);
    expect(r.map((s) => s.rotulo)).toEqual(["GRANDE", "PEQUENA"]);
  });

  it("⚠ não muta a lista recebida", () => {
    const lista = [serie({ rotulo: "A", leitura: LEITURA.CONTINUA }), serie({ rotulo: "B" })];
    ordenarSeries(lista);
    expect(lista.map((s) => s.rotulo)).toEqual(["A", "B"]);
  });
});

describe("⚠ os rótulos", () => {
  it("o lado diz se o dinheiro entra ou sai", () => {
    expect(rotuloDoLado("RECEITA")).toBe("Entrada");
    expect(rotuloDoLado("DESPESA")).toBe("Saída");
    expect(rotuloDoLado("SEI_LA")).toBe("—");
  });

  it("⚠⚠ periodicidade desconhecida NÃO vira 'todo mês'", () => {
    // Afirmaria um ritmo que ninguém escolheu — e é a coluna que existe por causa da taxa anual.
    expect(rotuloDaPeriodicidade("SEMESTRAL")).toMatch(/desconhecida/i);
    expect(rotuloDaPeriodicidade(null)).toMatch(/desconhecida/i);
    expect(rotuloDaPeriodicidade("ANUAL")).toBe("uma vez por ano");
  });
});
