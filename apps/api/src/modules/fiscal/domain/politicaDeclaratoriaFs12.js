// Política independente do motor tributário. Nenhum resultado autoriza transporte.
export const VERSAO_POLITICA_FS12 = "PGDAS-2026-B1.v1";
export const FUNDAMENTO_FS12 = Object.freeze({
  documento: "Manual PGDAS-D/DEFIS 2018–2026, versão 13/11/2026",
  secao: "8.2, 8.2.1 e 8.2.2 (páginas 74–77)",
  url: "https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf",
  sha256: "1786a9badcd6676567b8a2ce27c6f11466b3abaf1ea1330a27eef31ec013119f",
});

export function indiceCompetenciaFs12(valor) {
  if (typeof valor !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(valor)) return null;
  return Number(valor.slice(0, 4)) * 12 + Number(valor.slice(5)) - 1;
}
const competenciaDoIndice = n => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;

/**
 * Fatos do período fornecidos por leitura autorizada, nunca pelo regime atual inferido.
 * exigenciaHistorica é a decisão do classificador legado (true/false/null), não uma
 * nova decisão sobre anexo. B1 não substitui nem modifica esse classificador.
 */
export function determinarPoliticaDeclaratoriaFs12(entrada = {}) {
  const { empresaId, competenciaApuracao, inicioAtividade, regimeDoPeriodo,
    exigenciaHistorica } = entrada ?? {};
  const resultado = {
    versao: VERSAO_POLITICA_FS12, empresaId, competenciaApuracao,
    situacao: "PENDENTE", exigida: null, regra: "CONTEXTO_INSUFICIENTE",
    fundamento: { ...FUNDAMENTO_FS12 }, janela: null, impedimentos: [],
    limitacoes: ["Não determina Fator R, anexo, regime CAIXA/COMPETENCIA ou payload SERPRO.",
      "Cobertura local não comprova aceite remoto nem autoriza simulação/transmissão."],
  };
  const pa = indiceCompetenciaFs12(competenciaApuracao);
  if (typeof empresaId !== "string" || !empresaId.trim()) resultado.impedimentos.push("EMPRESA_AUSENTE");
  if (pa === null) resultado.impedimentos.push("COMPETENCIA_INVALIDA");
  if (resultado.impedimentos.length) return resultado;
  if (!regimeDoPeriodo || regimeDoPeriodo.empresaId !== empresaId || regimeDoPeriodo.competencia !== competenciaApuracao
    || typeof regimeDoPeriodo.referencia !== "string" || !regimeDoPeriodo.referencia.trim()
    || !["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"].includes(regimeDoPeriodo.tipo)) {
    resultado.impedimentos.push("REGIME_DO_PERIODO_NAO_COMPROVADO");
    return resultado;
  }
  if (regimeDoPeriodo.tipo !== "SIMPLES_NACIONAL") {
    return { ...resultado, situacao: "FORA_DO_ESCOPO", regra: "FORA_DO_PGDAS_D" };
  }
  if (competenciaApuracao >= "2027-01") {
    return { ...resultado, regra: "HOMOLOGACAO_2027_PENDENTE",
      impedimentos: ["POLITICA_PENDENTE_HOMOLOGACAO"],
      limitacoes: [...resultado.limitacoes, "Manual específico de 2027 e contrato técnico ainda não homologados."] };
  }
  if (competenciaApuracao < "2018-01") {
    return { ...resultado, regra: "PERIODO_FORA_DO_MANUAL", impedimentos: ["POLITICA_NAO_DOCUMENTADA"] };
  }
  const historica = competenciaApuracao <= "2026-10";
  resultado.regra = historica ? "HISTORICA_CONDICIONADA_ATIVIDADE" : "FS12_TODAS_ATIVIDADES_2026";
  if (historica && typeof exigenciaHistorica !== "boolean") {
    resultado.impedimentos.push("EXIGENCIA_HISTORICA_DESCONHECIDA");
    return resultado;
  }
  resultado.exigida = historica ? exigenciaHistorica : true;
  if (!resultado.exigida) return { ...resultado, situacao: "NAO_EXIGIDA" };
  const abertura = indiceCompetenciaFs12(inicioAtividade);
  if (abertura === null || abertura > pa) {
    resultado.impedimentos.push("INICIO_ATIVIDADE_INVALIDO_OU_AUSENTE");
    return resultado;
  }
  const idade = pa - abertura;
  const inicio = idade === 0 ? pa : Math.max(abertura, pa - 12);
  const fim = idade === 0 ? pa : pa - 1;
  resultado.janela = {
    fase: idade === 0 ? "PRIMEIRO_PERIODO" : idade < 12 ? "PRIMEIRO_ANO" : "ESTABELECIDA",
    competencias: Array.from({ length: fim - inicio + 1 }, (_, i) => competenciaDoIndice(inicio + i)),
    fundamento: "Manual 8.2.1: PA da abertura; depois abertura até mês anterior, limitado a 12 anteriores.",
  };
  return { ...resultado, situacao: "EXIGIDA" };
}
