import { obrigatoriedadeDefis, DEFIS_OBRIGATORIEDADE_FONTE } from "../obrigatoriedadeDefis";

describe("obrigatoriedadeDefis — quem entrega a DEFIS", () => {
  // ── A correção que originou a regra ────────────────────────────────────────
  describe("⚠ Lucro Presumido NÃO entrega — foi o defeito relatado pelo dono", () => {
    it("Presumido é dispensada", () => {
      const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: 2025 });
      expect(r.situacao).toBe("dispensada");
      expect(r.motivo).toMatch(/Lucro Presumido/);
    });

    it("Lucro Real também é dispensada", () => {
      expect(obrigatoriedadeDefis({ regime: "LUCRO_REAL", anoCalendario: 2025 }).situacao).toBe("dispensada");
    });

    it("arbitrado segue o mesmo caminho", () => {
      expect(obrigatoriedadeDefis({ regime: "LUCRO_ARBITRADO", anoCalendario: 2025 }).situacao).toBe("dispensada");
    });

    it("⚠ o motivo diz POR QUE, não só que não é devida", () => {
      // "Não devida" sem o porquê faz o contador desconfiar da tela em vez de confiar na lei.
      const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: 2025 });
      expect(r.motivo).toMatch(/Simples Nacional/);
      expect(r.motivo).toMatch(/não é devida|não entrega/i);
    });
  });

  describe("Simples Nacional entrega", () => {
    it("optante do Simples é obrigada", () => {
      expect(obrigatoriedadeDefis({ regime: "SIMPLES", anoCalendario: 2025 }).situacao).toBe("obrigada");
    });

    it("aceita as duas grafias do mesmo regime", () => {
      // O projeto tem `SIMPLES` e `SIMPLES_NACIONAL` no vocabulário, e as duas chegam do backend.
      expect(obrigatoriedadeDefis({ regime: "SIMPLES_NACIONAL" }).situacao).toBe("obrigada");
      expect(obrigatoriedadeDefis({ regime: "simples nacional" }).situacao).toBe("obrigada");
    });

    it("empresa obrigada não recebe motivo nem ação — não há nada a explicar", () => {
      const r = obrigatoriedadeDefis({ regime: "SIMPLES", anoCalendario: 2025 });
      expect(r.motivo).toBeNull();
      expect(r.acao).toBeNull();
    });
  });

  describe("⚠ o Simei é dispensado por motivo PRÓPRIO, não por ser 'mais um não-Simples'", () => {
    it("MEI é dispensada", () => {
      const r = obrigatoriedadeDefis({ regime: "MEI", anoCalendario: 2025 });
      expect(r.situacao).toBe("dispensada");
      expect(r.motivo).toMatch(/Simei/);
    });

    it("SIMEI, a outra grafia, cai no mesmo lugar", () => {
      expect(obrigatoriedadeDefis({ regime: "SIMEI" }).situacao).toBe("dispensada");
    });

    it("⚠ NÃO nomeia declaração substituta — o manual consultado não a traz", () => {
      // Regra 1/4 do projeto: o que não se confirma em fonte oficial não se escreve. Citar uma
      // declaração anual do Simei sem tê-la lido seria mandar o contador a um lugar não verificado.
      const r = obrigatoriedadeDefis({ regime: "MEI" });
      expect(`${r.motivo} ${r.acao}`).not.toMatch(/DASN/i);
    });
  });

  describe("⚠ ausência de dado é o TERCEIRO estado, não um empate", () => {
    it("sem regime cadastrado, não afirma nem obrigada nem dispensada", () => {
      const r = obrigatoriedadeDefis({ anoCalendario: 2025 });
      expect(r.situacao).toBe("indefinida");
      expect(r.acao).toMatch(/[Cc]adastre o regime/);
    });

    it("regime desconhecido não vira dispensada por descuido", () => {
      // Um default para "dispensada" esconderia obrigação real de uma empresa do Simples; um para
      // "obrigada" pediria ~40 campos de trabalho que a lei não pede. Nenhum dos dois é silêncio
      // aceitável.
      const r = obrigatoriedadeDefis({ regime: "IMUNE", anoCalendario: 2025 });
      expect(r.situacao).toBe("indefinida");
      expect(r.motivo).toMatch(/IMUNE/);
    });

    it("string vazia e espaços em branco contam como ausência, não como regime", () => {
      expect(obrigatoriedadeDefis({ regime: "   " }).situacao).toBe("indefinida");
      expect(obrigatoriedadeDefis({ regime: null }).situacao).toBe("indefinida");
      expect(obrigatoriedadeDefis().situacao).toBe("indefinida");
    });

    it("ano ausente não impede responder pelo regime", () => {
      // O regime já decide; exigir o ano deixaria a tela muda no caso mais comum da carteira.
      expect(obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO" }).situacao).toBe("dispensada");
      expect(obrigatoriedadeDefis({ regime: "SIMPLES" }).situacao).toBe("obrigada");
    });
  });

  describe("⚠ a resposta é sobre o ANO-CALENDÁRIO, não sobre 'hoje'", () => {
    it("a dispensa diz o que fazer se a empresa ERA do Simples naquele ano", () => {
      // O manual (item 9.2.2): no ano-calendário da exclusão, a DEFIS abrange o período em que a
      // empresa esteve na condição de optante. Quem lê "dispensada" sem essa frase não descobre
      // isso sozinho — e deixaria de entregar a DEFIS do ano em que a empresa saiu do Simples.
      const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: 2025 });
      expect(r.acao).toMatch(/optante pelo Simples Nacional em algum período/i);
      expect(r.acao).toMatch(/2025/);
    });

    it("o ano aparece no texto quando é plausível", () => {
      expect(obrigatoriedadeDefis({ anoCalendario: 2024 }).acao).toMatch(/DEFIS de 2024/);
    });

    it("⚠ ano-lixo não vira texto — nunca 'a DEFIS de undefined'", () => {
      for (const lixo of [undefined, null, "", "abc", 0, 1500, 99999, "2025-01"]) {
        const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: lixo });
        expect(`${r.motivo} ${r.acao}`).not.toMatch(/undefined|NaN|null/);
      }
    });
  });

  describe("⚠ as hipóteses que DERRUBARIAM a dispensa viajam junto dela", () => {
    it("empresa dispensada recebe as hipóteses nomeadas", () => {
      const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: 2025 });
      const chaves = r.obrigatoriedadesNaoAvaliadas.map((o) => o.chave);
      expect(chaves).toEqual(expect.arrayContaining(["optanteNoAno", "processoAdministrativo"]));
    });

    it("a hipótese do ano CARREGA a regra do ano de exclusão", () => {
      // Sem essa frase, a dispensa apagaria em silêncio a DEFIS do ano da saída do Simples.
      const r = obrigatoriedadeDefis({ regime: "LUCRO_PRESUMIDO", anoCalendario: 2025 });
      const noAno = r.obrigatoriedadesNaoAvaliadas.find((o) => o.chave === "optanteNoAno");
      expect(noAno.detalhe).toMatch(/exclusão/i);
      expect(noAno.detalhe).toMatch(/histórico/i);
    });

    it("a hipótese do processo administrativo está na lista — é a outra porta do manual", () => {
      const r = obrigatoriedadeDefis({ regime: "MEI" });
      const proc = r.obrigatoriedadesNaoAvaliadas.find((o) => o.chave === "processoAdministrativo");
      expect(proc.detalhe).toMatch(/Simples Nacional/);
    });

    it("empresa obrigada não recebe a lista — não há dispensa a derrubar", () => {
      expect(obrigatoriedadeDefis({ regime: "SIMPLES" }).obrigatoriedadesNaoAvaliadas).toEqual([]);
    });

    it("indefinida não recebe a lista — não se ressalva uma dispensa que não foi afirmada", () => {
      expect(obrigatoriedadeDefis({ regime: "" }).obrigatoriedadesNaoAvaliadas).toEqual([]);
      expect(obrigatoriedadeDefis({ regime: "IMUNE" }).obrigatoriedadesNaoAvaliadas).toEqual([]);
    });
  });

  describe("⚠ a norma citada é a CONFIRMADA em fonte oficial", () => {
    it("toda resposta aponta a fonte", () => {
      for (const regime of ["SIMPLES", "LUCRO_PRESUMIDO", "MEI", "", "IMUNE"]) {
        expect(obrigatoriedadeDefis({ regime }).fonte).toBe(DEFIS_OBRIGATORIEDADE_FONTE);
      }
    });

    it("a fonte traz os três dispositivos lidos no manual da RFB", () => {
      // Manual do PGDAS-D e DEFIS, seção 9 (quem entrega, citando a LC 123/2006, art. 25, caput) e
      // item 9.1.2 (prazo, citando a Res. CGSN 140/2018, art. 72, §§ 1º e 2º). Conferido no
      // documento oficial — não copiado de terceiros.
      expect(DEFIS_OBRIGATORIEDADE_FONTE).toMatch(/Manual do PGDAS-D e DEFIS/);
      expect(DEFIS_OBRIGATORIEDADE_FONTE).toMatch(/LC 123\/2006, art\. 25/);
      expect(DEFIS_OBRIGATORIEDADE_FONTE).toMatch(/Res\. CGSN 140\/2018, art\. 72/);
    });
  });
});
