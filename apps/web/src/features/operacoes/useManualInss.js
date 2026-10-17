import { useEffect, useRef, useState } from 'react';
import { agruparPendencias } from './operacoes';

// Reads only local evidence. Refreshing this projection never captures fiscal documents.
export function useManualInss(api, competencia, companies) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => { const generationDaExecucao = generation;
    const current = ++generation.current;
    if (!api?.getOperationManualInss) { setResult(null); return; }
    setResult({ competencia, loading: true, items: [] });
    Promise.resolve().then(() => api.getOperationManualInss(competencia)).then(data => {
      if (!Array.isArray(data?.items)) throw Error('Resposta inválida');
      if (current === generation.current) setResult({ competencia, items: data.items, loading: false });
    }).catch(() => {
      if (current === generation.current) setResult({ competencia, items: [], loading: false, error: 'Não foi possível conferir o INSS manual desta competência.' });
    });
    return () => { generationDaExecucao.current++; };
  }, [api, competencia, companies, retry]);
  const current = result?.competencia === competencia ? result : null;
  return { ...current, reload: () => setRetry(value => value + 1) };
}

export function incorporarInssManual(projection, items = []) {
  const byCompany = new Map(items.map(item => [item.companyId, item]));
  // Keep document delivery failures and existing fiscal/closing states untouched.
  const tasks = projection.tasks.filter(task => {
    const manual = byCompany.get(task.company.companyId);
    return !(manual && task.tag?.key === 'inss' && task.tag.state === 'missing');
  });
  for (const row of projection.rows) {
    const manual = byCompany.get(row.company.companyId);
    if (!manual || !['PENDING_DOCUMENT', 'DOCUMENT_REVIEW'].includes(manual.status)) continue;
    const existing = tasks.find(task => task.company.companyId === row.company.companyId && task.tag?.key === 'inss');
    if (existing) continue;
    tasks.push({ ...row, id: `${row.company.companyId}:inss-manual`, tipo: 'pendencias', categoria: manual.status === 'DOCUMENT_REVIEW' ? 'revisoes' : 'faltantes', manualInss: manual,
      titulo: manual.status === 'DOCUMENT_REVIEW' ? 'INSS · documento para revisão' : 'INSS · aguardando guia manual' });
  }
  const pendingCompanies = new Set(tasks.filter(t => t.manualInss).map(t => t.company.companyId));
  return { ...projection, tasks, groups: { ...projection.groups,
    concluidas: projection.groups.concluidas.filter(row => !pendingCompanies.has(row.company.companyId)),
    ...agruparPendencias(tasks),
  } };
}
