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

  return { parcelamentos, loading, error, saving, load, create, linkGuide, payParcela, rescindir };
}
