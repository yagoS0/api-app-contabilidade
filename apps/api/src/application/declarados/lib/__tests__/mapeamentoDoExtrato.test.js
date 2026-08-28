// O MAPEAMENTO DE UM EXTRATO EM EXCEL.
//
// ⚠⚠ O que está em jogo: o destino disto é a fila de conferência do contador, e um mapeamento
// errado vira despesa lançada errada — extrato inteiro com data no lugar de valor, ou com o sinal
// invertido. Por isso o sistema PROPÕE e uma pessoa CONFIRMA.

import {
  PAPEL, PAPEIS_OBRIGATORIOS, SINAL, SINAIS_SUPORTADOS, APELIDOS, LEITURA_DO_SINAL,
  normalizarCabecalho, proporMapeamento, validarMapeamento, lerSinalDaLinha, fraseDoErroDeMapeamento,
  assinaturaDoCabecalho, lerValorDoExtrato,
} from "../mapeamentoDoExtrato.js";

describe("⚠ A PROPOSTA — e ela nasce marcada como proposta", () => {
  it("reconhece um cabeçalho comum de banco", () => {
    const p = proporMapeamento(["Data", "Histórico", "Valor"]);
    expect(p.colunas[PAPEL.DATA]).toBe(0);
    expect(p.colunas[PAPEL.HISTORICO]).toBe(1);
    expect(p.colunas[PAPEL.VALOR]).toBe(2);
    expect(p.completa).toBe(true);
  });

  it("acento, caixa e pontuação não decidem nada", () => {
    const p = proporMapeamento(["DATA ", "descriÇÃO", "VLR."]);
    expect(p.faltando).toEqual([]);
  });

  it("⚠⚠ `confirmado` NASCE `false`, e nenhum caminho de código o vira", () => {
    // É a trava inteira da fase: sem a confirmação de uma pessoa, o arquivo não vira lançamento.
    expect(proporMapeamento(["Data", "Histórico", "Valor"]).confirmado).toBe(false);
  });

  it("coluna que falta sai NOMEADA, e a proposta não fica completa", () => {
    const p = proporMapeamento(["Data", "Valor"]);
    expect(p.faltando).toEqual([PAPEL.HISTORICO]);
    expect(p.completa).toBe(false);
  });

  it("⚠⚠ DUAS colunas para o MESMO papel viram AMBIGUIDADE, não a primeira", () => {
    // "Valor" e "Valor R$" na mesma planilha é caso real (saldo × lançamento), e escolher sozinho
    // importaria a coluna errada com aparência de acerto.
    const p = proporMapeamento(["Data", "Histórico", "Valor", "Valor R$"]);
    expect(p.colunas[PAPEL.VALOR]).toBeNull();
    expect(p.ambiguidades).toEqual([{ papel: PAPEL.VALOR, colunas: [2, 3] }]);
    expect(p.completa).toBe(false);
  });

  it("⚠ casamento EXATO vence o parcial — substring solta casaria demais", () => {
    // "Data" exato não pode perder para "Data do saldo anterior" nem "valor" para "valor do saldo".
    const p = proporMapeamento(["Data do saldo anterior", "Data", "Histórico", "Valor"]);
    expect(p.colunas[PAPEL.DATA]).toBe(1);
  });

  it("coluna de D/C reconhecida muda o SINAL proposto", () => {
    const p = proporMapeamento(["Data", "Histórico", "Valor", "D/C"]);
    expect(p.colunas[PAPEL.SINAL]).toBe(3);
    expect(p.sinal).toBe(SINAL.COLUNA_DE_SINAL);
  });

  it("sem coluna de D/C, o palpite é valor negativo", () => {
    expect(proporMapeamento(["Data", "Histórico", "Valor"]).sinal).toBe(SINAL.VALOR_NEGATIVO);
  });

  it("cabeçalho vazio ou torto não quebra", () => {
    for (const c of [[], null, undefined, ["", null, 5]]) {
      expect(proporMapeamento(c).faltando).toEqual(PAPEIS_OBRIGATORIOS);
    }
  });

  it("⚠ os apelidos são os MESMOS do import do escritório — duas listas divergiriam", () => {
    // O contador veria o portal propor uma coisa num import e outra no outro, sobre o mesmo arquivo.
    for (const a of ["data", "descricao", "historico", "valor"]) {
      expect(Object.values(APELIDOS).flat()).toContain(a);
    }
  });
});

describe("⚠⚠ A VALIDAÇÃO — e `confirmado !== true` RECUSA", () => {
  const bom = { colunas: { data: 0, historico: 1, valor: 2 }, sinal: SINAL.VALOR_NEGATIVO, confirmado: true };

  it("mapeamento confirmado e completo passa", () => {
    expect(validarMapeamento(bom).ok).toBe(true);
  });

  it("⚠⚠ sem confirmação NÃO passa — nem completo", () => {
    for (const v of [false, undefined, null, "true", 1]) {
      const r = validarMapeamento({ ...bom, confirmado: v });
      expect(r.ok).toBe(false);
      expect(r.erros).toContainEqual({ papel: null, motivo: "nao_confirmado" });
    }
  });

  it("coluna obrigatória ausente é erro NOMEADO", () => {
    const r = validarMapeamento({ ...bom, colunas: { data: 0, valor: 2 } });
    expect(r.erros).toContainEqual({ papel: PAPEL.HISTORICO, motivo: "coluna_nao_indicada" });
  });

  it("⚠⚠ duas obrigatórias no MESMO índice é erro — a data viraria o valor, 'funcionando'", () => {
    const r = validarMapeamento({ ...bom, colunas: { data: 0, historico: 1, valor: 0 } });
    expect(r.erros).toContainEqual({ papel: PAPEL.VALOR, motivo: "coluna_repetida", com: PAPEL.DATA });
  });

  it("⚠ índice não inteiro ou negativo não conta como indicado", () => {
    for (const i of ["0", 1.5, -1, null]) {
      expect(validarMapeamento({ ...bom, colunas: { ...bom.colunas, data: i } }).ok).toBe(false);
    }
  });

  it("⚠⚠ COLUNAS SEPARADAS é recusa NOMEADA, não adivinhação", () => {
    // Mapear duas colunas de valor exigiria outro papel e mudaria a leitura da linha inteira.
    // Escolher uma das duas em silêncio importaria METADE do extrato.
    const r = validarMapeamento({ ...bom, sinal: SINAL.COLUNAS_SEPARADAS });
    expect(r.erros).toContainEqual({ papel: PAPEL.SINAL, motivo: "sinal_em_colunas_separadas" });
    expect(fraseDoErroDeMapeamento("sinal_em_colunas_separadas")).toMatch(/envie o extrato em OFX/);
  });

  it("dizer que há coluna de sinal sem indicá-la é erro", () => {
    const r = validarMapeamento({ ...bom, sinal: SINAL.COLUNA_DE_SINAL });
    expect(r.erros).toContainEqual({ papel: PAPEL.SINAL, motivo: "coluna_de_sinal_nao_indicada" });
  });

  it("⚠ todo motivo tem frase — erro sem frase vira caixa vazia na tela", () => {
    const motivos = ["coluna_nao_indicada", "coluna_repetida", "sinal_desconhecido",
      "sinal_em_colunas_separadas", "coluna_de_sinal_nao_indicada", "nao_confirmado"];
    for (const m of motivos) expect(fraseDoErroDeMapeamento(m)).toBeTruthy();
    expect(fraseDoErroDeMapeamento("coisa_nova")).toBeNull();
  });

  it("mapeamento ausente não quebra", () => {
    expect(validarMapeamento(null).ok).toBe(false);
    expect(validarMapeamento().ok).toBe(false);
  });
});

describe("⚠⚠ A LINHA É SAÍDA? — e 'não sei' é a terceira resposta", () => {
  it("por VALOR NEGATIVO", () => {
    const p = { sinal: SINAL.VALOR_NEGATIVO };
    expect(lerSinalDaLinha({ ...p, valorBruto: -120.5 })).toBe(LEITURA_DO_SINAL.SAIDA);
    expect(lerSinalDaLinha({ ...p, valorBruto: 300 })).toBe(LEITURA_DO_SINAL.ENTRADA);
  });

  it("⚠⚠ ZERO não é saída nem entrada", () => {
    // Linha de valor zero é saldo, separador ou erro de leitura. Criar uma despesa de R$ 0,00 na
    // fila do contador é ruído que ele tem de resolver.
    expect(lerSinalDaLinha({ sinal: SINAL.VALOR_NEGATIVO, valorBruto: 0 })).toBe(LEITURA_DO_SINAL.DESCONHECIDO);
  });

  it("⚠ valor ilegível é DESCONHECIDO, nunca entrada", () => {
    for (const v of [null, undefined, "", "abc", NaN]) {
      expect(lerSinalDaLinha({ sinal: SINAL.VALOR_NEGATIVO, valorBruto: v })).toBe(LEITURA_DO_SINAL.DESCONHECIDO);
    }
  });

  it("por COLUNA DE SINAL, nas grafias que os bancos usam", () => {
    const p = { sinal: SINAL.COLUNA_DE_SINAL };
    for (const c of ["D", "d", "débito", "DEBITO", "Saída", "-"]) {
      expect(lerSinalDaLinha({ ...p, celulaDeSinal: c })).toBe(LEITURA_DO_SINAL.SAIDA);
    }
    for (const c of ["C", "crédito", "Entrada", "+"]) {
      expect(lerSinalDaLinha({ ...p, celulaDeSinal: c })).toBe(LEITURA_DO_SINAL.ENTRADA);
    }
  });

  it("⚠⚠ marca FORA da lista não vira entrada por descarte — vira 'não sei'", () => {
    // Tratá-la como crédito faria a linha sumir em silêncio da fila de despesa.
    for (const c of ["X", "TED", "transferencia", "", null]) {
      expect(lerSinalDaLinha({ sinal: SINAL.COLUNA_DE_SINAL, celulaDeSinal: c })).toBe(LEITURA_DO_SINAL.DESCONHECIDO);
    }
  });

  it("⚠ com coluna de sinal, o SINAL DO VALOR não é consultado", () => {
    // Vários bancos escrevem o valor sempre positivo e põem o sinal na coluna ao lado.
    expect(lerSinalDaLinha({ sinal: SINAL.COLUNA_DE_SINAL, celulaDeSinal: "D", valorBruto: 500 }))
      .toBe(LEITURA_DO_SINAL.SAIDA);
  });
});

describe("normalização de cabeçalho", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(normalizarCabecalho(" Histórico/Descrição ")).toBe("historico descricao");
    expect(normalizarCabecalho(null)).toBe("");
  });

  it("⚠ os sinais suportados são dois, e `COLUNAS_SEPARADAS` não é um deles", () => {
    expect(SINAIS_SUPORTADOS).toEqual([SINAL.VALOR_NEGATIVO, SINAL.COLUNA_DE_SINAL]);
    expect(SINAIS_SUPORTADOS).not.toContain(SINAL.COLUNAS_SEPARADAS);
  });
});

describe("⚠⚠ A ASSINATURA DO CABEÇALHO — é assim que 'o banco' se identifica num Excel", () => {
  it("dois arquivos com as MESMAS colunas têm a mesma assinatura", () => {
    expect(assinaturaDoCabecalho(["Data", "Histórico", "Valor"]))
      .toBe(assinaturaDoCabecalho(["DATA", "histórico", " Valor "]));
  });

  it("⚠⚠ e a ORDEM não muda a assinatura — o banco reordena colunas entre versões", () => {
    // Uma chave sensível à ordem faria o contador remapear a MESMA planilha. Os índices continuam
    // sendo lidos do arquivo de cada envio: a chave identifica o FORMATO, não a posição.
    expect(assinaturaDoCabecalho(["Data", "Histórico", "Valor"]))
      .toBe(assinaturaDoCabecalho(["Valor", "Data", "Histórico"]));
  });

  it("colunas diferentes ⇒ assinatura diferente", () => {
    expect(assinaturaDoCabecalho(["Data", "Histórico", "Valor"]))
      .not.toBe(assinaturaDoCabecalho(["Data", "Histórico", "Valor", "D/C"]));
  });

  it("⚠⚠ cabeçalho vazio NÃO produz assinatura", () => {
    // Uma chave vazia colaria arquivos ilegíveis de bancos DIFERENTES no mesmo mapeamento.
    for (const c of [[], null, undefined, ["", null, "  "]]) {
      expect(assinaturaDoCabecalho(c)).toBeNull();
    }
  });

  it("⚠ ela não é o NOME do banco — é impressão digital, e não afirma nada", () => {
    // Deduzir "Itaú" de um cabeçalho seria inventar, e o nome aparece na tela do contador.
    const a = assinaturaDoCabecalho(["Data", "Histórico", "Valor"]);
    expect(a).not.toMatch(/ita|bradesco|banco do brasil|santander|caixa/i);
  });
});

describe("⚠⚠ O VALOR — a gramática é a do lote; o que este acrescenta é o SINAL", () => {
  it("célula numérica: o módulo é o valor, e o sinal viaja à parte", () => {
    expect(lerValorDoExtrato(-120.5)).toEqual({ ok: true, valor: 120.5, negativo: true });
    expect(lerValorDoExtrato(300)).toEqual({ ok: true, valor: 300, negativo: false });
  });

  it("⚠⚠ célula de TEXTO em pt-BR — e é aqui que `Number()` falhava", () => {
    // `Number("1.234,56")` é NaN: todo extrato com a coluna de valor em texto responderia
    // "não sei" em TODA linha, e o arquivo inteiro sumiria da fila em silêncio.
    expect(lerValorDoExtrato("-1.234,56")).toEqual({ ok: true, valor: 1234.56, negativo: true });
    expect(lerValorDoExtrato("1.234,56")).toEqual({ ok: true, valor: 1234.56, negativo: false });
    expect(lerValorDoExtrato("- 1.234,56")).toEqual({ ok: true, valor: 1234.56, negativo: true });
    expect(lerValorDoExtrato("R$ 89,90")).toEqual({ ok: true, valor: 89.9, negativo: false });
  });

  it("⚠⚠ e a AMBIGUIDADE que a gramática recusa continua recusada", () => {
    // `1,500.00` é en-US; lido como pt-BR viraria 1,50 — 1000× para baixo. Recusar é o certo.
    expect(lerValorDoExtrato("1.23.4").ok).toBe(false);
    expect(lerValorDoExtrato("1500,005").ok).toBe(false);
  });

  it("⚠⚠ ZERO e ilegível NÃO viram valor — e o sinal deles não vira entrada", () => {
    for (const c of [0, "0,00", "", null, undefined, "abc", NaN]) {
      expect(lerValorDoExtrato(c).ok).toBe(false);
      expect(lerSinalDaLinha({ sinal: SINAL.VALOR_NEGATIVO, valorBruto: c }))
        .toBe(LEITURA_DO_SINAL.DESCONHECIDO);
    }
  });

  it("⚠ parêntese contábil e o `-` no FIM NÃO são lidos — nunca foram medidos aqui", () => {
    // Aceitá-los por analogia seria inventar leitura de dinheiro. Eles caem em ilegível, contados
    // e nomeados: uma pendência a mais, nunca uma despesa com o sinal trocado.
    expect(lerValorDoExtrato("(1.234,56)").ok).toBe(false);
    expect(lerValorDoExtrato("1.234,56-").ok).toBe(false);
  });

  it("⚠⚠ o sinal por VALOR NEGATIVO passa a funcionar com célula de texto", () => {
    const p = { sinal: SINAL.VALOR_NEGATIVO };
    expect(lerSinalDaLinha({ ...p, valorBruto: "-1.234,56" })).toBe(LEITURA_DO_SINAL.SAIDA);
    expect(lerSinalDaLinha({ ...p, valorBruto: "1.234,56" })).toBe(LEITURA_DO_SINAL.ENTRADA);
  });
});
