const dinheiro = v => v == null ? 'Não informado' : Number(v).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});

export function TributosDocumento({ ibscbs }) {
  return <details style={{textAlign:'left',fontWeight:'normal'}}>
    <summary>IBS e CBS</summary>
    {!ibscbs ? <p>Leitura tributária pendente.</p>
      : ibscbs.valores ? <>
        <dl>
          <dt>Base de cálculo</dt><dd>{dinheiro(ibscbs.valores.baseCalculo)}</dd>
          <dt>IBS estadual</dt><dd>{dinheiro(ibscbs.valores.ibsUf?.valor)}</dd>
          <dt>IBS municipal</dt><dd>{dinheiro(ibscbs.valores.ibsMunicipio?.valor)}</dd>
          <dt>IBS total</dt><dd>{dinheiro(ibscbs.valores.ibsTotal)}</dd>
          <dt>CBS</dt><dd>{dinheiro(ibscbs.valores.cbs?.valor)}</dd>
        </dl>
        <p>Valores do documento. O destaque não confirma direito a crédito.</p>
      </> : <p>{ibscbs.situacao === 'GRUPO_AUSENTE' ? 'O documento não informa IBS/CBS.'
        : ibscbs.situacao === 'SOMENTE_DECLARACAO' ? 'Classificação declarada; valores não informados no documento.'
          : 'Não foi possível ler os tributos do documento.'}</p>}
    {ibscbs?.avisos?.length > 0 && <p>Há campos ilegíveis; solicite a conferência ao escritório.</p>}
  </details>;
}
