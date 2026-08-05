import { useCallback, useEffect, useState } from "react";

export function useParcelamentos({ api, companyId, status = null }) {
  const [parcelamentos, setParcelamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setError(null);
    try {
      const data = await api.listParcelamentos(companyId, status ? { status } : {});
      setParcelamentos(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Falha ao listar parcelamentos.");
      setParcelamentos([]);
    } finally {
      setLoading(false);
    }
  }, [api, companyId, status]);

  useEffect(() => { load(); }, [load]);

  async function create(body) {
    setSaving(true); setError(null);
    try {
      const res = await api.createParcelamento(companyId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao criar parcelamento.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q21/Q23: sobe guia manual como 1ª parcela → cria/anexa parcelamento + provisão (≥3 linhas).
  async function ingest(body) {
    setSaving(true); setError(null);
    try {
      const res = await api.ingestParcelamento(companyId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao registrar parcela.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q28 Fase 1: consulta um parcelamento no SERPRO por código (pré-preenche o modal de entrada).
  async function consultarSerpro({ tipo, numeroParcelamento }) {
    const res = await api.consultarParcelamentoSerpro(companyId, { tipo, numeroParcelamento });
    return res?.parcelamento || null;
  }

  // Q23: contas memorizadas das linhas-padrão da provisão (pré-preenche o modal).
  async function getContasProvisao(tipo) {
    try {
      const res = await api.getContasProvisao(companyId, tipo);
      return res?.contas || {};
    } catch {
      return {};
    }
  }

  // Q28 Fase 2: ver/editar config de lançamento do parcelamento.
  async function getConfig(parcId) {
    const res = await api.getParcelamentoConfig(companyId, parcId);
    return res?.parcelamento || null;
  }
  async function saveConfig(parcId, body) {
    setSaving(true); setError(null);
    try {
      const res = await api.saveParcelamentoConfig(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao salvar config do parcelamento.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q28 Fase 3: fila de conferência de parcelas.
  async function listConferencia() {
    try {
      const res = await api.getConferenciaParcelas(companyId);
      return Array.isArray(res?.items) ? res.items : [];
    } catch { return []; }
  }
  async function aprovarConferencia(guideIds) {
    setSaving(true); setError(null);
    try {
      const res = await api.aprovarConferenciaParcelas(companyId, guideIds);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao aprovar conferência.");
      throw err;
    } finally { setSaving(false); }
  }

  async function linkGuide(parcId, { guideId, numeroParcela }) {
    setSaving(true); setError(null);
    try {
      const res = await api.linkGuideToParcelamento(companyId, parcId, { guideId, numeroParcela });
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao vincular guia.");
      throw err;
    } finally { setSaving(false); }
  }

  async function payParcela(parcId, numeroParcela, { jurosValor, dataPagamento }) {
    setSaving(true); setError(null);
    try {
      const res = await api.payParcela(companyId, parcId, numeroParcela, { jurosValor, dataPagamento });
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao confirmar pagamento.");
      throw err;
    } finally { setSaving(false); }
  }

  async function rescindir(parcId, body = {}) {
    setSaving(true); setError(null);
    try {
      const res = await api.rescindirParcelamento(companyId, parcId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao rescindir.");
      throw err;
    } finally { setSaving(false); }
  }

  // Q31 Parte D: vincula/desvincula uma provisão (competência aberta) a um parcelamento (só marca).
  async function vincularEntry(entryId, parcelamentoId) {
    const res = await api.vincularEntryParcelamento(companyId, entryId, parcelamentoId || null);
    await load();
    return res;
  }

  // ⚠ `listConferencia`/`aprovarConferencia` FALTAVAM neste retorno, e as duas existem desde a
  // Q28 Fase 3. O efeito era o painel "Conferência de parcelas" QUEBRAR ao montar:
  // `ConferenciaParcelasPanel` faz `await listConferencia()` sem catch, então recebia `undefined`
  // e estourava `TypeError: listConferencia is not a function` — a fila de conferência nunca
  // apareceu na aba Parcelamento. Rotas e mock sempre estiveram de pé; era só o repasse.
  return {
    parcelamentos, loading, error, saving, load, create, ingest, getContasProvisao, consultarSerpro,
    getConfig, saveConfig, linkGuide, payParcela, rescindir, vincularEntry,
    listConferencia, aprovarConferencia,
  };
}
