import { preencherMensal, editarCampoMensal } from "../preencherMensal";
import { planejarMeses } from "../planejamentoMensal";
const dados = [{ competencia: "2026-01", receita: 100, folha: 25, origem: "notas", tributoApurado: 6 }, { competencia: "2025-01", receita: 90, folha: 20 }];
test("preenche realizado, histórico e plano automaticamente, preservando zero", () => {
  const r = preencherMensal({}, [...dados, { competencia: "2026-02", receita: 0 }], 2026, 1200);
  expect(r.meses[0]).toMatchObject({ plano: 100, realizado: 100, folha: 25, origem: "notas", tributoApurado: 6 });
  expect(r.meses[1].realizado).toBe(0);
  expect(r.historico[0]).toMatchObject({ receita: 90, folha: 20 });
  expect(r.meses[2].realizado).toBeUndefined();
});
test("edição e apagamento intencional vencem atualização automática", () => {
  const r = preencherMensal({}, dados, 2026, 1200);
  r.meses[0] = editarCampoMensal(r.meses[0], "realizado", "");
  r.historico[0] = editarCampoMensal(r.historico[0], "receita", 0);
  const atualizado = preencherMensal(r, dados, 2026, 2400);
  expect(atualizado.meses[0].realizado).toBe(""); expect(atualizado.meses[0].tributoApurado).toBeNull();
  expect(atualizado.historico[0].receita).toBe(0); expect(atualizado.meses[0].plano).toBe(200);
});
test("atualiza apenas valores automáticos; cenário legado permanece preservado", () => {
  expect(preencherMensal({ meses: [{ realizado: 555, folha: 0 }] }, dados, 2026, 1200).meses[0]).toMatchObject({ realizado: 555, folha: 0 });
  const salvo = preencherMensal({}, dados, 2026, 1200);
  const atualizado = preencherMensal(salvo, [{ ...dados[0], receita: 777 }], 2026, 1200);
  expect(atualizado.meses[0].realizado).toBe(777); expect(salvo.meses[0].realizado).toBe(100);
});
test("provisão contábil aparece preenchida mas não vira FS12 sem conferência", () => {
  const r = preencherMensal({}, Array.from({ length: 12 }, (_, i) => ({ competencia: `2025-${String(i + 1).padStart(2, "0")}`, receita: 1000, folhaContabil: 300 })), 2026, 12000);
  expect(r.historico[0]).toMatchObject({ folha: 300, folhaPendenteConferencia: true });
  expect(planejarMeses({ ...r, entradas: { sujeitoAoFatorR: true } }).linhas[0].fatorR).toBeNull();
  r.historico = r.historico.map(m => editarCampoMensal(m, "folha", m.folha));
  expect(planejarMeses({ ...r, entradas: { sujeitoAoFatorR: true } }).linhas[0].fatorR).toBe(0.3);
});
test("mês em andamento não reduz a projeção ao realizado parcial nem gera desvio fechado", () => {
  const r = preencherMensal({}, [{ competencia: "2026-09", receita: 30, mesParcial: true }], 2026, 1200);
  const m = planejarMeses(r);
  expect(m.linhas[8]).toMatchObject({ realizado: 30, plano: 100, receita: 100, desvio: null });
  expect(m.totalProjetado).toBe(1200); expect(m.mesesComparados).toBe(0);
});
