// Q41: página Pendências (situação fiscal / SITFIS) — lista + consulta individual e em lote.

import { useCallback, useEffect, useState } from "react";

export function usePendencias({ api, feedback, enabled = true }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const load = useCallback(async () => {
    if (!api || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const out = await api.listFiscalPendencias();
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar as pendências fiscais.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, enabled]);

  // Consulta o SITFIS de UMA empresa (chamada paga ao SERPRO) e recarrega a lista.
  const consultarUma = useCallback(async (companyId) => {
    if (!api || !companyId) return { ok: false };
    try {
      const res = await api.getSitfis(companyId);
      await load();
      return { ok: true, processando: Boolean(res?.processando), situacao: res?.situacao };
    } catch (err) {
      feedback?.setError?.(err?.reason || err?.message || "Falha ao consultar situação fiscal.");
      return { ok: false, message: err?.reason || err?.message };
    }
  }, [api, load, feedback]);

  // Consulta o SITFIS de várias empresas em sequência (respeita o rate limit do SERPRO).
  const consultarLote = useCallback(async (companyIds) => {
    const ids = Array.isArray(companyIds) ? companyIds.filter(Boolean) : [];
    if (!api || ids.length === 0 || running) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    let done = 0;
    let firstError = null;
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.getSitfis(id);
      } catch (err) {
        if (!firstError) firstError = err?.reason || err?.message || "Falha na consulta.";
      }
      done += 1;
      setProgress({ done, total: ids.length });
    }
    await load();
    setRunning(false);
    setProgress({ done: 0, total: 0 });
    if (firstError) setError(`Concluído com erros: ${firstError}`);
  }, [api, running, load]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, error, running, progress, reload: load, consultarUma, consultarLote };
}
