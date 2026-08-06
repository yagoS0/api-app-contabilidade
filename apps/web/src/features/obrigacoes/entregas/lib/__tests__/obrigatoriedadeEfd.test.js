import {
  obrigatoriedadeEfdContribuicoes,
  ehCompetenciaQueConsolidaOAno,
} from "../obrigatoriedadeEfd";

describe("obrigatoriedadeEfdContribuicoes — quem entrega a EFD-Contribuições", () => {
  // ── A correção que originou a regra ────────────────────────────────────────
  describe("Simples Nacional NUNCA entrega", () => {
    it("optante do Simples é dispensada", () => {
      const r = obrigatoriedadeEfdContribuicoes({ regime: "SIMPLES", competencia: "2026-07" });
      expect(r.situacao).toBe("dispensada");
      expect(r.motivo).toMatch(/Simples Nacional/);
    });

    it("aceita as duas grafias do mesmo regime", () => {
      // O projeto tem `SIMPLES` e `SIMPLES_NACIONAL` no vocabulário, e as duas chegam do backend.
      expect(obrigatoriedadeEfdContribuicoes({ regime: "SIMPLES_NACIONAL" }).situacao).toBe("dispensada");
      expect(obrigatoriedadeEfdContribuicoes({ regime: "simples nacional" }).situacao).toBe("dispensada");
    });

    it("MEI também é dispensado", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "MEI" }).situacao).toBe("dispensada");
    });

    it("⚠ a dispensa diz o que fazer se a empresa SAIU do Simples", () => {
      // A dispensa vale "nos períodos abrangidos pelo regime". Empresa excluída passa a dever a
      // partir da saída — e quem lê "dispensada" sem essa frase não descobre isso sozinho.
      const r = obrigatoriedadeEfdContribuicoes({ regime: "SIMPLES", competencia: "2026-07" });
      expect(r.acao).toMatch(/deixou o Simples/i);
    });
  });

  describe("Lucro Presumido e Lucro Real entregam", () => {
    it("Presumido é obrigada", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO", competencia: "2026-07" }).situacao)
        .toBe("obrigada");
    });

    it("Lucro Real é obrigada", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_REAL", competencia: "2026-07" }).situacao)
        .toBe("obrigada");
    });

    it("arbitrado segue o Presumido", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_ARBITRADO", competencia: "2026-07" }).situacao)
        .toBe("obrigada");
    });
  });

  describe("início da obrigatoriedade — as datas são diferentes por regime", () => {
    it("Lucro Real: 01/2012 é devida, 12/2011 não", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_REAL", competencia: "2012-01" }).situacao).toBe("obrigada");
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_REAL", competencia: "2011-12" }).situacao).toBe("dispensada");
    });

    it("⚠ Presumido só a partir de 01/2013 — um ano DEPOIS do Lucro Real", () => {
      // As duas datas não são a mesma, e usar a do Lucro Real para o Presumido cobraria doze meses
      // de escrituração que nunca foram devidos.
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO", competencia: "2012-06" }).situacao).toBe("dispensada");
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO", competencia: "2013-01" }).situacao).toBe("obrigada");
    });
  });

  describe("⚠ ausência de dado é o TERCEIRO estado, não um empate", () => {
    it("sem regime cadastrado, não afirma nem obrigada nem dispensada", () => {
      const r = obrigatoriedadeEfdContribuicoes({ competencia: "2026-07" });
      expect(r.situacao).toBe("indefinida");
      expect(r.acao).toMatch(/[Cc]adastre o regime/);
    });

    it("regime desconhecido não vira obrigada por descuido", () => {
      // Um default para "obrigada" pediria trabalho inexistente; um para "dispensada" esconderia
      // obrigação real. Nenhum dos dois é aceitável como silêncio.
      const r = obrigatoriedadeEfdContribuicoes({ regime: "IMUNE", competencia: "2026-07" });
      expect(r.situacao).toBe("indefinida");
      expect(r.motivo).toMatch(/IMUNE/);
    });

    it("competência ausente não impede responder pelo regime", () => {
      // O regime já decide o Simples; exigir competência para dizer "dispensada" deixaria a tela
      // muda no caso mais comum da carteira.
      expect(obrigatoriedadeEfdContribuicoes({ regime: "SIMPLES" }).situacao).toBe("dispensada");
      expect(obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO" }).situacao).toBe("obrigada");
    });
  });

  describe("⚠ as dispensas que o sistema NÃO avalia viajam junto da obrigação", () => {
    it("empresa obrigada recebe as dispensas nomeadas", () => {
      const r = obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO", competencia: "2026-07" });
      const chaves = r.dispensasNaoAvaliadas.map((d) => d.chave);
      expect(chaves).toEqual(expect.arrayContaining(["imuneIsenta", "semReceita", "inativaOuOrgaoPublico"]));
    });

    it("a dispensa por mês sem receita CARREGA a exceção de dezembro", () => {
      // Sem essa frase, marcar meses como dispensados produziria um ano sem a consolidação do 0120.
      const r = obrigatoriedadeEfdContribuicoes({ regime: "LUCRO_PRESUMIDO", competencia: "2026-07" });
      const semReceita = r.dispensasNaoAvaliadas.find((d) => d.chave === "semReceita");
      expect(semReceita.detalhe).toMatch(/dezembro/i);
      expect(semReceita.detalhe).toMatch(/0120/);
    });

    it("empresa dispensada não recebe a lista — não há obrigação a ressalvar", () => {
      expect(obrigatoriedadeEfdContribuicoes({ regime: "SIMPLES" }).dispensasNaoAvaliadas).toEqual([]);
    });
  });

  it("toda resposta aponta a fonte", () => {
    for (const regime of ["SIMPLES", "LUCRO_PRESUMIDO", "", "IMUNE"]) {
      expect(obrigatoriedadeEfdContribuicoes({ regime }).fonte).toMatch(/IN RFB 1\.252\/2012/);
    }
  });
});

describe("ehCompetenciaQueConsolidaOAno", () => {
  it("dezembro consolida", () => {
    expect(ehCompetenciaQueConsolidaOAno("2026-12")).toBe(true);
  });

  it("os outros onze meses não", () => {
    expect(ehCompetenciaQueConsolidaOAno("2026-11")).toBe(false);
    expect(ehCompetenciaQueConsolidaOAno("2026-01")).toBe(false);
  });

  it("lixo não vira dezembro", () => {
    expect(ehCompetenciaQueConsolidaOAno("")).toBe(false);
    expect(ehCompetenciaQueConsolidaOAno(null)).toBe(false);
    expect(ehCompetenciaQueConsolidaOAno("2026-12-31")).toBe(false);
  });
});
