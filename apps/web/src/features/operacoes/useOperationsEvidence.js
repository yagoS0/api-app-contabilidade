import { useEffect, useState } from 'react';

// One local batch read; no fiscal provider, mutation or per-company HTTP request.
export function useOperationsEvidence(api, competencia, companies) {
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(previous => ({ ...previous, loading: true }));
    Promise.resolve().then(() => {
      if (!api?.getOperationEvidence) throw Error('Conferências indisponíveis neste ambiente.');
      return api.getOperationEvidence(competencia);
    }).then(data => {
      if (data?.ok === false || data?.competencia !== competencia || !Array.isArray(data.items) || data.total !== data.items.length
        || data.items.some(item => !item.companyId || item.competencia !== competencia || !item.revision)
        || new Set(data.items.map(item => item.companyId)).size !== data.items.length) throw Error('Não foi possível conferir as evidências da competência.');
      if (active) setResult({ competencia, api, companies, items: data.items, loading: false });
    }).catch(e => { if (active) setResult({ competencia, api, companies, items: [], loading: false, error: e.message }); });
    return () => { active = false; };
  }, [api, competencia, companies, retry]);
  const current = result?.competencia === competencia && result.api === api && result.companies === companies ? result : null;
  return { items: current && !current.loading ? current.items : [], loading: !current || current.loading, error: current?.error, reload: () => setRetry(n => n + 1) };
}
