// Q41: Situação Fiscal (SITFIS) — estado + handlers.
// reload() lê o último status gravado (barato, sem SERPRO). consultar() chama o SERPRO (por clique).

import { useCallback, useEffect, useRef, useState } from "react";

export function useSitfis({ api, companyId }) {
  const contexto = useRef({ api, companyId });
  if (contexto.current.api !== api || contexto.current.companyId !== companyId) contexto.current = { api, companyId };
  const leitura = useRef(0);
  const expiracaoLida = useRef(null);
  const [status, setStatus] = useState(null); // { situacao, protocolo, relatorioPdfFileId, texto, checkedAt }
  const [loading, setLoading] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // mensagem pós-consulta (ex.: processando)
  const [pdfUrl, setPdfUrl] = useState(null); // Q43.4: object URL do PDF do relatório (para iframe/download)
  // C11: o PDF fica gravado e é exibido ao abrir a aba. Se o arquivo sumiu do armazenamento
  // (deploy sem volume persistente apagava a pasta), avisamos em vez de mostrar quadro em branco.
  const [pdfIndisponivel, setPdfIndisponivel] = useState(false);
  const [revisaoPdf, setRevisaoPdf] = useState(0);
  const recarregarPdf = () => { setPdfIndisponivel(false); setRevisaoPdf((v) => v + 1); };

  const reload = useCallback(async () => {
    if (!api || !companyId) return;
    const origem = contexto.current;
    const pedido = ++leitura.current;
    const vigente = () => contexto.current === origem && pedido === leitura.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStoredSitfis(companyId);
      if (!vigente()) return;
      setStatus(res?.status || null);
    } catch (err) {
      if (!vigente()) return;
      setError(err?.message || "Falha ao carregar a situação fiscal.");
      setStatus(null);
    } finally {
      if (vigente()) setLoading(false);
    }
  }, [api, companyId]);

  const consultar = useCallback(async () => {
    if (!api || !companyId || consulting) return;
    const origem = contexto.current;
    setConsulting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.getSitfis(companyId);
      if (contexto.current !== origem) return;
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
      if (contexto.current !== origem) return;
      setError(err?.reason || err?.message || "Falha ao consultar a situação fiscal no SERPRO.");
    } finally {
      if (contexto.current === origem) setConsulting(false);
    }
  }, [api, companyId, consulting, reload]);

  useEffect(() => {
    setStatus(null); setNotice(null); setConsulting(false);
    reload();
  }, [reload]);

  useEffect(() => {
    const quando = Date.parse(status?.proximaConsultaEm);
    const chave = `${companyId}|${status?.proximaConsultaEm}`;
    if (status?.podeConsultar !== false || !Number.isFinite(quando) || expiracaoLida.current === chave) return undefined;
    const timer = setTimeout(() => {
      expiracaoLida.current = chave;
      reload(); // Apenas relê o status salvo; nunca consulta o SERPRO automaticamente.
    }, Math.max(0, quando - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [companyId, status?.podeConsultar, status?.proximaConsultaEm, reload]);

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
  }, [api, companyId, status?.relatorioPdfFileId, status?.checkedAt, revisaoPdf]);

  // C11: trava de 4h — o backend manda `podeConsultar`/`proximaConsultaEm` junto do status.
  const podeConsultar = status?.podeConsultar !== false;
  const proximaConsultaEm = status?.proximaConsultaEm || null;

  return {
    status, loading, consulting, error, notice, pdfUrl, pdfIndisponivel,
    podeConsultar, proximaConsultaEm, reload, consultar, recarregarPdf,
  };
}
