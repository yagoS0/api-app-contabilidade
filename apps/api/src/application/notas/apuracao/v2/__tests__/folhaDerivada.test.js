// A janela da conferência de folha é pura — dá para travar sem banco, e ela já saiu errada uma vez.
//
// O defeito: a função devolvia os 12 meses terminando NA competência, um mês à frente da grade do
// FechamentoModal (`pasAnteriores`). Efeito visível para o contador: o mês do próprio período de
// apuração entrava no total e na contagem sem ter célula na tela ("há folha lançada em 3 dos 12
// meses" com só 2 rótulos), e o mês mais antigo da grade nunca era conferido.
import { competenciasDe12Meses } from "../FolhaDerivadaService.js";

// Réplica do `pasAnteriores` do FechamentoModal — se as duas divergirem de novo, o teste quebra.
function pasAnterioresDoModal(competencia, n = 12) {
  const [y, m] = String(competencia).split("-").map(Number);
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

describe("competenciasDe12Meses", () => {
  test("devolve os 12 meses ANTERIORES, sem incluir a competência", () => {
    const janela = competenciasDe12Meses("2026-07");
    expect(janela).toHaveLength(12);
    expect(janela[0]).toBe("2025-07");
    expect(janela[11]).toBe("2026-06");
    expect(janela).not.toContain("2026-07");
  });

  test("é exatamente a mesma janela que a grade do modal desenha", () => {
    for (const comp of ["2026-07", "2026-01", "2025-12", "2024-03"]) {
      expect(competenciasDe12Meses(comp)).toEqual(pasAnterioresDoModal(comp));
    }
  });

  test("atravessa a virada do ano sem escorregar", () => {
    const janela = competenciasDe12Meses("2026-01");
    expect(janela[0]).toBe("2025-01");
    expect(janela[11]).toBe("2025-12");
  });

  test("competência inválida devolve lista vazia (não uma janela chutada)", () => {
    expect(competenciasDe12Meses("")).toEqual([]);
    expect(competenciasDe12Meses("2026")).toEqual([]);
    expect(competenciasDe12Meses(null)).toEqual([]);
  });
});
