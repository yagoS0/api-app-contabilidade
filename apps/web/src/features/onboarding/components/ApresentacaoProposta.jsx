const reais = c => Number.isSafeInteger(c) && c >= 0 ? (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'A confirmar';
const bloco = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
export function ApresentacaoProposta({ proposta, detalhada = false }) {
  const a = proposta.apresentacao, perfil = proposta.perfil, limites = proposta.limitesPlano;
  const mensal = proposta.opcoes?.some(o => o.recorrente);
  return <>
    {(a || perfil || limites) && <details open={detalhada || undefined} style={{ marginBlock: 12 }}><summary>Ver escopo, acompanhamento e benefícios</summary>
      {perfil && <><h3>Sobre a empresa</h3><p>{[proposta.razaoSocial, perfil.atividade, ({SIMPLES:'Simples Nacional',LUCRO_PRESUMIDO:'Lucro Presumido'})[perfil.regime] || perfil.regime].filter(Boolean).join(' · ')}</p><p>Perfil informado: {[perfil.funcionarios != null ? `${perfil.funcionarios} funcionário(s)` : null, perfil.notasRecebidasMes != null ? `${perfil.notasRecebidasMes} documentos de entrada/mês` : null].filter(Boolean).join(' · ')}.</p></>}
      {mensal && a?.incluidos && <><h3>O que está incluído no plano mensal</h3><p style={bloco}>{a.incluidos}</p></>}
      {mensal && <><h3>Gestão e acompanhamento</h3><p style={bloco}>{perfil?.consultoriaMensal ? a?.gestao || 'Consultoria mensal de gestão incluída, conforme o escopo e as condições desta proposta.' : 'O acompanhamento segue o escopo apresentado. Consultoria gerencial mensal pode ser contratada separadamente.'}</p></>}
      {mensal && a?.beneficios && <><h3>Benefícios incluídos no plano mensal</h3><p style={bloco}>{a.beneficios}</p></>}
      {mensal && (limites || a?.limites) && <><h3>Limites e adicionais</h3>{limites && <p>{[limites.funcionarios != null ? `Até ${limites.funcionarios} funcionários` : null, limites.documentosEntradaMes != null ? `até ${limites.documentosEntradaMes} documentos de entrada/mês` : null].filter(Boolean).join(' · ')}.</p>}{limites?.blocoAdicionalQuantidade > 0 && <p>Volume adicional: {reais(limites.blocoAdicionalCentavos)} por bloco de {limites.blocoAdicionalQuantidade} documentos, conforme revisão do plano.</p>}<p style={bloco}>{a?.limites}</p></>}
    </details>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{proposta.opcoes?.map(o => <article key={o.chave} style={{ flex: '1 1 220px', padding: 14, border: '1px solid var(--border)', borderRadius: 8 }}><strong>{o.titulo}</strong><p>{o.recorrente ? `${reais(o.mensalCentavos)}/mês${o.unicoCentavos !== 0 ? ` + ${reais(o.unicoCentavos)} pelo serviço inicial` : ''}` : `${reais(o.unicoCentavos)} pelo serviço`}</p><p style={bloco}>{o.escopo}</p></article>)}</div>
    <p>Regularização: {proposta.regularizacaoCentavos == null ? 'orçamento separado, quando necessária' : reais(proposta.regularizacaoCentavos)} · Taxas públicas: {reais(proposta.taxasCentavos)}{proposta.taxasConfirmadas ? ' (confirmadas)' : ' (a conferir)'}</p><p style={bloco}>{proposta.condicoes}</p>
  </>;
}
