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
  // C11: o PDF fica gravado e é exibido ao abrir a aba. Se o arquivo sumiu do armazenamento
  // (deploy sem volume persistente apagava a pasta), avisamos em vez de mostrar quadro em branco.
  const [pdfIndisponivel, setPdfIndisponivel] = useState(false);

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
      if (res?.throttled) {
        // C11: dentro da janela de 4h o backend não chama o SERPRO — devolve o relatório salvo.
        setNotice(res?.mensagem || "Situação fiscal consultada há pouco — mostrando o último relatório salvo.");
      } else if (res?.processando) {
        // Mostra o que o SERPRO respondeu de fato — o texto padrão é inferência nossa.
        const base = res?.mensagem || "Relatório em processamento no SERPRO. Tente novamente em instantes.";
        setNotice(res?.mensagemSerpro ? `${base}

SERPRO: ${res.mensagemSerpro}` : base);
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
      setPdfIndisponivel(false);
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
        setPdfIndisponivel(false);
      } catch {
        // Há registro do PDF no banco, mas o arquivo não veio do armazenamento.
        if (!cancelled) { setPdfUrl(null); setPdfIndisponivel(true); }
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [api, companyId, status?.relatorioPdfFileId, status?.checkedAt]);

  // C11: trava de 4h — o backend manda `podeConsultar`/`proximaConsultaEm` junto do status.
  const podeConsultar = status?.podeConsultar !== false;
  const proximaConsultaEm = status?.proximaConsultaEm || null;

  return {
    status, loading, consulting, error, notice, pdfUrl, pdfIndisponivel,
    podeConsultar, proximaConsultaEm, reload, consultar,
  };
}
