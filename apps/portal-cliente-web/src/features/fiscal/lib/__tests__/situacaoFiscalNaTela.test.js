// ⚠⚠ A prova central: NUNCA CONSULTADA NÃO É "EM DIA", em nenhum caminho.

import {
  COLUNA_TOTAL,
  SITUACAO,
  ehRegular,
  naoVirouTabela,
  parseValorBR,
  situacaoNaTela,
  totalDoBloco,
} from "../situacaoFiscalNaTela";

describe("⚠⚠ ausência nunca vira regularidade", () => {
  const ausencias = [null, undefined, "", "   ", 0, false, NaN];

  test.each(ausencias)("%p cai em `nao_consultada`", (bruto) => {
    expect(situacaoNaTela(bruto).status).toBe(SITUACAO.NAO_CONSULTADA);
    expect(ehRegular(bruto)).toBe(false);
  });

  it("⚠ estado DESCONHECIDO do backend também cai lá — a falha FECHA, não abre", () => {
    // Um estado novo que ninguém mapeou aqui vira "não consultada": menos informação, nunca
    // informação errada.
    expect(situacaoNaTela("SUSPENSA_POR_DECISAO_JUDICIAL").status).toBe(SITUACAO.NAO_CONSULTADA);
    expect(ehRegular("QUALQUER_COISA")).toBe(false);
  });

  it("⚠ e o rótulo NÃO afirma nada sobre o fisco", () => {
    const { rotulo } = situacaoNaTela(null);
    expect(rotulo).toBe("Não consultada");
    expect(rotulo).not.toMatch(/em dia|regular|sem pend/i);
  });
});

describe("os quatro estados que o servidor manda", () => {
  it("REGULAR", () => {
    expect(situacaoNaTela("REGULAR")).toEqual({ status: SITUACAO.REGULAR, rotulo: "Sem pendências" });
    expect(ehRegular("REGULAR")).toBe(true);
  });
  it("COM_PENDENCIA", () => {
    expect(situacaoNaTela("COM_PENDENCIA").status).toBe(SITUACAO.COM_PENDENCIA);
  });
  it("EM_PARCELAMENTO", () => {
    expect(situacaoNaTela("EM_PARCELAMENTO").status).toBe(SITUACAO.EM_PARCELAMENTO);
  });
  it("PROCESSANDO", () => {
    expect(situacaoNaTela("PROCESSANDO").status).toBe(SITUACAO.PROCESSANDO);
  });
  it("aceita a grafia com espaço/minúscula — o valor é do banco, não do teclado", () => {
    expect(situacaoNaTela(" com_pendencia ").status).toBe(SITUACAO.COM_PENDENCIA);
  });
});

describe("parseValorBR — nunca fabrica zero", () => {
  it("lê o formato do relatório", () => {
    expect(parseValorBR("15.510,72")).toBe(15510.72);
    expect(parseValorBR("0,00")).toBe(0);
  });
  it("⚠ o que não é número reconhecível é `null`, jamais 0", () => {
    for (const v of ["", "  ", "—", "DEVEDOR", "1500", "1.500", null, undefined]) {
      expect(parseValorBR(v)).toBeNull();
    }
  });
});

describe("⚠⚠ totalDoBloco — uma linha ilegível invalida o total inteiro", () => {
  const colunas = ["Receita", COLUNA_TOTAL];
  const reg = (v) => ({ Receita: "4406-01", [COLUNA_TOTAL]: v });

  it("soma quando TODAS as linhas fecham", () => {
    expect(totalDoBloco(colunas, [reg("100,00"), reg("50,50")])).toBe(150.5);
  });

  it("⚠ uma linha ilegível devolve `null` — total parcial mostraria dívida MENOR que a real", () => {
    expect(totalDoBloco(colunas, [reg("100,00"), reg("ilegível")])).toBeNull();
  });

  it("⚠ com uma linha só não há total — seria o próprio valor repetido abaixo dele", () => {
    expect(totalDoBloco(colunas, [reg("100,00")])).toBeNull();
  });

  it("sem a coluna do saldo consolidado não há total", () => {
    expect(totalDoBloco(["Receita"], [reg("100,00"), reg("50,00")])).toBeNull();
  });

  it("centavos não acumulam erro de float", () => {
    expect(totalDoBloco(colunas, [reg("0,10"), reg("0,20")])).toBe(0.3);
  });
});

describe("⚠ o quarto estado: bloco que não virou tabela", () => {
  it("sem colunas e sem registros, mas com descrição", () => {
    expect(naoVirouTabela({ colunas: [], registros: [], descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"] })).toBe(true);
  });
  it("bloco lido não cai nele — a descrição ali é só contexto", () => {
    expect(naoVirouTabela({ colunas: ["Receita"], registros: [{}], descricao: ["x"] })).toBe(false);
  });
  it("bloco vazio de tudo também não — não há o que mostrar cru", () => {
    expect(naoVirouTabela({ colunas: [], registros: [], descricao: [] })).toBe(false);
    expect(naoVirouTabela(null)).toBe(false);
  });
});
