// A PRÉ-VERIFICAÇÃO NA TELA — a tradução do que a rota devolve.
//
// ⚠ A REGRA (qual par viola) é do backend e tem teste lá. O que se prende aqui é a APRESENTAÇÃO:
// que âmbar não vire vermelho, que "a conferir" não pese como erro, que regra desconhecida não
// suma, e que ausência de achado não vire um painel dizendo "tudo certo".

import {
  TITULO_DA_REGRA,
  gruposDaVerificacao,
  naoAvaliados,
  resumoDaVerificacao,
  tituloDaRegra,
  tomDoGrupo,
} from "../verificacaoNaTela";

describe("tituloDaRegra", () => {
  it("traduz as regras do catálogo", () => {
    expect(tituloDaRegra("F3.01")).toBe("IRPJ/CSLL fora da despesa tributária");
    expect(tituloDaRegra("F9.01")).toBe("Provisão creditando conta que não é obrigação");
  });

  it("⚠ regra que a tela NÃO conhece aparece com o próprio id — nunca some", () => {
    // Um achado sem tradução ainda é um achado; sumir com ele faria a contagem do resumo
    // discordar da lista logo abaixo.
    expect(tituloDaRegra("F7.02")).toBe("F7.02");
    expect(tituloDaRegra(null)).toBe("achado");
  });

  it("o catálogo cobre as dez regras do motor", () => {
    expect(Object.keys(TITULO_DA_REGRA).sort()).toEqual([
      "F2.01", "F2.02", "F3.01", "F3.02", "F4.01", "F4.02", "F5.01", "F9.01", "F9.02", "F9.03",
    ]);
  });
});

describe("⚠⚠ tomDoGrupo — âmbar, nunca vermelho", () => {
  it("ALERTA é atenção", () => {
    expect(tomDoGrupo("ALERTA")).toBe("atencao");
  });

  it("⚠ SUGESTAO é NEUTRO — mover dívida entre passivos é ato legítimo", () => {
    // Acusá-lo com o mesmo peso do erro treinaria o contador a ignorar a lista.
    expect(tomDoGrupo("SUGESTAO")).toBe("neutro");
  });

  it("severidade desconhecida cai em atenção, não em neutro — falha fechado", () => {
    expect(tomDoGrupo("ALGO_NOVO")).toBe("atencao");
    expect(tomDoGrupo(null)).toBe("atencao");
  });
});

describe("resumoDaVerificacao", () => {
  it("conta os que precisam de correção e os que precisam de conferência, separados", () => {
    expect(resumoDaVerificacao({ viola: 6, conferir: 1 }))
      .toBe("6 lançamentos a corrigir · 1 a conferir");
  });

  it("singular e plural", () => {
    expect(resumoDaVerificacao({ viola: 1, conferir: 0 })).toBe("1 lançamento a corrigir");
  });

  it("só a conferir", () => {
    expect(resumoDaVerificacao({ viola: 0, conferir: 3 })).toBe("3 a conferir");
  });

  it("⚠⚠ sem achado devolve NULL — e null quer dizer 'não desenhe o painel'", () => {
    // Nunca um painel dizendo "tudo certo": a verificação não julga o que não sabe julgar (36 de
    // 200 em produção), e afirmar "tudo certo" por cima disso seria mentira por omissão.
    expect(resumoDaVerificacao({ viola: 0, conferir: 0, indeterminado: 36 })).toBeNull();
    expect(resumoDaVerificacao(null)).toBeNull();
    expect(resumoDaVerificacao({})).toBeNull();
  });
});

describe("⚠ naoAvaliados — o que a verificação não alcançou aparece", () => {
  it("devolve o número quando há", () => {
    expect(naoAvaliados({ indeterminado: 36 })).toBe(36);
  });

  it("zero devolve null — não se anuncia ausência de ausência", () => {
    expect(naoAvaliados({ indeterminado: 0 })).toBeNull();
    expect(naoAvaliados(null)).toBeNull();
  });
});

describe("gruposDaVerificacao", () => {
  const porRegra = [
    { regraId: "F3.01", severidade: "ALERTA", n: 3, exemplos: ["a", "b"], lancamentos: ["e1", "e2", "e3"] },
    { regraId: "F9.03", severidade: "SUGESTAO", n: 1, exemplos: ["c"], lancamentos: ["e5"] },
  ];

  it("traduz título e tom, preservando contagem e exemplos", () => {
    const g = gruposDaVerificacao(porRegra);
    expect(g[0]).toMatchObject({ regraId: "F3.01", tom: "atencao", n: 3 });
    expect(g[0].titulo).toBe("IRPJ/CSLL fora da despesa tributária");
    expect(g[1].tom).toBe("neutro");
  });

  it("⚠ a ORDEM vem do servidor e não é refeita — senão o diagnóstico e a tela listariam diferente", () => {
    expect(gruposDaVerificacao(porRegra).map((g) => g.regraId)).toEqual(["F3.01", "F9.03"]);
  });

  it("entrada torta não explode", () => {
    expect(gruposDaVerificacao(null)).toEqual([]);
    expect(gruposDaVerificacao([{ regraId: "X" }])[0]).toMatchObject({ n: 0, exemplos: [], lancamentos: [] });
  });
});
