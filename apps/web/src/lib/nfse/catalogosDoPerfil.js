import { DESCRICAO_DO_VALOR } from './perfilEmissao';

export function catalogosDoPerfil(dados, campos) {
  const sugestoes = dados?.sugestoes || {};
  const rtc = sugestoes.tabelasRtc || {};
  return {
    categoriaObrigacaoIbscbs: [
      { codigo: 'SERVICO_ISS', descricao: 'Serviço sujeito ao ISS, fora da hipótese de plataforma digital' },
      { codigo: 'PLATAFORMA_DIGITAL', descricao: 'Hipótese de plataforma digital do art. 1º, III, a, do Ato 4/2026' },
    ],
    ...Object.fromEntries(campos.filter(c => c.valores).map(c => [c.id,
      c.valores.map(codigo => ({ codigo: String(codigo), descricao: DESCRICAO_DO_VALOR[c.id]?.[codigo] || 'Sem descrição na fonte' }))])),
    codigoServicoNacional: (sugestoes.porServico || []).map(s => ({ codigo: s.codigo, descricao: s.descricao })),
    codigoNbs: sugestoes.nbs || [...new Map((sugestoes.porServico || []).flatMap(s => s.nbs || []).map(n => [n.codigo, n])).values()],
    ibscbsCIndOp: (rtc.operacoes || []).map(o => ({ codigo: o.codigo, descricao: o.local })),
    ibscbsCst: rtc.csts || [],
    ibscbsCClassTrib: (rtc.classificacoes || []).map(c => ({ codigo: c.codigo, descricao: c.descricao, detalhe: `CST ${c.cst}` })),
  };
}
