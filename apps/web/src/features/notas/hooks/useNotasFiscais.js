// Q12.A.4: state + handlers da aba Notas Fiscais.
// Único hook, instanciado pelo CompanyDetailPage via lazy load.

import { useCallback, useEffect, useState } from "react";

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

  const loadAll = useCallback(async () => {
    if (!companyId || !api) return;
    setLoading(true);
    setError(null);
    try {
      const [comp, procs, pends, dfe, adn] = await Promise.all([
        api.listCompetenciasNotas(companyId, ano),
        api.listProcuracoes(companyId),
        api.listPendenciasPosFechamento(companyId, { onlyOpen: true }),
        api.getDfeState ? api.getDfeState(companyId) : Promise.resolve(null),
        api.getAdnState ? api.getAdnState(companyId) : Promise.resolve(null),
      ]);
      setCompetencias(comp.competencias || []);
      setProcuracoes(procs || []);
      setPendencias(pends || []);
      setDfeState(dfe);
      setAdnState(adn);
    } catch (err) {
      setError(err?.message || "Falha ao carregar Notas Fiscais.");
    } finally {
      setLoading(false);
    }
  }, [api, companyId, ano]);

  useEffect(() => { loadAll(); }, [loadAll]);

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
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setDfeSyncing(false);
    }
  }

  async function syncAdn() {
    setAdnSyncing(true);
    setAdnLastResult(null);
    try {
      const out = await api.syncAdn(companyId);
      setAdnLastResult(out?.result || out);
      if (out?.ok) {
        feedback?.notifySuccess?.(`Captura NFS-e (ADN) concluída — ${out.result?.totalDocs || 0} documentos.`);
      } else {
        feedback?.notifyError?.(out?.result?.message || out?.message || "Falha na captura ADN.");
      }
      await loadAll();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro.");
    } finally {
      setAdnSyncing(false);
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
    dfeState, dfeSyncing, dfeLastResult, syncDfe,
    // Q12.B+: NFS-e via ADN
    adnState, adnSyncing, adnLastResult, syncAdn,
  };
}
