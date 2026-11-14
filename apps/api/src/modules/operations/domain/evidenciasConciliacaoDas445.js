export function evidenciaExecucao445(r) {
  return { id: r.id, status: ['running','completed','failed','skipped'].includes(r.status) ? r.status : null,
    action: ['search_guides','check_payments','sync_inss'].includes(r.action) ? r.action : null,
    iniciadaEm: r.startedAt, concluidaEm: r.completedAt, entriesGenerated: r.entriesGenerated,
    circularUpdated: r.circularUpdated, resultadoContabil: 'NAO_PERSISTIDO_NESTE_LOG' };
}
export function projetarOperacoes445(execucoes, worker) {
  return { estado: execucoes.items?.length || worker.items?.length ? 'Parcial' : 'Não verificável', execucoes, worker,
    lacunas: ['COMPLETED_NAO_COMPROVA_SUCESSO_FISCAL_OU_CONTABIL', 'ACCOUNTING_OK_NAO_PERSISTIDO', 'ENTRIES_GENERATED_ZERO_NAO_COMPROVA_CONCILIACAO'] };
}

export function lacunasCruzadas445(fiscal, guias, contabilidade) {
  const lacunas = [];
  const docs = guias.guias.items || []; const caches = fiscal.cache.items || []; const c = contabilidade.circular.items?.[0];
  if (caches.length && !docs.length && guias.guias.consulta === 'ok' && !guias.guias.truncated) lacunas.push('CACHE_SEM_GUIA_NO_RECORTE');
  if (docs.length && !c && contabilidade.circular.consulta === 'ok' && !contabilidade.circular.truncated) lacunas.push('GUIA_SEM_CIRCULAR_NO_RECORTE');
  for (const g of docs) {
    if (g.numeroDocumento && c?.numeroDocumento && g.numeroDocumento !== c.numeroDocumento) lacunas.push('DOCUMENTO_GUIA_CIRCULAR_DIVERGENTE');
    // Only compare totals for an explicitly matching document, never unrelated monthly amounts.
    if (g.numeroDocumento && g.numeroDocumento === c?.numeroDocumento && g.valor != null && c.dasTotal != null) {
      const guia = decimalExato(g.valor), circular = decimalExato(c.dasTotal);
      if (guia == null || circular == null) lacunas.push('VALOR_NAO_COMPARAVEL');
      else if (guia !== circular) lacunas.push('VALOR_GUIA_CIRCULAR_DIVERGENTE');
    }
  }
  return [...new Set(lacunas)];
}

// Comparison only: no numeric conversion, calculation or rounding of persisted money.
function decimalExato(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const inteiro = match[2].replace(/^0+(?=\d)/, '');
  const fracao = (match[3] || '').replace(/0+$/, '');
  const sinal = match[1] === '-' && (inteiro !== '0' || fracao) ? '-' : '';
  return sinal + inteiro + (fracao ? '.' + fracao : '');
}
