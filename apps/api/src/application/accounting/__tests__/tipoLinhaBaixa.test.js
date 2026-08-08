// O PADRÃO DOS CAMINHOS GENÉRICOS DE BAIXA.
//
// ⚠ Existe um CHECK no banco (`chk_baixa_tipo_linha`): `tipo = 'BAIXA'` sem `tipoLinha` é recusado.
// Os caminhos que SABEM o papel (INSS, parcelamento, rota de baixa) passam o papel e têm teste
// próprio. Os genéricos — lançamento digitado à mão, importação de OFX/Excel, função de lançamento,
// template de parcelamento V1 — não têm papel nenhum a declarar, e é este helper que decide o que
// eles gravam. Sem ele, cada um escolheria um default seu e o CHECK viraria um sorteio.

import { tipoLinhaDaBaixa, TIPO_LINHA_BAIXA_PADRAO } from "../tipoLinhaBaixa.js";

describe("tipoLinhaDaBaixa", () => {
  it("⚠ nenhuma baixa sai com papel nulo — é o que o CHECK do banco recusa", () => {
    expect(tipoLinhaDaBaixa("BAIXA")).toBe(TIPO_LINHA_BAIXA_PADRAO);
    expect(tipoLinhaDaBaixa("BAIXA", null)).toBeTruthy();
    expect(tipoLinhaDaBaixa("BAIXA", "")).toBeTruthy();
    expect(tipoLinhaDaBaixa("BAIXA", "   ")).toBeTruthy();
  });

  it("o papel conhecido vence o padrão (e chega normalizado)", () => {
    expect(tipoLinhaDaBaixa("BAIXA", "PRINCIPAL")).toBe("PRINCIPAL");
    expect(tipoLinhaDaBaixa("BAIXA", "juros")).toBe("JUROS");
  });

  it("⚠ o padrão é TOTAL, não PRINCIPAL — o lançamento inteiro não afirma amortizar o passivo", () => {
    // Dizer PRINCIPAL afirmaria que aquele lançamento amortiza a provisão e que juros e multa estão
    // em outro lugar. Numa baixa digitada à mão ninguém sabe disso.
    expect(TIPO_LINHA_BAIXA_PADRAO).toBe("TOTAL");
  });

  it("fora da baixa a coluna fica NULL — ela só é cobrada em BAIXA", () => {
    for (const tipo of ["DESPESA", "RECEITA", "FOLHA", "PROVISAO", "PARCELA", "OUTRO", "", null, undefined]) {
      expect(tipoLinhaDaBaixa(tipo)).toBeNull();
    }
    // ⚠ nem mesmo com papel: gravar papel num lançamento que não é baixa faria o índice parcial
    // (que filtra por tipo='BAIXA') passar a enxergar linha que não é da sua conta.
    expect(tipoLinhaDaBaixa("PROVISAO", "PRINCIPAL")).toBeNull();
  });
});
