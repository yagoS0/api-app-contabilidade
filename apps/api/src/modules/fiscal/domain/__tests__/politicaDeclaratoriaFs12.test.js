import { determinarPoliticaDeclaratoriaFs12 as decidir } from "../politicaDeclaratoriaFs12.js";
const contexto = (pa, extra = {}) => ({ empresaId: "empresa-sintetica", competenciaApuracao: pa,
  inicioAtividade: "2020-01", regimeDoPeriodo: { empresaId: "empresa-sintetica", tipo: "SIMPLES_NACIONAL", competencia: pa, referencia: "historico:r1" },
  ...extra });

describe("Política declaratória FS12 pura", () => {
  test.each([
    ["2026-10", true, "EXIGIDA", "2025-10", "2026-09"],
    ["2026-10", false, "NAO_EXIGIDA", undefined, undefined],
    ["2026-11", true, "EXIGIDA", "2025-11", "2026-10"],
    ["2026-11", false, "EXIGIDA", "2025-11", "2026-10"],
    ["2026-12", true, "EXIGIDA", "2025-12", "2026-11"],
    ["2026-12", false, "EXIGIDA", "2025-12", "2026-11"],
    ["2027-01", true, "PENDENTE", undefined, undefined],
    ["2027-01", false, "PENDENTE", undefined, undefined],
  ])("PA %s / atividade histórica %s → %s", (pa, exigenciaHistorica, situacao, inicio, fim) => {
    const r = decidir(contexto(pa, { exigenciaHistorica }));
    expect(r.situacao).toBe(situacao);
    expect(r.janela?.competencias[0]).toBe(inicio);
    expect(r.janela?.competencias.at(-1)).toBe(fim);
    if (inicio) expect(r.janela.competencias).toHaveLength(12);
    expect(r).not.toHaveProperty("anexoDecidido");
    expect(r).not.toHaveProperty("fatorR");
    expect(r.fundamento.sha256).toHaveLength(64);
    expect(r.versao).toBe("PGDAS-2026-B1.v1");
  });
  test("atividade desconhecida não dispensa legado; novembro independe desse fato", () => {
    expect(decidir(contexto("2026-10")).impedimentos).toContain("EXIGENCIA_HISTORICA_DESCONHECIDA");
    expect(decidir(contexto("2026-11")).exigida).toBe(true);
  });
  test("sem movimento não comprova folha zero nem dispensa novembro", () => {
    expect(decidir(contexto("2026-11", { semMovimento: true, receita: 0 })).situacao).toBe("EXIGIDA");
  });
  test.each([
    ["2026-11", "PRIMEIRO_PERIODO", ["2026-11"]],
    ["2026-10", "PRIMEIRO_ANO", ["2026-10"]],
    ["2026-09", "PRIMEIRO_ANO", ["2026-09", "2026-10"]],
  ])("abertura %s: %s", (inicioAtividade, fase, competencias) => {
    expect(decidir(contexto("2026-11", { inicioAtividade })).janela).toMatchObject({ fase, competencias });
  });
  test("limites 12º e 13º períodos; não gera mês anterior à abertura", () => {
    const a = decidir(contexto("2026-11", { inicioAtividade: "2025-12" })).janela;
    expect(a.fase).toBe("PRIMEIRO_ANO"); expect(a.competencias).toHaveLength(11);
    const b = decidir(contexto("2026-11", { inicioAtividade: "2025-11" })).janela;
    expect(b.fase).toBe("ESTABELECIDA"); expect(b.competencias).toHaveLength(12);
    expect(b.competencias[0]).toBe("2025-11");
  });
  test.each([null, "2026-12", "2026-00", "2026-13", "2026-11-01"])("abertura inválida %p", inicioAtividade => {
    expect(decidir(contexto("2026-11", { inicioAtividade }))).toMatchObject({ situacao: "PENDENTE", janela: null, exigida: true });
  });
  test.each([undefined, "202611", "2026-1", "2026-13", 202611])("PA inválido %p", pa => {
    expect(decidir(contexto(pa)).impedimentos).toContain("COMPETENCIA_INVALIDA");
  });
  test("regime precisa da identidade do período e referência; outros regimes não são dispensas FS12", () => {
    for (const regimeDoPeriodo of [null, { tipo: "SIMPLES_NACIONAL", competencia: "2026-10", referencia: "r1" },
      { tipo: "SIMPLES_NACIONAL", competencia: "2026-11" }]) {
      expect(decidir(contexto("2026-11", { regimeDoPeriodo })).situacao).toBe("PENDENTE");
    }
    expect(decidir(contexto("2026-11", { regimeDoPeriodo: { empresaId: "empresa-sintetica", tipo: "LUCRO_REAL", competencia: "2026-11", referencia: "r1" } })))
      .toMatchObject({ situacao: "FORA_DO_ESCOPO", exigida: null });
  });
  test("2027 não fabrica janela; retorno e entrada não compartilham mutação", () => {
    const entrada = contexto("2027-01"); const antes = JSON.stringify(entrada);
    const r = decidir(entrada);
    expect(r).toMatchObject({ regra: "HOMOLOGACAO_2027_PENDENTE", janela: null, exigida: null });
    r.fundamento.sha256 = "alterado";
    expect(decidir(entrada).fundamento.sha256).not.toBe("alterado");
    expect(JSON.stringify(entrada)).toBe(antes);
  });
});

test.each([undefined, "outra-empresa"])("regime sem identidade da mesma empresa fica pendente: %s", empresaId => {
  const entrada = contexto("2026-11");
  entrada.regimeDoPeriodo.empresaId = empresaId;
  expect(decidir(entrada)).toMatchObject({ situacao: "PENDENTE", janela: null,
    impedimentos: ["REGIME_DO_PERIODO_NAO_COMPROVADO"] });
});
test("período anterior ao manual não aplica dispensa histórica", () => {
  expect(decidir(contexto("2017-12", { exigenciaHistorica: false })))
    .toMatchObject({ situacao: "PENDENTE", regra: "PERIODO_FORA_DO_MANUAL", exigida: null });
});
