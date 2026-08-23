// A TELA DA AUDITORIA — e a distinção que ela existe para não apagar.
//
// O que está travado aqui: "zero achados" e "não dá para conferir" têm desenhos DIFERENTES, e
// nenhuma frase de tela é um veredito.

import {
  leituraDaPergunta,
  leituraDoCabecalho,
  leituraDoForaDaConferencia,
  frasesDoAchado,
  fraseDaViradaDeMes,
  ordenarPerguntas,
  FRASE_NAO_CONFERIVEL,
  FRASE_ESPECIE,
  FRASE_FORA_DA_CONFERENCIA,
  FRASE_MOTIVO_PENDENCIA,
  TOKEN,
} from "../auditoriaTela";

const conferidaSemAchado = (over = {}) => ({
  id: "ISS_ZERADO_ONDE_TRIBUTA", titulo: "ISS zerado", achado: "algo a conferir",
  situacao: "CONFERIDA", motivo: null, avaliadas: 7, achados: [], naoAvaliadas: [], ...over,
});
const naoConferivel = (motivo, over = {}) => ({
  id: "ATIVIDADE_FORA_DO_CADASTRO", titulo: "Atividade fora do cadastro", achado: "algo a conferir",
  situacao: "NAO_CONFERIVEL", motivo, avaliadas: 0, achados: [], naoAvaliadas: [], ...over,
});

describe("⚠ zero achados ≠ não dá para conferir", () => {
  test("conferida sem achado é OK e diz quantas notas foram olhadas", () => {
    const l = leituraDaPergunta(conferidaSemAchado());
    expect(l.estado).toBe("SEM_ACHADO");
    expect(l.token).toBe(TOKEN.OK);
    expect(l.resumo).toContain("7 nota(s) conferida(s)");
  });

  test("não conferível é NEUTRO e diz O QUE FAZER, nunca 'nada a apontar'", () => {
    const l = leituraDaPergunta(naoConferivel("EMPRESA_SEM_CODIGOS_CADASTRADOS"));
    expect(l.estado).toBe("NAO_CONFERIVEL");
    expect(l.token).toBe(TOKEN.NEUTRO);
    expect(l.resumo).toBe(FRASE_NAO_CONFERIVEL.EMPRESA_SEM_CODIGOS_CADASTRADOS);
    expect(l.resumo).toMatch(/Cadastre os códigos/);
    expect(l.resumo).not.toMatch(/nada a apontar/i);
  });

  test("as duas têm token DIFERENTE — é o que impede a tela de confundi-las", () => {
    expect(leituraDaPergunta(conferidaSemAchado()).token)
      .not.toBe(leituraDaPergunta(naoConferivel("SEM_NOTAS")).token);
  });

  test("motivo desconhecido não vira 'tudo certo' — sai o código cru", () => {
    const l = leituraDaPergunta(naoConferivel("MOTIVO_QUE_AINDA_NAO_EXISTE"));
    expect(l.token).toBe(TOKEN.NEUTRO);
    expect(l.resumo).toContain("MOTIVO_QUE_AINDA_NAO_EXISTE");
  });
});

describe("⚠ achado é PERGUNTA, não veredito — e nunca é vermelho", () => {
  test("a pergunta com achado usa --state-warn, jamais --state-danger", () => {
    const l = leituraDaPergunta(conferidaSemAchado({ achados: [{ dados: {} }], avaliadas: 3 }));
    expect(l.token).toBe(TOKEN.ATENCAO);
    expect(l.token).not.toBe("--state-danger");
  });

  test("o resumo fala em 'conferir', nunca em erro", () => {
    const l = leituraDaPergunta(conferidaSemAchado({ achados: [{ dados: {} }, { dados: {} }] }));
    expect(l.resumo).toContain("pontos a conferir");
    expect(l.resumo).not.toMatch(/erro|errad|inválid|irregular/i);
  });

  test("nenhuma frase do vocabulário de tela é conclusiva", () => {
    const proibidas = /\berrad|\binválid|\birregular|\bincorret|\bilegal/i;
    for (const frase of [
      ...Object.values(FRASE_NAO_CONFERIVEL),
      ...Object.values(FRASE_ESPECIE),
      ...Object.values(FRASE_FORA_DA_CONFERENCIA),
      ...Object.values(FRASE_MOTIVO_PENDENCIA),
    ]) {
      expect(frase).not.toMatch(proibidas);
    }
  });

  test("singular e plural", () => {
    expect(leituraDaPergunta(conferidaSemAchado({ achados: [{ dados: {} }] })).resumo).toContain("1 ponto a conferir");
  });
});

describe("as frases de cada achado", () => {
  test("atividade fora do cadastro mostra o código, a descrição e o que está cadastrado", () => {
    const f = frasesDoAchado(
      { numero: "10", dados: { cTribNac: "070201", descricaoNaNota: "Obras", cadastrados: ["310104"] } },
      { id: "ATIVIDADE_FORA_DO_CADASTRO", achado: "esta nota usa um código de serviço que não está no cadastro da empresa" },
    );
    expect(f.titulo).toContain("070201");
    expect(f.titulo).toContain("Obras");
    expect(f.texto).toContain("310104");
  });

  test("⚠ emissão fora da competência traz o DESVIO — é ele que diz o tamanho do problema", () => {
    const cinco = frasesDoAchado(
      { dados: { mesDaCompetencia: "2026-03", mesDaEmissao: "2026-08", mesesDeDesvio: -5 } },
      { id: "EMISSAO_FORA_DA_COMPETENCIA", achado: "contada em competência diferente" },
    );
    expect(cinco.texto).toContain("5 meses de diferença");
  });

  // ⚠⚠ O CADEADO DO CORTE DE 21/08/2026 no lado da tela. As frases da numeração da DPS não voltam
  // sem norma: a E0014 (ANEXO_I, aba `RN DPS_NFS-e`, linha 148) define unicidade por QUATRO
  // componentes, e não existe regra de numeração CONTÍNUA da DPS nas 653 regras do ANEXO_I.
  test("⚠ o vocabulário de tela NÃO tem mais espécie de numeração da DPS", () => {
    expect(FRASE_ESPECIE.NUMERO_PULADO).toBeUndefined();
    expect(FRASE_ESPECIE.NUMERO_REPETIDO).toBeUndefined();
  });

  test("⚠ nem espécie de leitura — 'nota não lida' saiu da tela do contador (é manutenção)", () => {
    expect(FRASE_ESPECIE.LEITURA_FALHOU).toBeUndefined();
    expect(FRASE_ESPECIE.NUNCA_EXTRAIDA).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ a virada de mês vira CONTAGEM — e a contagem tem de aparecer", () => {
  // Medido: 1.727 das 1.738 divergências eram de um mês. Elas deixaram de ser linha; se também
  // deixassem de ser NÚMERO, a pergunta passaria a esconder o que conferiu.
  test("com viradaDeMes > 0 a frase existe e explica por que elas não estão listadas", () => {
    const f = fraseDaViradaDeMes({ viradaDeMes: 1727 });
    expect(f).toContain("1727 nota(s)");
    expect(f).toContain("virada normal de mês");
    expect(f).toContain("dois meses");
  });

  test("sem virada de mês não se escreve '0 notas'", () => {
    expect(fraseDaViradaDeMes({ viradaDeMes: 0 })).toBeNull();
    expect(fraseDaViradaDeMes({})).toBeNull();
    expect(fraseDaViradaDeMes(null)).toBeNull();
  });

  test("a frase não é veredito", () => {
    expect(fraseDaViradaDeMes({ viradaDeMes: 3 })).not.toMatch(/errad|inválid|irregular/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠ as notas fora de QUALQUER conferência mensal", () => {
  // Até 21/08/2026 elas não apareciam em lugar nenhum: a consulta filtrava por competência e `NULL`
  // não satisfaz intervalo. A aba prometia "nada some em silêncio" enquanto sumia com elas.
  test("com órfãs, a linha existe, é ÂMBAR e diz o motivo", () => {
    const l = leituraDoForaDaConferencia({ motivo: "SEM_COMPETENCIA_GRAVADA", total: 4 });
    expect(l.token).toBe(TOKEN.ATENCAO);
    expect(l.token).not.toBe("--state-danger"); // vermelho trava fechamento; isto não trava nada
    expect(l.resumo).toContain("4 nota(s)");
    expect(l.resumo).toContain("não têm competência gravada");
    // ⚠ A consequência (não entram em apuração) é o que faz o contador agir.
    expect(l.resumo).toContain("apuração");
  });

  test("sem órfã nenhuma, não se escreve nada", () => {
    expect(leituraDoForaDaConferencia({ total: 0 })).toBeNull();
    expect(leituraDoForaDaConferencia(null)).toBeNull();
  });

  test("motivo desconhecido não vira 'está tudo certo' — sai o código cru", () => {
    const l = leituraDoForaDaConferencia({ motivo: "MOTIVO_NOVO", total: 2 });
    expect(l.resumo).toContain("MOTIVO_NOVO");
  });
});

describe("o cabeçalho distingue os TRÊS casos", () => {
  const p = (situacao, achados = []) => ({ situacao, achados, avaliadas: 1, naoAvaliadas: [] });

  test("tudo conferido e nada a apontar: OK", () => {
    const c = leituraDoCabecalho({ totalAchados: 0, totalNotas: 12, perguntas: [p("CONFERIDA"), p("CONFERIDA")] });
    expect(c.token).toBe(TOKEN.OK);
    expect(c.titulo).toBe("Nada a apontar");
    expect(c.texto).toContain("12 nota(s)");
  });

  test("⚠ zero achados COM pergunta não conferível NÃO diz 'nada a apontar'", () => {
    const c = leituraDoCabecalho({ totalAchados: 0, totalNotas: 12, perguntas: [p("CONFERIDA"), p("NAO_CONFERIVEL")] });
    expect(c.token).toBe(TOKEN.NEUTRO);
    expect(c.titulo).toBe("Conferido em parte");
    expect(c.titulo).not.toBe("Nada a apontar");
  });

  test("nenhuma pergunta respondida: diz isso, e não 'tudo certo'", () => {
    const c = leituraDoCabecalho({ totalAchados: 0, perguntas: [p("NAO_CONFERIVEL"), p("NAO_CONFERIVEL")] });
    expect(c.titulo).toBe("Não foi possível conferir");
  });

  test("com achado: atenção, e o cabeçalho ainda conta quantas não deram", () => {
    const c = leituraDoCabecalho({ totalAchados: 3, perguntas: [p("CONFERIDA", [1, 2, 3]), p("NAO_CONFERIVEL")] });
    expect(c.token).toBe(TOKEN.ATENCAO);
    expect(c.titulo).toBe("3 pontos a conferir");
    expect(c.texto).toContain("1 sem como conferir");
  });

  test("payload ausente não afirma nada", () => {
    expect(leituraDoCabecalho(null).titulo).toBe("Auditoria não carregada");
    expect(leituraDoCabecalho({}).token).toBe(TOKEN.NEUTRO);
  });
});

describe("a ordem de leitura", () => {
  test("achado primeiro, conferido depois, não conferível por último", () => {
    const lista = [
      naoConferivel("SEM_NOTAS", { id: "A" }),
      conferidaSemAchado({ id: "B" }),
      conferidaSemAchado({ id: "C", achados: [{ dados: {} }] }),
    ];
    expect(ordenarPerguntas(lista).map((p) => p.id)).toEqual(["C", "B", "A"]);
  });

  test("não muta a lista recebida", () => {
    const lista = [conferidaSemAchado({ id: "B" }), conferidaSemAchado({ id: "C", achados: [{ dados: {} }] })];
    ordenarPerguntas(lista);
    expect(lista.map((p) => p.id)).toEqual(["B", "C"]);
  });
});
