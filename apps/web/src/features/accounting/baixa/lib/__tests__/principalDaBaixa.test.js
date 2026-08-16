// A ANTECIPAÇÃO DA RECUSA `baixa_excede_saldo` — o espelho da conta do servidor.
//
// ⚠ O CASO QUE ORIGINOU TUDO (produção, medido em 2026-08-16): LENTE - MEDICAL MARKETING, DAS de
// 2026-06. Provisão de R$ 14.115,30; comprovante do SERPRO com `principal: 15.033,58`, `juros: 0`,
// `multa: 0` (guia RECALCULADA — pagamento em 14/07 com R$ 918,28 de acréscimo que o comprovante
// não quebra). O modal montava `D 15.033,58 / C 15.033,58`: BALANCEADO, botão habilitado, e o
// servidor recusando com 400.
//
// O que este arquivo trava é que a tela some do MESMO jeito que o servidor — por CONTA, não por
// papel — e que a ausência de `saldoInfo` não vire recusa.
import {
  CONTA_JUROS,
  CONTA_MULTA,
  RECUSA_EXCEDE_SALDO,
  principalDaBaixa,
  conferirPrincipalContraSaldo,
} from "../principalDaBaixa.js";

describe("principalDaBaixa", () => {
  it("soma só os DÉBITOS que não são acréscimo", () => {
    const lines = [
      { tipo: "D", conta: "265", valor: "1543.49", papel: "PRINCIPAL" },
      { tipo: "D", conta: CONTA_JUROS, valor: "81.50", papel: "JUROS" },
      { tipo: "D", conta: CONTA_MULTA, valor: "15.43", papel: "MULTA" },
      { tipo: "C", conta: "111", valor: "1640.42", papel: "CAIXA" },
    ];
    expect(principalDaBaixa(lines)).toBe(1543.49);
  });

  it("lê vírgula decimal como o servidor lê", () => {
    expect(principalDaBaixa([{ tipo: "D", conta: "265", valor: "1543,49" }])).toBe(1543.49);
  });

  it("valor vazio ou ilegível conta como zero, nunca NaN", () => {
    expect(principalDaBaixa([{ tipo: "D", conta: "265", valor: "" }, { tipo: "D", conta: "265", valor: "abc" }])).toBe(0);
  });

  it("linha sem nada não quebra", () => {
    expect(principalDaBaixa(null)).toBe(0);
    expect(principalDaBaixa([{}])).toBe(0);
  });
});

describe("conferirPrincipalContraSaldo", () => {
  // ⚠ O caso LENTE, com os números reais de produção.
  it("RECUSA quando o comprovante traz principal maior que o saldo (LENTE 2026-06)", () => {
    const lines = [
      { tipo: "D", conta: "265", valor: "15033.58", papel: "PRINCIPAL" },
      { tipo: "C", conta: "111", valor: "15033.58", papel: "CAIXA" },
    ];
    const r = conferirPrincipalContraSaldo(lines, { principal: 14115.3, abatido: 0, saldo: 14115.3 });
    expect(r).not.toBeNull();
    expect(r.codigo).toBe(RECUSA_EXCEDE_SALDO);
    expect(r.principal).toBe(15033.58);
    expect(r.saldo).toBe(14115.3);
    expect(r.excedente).toBe(918.28);
    // ⚠ A recusa diz o motivo E a saída — recusa muda é o defeito, não a recusa.
    expect(r.motivo).toContain("15.033,58");
    expect(r.motivo).toContain("14.115,30");
    expect(r.saida).toContain(CONTA_JUROS);
    expect(r.saida).toContain(CONTA_MULTA);
  });

  // ⚠ O caso saudável, também de produção: ELEVARE 2026-06, com o acréscimo QUEBRADO na circular.
  it("PASSA quando o acréscimo está nas contas 501/506 (ELEVARE 2026-06)", () => {
    const lines = [
      { tipo: "D", conta: "265", valor: "1543.49", papel: "PRINCIPAL" },
      { tipo: "D", conta: CONTA_JUROS, valor: "81.50", papel: "JUROS" },
      { tipo: "D", conta: CONTA_MULTA, valor: "15.43", papel: "MULTA" },
      { tipo: "C", conta: "111", valor: "1640.42", papel: "CAIXA" },
    ];
    expect(conferirPrincipalContraSaldo(lines, { principal: 1543.49, abatido: 0, saldo: 1543.49 })).toBeNull();
  });

  it("PASSA na baixa parcial por quota — principal menor que o saldo", () => {
    const lines = [{ tipo: "D", conta: "265", valor: "500.00" }, { tipo: "C", conta: "111", valor: "500.00" }];
    expect(conferirPrincipalContraSaldo(lines, { principal: 1500, abatido: 0, saldo: 1500 })).toBeNull();
  });

  it("tolera o centavo, igual ao servidor", () => {
    const lines = [{ tipo: "D", conta: "265", valor: "1000.01" }];
    expect(conferirPrincipalContraSaldo(lines, { saldo: 1000 })).toBeNull();
    expect(conferirPrincipalContraSaldo([{ tipo: "D", conta: "265", valor: "1000.02" }], { saldo: 1000 })).not.toBeNull();
  });

  // ⚠ AUSÊNCIA NUNCA É RESPOSTA. Sem `saldoInfo` não se sabe qual é o saldo, e recusar por falta de
  // dado travaria baixa legítima — quem decide, aí, é só o servidor.
  it("não afirma nada sem saldoInfo", () => {
    const lines = [{ tipo: "D", conta: "265", valor: "99999.00" }];
    expect(conferirPrincipalContraSaldo(lines, null)).toBeNull();
    expect(conferirPrincipalContraSaldo(lines, undefined)).toBeNull();
    expect(conferirPrincipalContraSaldo(lines, {})).toBeNull();
  });

  // ⚠ O CRITÉRIO É A CONTA, PORQUE O DO SERVIDOR É. Uma tela que somasse por PAPEL diria "cabe"
  // onde o servidor diz "não cabe", e o contador voltaria ao formulário sem entender o que mudou.
  it("conta marcada JUROS fora de 501/506 entra no principal — como no servidor", () => {
    const lines = [
      { tipo: "D", conta: "265", valor: "1000.00", papel: "PRINCIPAL" },
      { tipo: "D", conta: "502", valor: "100.00", papel: "JUROS" },
      { tipo: "C", conta: "111", valor: "1100.00", papel: "CAIXA" },
    ];
    const r = conferirPrincipalContraSaldo(lines, { saldo: 1000 });
    expect(r).not.toBeNull();
    expect(r.principal).toBe(1100);
  });
});
