// A TELA DA AUDITORIA — e a distinção que ela existe para não apagar.
//
// O que está travado aqui: "zero achados" e "não dá para conferir" têm desenhos DIFERENTES, e
// nenhuma frase de tela é um veredito.

import {
  leituraDaPergunta,
  leituraDoCabecalho,
  frasesDoAchado,
  ordenarPerguntas,
  FRASE_NAO_CONFERIVEL,
  FRASE_ESPECIE,
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
    for (const frase of [...Object.values(FRASE_NAO_CONFERIVEL), ...Object.values(FRASE_ESPECIE)]) {
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

  test("⚠ emissão fora da competência traz o DESVIO — é ele que separa virada de mês de 5 meses", () => {
    const um = frasesDoAchado(
      { dados: { mesDaCompetencia: "2026-07", mesDaEmissao: "2026-08", mesesDeDesvio: -1 } },
      { id: "EMISSAO_FORA_DA_COMPETENCIA", achado: "contada em competência diferente" },
    );
    expect(um.texto).toContain("1 mês de diferença");
    const cinco = frasesDoAchado(
      { dados: { mesDaCompetencia: "2026-03", mesDaEmissao: "2026-08", mesesDeDesvio: -5 } },
      { id: "EMISSAO_FORA_DA_COMPETENCIA", achado: "contada em competência diferente" },
    );
    expect(cinco.texto).toContain("5 meses de diferença");
  });

  test("faixa de números pulados sai como UMA linha, com os vizinhos", () => {
    const f = frasesDoAchado(
      { dados: { especie: "NUMERO_PULADO", serie: "00001", de: 11, ate: 13, quantidade: 3, antes: 10, depois: 14 } },
      { id: "NUMERACAO_DA_DPS" },
    );
    expect(f.titulo).toBe("Série 00001 · nº 11 a 13");
    expect(f.texto).toContain("entre a 10 e a 14");
  });

  test("um número só não vira faixa", () => {
    const f = frasesDoAchado(
      { dados: { especie: "NUMERO_PULADO", serie: "00900", de: 2, ate: 2, quantidade: 1, antes: 1, depois: 3 } },
      { id: "NUMERACAO_DA_DPS" },
    );
    expect(f.titulo).toBe("Série 00900 · nº 2");
  });

  test("⚠ NUNCA_EXTRAIDA diz que o extrator não passou — não que o XML não tem o campo", () => {
    const f = frasesDoAchado(
      { numero: "14625", dados: { especie: "NUNCA_EXTRAIDA", motivo: null } },
      { id: "NOTA_NAO_LIDA", achado: "os campos fiscais desta nota não foram extraídos do XML" },
    );
    expect(f.texto).toContain("nunca foram extraídos");
  });

  test("leitura falhada traduz o motivo técnico", () => {
    const f = frasesDoAchado(
      { numero: "9", dados: { especie: "LEITURA_FALHOU", motivo: "NAO_E_NFSE" } },
      { id: "NOTA_NAO_LIDA", achado: "os campos fiscais desta nota não foram extraídos do XML" },
    );
    expect(f.texto).toContain("não é o da NFS-e");
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
