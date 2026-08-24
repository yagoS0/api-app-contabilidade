// A FAMÍLIA DA CONTA — classificação por prefixo do `codigoCompleto`.
//
// ⚠ Os códigos completos aqui são os REAIS do plano de contas de produção, medidos em 24/08/2026.
// Não são exemplos: é contra eles que a classificação tem de valer.

import {
  ANCORAS_FAMILIA,
  FAMILIA,
  FOLHAS_DE_PARCELAMENTO,
  classificarFamilia,
  conferirAncorasDeFamilia,
  ehContaDeParcelamento,
  pontuarCodigoCompleto,
} from "../familiaDaConta.js";

const conta = (codigoCompleto, codigo, nome) => ({ codigoCompleto, codigo, nome });

describe("classificarFamilia — o prefixo do codigoCompleto decide", () => {
  it("3.3.1.03 IMPOSTOS INCIDENTES é retificadora de receita — as nove folhas", () => {
    for (const cc of [
      "331030001", // (-) ICMS
      "331030002", // (-) IPI
      "331030003", // (-) ICMS ST RETIDO
      "331030004", // (-) ISS
      "331030005", // (-) PIS
      "331030006", // (-) COFINS
      "331030007", // (-) ISS RETIDO (NAO RECUPERAVEL)
      "331030008", // (-) INSS S/RECEITA LEI 12.546/2011 — CPRB, incide sobre RECEITA
      "331030009", // (-) DAS - SIMPLES NACIONAL
    ]) {
      expect(classificarFamilia(conta(cc))).toBe(FAMILIA.RETIFICADORA_DE_RECEITA);
    }
  });

  it("⚠ devolução e desconto NÃO são tributo, apesar de irmãs de 3.3.1.03", () => {
    expect(classificarFamilia(conta("331010004"))).toBe(FAMILIA.DEDUCAO_NAO_TRIBUTARIA);
    expect(classificarFamilia(conta("331020002"))).toBe(FAMILIA.DEDUCAO_NAO_TRIBUTARIA);
  });

  it("4.1.1.03 DESPESAS TRIBUTARIAS — onde IRPJ e CSLL debitam", () => {
    expect(classificarFamilia(conta("411030005", "499", "CONTRIBUICAO SOCIAL"))).toBe(FAMILIA.DESPESA_TRIBUTARIA);
    expect(classificarFamilia(conta("411030006", "544", "IRPJ"))).toBe(FAMILIA.DESPESA_TRIBUTARIA);
    expect(classificarFamilia(conta("411030004", "498", "IPTU"))).toBe(FAMILIA.DESPESA_TRIBUTARIA);
  });

  it("2.1.1.05 OBRIGACOES TRIBUTARIAS — o crédito de toda provisão", () => {
    expect(classificarFamilia(conta("211050001", "250", "IRPJ A RECOLHER"))).toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
    expect(classificarFamilia(conta("211050004", "253", "ISS A RECOLHER"))).toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
    expect(classificarFamilia(conta("211050007", "256", "CSLL A RECOLHER"))).toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
    expect(classificarFamilia(conta("211050016", "265", "DAS - SIMPLES NACIONAL A RECOLHER"))).toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
  });

  it("⚠⚠ as doze folhas de PARCELAMENTO moram dentro de 2.1.1.05 e NÃO são obrigação comum", () => {
    expect(FOLHAS_DE_PARCELAMENTO).toHaveLength(12);
    for (const cc of FOLHAS_DE_PARCELAMENTO) {
      expect(classificarFamilia(conta(cc))).toBe(FAMILIA.PASSIVO_PARCELAMENTO);
    }
    // o caso medido: 553 = PARCELAMENTO SIMPLES A RECOLHER
    expect(ehContaDeParcelamento(conta("211050027", "553", "PARCELAMENTO SIMPLES A RECOLHER"))).toBe(true);
    expect(ehContaDeParcelamento(conta("211050016", "265", "DAS A RECOLHER"))).toBe(false);
  });

  it("⚠ folha nova dentro de 2.1.1.05 fora da lista cai em OBRIGACAO_TRIBUTARIA — falso-negativo nomeado", () => {
    expect(classificarFamilia(conta("211050099", "999", "PARCELAMENTO NOVO A RECOLHER")))
      .toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
  });

  it("1.1.1 disponibilidade é DELEGADA a disponibilidades.js", () => {
    expect(classificarFamilia(conta("111010001", "5", "CAIXA - MATRIZ"))).toBe(FAMILIA.DISPONIBILIDADE);
    expect(classificarFamilia(conta("111020001"))).toBe(FAMILIA.DISPONIBILIDADE); // bancos
    expect(classificarFamilia(conta("111030001"))).toBe(FAMILIA.DISPONIBILIDADE); // aplicações
  });

  it("⚠⚠ o ramo 5 (-) IRPJ/CSLL fica FORA de todas as famílias — de propósito", () => {
    // O balancete do sistema de destino traz esse grupo ZERADO. Ele cai em violação por INCLUSÃO.
    expect(classificarFamilia(conta("511010001", "594", "(-) IRPJ"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
    expect(classificarFamilia(conta("511010002", "595", "(-) CSLL"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
    expect(classificarFamilia(conta("5", "590", "(-) IRPJ/CSLL"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
  });

  it("⚠ as contas de INCENTIVOS FISCAIS — o erro relatado — ficam FORA, não em obrigação", () => {
    expect(classificarFamilia(conta("121060002", "136", "IRPJ"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
    expect(classificarFamilia(conta("121060003", "137", "CSLL"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
  });

  it("receita bruta e despesa geral ficam fora", () => {
    expect(classificarFamilia(conta("311020007", "372", "DEMAIS RECEITAS"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
    expect(classificarFamilia(conta("411020001", "457", "ALUGUEIS"))).toBe(FAMILIA.FORA_DAS_FAMILIAS);
  });

  it("⚠⚠ sem codigoCompleto é INDETERMINADO, NUNCA FORA_DAS_FAMILIAS", () => {
    expect(classificarFamilia({ codigo: "419", nome: "(-) PIS" })).toBe(FAMILIA.INDETERMINADO);
    expect(classificarFamilia(conta(""))).toBe(FAMILIA.INDETERMINADO);
    expect(classificarFamilia(conta(null))).toBe(FAMILIA.INDETERMINADO);
    expect(classificarFamilia(null)).toBe(FAMILIA.INDETERMINADO);
    expect(classificarFamilia(undefined)).toBe(FAMILIA.INDETERMINADO);
  });

  it("⚠ a ÂNCORA é o codigoCompleto — o mesmo completo sob outro reduzido dá o mesmo veredito", () => {
    // Instrução do dono: "os reduzidos são mutáveis, os completos imutáveis".
    const a = classificarFamilia(conta("211050007", "256", "CSLL A RECOLHER"));
    const b = classificarFamilia(conta("211050007", "9999", "CSLL A RECOLHER (renumerada)"));
    expect(a).toBe(b);
    expect(a).toBe(FAMILIA.OBRIGACAO_TRIBUTARIA);
  });

  it("⚠ e o NOME não classifica nada", () => {
    // "(-) PIS" no nome, mas o completo é de caixa: vence o completo.
    expect(classificarFamilia(conta("111010001", "5", "(-) PIS"))).toBe(FAMILIA.DISPONIBILIDADE);
  });
});

describe("pontuarCodigoCompleto — a grafia que o dono e o balancete usam", () => {
  it("aplica a máscara 1-1-1-2-4", () => {
    expect(pontuarCodigoCompleto("211050001")).toBe("2.1.1.05.0001");
    expect(pontuarCodigoCompleto("331030005")).toBe("3.3.1.03.0005");
    expect(pontuarCodigoCompleto("511010002")).toBe("5.1.1.01.0002");
    expect(pontuarCodigoCompleto("111010001")).toBe("1.1.1.01.0001");
  });

  it("⚠ código fora da máscara volta como veio — não se inventa pontuação", () => {
    expect(pontuarCodigoCompleto("21105")).toBe("21105");
    expect(pontuarCodigoCompleto("5")).toBe("5");
    expect(pontuarCodigoCompleto("")).toBe("");
    expect(pontuarCodigoCompleto(null)).toBe("");
  });
});

describe("conferirAncorasDeFamilia — tripwire, não classificador", () => {
  const planoBom = Object.values(ANCORAS_FAMILIA).map((a) => conta(a.codigoCompleto, "x", a.nomeMedido));

  it("plano intacto não acusa nada", () => {
    expect(conferirAncorasDeFamilia(planoBom)).toEqual([]);
  });

  it("âncora renomeada acusa — é como o plano reimportado grita em vez de classificar calado", () => {
    const torto = planoBom.map((c) =>
      c.codigoCompleto === "21105" ? { ...c, nome: "OUTRO NOME QUALQUER" } : c);
    const d = conferirAncorasDeFamilia(torto);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ ancora: "OBRIGACAO_TRIBUTARIA", motivo: "nome_divergente" });
  });

  it("âncora ausente acusa com motivo próprio", () => {
    const d = conferirAncorasDeFamilia(planoBom.filter((c) => c.codigoCompleto !== "33103"));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ ancora: "RETIFICADORA_DE_RECEITA", motivo: "ausente_no_plano" });
  });

  it("entrada vazia não explode", () => {
    expect(conferirAncorasDeFamilia(null)).toHaveLength(Object.keys(ANCORAS_FAMILIA).length);
  });
});
