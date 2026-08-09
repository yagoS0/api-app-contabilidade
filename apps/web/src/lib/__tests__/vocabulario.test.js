// O DE-PARA DA MODALIDADE DE PARCELAMENTO — as quatro perguntas que ele tem de responder:
//
//   1. cada uma das 8 modalidades oficiais colapsa na FAMÍLIA CERTA (SN ≠ MEI);
//   2. `INSS` e `OUTRO` NÃO colapsam;
//   3. modalidade que o catálogo não conhece levanta REVISÃO em vez de virar "PARC SN";
//   4. a modalidade CRUA continua recuperável DEPOIS do colapso.
//
// A 3 e a 4 são o pedido inteiro: colapsar é fácil, colapsar sem perder o de onde veio é o ponto.

import {
  resolverModalidadeParcelamento,
  FAMILIAS_PARCELAMENTO,
  MODALIDADES_SEM_FAMILIA,
  AVISO_MODALIDADE_EM_REVISAO,
  rotuloRegime,
  rotuloEstadoApuracao,
  chaveSituacaoFiscal,
  situacaoFiscalComSimbolo,
} from "../vocabulario";

describe("as duas famílias colapsam — e cada uma na sua", () => {
  it.each(["PARCSN", "PARCSN_ESPECIAL", "PERT_SN", "RELP_SN"])(
    "%s → PARC SN (família do Simples Nacional)",
    (modalidade) => {
      const r = resolverModalidadeParcelamento(modalidade);
      expect(r.rotulo).toBe("PARC SN");
      expect(r.familia).toBe("SIMPLES_NACIONAL");
      expect(r.colapsada).toBe(true);
      expect(r.revisao).toBe(false);
    },
  );

  it.each(["PARCMEI", "PARCMEI_ESPECIAL", "PERT_MEI", "RELP_MEI"])(
    "%s → PARC MEI (família do MEI)",
    (modalidade) => {
      const r = resolverModalidadeParcelamento(modalidade);
      expect(r.rotulo).toBe("PARC MEI");
      expect(r.familia).toBe("MEI");
      expect(r.colapsada).toBe(true);
      expect(r.revisao).toBe(false);
    },
  );

  it("⚠ a família do MEI NUNCA cai em PARC SN — são duas, não uma", () => {
    for (const m of FAMILIAS_PARCELAMENTO.MEI.modalidades) {
      expect(resolverModalidadeParcelamento(m).rotulo).not.toBe("PARC SN");
    }
    for (const m of FAMILIAS_PARCELAMENTO.SIMPLES_NACIONAL.modalidades) {
      expect(resolverModalidadeParcelamento(m).rotulo).not.toBe("PARC MEI");
    }
  });

  it("são 8 modalidades no total — 4 + 4, como a documentação oficial lista", () => {
    expect(FAMILIAS_PARCELAMENTO.SIMPLES_NACIONAL.modalidades).toHaveLength(4);
    expect(FAMILIAS_PARCELAMENTO.MEI.modalidades).toHaveLength(4);
  });

  it("aceita o valor em caixa baixa e com espaço — vem de payload, não de constante", () => {
    expect(resolverModalidadeParcelamento("  relp_sn  ").rotulo).toBe("PARC SN");
  });
});

describe("⚠ INSS e OUTRO NÃO colapsam", () => {
  it("INSS é parcelamento previdenciário — chamá-lo de PARC SN seria trocar um erro por outro", () => {
    const r = resolverModalidadeParcelamento("INSS");
    expect(r.rotulo).toBe("INSS");
    expect(r.rotulo).not.toBe("PARC SN");
    expect(r.familia).toBeNull();
    expect(r.colapsada).toBe(false);
    // Conhecida: não colapsa, mas também não é caso de revisão.
    expect(r.conhecida).toBe(true);
    expect(r.revisao).toBe(false);
  });

  it("OUTRO segue OUTRO — não diz qual natureza é, e o de-para não decide por ele", () => {
    const r = resolverModalidadeParcelamento("OUTRO");
    expect(r.rotulo).toBe("OUTRO");
    expect(r.colapsada).toBe(false);
    expect(r.revisao).toBe(false);
  });

  it("as duas estão declaradas como sem-família, não esquecidas", () => {
    expect(MODALIDADES_SEM_FAMILIA).toEqual(expect.arrayContaining(["INSS", "OUTRO"]));
  });
});

describe("⚠ modalidade desconhecida levanta REVISÃO — nunca colapso automático", () => {
  it("o catálogo do SERPRO evolui: modalidade nova aparece CRUA e pede conferência", () => {
    const r = resolverModalidadeParcelamento("TRANSACAO_PGFN");
    expect(r.rotulo).toBe("TRANSACAO_PGFN");
    expect(r.rotulo).not.toBe("PARC SN");
    expect(r.familia).toBeNull();
    expect(r.colapsada).toBe(false);
    expect(r.conhecida).toBe(false);
    expect(r.revisao).toBe(true);
    expect(r.motivo).toBe("modalidade_desconhecida");
  });

  it("uma modalidade que só PARECE do Simples também não colapsa — a lista é fechada", () => {
    // Prefixo casaria com `^PARCSN`; a lista fechada é o que impede o colapso em silêncio.
    const r = resolverModalidadeParcelamento("PARCSN_FUTURO");
    expect(r.revisao).toBe(true);
    expect(r.rotulo).toBe("PARCSN_FUTURO");
  });

  it("o aviso existe como texto único, para tela e tooltip não divergirem", () => {
    expect(AVISO_MODALIDADE_EM_REVISAO).toMatch(/⚠/);
    expect(AVISO_MODALIDADE_EM_REVISAO).toMatch(/não reconhecida/i);
  });

  it("⚠ AUSÊNCIA de modalidade não é modalidade desconhecida — não levanta revisão", () => {
    // O parcelamento do caminho V1 não grava `tipo`. Pedir revisão dele acenderia alerta permanente
    // em dado legado, e alerta que acende sempre é alerta que ninguém lê.
    for (const vazio of [null, undefined, ""]) {
      const r = resolverModalidadeParcelamento(vazio);
      expect(r.rotulo).toBe("Parcelamento");
      expect(r.revisao).toBe(false);
      expect(r.motivo).toBe("modalidade_ausente");
      expect(r.cru).toBe("");
    }
  });
});

describe("⚠ o colapso é NÃO DESTRUTIVO — o cru volta sempre", () => {
  it("depois de colapsar em PARC SN, ainda se sabe que veio como RELP_SN", () => {
    const r = resolverModalidadeParcelamento("RELP_SN");
    expect(r.rotulo).toBe("PARC SN");
    expect(r.cru).toBe("RELP_SN"); // é isto que responde "veio como RELP_SN" numa auditoria
  });

  it("PERT_SN e RELP_SN compartilham o rótulo mas continuam distinguíveis", () => {
    const pert = resolverModalidadeParcelamento("PERT_SN");
    const relp = resolverModalidadeParcelamento("RELP_SN");
    expect(pert.rotulo).toBe(relp.rotulo);
    expect(pert.cru).not.toBe(relp.cru);
  });

  it("o cru volta também quando NÃO houve colapso", () => {
    expect(resolverModalidadeParcelamento("INSS").cru).toBe("INSS");
    expect(resolverModalidadeParcelamento("TRANSACAO_PGFN").cru).toBe("TRANSACAO_PGFN");
  });
});

// O resto do vocabulário não tinha teste; estas travam o que já era o comportamento.
describe("o resto do vocabulário", () => {
  it("regime: enum do banco nunca chega cru à tela", () => {
    expect(rotuloRegime("LUCRO_PRESUMIDO")).toBe("Presumido");
    expect(rotuloRegime("SIMPLES_NACIONAL")).toBe("Simples");
    expect(rotuloRegime("REGIME_NOVO")).toBe("Regime novo"); // fallback legível, não o enum
    expect(rotuloRegime(null)).toBe("");
  });

  it("apuração: sem estado, 'Não iniciada' — nunca vazio", () => {
    expect(rotuloEstadoApuracao(null)).toBe("Não iniciada");
    expect(rotuloEstadoApuracao("bloqueada_pendencias")).toBe("Travada por pendência");
  });

  it("situação fiscal: ausência de consulta jamais vira 'sem pendência'", () => {
    expect(chaveSituacaoFiscal(null)).toBe("NAO_CONSULTADA");
    expect(chaveSituacaoFiscal("QUALQUER_COISA")).toBe("NAO_CONSULTADA");
    expect(situacaoFiscalComSimbolo("NAO_CONSULTADA")).toBe("○ Fiscal não consultada");
  });
});
