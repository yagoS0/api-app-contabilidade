import { historicoMensalDosSnapshots } from "../lib/historicoMensal.js";
it("preserva zero declarado e não confunde simulação com transmissão", () => {
  const r = historicoMensalDosSnapshots([{ competencia: "2026-01", estado: "calculada", receitaInterna: 0, receitaExterna: 0, dasSimuladoSerpro: 1500, dasRetornadoSerpro: 1600, folhaMensal12: { "202512": 2300 } }]);
  expect(r[0]).toMatchObject({ competencia: "2025-12", folha: 2300, receita: null });
  expect(r[1]).toMatchObject({ receita: 0, tributoApurado: null });
});
it("respeita procedência do DAS e soma receitas segregadas", () => {
  const r = historicoMensalDosSnapshots([
    { competencia: "2026-01", estado: "transmitida", receitaPorTipo: { A: 1000, B: 2000 }, dasRetornadoSerpro: 300 },
    { competencia: "2026-02", estado: "calculada", receitaPorTipo: {}, dasCalculadoLocal: 500, dasCalculadoLocalProcedencia: "AMBIGUO" },
  ]);
  expect(r[0]).toMatchObject({ receita: 3000, tributoApurado: 300, origemTributo: "transmitido" });
  expect(r[1]).toMatchObject({ receita: null, tributoApurado: null });
});
