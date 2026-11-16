import { avaliarEvidenciaMensalFs12 as avaliar } from "../evidenciaMensalFs12.js";
import { determinarPoliticaDeclaratoriaFs12 } from "../politicaDeclaratoriaFs12.js";
const contexto = { empresaId: "empresa-sintetica", competenciaApuracao: "2026-11", inicioAtividade: "2026-09",
  regimeDoPeriodo: { empresaId: "empresa-sintetica", tipo: "SIMPLES_NACIONAL", competencia: "2026-11", referencia: "regime:r1" } };
const agora = "2026-11-16T12:00:00.000Z";
function evidencia(comp, valorCentavos = 0) {
  const conteudo = { empresaId: contexto.empresaId, competenciaApuracao: "2026-11", competenciaFolha: comp,
    valorCentavos, origem: { tipo: "DECLARACAO_MANUAL", referencia: `folha:${comp}`, revisao: "r1" },
    obtidoEm: "2026-11-15T10:00:00.000Z" };
  return { ...conteudo, revisaoAtual: "r1", conferencia: { situacao: "CONFERIDA", autor: "contador-sintetico",
    em: agora, conteudo: JSON.parse(JSON.stringify(conteudo)) } };
}
const serie = () => [evidencia("2026-09"), evidencia("2026-10")];
const executar = evidencias => avaliar({ contexto, evidencias, avaliadoEm: agora });
const codigos = r => r.impedimentos.map(i => i.codigo);

describe("Contrato mensal FS12", () => {
  test("zero comprovado é distinto de ausência; total somente com cobertura conferida", () => {
    expect(executar(serie())).toMatchObject({ situacao: "COMPLETA_CONFERIDA", totalCentavos: 0,
      cobertura: { esperadas: ["2026-09", "2026-10"], conferidas: ["2026-09", "2026-10"], ausentes: [] } });
    expect(executar([])).toMatchObject({ situacao: "PENDENTE", totalCentavos: null,
      cobertura: { ausentes: ["2026-09", "2026-10"] } });
  });
  test.each([undefined, null, { fs12: 12000 }, 12000])("não divide agregado ou aceita série inválida %p", entrada => {
    expect(codigos(executar(entrada))).toContain("SERIE_MENSAL_AUSENTE_OU_INVALIDA");
    expect(executar(entrada).totalCentavos).toBeNull();
  });
  test.each([null, undefined, "", "0", false, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("valor inválido %p", valor => {
    const e = serie(); e[0].valorCentavos = valor;
    expect(codigos(executar(e))).toContain("VALOR_MENSAL_INVALIDO_OU_AUSENTE");
    expect(executar(e).totalCentavos).toBeNull();
  });
  test("série parcial identifica mês faltante, não totaliza parcialmente", () => {
    expect(executar([evidencia("2026-09", 100)])).toMatchObject({ totalCentavos: null,
      cobertura: { ausentes: ["2026-10"], conferidas: ["2026-09"] } });
  });
  test("duplicata idêntica ou retificada exige conciliação, não escolhe a última", () => {
    const e = [...serie(), evidencia("2026-09", 100)];
    expect(codigos(executar(e))).toContain("COMPETENCIA_DUPLICADA");
    expect(executar(e).cobertura.conferidas).toEqual(["2026-10"]);
  });
  test.each(["2026-08", "2026-11", "2026-12", "invalida"])("fora da janela %s não é podado silenciosamente", comp => {
    expect(codigos(executar([...serie(), evidencia(comp)]))).toContain("COMPETENCIA_FORA_DA_JANELA");
  });
  test.each([
    ["empresaId", "outra-empresa", "EMPRESA_DIVERGENTE"],
    ["competenciaApuracao", "2026-10", "APURACAO_DIVERGENTE"],
    ["origem", null, "ORIGEM_NAO_COMPROVADA"],
    ["revisaoAtual", null, "REVISAO_NAO_COMPROVADA"],
    ["revisaoAtual", "r2", "FONTE_RETIFICADA"],
    ["conferencia", null, "CONFERENCIA_PENDENTE"],
    ["obtidoEm", "2026-02-30T12:00:00.000Z", "DATA_OBTENCAO_INVALIDA"],
    ["obtidoEm", "2026-11-17T12:00:00.000Z", "DATA_OBTENCAO_INVALIDA"],
  ])("%s divergente/ausente", (campo, valor, codigo) => {
    const e = serie(); e[0][campo] = valor;
    expect(codigos(executar(e))).toContain(codigo);
    expect(executar(e).situacao).toBe("PENDENTE");
  });
  test("valor/origem/revisão alterados invalidam conteúdo conferido", () => {
    for (const mudar of [e => { e.valorCentavos = 1; }, e => { e.origem.referencia = "outra"; },
      e => { e.origem.revisao = "r2"; e.revisaoAtual = "r2"; }]) {
      const e = serie(); mudar(e[0]);
      expect(codigos(executar(e))).toContain("CONTEUDO_NAO_CONFERIDO");
    }
  });
  test("nova conferência explícita pode aceitar fonte retificada sem alterar histórico", () => {
    const anterior = serie(); const nova = JSON.parse(JSON.stringify(anterior));
    nova[0].valorCentavos = 500; nova[0].origem.revisao = "r2"; nova[0].revisaoAtual = "r2";
    nova[0].conferencia.conteudo.valorCentavos = 500; nova[0].conferencia.conteudo.origem.revisao = "r2";
    expect(executar(nova).totalCentavos).toBe(500);
    expect(anterior[0].valorCentavos).toBe(0);
  });
  test("janela estabelecida exige os 12 meses, preserva centavos e ordem canônica", () => {
    const ctx = { ...contexto, inicioAtividade: "2020-01" };
    const meses = determinarPoliticaDeclaratoriaFs12(ctx).janela.competencias;
    const e = meses.map(m => evidencia(m, 101)).reverse(); const antes = JSON.stringify(e);
    const r = avaliar({ contexto: ctx, evidencias: e, avaliadoEm: agora });
    expect(r.totalCentavos).toBe(1212); expect(r.cobertura.conferidas).toEqual(meses);
    expect(JSON.stringify(e)).toBe(antes);
  });
  test("overflow não devolve soma arredondada", () => {
    expect(codigos(executar([evidencia("2026-09", Number.MAX_SAFE_INTEGER), evidencia("2026-10", 1)])))
      .toContain("TOTAL_FORA_DA_PRECISAO_SEGURA");
  });
  test("sem instante explícito e com item malformado não há sucesso", () => {
    expect(codigos(avaliar({ contexto, evidencias: serie() }))).toContain("INSTANTE_AVALIACAO_INVALIDO");
    expect(codigos(executar([...serie(), null]))).toContain("EVIDENCIA_INVALIDA");
  });
});

describe("Integridade adicional do contrato mensal", () => {
  test("origem desconhecida não é promovida a prova", () => {
    const e = serie(); e[0].origem.tipo = "DESCONHECIDA";
    e[0].conferencia.conteudo.origem.tipo = "DESCONHECIDA";
    expect(codigos(executar(e))).toContain("ORIGEM_NAO_COMPROVADA");
  });
  test("slot vazio não é ignorado em série com cobertura aparente completa", () => {
    const e = serie(); e.length = 3;
    expect(codigos(executar(e))).toContain("EVIDENCIA_INVALIDA");
  });
  test.each(["2026-11-14T12:00:00.000Z", "2026-11-17T12:00:00.000Z", "2026-02-30T12:00:00.000Z"])(
    "conferência com instante incompatível %s", em => {
      const e = serie(); e[0].conferencia.em = em;
      expect(codigos(executar(e))).toContain("DATA_CONFERENCIA_INVALIDA");
    });
});
