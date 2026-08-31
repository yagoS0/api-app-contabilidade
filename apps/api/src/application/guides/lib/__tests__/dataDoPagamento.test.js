// A DATA EM QUE O DINHEIRO SAIU — regra pura.
//
// ⚠⚠ Relato do dono (30/08/2026): *"ao clicar em confirmar pagamento, o pagamento foi posto no dia
// 30 de agosto mesmo não sendo verdade."* `paymentConfirmedAt` é o dia do PAGAMENTO, e é dele que o
// fluxo tira o mês e o dia da linha — não é o instante do clique.

import {
  RECUSA_DA_DATA, FRASE_DA_RECUSA, lerDataDoPagamentoInformada,
} from "../dataDoPagamento.js";

// ⚠ HOJE injetado: sem isso esta suíte mudaria de resultado conforme o dia em que rodasse.
const HOJE = new Date(Date.UTC(2026, 7, 30, 15, 42));
const ler = (t) => lerDataDoPagamentoInformada(t, { hoje: HOJE });

describe("a data informada", () => {
  it("lê AAAA-MM-DD e devolve a data em UTC", () => {
    const { data, recusa } = ler("2026-08-11");
    expect(recusa).toBeNull();
    expect(data.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("⚠⚠ NÃO desloca o dia — a armadilha do `new Date(string)`", () => {
    // O construtor com string lê a forma só-data como UTC e a com hora como LOCAL. Um deslocamento
    // aqui move o pagamento de dia no fluxo, que é exatamente o defeito que este módulo conserta.
    // ⚠ As três são ANTERIORES a `HOJE` de propósito: uma data futura aqui mediria a recusa de
    // futuro em vez do deslocamento, e o teste passaria a falar de outra coisa.
    for (const dia of ["2025-12-31", "2026-01-01", "2026-08-11"]) {
      expect(ler(dia).data.toISOString().slice(0, 10)).toBe(dia);
    }
  });

  it("⚠⚠ 31 de fevereiro é RECUSADO — `Date.UTC` rolaria para março sem erro nenhum", () => {
    expect(ler("2026-02-31").recusa).toBe(RECUSA_DA_DATA.INVALIDA);
    expect(ler("2026-13-01").recusa).toBe(RECUSA_DA_DATA.INVALIDA);
    expect(ler("2026-04-31").recusa).toBe(RECUSA_DA_DATA.INVALIDA);
    // E o ano bissexto continua passando: 2028 tem 29 de fevereiro.
    expect(ler("2026-02-28").recusa).toBeNull();
  });

  it("⚠⚠ AMANHÃ é recusado — ninguém pagou no futuro", () => {
    expect(ler("2026-08-31").recusa).toBe(RECUSA_DA_DATA.NO_FUTURO);
  });

  it("⚠ HOJE passa, mesmo com o relógio às 15h42", () => {
    // A comparação é por DIA. Comparar instantes recusaria o pagamento feito hoje de manhã — o caso
    // mais comum de todos.
    expect(ler("2026-08-30").recusa).toBeNull();
  });

  it("⚠ NÃO há piso: guia antiga paga há anos é fato legítimo", () => {
    // Inventar um limite inferior recusaria verdade.
    expect(ler("2019-03-07").recusa).toBeNull();
  });

  it("vazio, nulo e lixo têm recusas DIFERENTES — ausência não é erro de forma", () => {
    expect(ler("").recusa).toBe(RECUSA_DA_DATA.AUSENTE);
    expect(ler(null).recusa).toBe(RECUSA_DA_DATA.AUSENTE);
    expect(ler(undefined).recusa).toBe(RECUSA_DA_DATA.AUSENTE);
    expect(ler("   ").recusa).toBe(RECUSA_DA_DATA.AUSENTE);
    expect(ler("11/08/2026").recusa).toBe(RECUSA_DA_DATA.INVALIDA);
    expect(ler("hoje").recusa).toBe(RECUSA_DA_DATA.INVALIDA);
  });

  it("⚠ toda recusa tem frase, e nenhuma frase é igual a outra", () => {
    const frases = Object.values(RECUSA_DA_DATA).map((r) => FRASE_DA_RECUSA[r]);
    expect(frases.every(Boolean)).toBe(true);
    expect(new Set(frases).size).toBe(frases.length);
  });

  it("⚠ recusa NÃO devolve data — nunca as duas coisas", () => {
    for (const t of ["", "2026-02-31", "2026-09-01"]) {
      const r = ler(t);
      expect(r.data).toBeNull();
      expect(r.recusa).not.toBeNull();
    }
  });
});
