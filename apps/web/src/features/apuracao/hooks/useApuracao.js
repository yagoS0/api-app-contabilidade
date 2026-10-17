// A seleção pertence à lista carregada, incluindo competência, busca e cliente de API.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function defaultCompetencia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(agora);
  const ano = Number(partes.find(p => p.type === "year").value);
  const mes = Number(partes.find(p => p.type === "month").value);
  return `${mes === 1 ? ano - 1 : ano}-${String(mes === 1 ? 12 : mes - 1).padStart(2, "0")}`;
}

export function useApuracao({ api, feedback, enabled = true }) {
  const [competencia, mudarCompetencia] = useState(defaultCompetencia);
  const [search, mudarSearch] = useState("");
  const contexto = useMemo(() => ({ api, competencia, search, enabled }), [api, competencia, search, enabled]);
  const contextoAtual = useRef(contexto); contextoAtual.current = contexto;
  const pedidoAtual = useRef(0), listaApta = useRef(null), enviando = useRef(false), vivo = useRef(false);
  const [lista, setLista] = useState(null);
  const [selecao, setSelecao] = useState(null);
  const [batch, setBatch] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { const pedidoAtualDaExecucao = pedidoAtual; vivo.current = true; return () => { vivo.current = false; pedidoAtualDaExecucao.current++; listaApta.current = null; }; }, []);

  function invalidar() { pedidoAtual.current++; listaApta.current = null; setSelecao(null); }
  function setCompetencia(valor) { if (valor !== competencia) { invalidar(); mudarCompetencia(valor); } }
  function setSearch(valor) { if (valor !== search) { invalidar(); mudarSearch(valor); } }

  const load = useCallback(async () => {
    if (!api || !enabled || contextoAtual.current !== contexto) return;
    const pedido = ++pedidoAtual.current;
    const vigente = () => vivo.current && contextoAtual.current === contexto && pedidoAtual.current === pedido;
    listaApta.current = null;
    setSelecao(null);
    setLista({ contexto, loading: true, items: [], error: null });
    try {
      const out = await api.listApuracao({ competencia, search });
      if (!vigente()) return;
      if (!Array.isArray(out?.items) || out?.ok === false) throw new Error(out?.message || "Resposta de apuração inválida.");
      const carregada = { contexto, loading: false, items: out.items, error: null };
      listaApta.current = carregada;
      setLista(carregada);
    } catch (err) {
      if (!vigente()) return;
      setLista({ contexto, loading: false, items: [], error: err?.message || "Falha ao carregar apuração." });
    }
  }, [api, competencia, search, enabled, contexto]);

  useEffect(() => { const pedidoAtualDaExecucao = pedidoAtual; load(); return () => { pedidoAtualDaExecucao.current++; listaApta.current = null; }; }, [load]);

  const visivel = enabled && api && lista?.contexto === contexto;
  const loading = Boolean(enabled && api && (!visivel || lista.loading));
  const error = visivel ? lista.error : null;
  const items = visivel ? lista.items : [];
  const listaPronta = Boolean(visivel && !loading && !error && listaApta.current === lista);
  const selected = listaPronta && selecao?.contexto === contexto ? selecao.ids : new Set();
  const aptaAgora = () => vivo.current && enabled && contextoAtual.current === contexto && listaApta.current === lista && listaPronta && !enviando.current;

  function toggleSelect(portalClientId) {
    if (!aptaAgora() || !items.some(i => i.portalClientId === portalClientId && i.estado === "fechada")) return;
    setSelecao(prev => {
      const ids = new Set(prev?.contexto === contexto ? prev.ids : []);
      if (ids.has(portalClientId)) ids.delete(portalClientId); else ids.add(portalClientId);
      return { contexto, ids };
    });
  }
  function selectAllFechadas() {
    if (!aptaAgora()) return;
    const fechadas = items.filter(i => i.estado === "fechada").map(i => i.portalClientId);
    setSelecao(prev => ({ contexto, ids: prev?.contexto === contexto && prev.ids.size === fechadas.length ? new Set() : new Set(fechadas) }));
  }

  async function apurarEmLote() {
    if (!aptaAgora()) return;
    const fechadas = new Set(items.filter(i => i.estado === "fechada").map(i => i.portalClientId));
    const ids = [...selected].filter(id => fechadas.has(id));
    if (!ids.length) { feedback?.notifyError?.("Selecione empresas fechadas."); return; }
    enviando.current = true; setSubmitting(true);
    const vigente = () => vivo.current && contextoAtual.current === contexto;
    try {
      const out = await api.criarApuracaoBatch({ portalClientIds: ids, competencia });
      if (!vigente()) return;
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      setBatch({ contexto, jobId: out.taskId ? null : out.jobId });
      feedback?.notifySuccess?.(out.taskId ? "Apuração iniciada. Acompanhe em Tarefas, no topo da tela." : `Lote criado: ${out.totalEmpresas} empresa(s)${out.ignoradas ? ` (${out.ignoradas} ignoradas)` : ""}.`);
      setSelecao(null);
      // Revalidar a lista antes de permitir uma nova seleção do lote aceito.
      await load();
    } catch (err) {
      if (vigente()) feedback?.notifyError?.(err?.message || "Erro ao criar lote");
    } finally {
      enviando.current = false;
      if (vivo.current) setSubmitting(false);
    }
  }

  return {
    competencia, setCompetencia, search, setSearch,
    items, loading, error, listaPronta, submitting,
    selected, toggleSelect, selectAllFechadas,
    batchJobId: enabled && batch?.contexto === contexto ? batch.jobId : null,
    setBatchJobId: jobId => setBatch({ contexto, jobId }),
    apurarEmLote, reload: load,
  };
}
