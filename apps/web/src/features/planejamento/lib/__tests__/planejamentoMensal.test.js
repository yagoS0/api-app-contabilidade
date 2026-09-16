import { planejarMeses, distribuirReceitaAnual } from "../planejamentoMensal";
const historico = Array.from({ length: 12 }, () => ({ receita: 100000, folha: 27000 }));
const meses = Array.from({ length: 12 }, () => ({ plano: 100000, folha: 30000 }));
const entradas = { sujeitoAoFatorR: true, atividadePresumido: "servicos", aliquotaIss: 0.05 };
it("distribui centavos sem criar frações monetárias nem alterar o total", () => {
  const valores = distribuirReceitaAnual(1850000.37);
  expect(valores.reduce((a, v) => a + Math.round(v * 100), 0)).toBe(185000037);
  expect(valores[0]).toBe(154166.70); expect(valores[11]).toBe(154166.69);
});
it("janela móvel usa meses anteriores; aumento não muda o fator do próprio mês", () => {
  const r = planejarMeses({ historico, meses, entradas });
  expect(r.linhas[0].fs12).toBe(324000);
  expect(r.linhas[3].fs12).toBe(333000);
  expect(r.linhas[3].anexo).toBe("V");
  expect(r.linhas[4].fs12).toBe(336000);
  expect(r.linhas[4].anexo).toBe("III");
  expect(r.linhas[4].dasEstimado).toBeCloseTo(13030, 2);
});
it("realizado zero substitui plano e desvio só compara meses conhecidos", () => {
  const r = planejarMeses({ historico, meses: [{ plano: 100000, realizado: 0 }, ...meses.slice(1)], entradas });
  expect(r.totalProjetado).toBe(1100000);
  expect(r.desvio).toBe(-100000); expect(r.mesesComparados).toBe(1);
  expect(r.linhas[1].rbt12).toBe(1100000);
});
it("histórico ausente não vira zero; projeção incompleta não vira total anual", () => {
  const r = planejarMeses({ meses: [{ plano: 100000 }], entradas });
  expect(r.totalProjetado).toBeNull(); expect(r.linhas[0].rbt12).toBeNull(); expect(r.dasEstimado).toBeNull();
  expect(r.linhas[0].pendencia).toMatch(/Falta receita/);
});
it("adicional trimestral preserva sazonalidade, sem compensar trimestre fraco", () => {
  const r = planejarMeses({ historico, meses: Array.from({ length: 12 }, (_, i) => ({ plano: i < 3 ? 200000 : 0 })), entradas });
  expect(r.trimestral[0].baseIrpj).toBe(192000);
  expect(r.trimestral.reduce((a, t) => a + t.adicionalIrpj, 0)).toBe(13200);
});
it("não extrapola a projeção de 2026 para empresa nova ou outro ano", () => {
  for (const extra of [{ ano: 2027 }, { entradas: { ...entradas, mesesDeAtividade: 2 } }]) {
    expect(planejarMeses({ historico, meses, entradas, ...extra }).dasEstimado).toBeNull();
  }
});
