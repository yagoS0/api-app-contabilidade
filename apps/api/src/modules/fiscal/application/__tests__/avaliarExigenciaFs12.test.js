import { avaliarExigenciaFs12, determinarPoliticaDeclaratoriaFs12 } from "../../publicFs12.js";

const contexto = (pa, extra = {}) => ({ empresaId: "empresa-sintetica", competenciaApuracao: pa,
  inicioAtividade: "2026-11", regimeDoPeriodo: { empresaId: "empresa-sintetica", tipo: "SIMPLES_NACIONAL", competencia: pa, referencia: "hist:r1" }, ...extra });
const instante = "2026-11-16T12:00:00.000Z";
function evidencia() {
  const conteudo = { empresaId: "empresa-sintetica", competenciaApuracao: "2026-11", competenciaFolha: "2026-11",
    valorCentavos: 0, origem: { tipo: "DECLARACAO_MANUAL", referencia: "folha:r1", revisao: "r1" }, obtidoEm: instante };
  return { ...conteudo, revisaoAtual: "r1", conferencia: { situacao: "CONFERIDA", autor: "contador-sintetico",
    em: instante, conteudo: JSON.parse(JSON.stringify(conteudo)) } };
}

describe("Contrato público e coordenação local FS12 (sem integração externa)", () => {
  test("primeiro PA usa somente próprio mês; zero conferido não autoriza ato fiscal", () => {
    const entrada = { contexto: contexto("2026-11"), evidencias: [evidencia()], avaliadoEm: instante };
    const antes = JSON.stringify(entrada);
    expect(avaliarExigenciaFs12(entrada)).toMatchObject({ evidenciaSuficiente: true, autorizaEfeitoFiscal: false,
      politica: { exigida: true, janela: { competencias: ["2026-11"] } },
      qualidade: { situacao: "COMPLETA_CONFERIDA", totalCentavos: 0 } });
    expect(JSON.stringify(entrada)).toBe(antes);
    expect(avaliarExigenciaFs12(entrada)).toEqual(avaliarExigenciaFs12(entrada));
  });
  test("trocar apuração não promove automaticamente prova do mês anterior", () => {
    const r = avaliarExigenciaFs12({ contexto: contexto("2026-12"), evidencias: [evidencia()], avaliadoEm: instante });
    expect(r.evidenciaSuficiente).toBe(false);
    expect(r.qualidade.impedimentos.map(i => i.codigo)).toContain("APURACAO_DIVERGENTE");
  });
  test("jan/2027 permanece pendente mesmo com dados", () => {
    const r = avaliarExigenciaFs12({ contexto: contexto("2027-01"), evidencias: [evidencia()], avaliadoEm: instante });
    expect(r).toMatchObject({ evidenciaSuficiente: false, autorizaEfeitoFiscal: false,
      politica: { regra: "HOMOLOGACAO_2027_PENDENTE", janela: null }, qualidade: { situacao: "NAO_AVALIADA", totalCentavos: null } });
  });
  test("dispensa histórica não é evidência de folha zero", () => {
    const r = avaliarExigenciaFs12({ contexto: contexto("2026-10", { exigenciaHistorica: false }), evidencias: [] });
    expect(r).toMatchObject({ evidenciaSuficiente: false, politica: { situacao: "NAO_EXIGIDA" },
      qualidade: { situacao: "NAO_AVALIADA", cobertura: null, totalCentavos: null } });
  });
  test("entrada ausente e regime não comprovado são pendências", () => {
    expect(avaliarExigenciaFs12()).toMatchObject({ evidenciaSuficiente: false, autorizaEfeitoFiscal: false });
    expect(determinarPoliticaDeclaratoriaFs12(contexto("2026-11", { regimeDoPeriodo: null })).situacao).toBe("PENDENTE");
  });
});
