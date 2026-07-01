// Q41: Situação Fiscal (SITFIS) — estado + handlers.
// reload() lê o último status gravado (barato, sem SERPRO). consultar() chama o SERPRO (por clique).

import { useCallback, useEffect, useState } from "react";

export function useSitfis({ api, companyId }) {
  const [status, setStatus] = useState(null); // { situacao, protocolo, relatorioPdfFileId, texto, checkedAt }
  const [loading, setLoading] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // mensagem pós-consulta (ex.: processando)
  const [pdfUrl, setPdfUrl] = useState(null); // Q43.4: object URL do PDF do relatório (para iframe/download)

  const reload = useCallback(async () => {
    if (!api || !companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStoredSitfis(companyId);
      setStatus(res?.status || null);
    } catch (err) {
      setError(err?.message || "Falha ao carregar a situação fiscal.");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [api, companyId]);

  const consultar = useCallback(async () => {
    if (!api || !companyId || consulting) return;
    setConsulting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.getSitfis(companyId);
      if (res?.processando) {
        setNotice(res?.mensagem || "Relatório em processamento no SERPRO. Tente novamente em instantes.");
      } else {
        setNotice("Situação fiscal consultada com sucesso.");
      }
      await reload();
    } catch (err) {
      setError(err?.reason || err?.message || "Falha ao consultar a situação fiscal no SERPRO.");
    } finally {
      setConsulting(false);
    }
  }, [api, companyId, consulting, reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Q43.4: quando há PDF gravado, busca como blob (com auth) e cria um object URL p/ iframe + download.
  useEffect(() => {
    const fileId = status?.relatorioPdfFileId;
    if (!api || !companyId || !fileId || typeof api.fetchSitfisPdfBlob !== "function") {
      setPdfUrl(null);
      return undefined;
    }
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const blob = await api.fetchSitfisPdfBlob(companyId);
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPdfUrl(createdUrl);
      } catch {
        if (!cancelled) setPdfUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [api, companyId, status?.relatorioPdfFileId, status?.checkedAt]);

  return { status, loading, consulting, error, notice, pdfUrl, reload, consultar };
}
