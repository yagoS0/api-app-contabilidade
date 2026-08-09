import { ehGuiaDeParcelamento, rotuloParcelamento, rotuloTipoGuia, tituloTipoGuia } from "../rotuloGuia";

describe("ehGuiaDeParcelamento", () => {
  it("decide pelo vínculo, nunca pelo tipo", () => {
    expect(ehGuiaDeParcelamento({ tipo: "SIMPLES", parcelamentoId: "p1" })).toBe(true);
    expect(ehGuiaDeParcelamento({ tipo: "SIMPLES", parcelamentoId: null })).toBe(false);
    // Parcela de INSS parcelado também é parcelamento.
    expect(ehGuiaDeParcelamento({ tipo: "INSS", parcelamentoId: "p2" })).toBe(true);
  });
});

describe("rotuloParcelamento", () => {
  it("traz modalidade, número do parcelamento e parcela atual/total", () => {
    expect(rotuloParcelamento({
      tipo: "SIMPLES",
      parcelamentoId: "p1",
      parcelamentoTipo: "PARCSN",
      parcelamentoNumero: "1",
      numeroParcela: 3,
      quantidadeParcelas: 10,
    })).toBe("PARC SN Nº 1 · 3/10");
  });

  // ── A LIGAÇÃO COM O DE-PARA (a regra em si tem teste próprio em `lib/vocabulario`) ──
  it("as 4 modalidades do Simples chegam à coluna como PARC SN", () => {
    for (const m of ["PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN"]) {
      expect(rotuloParcelamento({ parcelamentoId: "p1", parcelamentoTipo: m })).toBe("PARC SN");
    }
  });

  it("as 4 do MEI chegam como PARC MEI — a família não se mistura na tela", () => {
    for (const m of ["PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI"]) {
      expect(rotuloParcelamento({ parcelamentoId: "p1", parcelamentoTipo: m })).toBe("PARC MEI");
    }
  });

  it("⚠ a parcela de INSS parcelado NÃO vira PARC SN", () => {
    const rotulo = rotuloParcelamento({ tipo: "INSS", parcelamentoId: "p1", parcelamentoTipo: "INSS" });
    expect(rotulo).toBe("INSS");
    expect(rotulo).not.toMatch(/PARC SN/);
  });

  it("⚠ modalidade desconhecida sai CRUA com o sinal de revisão — nunca colapsada", () => {
    const rotulo = rotuloParcelamento({
      parcelamentoId: "p1",
      parcelamentoTipo: "TRANSACAO_PGFN",
      numeroParcela: 1,
      quantidadeParcelas: 12,
    });
    expect(rotulo).toBe("TRANSACAO_PGFN ⚠ · 1/12");
    expect(rotulo).not.toMatch(/PARC SN/);
  });

  it("⚠ NUNCA cai no tipo da guia quando a modalidade é nula — era assim que saía 'SIMPLES'", () => {
    const rotulo = rotuloParcelamento({
      tipo: "SIMPLES",
      parcelamentoId: "p1",
      parcelamentoTipo: null,
      parcelamentoNumero: null,
      numeroParcela: 4,
      quantidadeParcelas: 10,
    });
    expect(rotulo).toBe("Parcelamento · 4/10");
    expect(rotulo).not.toMatch(/SIMPLES/);
  });

  it("omite o número do parcelamento quando ele não veio", () => {
    expect(rotuloParcelamento({
      parcelamentoId: "p1",
      parcelamentoTipo: "PERT_SN",
      numeroParcela: 2,
      quantidadeParcelas: 24,
    })).toBe("PARC SN · 2/24");
  });

  it("sem o total, não inventa denominador", () => {
    const rotulo = rotuloParcelamento({
      parcelamentoId: "p1",
      parcelamentoTipo: "PARCSN",
      parcelamentoNumero: "9",
      numeroParcela: 3,
      quantidadeParcelas: null,
    });
    expect(rotulo).toBe("PARC SN Nº 9 · parcela 3");
    expect(rotulo).not.toContain("/");
  });

  it("sem número de parcela, sobra só a identificação do acordo", () => {
    expect(rotuloParcelamento({
      parcelamentoId: "p1",
      parcelamentoTipo: "PARCSN",
      parcelamentoNumero: "1234567",
    })).toBe("PARC SN Nº 1234567");
  });
});

describe("rotuloTipoGuia", () => {
  it("o parcelamento é decidido ANTES do tipo", () => {
    expect(rotuloTipoGuia({
      tipo: "SIMPLES",
      parcelamentoId: "p1",
      parcelamentoTipo: "PARCSN",
      parcelamentoNumero: "1",
      numeroParcela: 3,
      quantidadeParcelas: 10,
    })).toBe("PARC SN Nº 1 · 3/10");
  });

  it("guia normal do Simples continua sendo SIMPLES", () => {
    expect(rotuloTipoGuia({ tipo: "SIMPLES", parcelamentoId: null })).toBe("SIMPLES");
  });

  it("a DARF consolidada do LP mostra os tributos contidos, não 'OUTRA'", () => {
    expect(rotuloTipoGuia({
      tipo: "OUTRA",
      extracted: { composicao: [{ tributo: "PIS" }, { tributo: "COFINS" }, { tributo: "PIS" }] },
    })).toBe("PIS · COFINS");
  });

  it("'OUTRA' sem composição não vira outra coisa", () => {
    expect(rotuloTipoGuia({ tipo: "OUTRA" })).toBe("OUTRA");
  });

  it("guia sem tipo não vira string vazia", () => {
    expect(rotuloTipoGuia({})).toBe("-");
  });
});

describe("tituloTipoGuia", () => {
  it("mostra o label do parcelamento, que não cabe na coluna", () => {
    expect(tituloTipoGuia({
      parcelamentoId: "p1",
      parcelamentoLabel: "RE-PARCELAMENTO SIMPLES NACIONAL DE SET/OUT/2024",
    })).toBe("RE-PARCELAMENTO SIMPLES NACIONAL DE SET/OUT/2024");
  });

  it("sem label, não inventa tooltip", () => {
    expect(tituloTipoGuia({ parcelamentoId: "p1" })).toBeUndefined();
    expect(tituloTipoGuia({ tipo: "SIMPLES" })).toBeUndefined();
  });

  // ⚠ O COLAPSO É NÃO DESTRUTIVO ATÉ A TELA. A coluna diz "PARC SN"; o título diz de qual das
  // quatro modalidades veio. Sem isto, "veio como RELP_SN" só se responderia abrindo o banco.
  it("⚠ depois do colapso, a modalidade CRUA continua na tela", () => {
    const titulo = tituloTipoGuia({
      parcelamentoId: "p1",
      parcelamentoTipo: "RELP_SN",
      parcelamentoLabel: "RE-PARCELAMENTO SIMPLES NACIONAL",
    });
    expect(titulo).toContain("RELP_SN");
    expect(titulo).toContain("RE-PARCELAMENTO SIMPLES NACIONAL");
  });

  it("a modalidade crua aparece mesmo sem label do contador", () => {
    expect(tituloTipoGuia({ parcelamentoId: "p1", parcelamentoTipo: "PERT_MEI" })).toContain("PERT_MEI");
  });

  it("modalidade desconhecida leva o motivo da revisão junto", () => {
    const titulo = tituloTipoGuia({ parcelamentoId: "p1", parcelamentoTipo: "TRANSACAO_PGFN" });
    expect(titulo).toContain("TRANSACAO_PGFN");
    expect(titulo).toMatch(/não reconhecida/i);
  });

  it("INSS não ganha aviso de revisão — ele é conhecido, só não colapsa", () => {
    const titulo = tituloTipoGuia({ parcelamentoId: "p1", parcelamentoTipo: "INSS" });
    expect(titulo).toContain("INSS");
    expect(titulo).not.toMatch(/não reconhecida/i);
  });

  it("lista os impostos da DARF consolidada", () => {
    const titulo = tituloTipoGuia({
      tipo: "OUTRA",
      extracted: { composicao: [{ denominacao: "PIS - FATURAMENTO", total: 100 }] },
    });
    expect(titulo).toContain("PIS - FATURAMENTO");
    expect(titulo).toContain("100,00");
  });
});
