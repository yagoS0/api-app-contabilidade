// As regras do wizard "Novo parcelamento" — a parte que dá para exercer sem montar tela.
//
// O caso ÂNCORA é o aceite literal da fase: registrar um parcelamento MIGRADO — 23ª de 60, saldo
// declarado, débito automático — SEM NENHUM PDF, e o contrato passar a gerenciar 38 prestações com
// as 22 anteriores entrando como histórico.

import {
  validarPasso1, validarPasso2, validarPasso3, montarPayloadIngestao,
  parcelasRestantes, proximaParcela, competenciaProximaParcela, textoDoRodapePasso2,
  oQueSePerdeAoFechar, somasProvisao, somarMeses, vencimentoDaCompetencia,
  tipoGuiaSugeridoNaoExisteAqui, estadoInicial, numero,
} from "../wizardParcelamento";

/** O contrato do aceite: migrado, 23ª de 60, débito automático, sem documento nenhum. */
function migrado(over = {}) {
  return {
    ...estadoInicial(),
    tipo: "PARCSN",
    numeroParcelamento: "1234567",
    dataAdesao: "2024-10-15",
    situacao: "EM_ANDAMENTO",
    saldoConsolidado: "45600",
    valorParcela: "1200",
    totalParcelas: "60",
    parcelasJaPagas: "22",
    competenciaPrimeiraParcela: "2024-10",
    diaVencimento: "20",
    formaPagamento: "DEBITO_AUTOMATICO",
    provisaoLines: [
      { tipoLinha: "PRINCIPAL", tipo: "D", conta: "265", valor: "45600" },
      { tipoLinha: "PARC", tipo: "C", conta: "553", valor: "45600" },
    ],
    pagamentoLines: [
      { tipoLinha: "PARC", tipo: "D", conta: "553" },
      { tipoLinha: "JUROS", tipo: "D", conta: "501" },
      { tipoLinha: "CAIXA", tipo: "C", conta: "111" },
    ],
    ...over,
  };
}

describe("aceite literal — migrado 23ª de 60, débito automático, sem PDF", () => {
  const dados = migrado();

  it("os três passos passam", () => {
    expect(validarPasso1(dados).ok).toBe(true);
    expect(validarPasso2(dados).ok).toBe(true);
    expect(validarPasso3(dados).ok).toBe(true);
  });

  it("o sistema passa a gerenciar 38 prestações e a próxima é a 23ª", () => {
    expect(parcelasRestantes(dados)).toBe(38);
    expect(proximaParcela(dados)).toBe(23);
    expect(textoDoRodapePasso2(dados)).toContain("38 parcelas restantes");
    expect(textoDoRodapePasso2(dados)).toContain("22 já pagas");
  });

  it("⚠ o payload vai SEM guia — é o coração do parcelamento-first", () => {
    const body = montarPayloadIngestao(dados);
    expect(body.guideId).toBeNull();
  });

  it("manda `parcelasJaPagas: 22` e `numeroParcela: 23`", () => {
    const body = montarPayloadIngestao(dados);
    expect(body.parcelasJaPagas).toBe(22);
    expect(body.header.numeroParcela).toBe(23);
    expect(body.header.quantidadeParcelas).toBe(60);
  });

  it("⚠ `anoMesParcela` é a competência da 1ª parcela, NÃO a da atual", () => {
    // Mandar a competência da 23ª deslocaria o cronograma inteiro em 22 meses — e é o vencimento
    // que decide atraso quando não há guia.
    const body = montarPayloadIngestao(dados);
    expect(body.header.anoMesParcela).toBe("202410");
    expect(competenciaProximaParcela(dados)).toBe("2026-08");
  });

  it("leva `diaPagamento`, `formaPagamento` e `saldoConsolidado`", () => {
    const body = montarPayloadIngestao(dados);
    expect(body.header.diaPagamento).toBe(20);
    expect(body.header.formaPagamento).toBe("DEBITO_AUTOMATICO");
    expect(body.header.saldoConsolidado).toBe(45600);
  });

  it("`valorPrincipal`/`valorTotal` saem das LINHAS, não do saldo declarado", () => {
    const body = montarPayloadIngestao(migrado({
      saldoConsolidado: "99999",
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", tipo: "D", conta: "265", valor: "40000" },
        { tipoLinha: "PARC", tipo: "C", conta: "553", valor: "40000" },
      ],
    }));
    expect(body.header.valorPrincipal).toBe(40000);
    expect(body.header.valorTotal).toBe(40000);
    // o saldo declarado continua viajando, mas como informativo
    expect(body.header.saldoConsolidado).toBe(99999);
  });
});

describe("passo 1 — identificação", () => {
  it("nº do parcelamento é obrigatório (é a chave da consulta ao SERPRO)", () => {
    const r = validarPasso1(migrado({ numeroParcelamento: "  " }));
    expect(r.ok).toBe(false);
    expect(r.erros.numeroParcelamento).toMatch(/nº do parcelamento/i);
  });

  it("data de adesão é obrigatória — é a data do lançamento da provisão", () => {
    const r = validarPasso1(migrado({ dataAdesao: "" }));
    expect(r.ok).toBe(false);
    expect(r.erros.dataAdesao).toMatch(/adesão/i);
  });
});

describe("passo 2 — valores e parcelas", () => {
  it("saldo tem de ser > 0", () => {
    expect(validarPasso2(migrado({ saldoConsolidado: "0" })).erros.saldoConsolidado).toBeTruthy();
  });

  it("pagas tem de ser MENOR que o total", () => {
    const r = validarPasso2(migrado({ parcelasJaPagas: "60" }));
    expect(r.ok).toBe(false);
    expect(r.erros.parcelasJaPagas).toMatch(/MENOR/);
  });

  it("'parcelas já pagas' só é exigido em Em andamento", () => {
    const novo = migrado({ situacao: "NOVO", parcelasJaPagas: "" });
    expect(validarPasso2(novo).erros.parcelasJaPagas).toBeUndefined();
    expect(parcelasRestantes(novo)).toBe(60);
    expect(proximaParcela(novo)).toBe(1);
  });

  it("⚠ o dia do vencimento é obrigatório — é a data que decide atraso sem guia", () => {
    const r = validarPasso2(migrado({ diaVencimento: "" }));
    expect(r.ok).toBe(false);
    expect(r.erros.diaVencimento).toMatch(/dia do vencimento/i);
    expect(validarPasso2(migrado({ diaVencimento: "32" })).ok).toBe(false);
  });

  it("competência da 1ª parcela é obrigatória — sem ela o cronograma nasce sem datas", () => {
    expect(validarPasso2(migrado({ competenciaPrimeiraParcela: "" })).ok).toBe(false);
  });

  it("⚠ divergência entre parcela×restantes e saldo é ALERTA, não erro", () => {
    // 1200 × 38 = 45.600. Com saldo declarado de 39.000 há divergência de 6.600 (juros embutidos).
    const r = validarPasso2(migrado({ saldoConsolidado: "39000" }));
    expect(r.ok).toBe(true);            // NÃO bloqueia
    expect(r.alertas.length).toBe(1);
    expect(r.alertas[0]).toMatch(/Juros embutidos/);
  });

  it("diferença de centavos não vira alerta", () => {
    const r = validarPasso2(migrado({ saldoConsolidado: "45600.40" }));
    expect(r.alertas).toHaveLength(0);
  });
});

describe("passo 3 — contabilização", () => {
  it("⚠ D ≠ C BLOQUEIA — lançamento desbalanceado trava o fechamento do mês", () => {
    const r = validarPasso3(migrado({
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", tipo: "D", conta: "265", valor: "45600" },
        { tipoLinha: "PARC", tipo: "C", conta: "553", valor: "40000" },
      ],
    }));
    expect(r.ok).toBe(false);
    expect(r.erros.provisaoBalanco).toMatch(/trava o fechamento/);
  });

  it("provisão sem valor nenhum é recusada (0 = 0 seria 'balanceado')", () => {
    const r = validarPasso3(migrado({
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", tipo: "D", conta: "265", valor: "" },
        { tipoLinha: "PARC", tipo: "C", conta: "553", valor: "" },
      ],
    }));
    expect(r.ok).toBe(false);
    expect(r.erros.provisaoValor).toBeTruthy();
  });

  it("⚠ conta em branco AVISA, não bloqueia — é o estado esperado no 1º da modalidade", () => {
    const r = validarPasso3(migrado({
      provisaoLines: [
        { tipoLinha: "PRINCIPAL", tipo: "D", conta: "", valor: "45600" },
        { tipoLinha: "PARC", tipo: "C", conta: "", valor: "45600" },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(r.alertas[0]).toMatch(/sem conta/);
  });

  it("⚠ D e C são lidos pela MESMA gramática de separador decimal", () => {
    // "1.200,50" (milhar pt-BR) e "1200,50" são o mesmo número. Um `replace(',', '.')` escrito à mão
    // leria o primeiro como NaN → 0, e a provisão apareceria desbalanceada por causa de um ponto.
    const s = somasProvisao([
      { tipo: "D", valor: "1.200,50" },
      { tipo: "C", valor: "1200,50" },
    ]);
    expect(s.debito).toBe(1200.5);
    expect(s.credito).toBe(1200.5);
    expect(s.balanceado).toBe(true);
  });
});

describe("fechar com dados preenchidos NOMEIA o que se perde", () => {
  it("lista os campos preenchidos", () => {
    const perde = oQueSePerdeAoFechar(migrado());
    expect(perde.join(" · ")).toMatch(/nº do parcelamento 1234567/);
    expect(perde.join(" · ")).toMatch(/saldo consolidado de R\$ 45\.600,00/);
    expect(perde.join(" · ")).toMatch(/60 parcelas/);
    expect(perde.join(" · ")).toMatch(/22 prestações já pagas/);
    expect(perde.join(" · ")).toMatch(/vencimento no dia 20/);
  });

  it("⚠ conta PRÉ-PREENCHIDA pela memória não entra — só a digitada à mão", () => {
    // As linhas nascem com conta vinda do `MapaContaTributo`. Contá-las faria um wizard recém-aberto
    // pedir confirmação para fechar, e confirmação que aparece sempre é a que ninguém lê.
    expect(oQueSePerdeAoFechar(migrado()).join(" · ")).not.toMatch(/conta/);
    expect(oQueSePerdeAoFechar(migrado({ contasEditadas: 2 })).join(" · "))
      .toMatch(/2 contas de lançamento preenchidas à mão/);
  });

  it("wizard intocado não perde nada — e aí não há confirmação a pedir", () => {
    expect(oQueSePerdeAoFechar(estadoInicial())).toHaveLength(0);
  });
});

describe("calendário", () => {
  it("somarMeses atravessa o ano", () => {
    expect(somarMeses("2024-10", 22)).toBe("2026-08");
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("lixo", 1)).toBeNull();
  });

  it("o dia é clampado ao último do mês", () => {
    expect(vencimentoDaCompetencia("2026-02", 31)).toBe("28/02/2026");
    expect(vencimentoDaCompetencia("2026-08", 20)).toBe("20/08/2026");
    expect(vencimentoDaCompetencia("", 20)).toBe("—");
  });
});

describe("leitura de número — reusa a gramática estrita da célula de lançamento", () => {
  it("aceita as duas formas canônicas e o milhar pt-BR", () => {
    expect(numero("1200,50")).toBe(1200.5);
    expect(numero("1200.50")).toBe(1200.5);
    expect(numero("1.200,50")).toBe(1200.5);
    expect(numero(1200.5)).toBe(1200.5);
  });

  it("recusa lixo sem virar NaN — e recusa o en-US, que valeria 1000× menos", () => {
    expect(numero("")).toBe(0);
    expect(numero("abc")).toBe(0);
    expect(numero("1,234.56")).toBe(0);
  });
});

it("o módulo não exporta nada que não exista (guarda contra import morto)", () => {
  expect(tipoGuiaSugeridoNaoExisteAqui).toBeUndefined();
});
