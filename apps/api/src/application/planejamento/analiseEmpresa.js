import { montarDreGerencial } from '../dre/lib/dreGerencial.js';

export const mesValido = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
export function moverMes(s, n) {
  const [y, m] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export function listaMeses(de, ate) {
  if (!mesValido(de) || !mesValido(ate) || de > ate) throw new Error('PERIODO_INVALIDO');
  const meses = [];
  for (let m = de; m <= ate; m = moverMes(m, 1)) {
    if (meses.length >= 60) throw new Error('PERIODO_INVALIDO');
    meses.push(m);
  }
  return meses;
}
export function definirPeriodos({ de, ate, comparar = 'anterior' }) {
  const meses = listaMeses(de, ate);
  if (meses.length > 24 || !['anterior', 'ano'].includes(comparar)) throw new Error('PERIODO_INVALIDO');
  const recuo = comparar === 'ano' ? 12 : meses.length;
  const anterior = { de: moverMes(de, -recuo), ate: moverMes(ate, -recuo) };
  return { atual: { de, ate }, anterior, inicio: [anterior.de, moverMes(ate, -11)].sort()[0], fim: ate };
}
export function exigirFechamento(de, ate, circulares) {
  const fechados = new Set(circulares.filter(c => c.fechadoContabilEm).map(c => c.competencia));
  const pendentes = listaMeses(de, ate).filter(m => !fechados.has(m));
  if (pendentes.length) {
    const erro = new Error(`Feche a contabilidade em Lançamentos para consultar: ${pendentes.join(', ')}.`);
    erro.code = 'CONTABILIDADE_ABERTA'; erro.mesesSemFechamento = pendentes;
    throw erro;
  }
  return fechados;
}
export function numero(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const soma = (xs) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;
export function compararValores(atual, anterior, pontos = false) {
  if (atual == null || anterior == null) return { absoluta: null, percentual: null, texto: 'Sem base comparável' };
  const absoluta = Math.round((atual - anterior) * 100) / 100;
  if (pontos) return { absoluta, percentual: null, texto: `${absoluta > 0 ? '+' : ''}${absoluta.toFixed(2)} p.p.` };
  if (anterior <= 0) return { absoluta, percentual: null, texto: anterior < 0 && atual >= 0 ? 'Reversão para resultado positivo' : 'Sem base positiva para percentual' };
  return { absoluta, percentual: (atual / anterior - 1) * 100, texto: null };
}
const compData = (d) => d ? new Date(d).toISOString().slice(0, 7) : null;
const despesasChaves = ['pessoal', 'gerais', 'tributarias', 'depreciacao', 'despesasFinanceiras'];

// Uma guia composta participa pelo total, nunca também por seus componentes.
export function montarAnalise({ periodos, lancamentos, notas, guias, plano, hoje, circulares=[], permitirLacunas=false }) {
  if (!permitirLacunas) exigirFechamento(periodos.atual.de, periodos.atual.ate, circulares);
  const meses = listaMeses(periodos.inicio, periodos.fim);
  const fechados = new Set(circulares.filter(c=>c.fechadoContabilEm).map(c=>c.competencia));
  if (permitirLacunas) {
    lancamentos = lancamentos.filter(e => fechados.has(e.competencia));
    notas = notas.filter(n => fechados.has(compData(n.competencia)));
  }
  const guiasValidas = guias.filter(g => fechados.has(g.competencia) && g.status === 'PROCESSED' && g.parcelaEstado !== 'CANCELADA');
  function calcular(de, ate) {
    const mesesSemFechamento = listaMeses(de, ate).filter(m => !circulares.some(c => c.competencia === m && c.fechadoContabilEm));
    const parcialPermitido = permitirLacunas && de === periodos.atual.de && ate === periodos.atual.ate;
    const indisponivel = mesesSemFechamento.length > 0 && (!parcialPermitido || listaMeses(de, ate).every(m => !fechados.has(m)));
    const entradas = lancamentos.filter(e => e.competencia >= de && e.competencia <= ate);
    const dre = montarDreGerencial({ lancamentos: entradas, planoPorCodigo: plano, competencia: `${de} a ${ate}` });
    const docs = notas.filter(n => compData(n.competencia) >= de && compData(n.competencia) <= ate);
    const impostos = guiasValidas.filter(g => g.competencia >= de && g.competencia <= ate && !g.parcelamentoId && !/^PARC/i.test(g.tipo));
    const valores = Object.fromEntries(dre.linhas.map(l => [l.chave, dre.semLancamento ? null : l.valor]));
    const zeroConfirmado = m => circulares.some(c=>c.competencia===m&&c.semFaturamento===true);
    const faturamento = docs.length && docs.every(n => numero(n.total) != null) ? soma(docs.map(n => numero(n.total))) : !docs.length&&listaMeses(de,ate).every(zeroConfirmado)?0:null;
    const tributos = impostos.length && impostos.every(g => numero(g.valor) != null) ? soma(impostos.map(g => numero(g.valor))) : null;
    const completos = listaMeses(de, ate);
    const faltas = {
      contabilidade: completos.filter(m => !entradas.some(e => e.competencia === m)),
      faturamento: completos.filter(m => !docs.some(n => compData(n.competencia) === m)&&!zeroConfirmado(m)),
      guias: completos.filter(m => !impostos.some(g => g.competencia === m)),
    };
    const parcial = dre.qualidade.provisorio || Object.values(faltas).some(a => a.length) || docs.some(n => numero(n.total) == null) || impostos.some(g => numero(g.valor) == null);
    const margem = (chave) => valores.receitaLiquida > 0 && valores[chave] != null ? valores[chave] / valores.receitaLiquida * 100 : null;
    if (indisponivel) {
      dre.semLancamento = true; dre.linhas = dre.linhas.map(l => ({...l, valor:null, contas:[]}));
      dre.naoClassificado = []; dre.inconsistencias = [];
    }
    const indicadores = {
      faturamento, resultado: valores.resultadoDoPeriodo,
      despesas: dre.semLancamento ? null : -soma(despesasChaves.map(k => valores[k])),
      tributos, margemBruta: margem('lucroBruto'), margemOperacional: margem('resultadoOperacional'), margemLiquida: margem('resultadoDoPeriodo'),
      carga: faturamento > 0 && tributos != null ? tributos / faturamento * 100 : null,
    };
    return {de, ate, dre, faltas, parcial:parcial || mesesSemFechamento.length > 0, indisponivel, mesesSemFechamento, indicadores:indisponivel ? Object.fromEntries(Object.keys(indicadores).map(k => [k,null])) : indicadores};
  }
  const atual = calcular(periodos.atual.de, periodos.atual.ate);
  const anterior = calcular(periodos.anterior.de, periodos.anterior.ate);
  const serie = meses.map(m => ({ competencia: m, ...calcular(m, m) }));
  const variacoes = Object.fromEntries(Object.keys(atual.indicadores).map(k => [k, compararValores(atual.mesesSemFechamento.length ? null : atual.indicadores[k], anterior.indicadores[k], k.startsWith('margem') || k === 'carga')]));
  const insights = [];
  if (!atual.parcial && !anterior.parcial) {
    if (variacoes.faturamento.percentual < -10) insights.push({ secao: 'geral', texto: `Faturamento caiu ${Math.abs(variacoes.faturamento.percentual).toFixed(1)}% no período comparado.` });
    if (variacoes.despesas.percentual != null && variacoes.faturamento.percentual != null && variacoes.despesas.percentual > variacoes.faturamento.percentual) insights.push({ secao: 'despesas', texto: `Despesas variaram ${variacoes.despesas.percentual.toFixed(1)}%, enquanto o faturamento variou ${variacoes.faturamento.percentual.toFixed(1)}%.` });
    if (variacoes.margemLiquida.absoluta < 0) insights.push({ secao: 'resultado', texto: `Margem líquida recuou ${Math.abs(variacoes.margemLiquida.absoluta).toFixed(1)} p.p.` });
    if (variacoes.carga.absoluta > 1) insights.push({ secao: 'impostos', texto: `A carga das guias disponíveis sobre faturamento aumentou ${variacoes.carga.absoluta.toFixed(1)} p.p. Confira a composição e a cobertura dos dois períodos.` });
  }
  return { atual, anterior, serie, variacoes, insights: insights.slice(0,5), hoje, guias: guiasValidas.map(g => ({ ...g, valor: numero(g.valor) })),
    cobertura: serie.map(m => ({ competencia: m.competencia, contabilidade: !m.faltas.contabilidade.length, faturamento: !m.faltas.faturamento.length, guias: !m.faltas.guias.length, semFaturamentoConfirmado:circulares.some(c=>c.competencia===m.competencia&&c.semFaturamento===true), fechadoContabilEm:circulares.find(c=>c.competencia===m.competencia)?.fechadoContabilEm||null })),
    avisos: ['Relatório restrito às competências com fechamento contábil registrado. O fechamento não substitui a conferência da cobertura documental.', 'Carga das guias sobre faturamento: documentos disponíveis, sem parcelamentos; não representa apuração tributária completa.', ...(guias.length > guiasValidas.length ? ['Guias sem fechamento contábil, ainda não processadas ou canceladas ficaram fora dos totais.'] : [])],
  };
}
