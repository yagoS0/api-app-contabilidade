// Q21 (spec v2) — testes dos invariantes + contrato (puros, sem DB).
import { normalizeTributoDTO, normalizeParcelaDTO } from "../contracts.js";
import { validarParcela, reconciliarParcelamento } from "../invariantes.js";

describe("contracts — DTO", () => {
  test("juros é LIDO (mantido), nunca derivado; total deriva quando ausente", () => {
    const t = normalizeTributoDTO({ codigoTributo: "1001", principal: 300, multa: 60, juros: 8.5 });
    expect(t.juros).toBe(8.5);
    expect(t.total).toBe(368.5); // derivado de p+m+j
  });
  test("total informado é preservado (pra invariante confrontar)", () => {
    const t = normalizeTributoDTO({ codigoTributo: "1001", principal: 300, multa: 60, juros: 8.5, total: 999 });
    expect(t.total).toBe(999);
  });
});

describe("validarParcela — Nível 1 (rejeita)", () => {
  const ok = normalizeParcelaDTO({
    numeroParcela: 2, anoMesParcela: "202602", valorTotal: 368.5,
    tributos: [{ codigoTributo: "1001", principal: 300, multa: 60, juros: 8.5, total: 368.5 }],
  });

  test("parcela consistente passa", () => {
    expect(validarParcela(ok).ok).toBe(true);
  });

  test("CT13 — soma por tributo inválida rejeita", () => {
    const bad = normalizeParcelaDTO({
      numeroParcela: 1, valorTotal: 400,
      tributos: [{ codigoTributo: "1001", principal: 300, multa: 60, juros: 8.5, total: 400 }],
    });
    const r = validarParcela(bad);
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toMatch(/principal\+multa\+juros/);
  });

  test("CT16 — componente negativo rejeita", () => {
    const neg = normalizeParcelaDTO({
      numeroParcela: 1, valorTotal: 360,
      tributos: [{ codigoTributo: "1001", principal: 300, multa: 60, juros: -0.01, total: 359.99 }],
    });
    expect(validarParcela(neg).ok).toBe(false);
  });

  test("Σ tributos != valorTotal da parcela rejeita", () => {
    const m = normalizeParcelaDTO({
      numeroParcela: 1, valorTotal: 999,
      tributos: [{ codigoTributo: "1001", principal: 300, multa: 60, juros: 0, total: 360 }],
    });
    expect(validarParcela(m).ok).toBe(false);
  });
});

describe("reconciliarParcelamento — Nível 2 + juros", () => {
  const parcelamento = { valorPrincipal: 1200, valorMulta: 240, valorJuros: 60 };
  // 4 parcelas: principal 300, multa 60, juros 0/8,5/12,3/15,1
  const jurosArr = [0, 8.5, 12.3, 15.1];
  const parcelas = jurosArr.map((j, i) => normalizeParcelaDTO({
    numeroParcela: i + 1, anoMesParcela: `20260${i + 1}`, valorTotal: 360 + j,
    tributos: [{ codigoTributo: "1001", principal: 300, multa: 60, juros: j, total: 360 + j }],
  }));

  test("conjunto coerente: ok, sem alertas (juros Σ=35,9 >= 60? não — mas é limite inferior)", () => {
    const r = reconciliarParcelamento(parcelamento, parcelas);
    // Σ principal=1200 ok; Σ multa=240 ok. Σ juros=35,9 < 60 consolidado → erro (limite inferior).
    expect(r.erros.join(" ")).toMatch(/juros/);
  });

  test("CT15 — juros Σ MAIOR que consolidado NÃO falha (só limite inferior)", () => {
    const p2 = { valorPrincipal: 1200, valorMulta: 240, valorJuros: 10 };
    const r = reconciliarParcelamento(p2, parcelas); // Σ juros 35,9 >= 10 → ok
    expect(r.ok).toBe(true);
    expect(r.erros).toHaveLength(0);
  });

  test("CT14 — troca de coluna (multa↔juros) marca revisão (alerta), soma comutativa não pega", () => {
    // multa e juros trocados: multa vira 0/8,5/... e juros vira 60. p+m+j==total ainda fecha.
    const trocadas = jurosArr.map((j, i) => normalizeParcelaDTO({
      numeroParcela: i + 1, valorTotal: 360 + j,
      tributos: [{ codigoTributo: "1001", principal: 300, multa: j, juros: 60, total: 300 + j + 60 }],
    }));
    const pj = { valorPrincipal: 1200, valorMulta: 240, valorJuros: 10 };
    const r = reconciliarParcelamento(pj, trocadas);
    // Nível 1 (soma por tributo) passa em cada; mas Σ multa (35,9) != 240 → alerta de troca.
    expect(r.alertas.join(" ")).toMatch(/multa.*troca de coluna|troca de coluna/i);
  });
});
