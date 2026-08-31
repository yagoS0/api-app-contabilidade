// QUAL GUIA UMA BAIXA QUITA — regra pura.
//
// ⚠⚠ Dono, 30/08/2026: *"apareceram impostos que estão pagos na circular e lançados em lançamentos
// como aberto."* Medido antes do conserto: **20 provisões de DAS com `PAGO` e baixa lançada** cuja
// guia continuava `OPEN` — duas delas já liberadas ao cliente, que via cobrança do que já pagou.

import { SEM_QUITACAO, guiaQuitadaPelaBaixa } from "../guiaQuitadaPelaBaixa.js";

const provisaoDas = (extra = {}) => ({
  id: "e1",
  portalClientId: "pc-1",
  competencia: "2026-06",
  eventType: "DAS_SIMPLES",
  subtipo: "DAS",
  sourceGuideId: null,
  ...extra,
});

describe("a baixa quita a guia", () => {
  it("⚠⚠ pela COMPETÊNCIA — a mesma chave que a Circular já usa para juntar as duas", () => {
    // A provisão do DAS nasce do extrato do PGDAS-D, não da guia: ela NÃO tem `sourceGuideId`.
    const { alvo, motivo } = guiaQuitadaPelaBaixa({ provisao: provisaoDas(), novoStatus: "PAGO" });
    expect(motivo).toBeNull();
    expect(alvo).toEqual({ portalClientId: "pc-1", competencia: "2026-06", tipo: "SIMPLES", parcelamentoId: null });
  });

  it("⚠⚠ PARCELA DE PARCELAMENTO fica de fora — ela é `tipo: SIMPLES`, idêntica ao DAS", () => {
    // Só `parcelamentoId` separa as duas. Sem esta trava, a baixa do DAS do mês quitaria a parcela
    // daquele mês — dívida antiga, de outro acordo.
    expect(guiaQuitadaPelaBaixa({ provisao: provisaoDas(), novoStatus: "PAGO" }).alvo.parcelamentoId).toBeNull();
  });

  it("⚠ o vínculo EXPLÍCITO vence a competência", () => {
    const { alvo } = guiaQuitadaPelaBaixa({
      provisao: provisaoDas({ sourceGuideId: "g-9" }), novoStatus: "PAGO",
    });
    expect(alvo).toEqual({ guideId: "g-9" });
  });

  it("⚠⚠ baixa PARCIAL não quita nada — meio pago não é pago", () => {
    const r = guiaQuitadaPelaBaixa({ provisao: provisaoDas(), novoStatus: "PARCIAL" });
    expect(r.alvo).toBeNull();
    expect(r.motivo).toBe(SEM_QUITACAO.BAIXA_PARCIAL);
    // ⚠ E vale para o vínculo explícito também: parcial é parcial dos dois jeitos.
    expect(guiaQuitadaPelaBaixa({ provisao: provisaoDas({ sourceGuideId: "g-9" }), novoStatus: "PARCIAL" }).alvo)
      .toBeNull();
  });

  it("⚠ provisão de outro tributo, sem vínculo, NÃO adivinha guia", () => {
    // Os DARFs do LP já nascem com `sourceGuideId` e entram pelo vínculo. Inferir por competência
    // fora do DAS marcaria a guia errada como paga.
    for (const p of [
      provisaoDas({ eventType: "DARF_IRPJ", subtipo: "IRPJ" }),
      provisaoDas({ eventType: null, subtipo: "INSS" }),
      provisaoDas({ eventType: null, subtipo: null }),
    ]) {
      const r = guiaQuitadaPelaBaixa({ provisao: p, novoStatus: "PAGO" });
      expect(r.alvo).toBeNull();
      expect(r.motivo).toBe(SEM_QUITACAO.TIPO_SEM_GUIA);
    }
  });

  it("⚠ sem competência legível não há chave — adivinhar por data marcaria o mês errado", () => {
    for (const c of ["", null, undefined, "2026", "06/2026", "2026-6"]) {
      const r = guiaQuitadaPelaBaixa({ provisao: provisaoDas({ competencia: c }), novoStatus: "PAGO" });
      expect(r.alvo).toBeNull();
      expect(r.motivo).toBe(SEM_QUITACAO.SEM_COMPETENCIA);
    }
  });

  it("⚠ status desconhecido NÃO quita — falha fechado", () => {
    for (const s of ["ABERTO", "NA", "", null, undefined, "pago"]) {
      // ⚠ "pago" minúsculo PASSA de propósito: a comparação normaliza. O que não passa é o resto.
      const r = guiaQuitadaPelaBaixa({ provisao: provisaoDas(), novoStatus: s });
      if (String(s).toUpperCase() === "PAGO") expect(r.alvo).not.toBeNull();
      else expect(r.alvo).toBeNull();
    }
  });
});

// ⚠⚠ A BAIXA CORRIGE A DATA QUE O CLIENTE INFORMOU — mas nunca a prova (30/08/2026)
//
// Caso relatado pelo dono: *"um pagamento de 1.876,46 que não faz sentido na Erisangela"*. Era a
// soma de DUAS guias que o cliente confirmou no mesmo dia (30/08), ambas carimbadas com a data do
// CLIQUE: R$ 1.552,63 + R$ 323,83. Uma delas está provada no razão em 13/06/2026 — três
// lançamentos contra o caixa que somam exatamente o valor da guia.
describe("⚠⚠ quem pode receber a data da baixa", () => {
  const { baixaPodeDatarAGuia } = require("../guiaQuitadaPelaBaixa.js");

  it("guia NÃO paga: sim", () => {
    expect(baixaPodeDatarAGuia({ paymentStatus: "OPEN" })).toBe(true);
    expect(baixaPodeDatarAGuia({ paymentStatus: "OVERDUE" })).toBe(true);
    expect(baixaPodeDatarAGuia({})).toBe(true);
  });

  it("⚠⚠ paga pelo CLIENTE: SIM — o clique não é prova, o lançamento do contador é", () => {
    expect(baixaPodeDatarAGuia({ paymentStatus: "PAID", paymentStatusSource: "CLIENTE" })).toBe(true);
  });

  it("⚠⚠ paga por SERPRO ou MANUAL: NÃO — sobrescrever seria apagar evidência melhor", () => {
    expect(baixaPodeDatarAGuia({ paymentStatus: "PAID", paymentStatusSource: "SERPRO" })).toBe(false);
    expect(baixaPodeDatarAGuia({ paymentStatus: "PAID", paymentStatusSource: "MANUAL" })).toBe(false);
  });

  it("⚠ procedência AUSENTE conta como já respondida — guia paga antes de a coluna existir", () => {
    // Tratá-la como "cliente" mexeria em contabilidade fechada por causa de um campo em branco.
    for (const v of [null, undefined, "", "   ", "OUTRA_COISA"]) {
      expect(baixaPodeDatarAGuia({ paymentStatus: "PAID", paymentStatusSource: v })).toBe(false);
    }
  });
});
