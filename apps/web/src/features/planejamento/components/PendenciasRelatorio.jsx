const mes = valor => `${valor.slice(5)}/${valor.slice(0, 4)}`;

// Somente evidências devolvidas pela consulta; ausência não é imposto ou receita zero.
export function PendenciasRelatorio({ dados, empresaId }) {
  const itens = [];
  for (const [chave, titulo] of [['atual', 'Período atual'], ['anterior', 'Comparação']]) {
    const periodo = dados[chave];
    if (!periodo) continue;
    const adicionar = (motivo, impacto, destino, acao) => itens.push({ titulo, motivo, impacto, destino, acao });
    for (const [fonte, impacto, destino, acao] of [
      ['contabilidade', 'DRE e indicadores de custos', 'lancamentos', 'Conferir lançamentos'],
      ['faturamento', 'Faturamento e crescimento', 'notas-fiscais', 'Conferir notas'],
      ['guias', 'Carga tributária documental', 'guides', 'Conferir guias'],
    ]) {
      const meses = periodo.faltas?.[fonte] || [];
      if (meses.length) adicionar(`Sem registros de ${fonte}: ${meses.map(mes).join(', ')}`, impacto, destino, acao);
    }
    const qualidade = periodo.dre?.qualidade || {};
    if (qualidade.lancamentosRascunho) adicionar(`${qualidade.lancamentosRascunho} lançamento(s) em rascunho`, 'DRE provisória e comparação de resultados', 'lancamentos', 'Conferir lançamentos');
    if (qualidade.linhasInvalidas || qualidade.linhasNaoClassificadas || periodo.dre?.naoClassificado?.length) adicionar('Lançamentos inconsistentes ou sem classificação na DRE', 'Resultado e indicadores gerenciais', 'lancamentos', 'Conferir lançamentos');
    if (periodo.mesesSemFechamento?.length) adicionar(`Contabilidade sem fechamento: ${periodo.mesesSemFechamento.map(mes).join(', ')}`, 'Comparação e indicadores de crescimento indisponíveis', 'lancamentos', 'Conferir lançamentos');
    if (periodo.parcial && !itens.some(i => i.titulo === titulo)) adicionar('Base sinalizada como parcial pela consulta', 'Confira os valores e a cobertura das fontes');
  }
  if (!itens.length) return null;
  return <details className="bi-card bi-pendencias"><summary>Pendências da base · {itens.length}</summary>
    <p>Afetam os relatórios abaixo. Ao abrir a origem, confira a competência indicada.</p>
    <ul>{itens.map((item, i) => <li key={i}><div><strong>{item.titulo}</strong><p>{item.motivo}</p><small>Afeta: {item.impacto}</small></div>{item.destino && <a href={`/companies/${empresaId}/${item.destino}`}>{item.acao}</a>}</li>)}</ul>
  </details>;
}
