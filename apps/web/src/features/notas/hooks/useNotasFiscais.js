// Q12.A.4: state + handlers da aba Notas Fiscais.
// Único hook, instanciado pelo CompanyDetailPage via lazy load.

import { useCallback, useEffect, useState } from "react";

// Competência (YYYY-MM) do mês anterior ao atual.
function prevMonthCompetencia() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function useNotasFiscais({ api, companyId, feedback }) {
  const [ano, setAno] = useState(() => new Date().getUTCFullYear());
  const [competencias, setCompetencias] = useState([]);
  const [procuracoes, setProcuracoes] = useState([]);
  const [pendencias, setPendencias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Q12.B
  const [dfeState, setDfeState] = useState(null);
  const [dfeSyncing, setDfeSyncing] = useState(false);
  const [dfeLastResult, setDfeLastResult] = useState(null);
  // Q12.B+: ADN/NFS-e
  const [adnState, setAdnState] = useState(null);
  const [adnSyncing, setAdnSyncing] = useState(false);
  const [adnLastResult, setAdnLastResult] = useState(null);

  // Q56: import MANUAL de notas (XML)
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  // Q12.C.1: listagem de notas + resumo
  const [notas, setNotas] = useState([]);
  const [notasTotal, setNotasTotal] = useState(0);
  const [notasSummary, setNotasSummary] = useState(null);
  // Q19: filtro de competência das notas começa no mês ANTERIOR ao atual (default).
  // Q20: + filtro por atividade (cfop / servico = código LC116 ou nome).
  const [notasFilters, setNotasFilters] = useState({ papel: "", type: "", competencia: prevMonthCompetencia(), search: "", cfop: "", servico: "", limit: 100, offset: 0 });
  const [loadingNotas, setLoadingNotas] = useState(false);

  const loadAll = useCallback(async () => {
    if (!companyId || !api) return;
    setLoading(true);
    setError(null);
    try {
      // Q12.B++: procurações são registradas no e-CAC da Receita, não no nosso banco.
      // Não carregamos listProcuracoes mais aqui. competências/pendências movem-se
      // pra página global de Apuração — não carregadas aqui.
      // Q12.B+++.X: summary não vem aqui — vai junto com loadNotas (mesmos filtros).
      const [dfe, adn] = await Promise.all([
        api.getDfeState ? api.getDfeState(companyId) : Promise.resolve(null),
        api.getAdnState ? api.getAdnState(companyId) : Promise.resolve(null),
      ]);
      setDfeState(dfe);
      setAdnState(adn);
    } catch (err) {
      setError(err?.message || "Falha ao carregar Notas Fiscais.");
    } finally {
      setLoading(false);
    }
  }, [api, companyId]);

  const loadNotas = useCallback(async (filtersOverride) => {
    if (!companyId || !api) return;
    setLoadingNotas(true);
    try {
      const f = filtersOverride || notasFilters;
      // Roda listagem + summary em paralelo com OS MESMOS filtros — assim o
      // resumo no topo reflete exatamente o que aparece na tabela.
      const summaryArgs = { ano, papel: f.papel, type: f.type, competencia: f.competencia, search: f.search, cfop: f.cfop, servico: f.servico };
      const [out, summary] = await Promise.all([
        api.listNotas(companyId, f),
        api.getNotasSummary ? api.getNotasSummary(companyId, summaryArgs) : Promise.resolve(null),
      ]);
      setNotas(out?.notas || []);
      setNotasTotal(out?.total || 0);
      setNotasSummary(summary);
    } catch (err) {
      setError(err?.message || "Falha ao carregar notas.");
    } finally {
      setLoadingNotas(false);
    }
  }, [api, companyId, notasFilters, ano]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadNotas(); }, [loadNotas]);

  async function createProcuracao(body) {
    setSaving(true);
    try {
      const out = await api.createProcuracao(companyId, body);
      if (!out?.ok) throw new Error(out?.message || "Falha ao criar procuração.");
      feedback?.notifySuccess?.("Procuração cadastrada.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function revogarProcuracao(procId) {
    setSaving(true);
    try {
      await api.revogarProcuracao(companyId, procId);
      feedback?.notifySuccess?.("Procuração revogada.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally { setSaving(false); }
  }

  async function fecharCompetencia(competencia) {
    setSaving(true);
    try {
      const out = await api.fecharCompetencia(companyId, competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha ao fechar competência.");
      feedback?.notifySuccess?.(`Competência ${competencia} fechada.`);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function reabrirCompetencia(competencia, reason) {
    setSaving(true);
    try {
      const out = await api.reabrirCompetencia(companyId, competencia, reason);
      if (!out?.ok) throw new Error(out?.message || "Falha ao reabrir competência.");
      feedback?.notifySuccess?.(`Competência ${competencia} reaberta.`);
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
      throw err;
    } finally { setSaving(false); }
  }

  async function resolverPendencia(pendId) {
    setSaving(true);
    try {
      await api.resolverPendencia(companyId, pendId);
      feedback?.notifySuccess?.("Pendência marcada como resolvida.");
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally { setSaving(false); }
  }

  async function syncDfe({ env = "prod" } = {}) {
    setDfeSyncing(true);
    setDfeLastResult(null);
    try {
      const out = await api.syncDfe(companyId, { env });
      setDfeLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura DFe (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura DFe.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), loadNotas()]);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setDfeSyncing(false);
    }
  }

  async function clearDfeError() {
    try {
      await api.clearDfeError(companyId);
      feedback?.notifySuccess?.("Erro DFe limpo.");
      await loadAll();
    } catch (err) { feedback?.notifyError?.(err?.message || "Erro."); }
  }
  async function clearAdnError() {
    try {
      await api.clearAdnError(companyId);
      feedback?.notifySuccess?.("Erro ADN limpo.");
      await loadAll();
    } catch (err) { feedback?.notifyError?.(err?.message || "Erro."); }
  }

  async function syncAdn({ env = "prod" } = {}) {
    setAdnSyncing(true);
    setAdnLastResult(null);
    try {
      const out = await api.syncAdn(companyId, { env });
      setAdnLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura NFS-e (${env}) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura ADN.");
      }
      // Recarrega estado E a lista de notas — as notas capturadas aparecem sem precisar consultar de novo.
      await Promise.all([loadAll(), loadNotas()]);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setAdnSyncing(false);
    }
  }

  // Marca uma nota como cancelada (some do faturamento/apuração) ou reativa.
  async function marcarNotaStatus(notaId, statusEfetivo) {
    if (!api?.marcarNotaStatus) { feedback?.notifyError?.("Ação indisponível."); return; }
    try {
      await api.marcarNotaStatus(companyId, notaId, statusEfetivo);
      feedback?.notifySuccess?.(statusEfetivo === "cancelada" ? "Nota marcada como cancelada." : "Nota reativada.");
      await loadNotas();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao atualizar a nota.");
    }
  }

  // Q56: import MANUAL de notas via upload de XML (pra empresas onde a captura automática falhou)
  async function importNotas(files) {
    const list = Array.isArray(files) ? files : (files ? [files] : []);
    if (!list.length) return;
    if (!api?.importInvoicesXml) {
      feedback?.notifyError?.("Import de notas não disponível.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const out = await api.importInvoicesXml(companyId, list);
      setImportResult(out || null);
      const created = out?.created ?? 0;
      const updated = out?.updated ?? 0;
      const dup = out?.duplicates ?? 0;
      const errs = Array.isArray(out?.errors) ? out.errors.length : 0;
      if (errs && !created && !updated) {
        feedback?.notifyError?.(`Nenhuma nota importada — ${errs} arquivo(s) com erro.`);
      } else {
        feedback?.notifySuccess?.(
          `Importação concluída — ${created} nova(s), ${updated} atualizada(s)` +
          (dup ? `, ${dup} duplicada(s)` : "") +
          (errs ? `, ${errs} com erro` : "") + "."
        );
      }
      await loadNotas();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao importar notas.");
    } finally {
      setImporting(false);
    }
  }

  return {
    ano, setAno,
    competencias, procuracoes, pendencias,
    loading, saving, error,
    reload: loadAll,
    createProcuracao, revogarProcuracao,
    fecharCompetencia, reabrirCompetencia,
    resolverPendencia,
    // Q12.B
    dfeState, dfeSyncing, dfeLastResult, syncDfe, clearDfeError,
    // Q12.B+: NFS-e via ADN
    adnState, adnSyncing, adnLastResult, syncAdn, clearAdnError,
    // Q12.C.1: listagem de notas
    notas, notasTotal, notasSummary,
    notasFilters, setNotasFilters,
    loadingNotas, loadNotas, marcarNotaStatus,
    // Q56: import manual de notas (XML)
    importing, importResult, importNotas,
  };
}
