// ⚠⚠ A SEPARAÇÃO DA TELA "A LANÇAR" — e o que ela existe para impedir.
//
// > Dono: *"na página A lançar, separe visualmente o que são regras, saídas do cliente, o que é
// > para virar lançamento e o que é para o fluxo."*
//
// O que este arquivo trava, em ordem de custo:
//   1. um bloco de FLUXO cair na seção «Vira lançamento contábil» — a tela passaria a prometer
//      lançamento onde não há conta, débito nem crédito;
//   2. um bloco novo cair numa seção por OMISSÃO, em vez de aparecer sem casa;
//   3. a origem da linha virar texto de máquina ("EXTRATO_EXCEL_CLIENTE") na tela do contador.

import {
  BLOCO,
  NATUREZA,
  SECAO,
  SECOES_NA_ORDEM,
  ORIGEM_NA_TELA,
  natureza,
  origemDaLinha,
  veioDeExtrato,
} from "../naturezaDaConferencia";

describe("⚠⚠ o destino de cada bloco — é o que vira SEÇÃO", () => {
  it.each([
    [BLOCO.CASAMENTOS, NATUREZA.VIRA_LANCAMENTO],
    [BLOCO.FILA, NATUREZA.VIRA_LANCAMENTO],
    [BLOCO.RECORRENCIAS, NATUREZA.SO_FLUXO],
    [BLOCO.SAIDAS_DO_CLIENTE, NATUREZA.SO_FLUXO],
    [BLOCO.MEXIDAS_DO_CLIENTE, NATUREZA.SO_FLUXO],
    [BLOCO.REGRAS, NATUREZA.REGRA],
  ])("%s cai em %s", (bloco, esperada) => {
    expect(natureza(bloco)).toBe(esperada);
  });

  it("⚠⚠ RECORRÊNCIA NÃO VIRA LANÇAMENTO — o painel dela diz de si que NÃO DECIDE NADA", () => {
    // É o caso que mais engana: ela mora entre dois painéis que lançam, e o nome ("recorrência de
    // despesa") soa contábil. Ela é previsão do fluxo futuro — sem conta, sem débito, sem crédito.
    expect(natureza(BLOCO.RECORRENCIAS)).not.toBe(NATUREZA.VIRA_LANCAMENTO);
  });

  it("⚠⚠ o SEXTO painel tem casa — as mexidas do cliente não ficam órfãs entre seções", () => {
    // Ele entrou depois dos outros cinco e é o único que não pede nada, então é o que se esquece.
    expect(natureza(BLOCO.MEXIDAS_DO_CLIENTE)).toBe(NATUREZA.SO_FLUXO);
  });

  it("⚠⚠ bloco DESCONHECIDO não cai em seção nenhuma — nunca em «Vira lançamento» por omissão", () => {
    // Um default aqui faria o próximo painel afirmar que gera lançamento contábil sem ninguém ter
    // decidido isso. Aparecer sem casa é barato e visível; a afirmação errada não é.
    expect(natureza("BLOCO_QUE_ALGUEM_ACRESCENTAR")).toBeNull();
    expect(natureza(undefined)).toBeNull();
  });

  it("⚠⚠⚠ `LANCADOS_POR_REGRA` é o ÚNICO fora da seção da própria natureza — e é decisão do dono", () => {
    // ⚠⚠ ELE FOI E VOLTOU NO MESMO DIA (01/09/2026): virou aba própria e o dono a devolveu —
    // *"devolva a aba pras regras"*.
    //
    // As linhas dele SÃO lançamentos contábeis: pela régua do destino, ele cairia em
    // «Vira lançamento contábil». Fica em «Regras» porque a pergunta que ele responde é sobre a
    // AUTOMAÇÃO — *"o que a regra que eu liguei já fez?"* —, e a consequência ao lado da causa era
    // o argumento da posição original dele.
    expect(natureza(BLOCO.LANCADOS_POR_REGRA)).toBe(NATUREZA.REGRA);
    expect(natureza(BLOCO.LANCADOS_POR_REGRA)).not.toBe(NATUREZA.VIRA_LANCAMENTO);
  });

  it("⚠⚠ e a frase da seção «Regras» DEIXOU de negar que ali há lançamento", () => {
    // Ela dizia *"NÃO é lançamento nem fluxo"* — e com o extrato recolhido ali dentro isso passaria
    // a ser falso: a tela negaria, no título, o conteúdo do próprio bloco.
    expect(SECAO[NATUREZA.REGRA].frase).not.toMatch(/não é lançamento/i);
    expect(SECAO[NATUREZA.REGRA].frase).toMatch(/o que ela já lançou/i);
  });

  it("os blocos declarados estão todos mapeados — a lista é fechada dos dois lados", () => {
    for (const b of Object.values(BLOCO)) expect(natureza(b)).not.toBeNull();
  });
});

describe("⚠ as três seções, e o texto que elas carregam", () => {
  it("são três, nesta ordem", () => {
    expect(SECOES_NA_ORDEM).toEqual([
      NATUREZA.VIRA_LANCAMENTO,
      NATUREZA.SO_FLUXO,
      NATUREZA.REGRA,
    ]);
  });

  it("cada uma tem título e frase", () => {
    for (const n of SECOES_NA_ORDEM) {
      expect(SECAO[n].titulo).toBeTruthy();
      expect(SECAO[n].frase).toBeTruthy();
    }
  });

  it("⚠⚠ a frase de «só fluxo» DIZ que não lança nada — é a fronteira do caixa em palavras", () => {
    expect(SECAO[NATUREZA.SO_FLUXO].frase).toMatch(/não lança nada/i);
  });

  it("⚠⚠ e ela NÃO fala de conta, débito nem crédito", () => {
    // Mesmo critério do guardião de `painelDeSaidasDoCliente.test.jsx`: vocabulário contábil ao
    // lado daquela fila faz o contador procurar uma conta que este caminho não tem.
    expect(SECAO[NATUREZA.SO_FLUXO].titulo + SECAO[NATUREZA.SO_FLUXO].frase)
      .not.toMatch(/conta|débito|crédito/i);
  });

  it("⚠ a de «vira lançamento» é a frase que o modal JÁ dizia — não texto novo", () => {
    expect(SECAO[NATUREZA.VIRA_LANCAMENTO].frase).toMatch(/débito na conta da despesa/i);
    expect(SECAO[NATUREZA.VIRA_LANCAMENTO].frase).toMatch(/crédito no caixa/i);
  });
});

describe("⚠⚠ a origem da linha — é o que responde «saídas do cliente» DENTRO da fila", () => {
  it.each([
    ["NOTA_RECEBIDA", "nota recebida"],
    ["CLIENTE_MANUAL", "do cliente"],
    ["OFX_CLIENTE", "extrato (OFX)"],
    ["EXTRATO_EXCEL_CLIENTE", "extrato (planilha)"],
  ])("%s vira o chip %s", (origem, rotulo) => {
    expect(origemDaLinha({ origem }).rotulo).toBe(rotulo);
  });

  it("⚠ o vocabulário é o mesmo do backend, e são QUATRO", () => {
    // Espelho de `application/declarados/lib/estadosDeclarado.js`. Mudou lá, muda aqui.
    expect(Object.keys(ORIGEM_NA_TELA).sort()).toEqual([
      "CLIENTE_MANUAL",
      "EXTRATO_EXCEL_CLIENTE",
      "NOTA_RECEBIDA",
      "OFX_CLIENTE",
    ]);
  });

  it("⚠⚠ a planilha NÃO é o OFX — o backend as separa e a tela também", () => {
    // São dois caminhos diferentes: a planilha teve as colunas mapeadas por alguém.
    expect(origemDaLinha({ origem: "EXTRATO_EXCEL_CLIENTE" }).rotulo)
      .not.toBe(origemDaLinha({ origem: "OFX_CLIENTE" }).rotulo);
  });

  it("⚠⚠ origem que a tela NÃO conhece não vira chip — nunca o valor cru", () => {
    // Um rótulo derivado do valor do banco poria "ORIGEM_NOVA_DO_BACKEND" na tela do contador.
    // Falta de chip é ausência; texto de máquina é ruído que se parece com informação.
    expect(origemDaLinha({ origem: "ORIGEM_NOVA_DO_BACKEND" })).toBeNull();
  });

  it("linha sem origem, e linha nenhuma, não viram chip", () => {
    expect(origemDaLinha({})).toBeNull();
    expect(origemDaLinha(null)).toBeNull();
    expect(origemDaLinha(undefined)).toBeNull();
  });

  it("⚠ todo chip tem título — o rótulo é curto e o título diz de onde veio", () => {
    for (const v of Object.values(ORIGEM_NA_TELA)) {
      expect(v.rotulo).toBeTruthy();
      expect(v.titulo).toBeTruthy();
    }
  });
});

describe("⚠⚠ «esta linha PODE ter nota?» — são DUAS origens de extrato, não uma", () => {
  it.each(["OFX_CLIENTE", "EXTRATO_EXCEL_CLIENTE"])("%s veio de extrato", (origem) => {
    expect(veioDeExtrato({ origem })).toBe(true);
  });

  it("⚠⚠ a PLANILHA conta tanto quanto o OFX — foi a metade que faltava", () => {
    // `conferenciaTela.leituraDoDocumento` comparava só `"OFX_CLIENTE"`, então a linha da planilha
    // dizia *"a nota de origem não está mais na base"* sobre uma linha que nunca teve nota.
    expect(veioDeExtrato({ origem: "EXTRATO_EXCEL_CLIENTE" })).toBe(true);
  });

  it.each(["NOTA_RECEBIDA", "CLIENTE_MANUAL"])("%s NÃO veio de extrato", (origem) => {
    expect(veioDeExtrato({ origem })).toBe(false);
  });

  it("⚠ origem desconhecida, ausente ou linha nenhuma respondem `false` — nunca «veio do extrato»", () => {
    // Na dúvida, a tela cai na leitura que fala da NOTA, que é o caminho de sempre.
    expect(veioDeExtrato({ origem: "ORIGEM_NOVA_DO_BACKEND" })).toBe(false);
    expect(veioDeExtrato({})).toBe(false);
    expect(veioDeExtrato(null)).toBe(false);
  });
});
