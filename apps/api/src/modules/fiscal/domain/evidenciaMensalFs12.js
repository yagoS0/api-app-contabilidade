import { determinarPoliticaDeclaratoriaFs12 } from "./politicaDeclaratoriaFs12.js";

const texto = v => typeof v === "string" && v.trim().length > 0;
const objeto = v => v !== null && typeof v === "object" && !Array.isArray(v);
// UTC canônico: rejeita datas impossíveis normalizadas silenciosamente por Date.parse.
function instante(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString() === v ? n : null;
}
function conteudo(e) {
  return [e?.empresaId, e?.competenciaApuracao, e?.competenciaFolha, e?.valorCentavos,
    e?.origem?.tipo, e?.origem?.referencia, e?.origem?.revisao, e?.obtidoEm];
}

/**
 * Contrato v1: valores BRL em centavos inteiros seguros, sem arredondar/coagir.
 * conferencia.conteudo é cópia dos fatos conferidos, vinculada à fonte/revisão.
 * revisaoAtual deve vir de leitura consistente da fonte, independente do snapshot.
 * Valida coerência dos fatos recebidos; não autentica sua procedência ou autoria.
 */
export function avaliarEvidenciaMensalFs12({ contexto, evidencias, avaliadoEm } = {}) {
  const politica = determinarPoliticaDeclaratoriaFs12(contexto);
  const esperadas = politica.janela?.competencias ?? [];
  const impedimentos = [];
  const adicionar = (codigo, competencia = null, indice = null) => impedimentos.push({ codigo, competencia, indice });
  if (politica.situacao !== "EXIGIDA") {
    return { versaoContrato: "FS12-MENSAL.v1", situacao: "NAO_AVALIADA", cobertura: null,
      totalCentavos: null, impedimentos: politica.impedimentos.map(codigo => ({ codigo })) };
  }
  const agora = instante(avaliadoEm);
  if (agora === null) adicionar("INSTANTE_AVALIACAO_INVALIDO");
  if (!Array.isArray(evidencias)) adicionar("SERIE_MENSAL_AUSENTE_OU_INVALIDA");
  const lista = Array.isArray(evidencias) ? Array.from(evidencias) : [];
  const contagens = new Map();
  for (const e of lista) {
    if (objeto(e)) contagens.set(e.competenciaFolha, (contagens.get(e.competenciaFolha) ?? 0) + 1);
  }
  const validas = new Map();
  const presentes = new Set();
  lista.forEach((e, indice) => {
    if (!objeto(e)) { adicionar("EVIDENCIA_INVALIDA", null, indice); return; }
    const comp = e.competenciaFolha;
    const antes = impedimentos.length;
    const falha = codigo => adicionar(codigo, typeof comp === "string" ? comp : null, indice);
    if (!esperadas.includes(comp)) falha("COMPETENCIA_FORA_DA_JANELA");
    if (contagens.get(comp) > 1) falha("COMPETENCIA_DUPLICADA");
    if (e.empresaId !== contexto.empresaId) falha("EMPRESA_DIVERGENTE");
    if (e.competenciaApuracao !== contexto.competenciaApuracao) falha("APURACAO_DIVERGENTE");
    if (esperadas.includes(comp) && e.empresaId === contexto.empresaId
      && e.competenciaApuracao === contexto.competenciaApuracao) presentes.add(comp);
    if (!Number.isSafeInteger(e.valorCentavos) || e.valorCentavos < 0) falha("VALOR_MENSAL_INVALIDO_OU_AUSENTE");
    if (!objeto(e.origem) || !["DECLARACAO_MANUAL", "DOCUMENTO_FOLHA", "DECLARACAO_PGDAS"].includes(e.origem.tipo) || !texto(e.origem.referencia)) falha("ORIGEM_NAO_COMPROVADA");
    if (!texto(e.origem?.revisao) || !texto(e.revisaoAtual)) falha("REVISAO_NAO_COMPROVADA");
    else if (e.origem.revisao !== e.revisaoAtual) falha("FONTE_RETIFICADA");
    const obtido = instante(e.obtidoEm);
    if (obtido === null || (agora !== null && obtido > agora)) falha("DATA_OBTENCAO_INVALIDA");
    const c = e.conferencia;
    if (!objeto(c) || c.situacao !== "CONFERIDA" || !texto(c.autor)) falha("CONFERENCIA_PENDENTE");
    const conferido = instante(c?.em);
    if (conferido === null || (obtido !== null && conferido < obtido)
      || (agora !== null && conferido > agora)) falha("DATA_CONFERENCIA_INVALIDA");
    if (!objeto(c?.conteudo) || !conteudo(e).every((v, i) => v === conteudo(c.conteudo)[i])) {
      falha("CONTEUDO_NAO_CONFERIDO");
    }
    if (impedimentos.length === antes && agora !== null) validas.set(comp, e.valorCentavos);
  });
  const ausentes = esperadas.filter(c => !presentes.has(c));
  for (const comp of ausentes) adicionar("MES_AUSENTE", comp);
  const naoConferidas = esperadas.filter(c => presentes.has(c) && !validas.has(c));
  let total = null;
  if (impedimentos.length === 0 && validas.size === esperadas.length) {
    total = [...validas.values()].reduce((s, v) => s + BigInt(v), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) { adicionar("TOTAL_FORA_DA_PRECISAO_SEGURA"); total = null; }
    else total = Number(total);
  }
  return {
    versaoContrato: "FS12-MENSAL.v1", situacao: impedimentos.length ? "PENDENTE" : "COMPLETA_CONFERIDA",
    cobertura: { esperadas: [...esperadas], presentes: esperadas.filter(c => presentes.has(c)),
      conferidas: esperadas.filter(c => validas.has(c)), ausentes, naoConferidas },
    totalCentavos: total, impedimentos,
  };
}
