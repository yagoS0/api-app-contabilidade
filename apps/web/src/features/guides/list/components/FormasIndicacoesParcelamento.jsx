import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import './guides-workspace.css';
const names = { GUIA_MENSAL: 'Guia mensal', DEBITO_AUTOMATICO: 'Débito automático' };
function Editor({ item, api, companyId, mes, onSaved, onReload, canEdit }) {
  const [forma, setForma] = useState(item.atual?.formaPagamento || '');
  const [desde, setDesde] = useState(mes);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false), [stale, setStale] = useState(false);
  const pending = useRef(null), active = useRef(true), locked = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function save() {
    if (locked.current || done) return;
    locked.current = true; setBusy(true); setError('');
    const body = pending.current || { requestId: crypto.randomUUID(), expectedRevision: item.revision, formaPagamento: forma, desde };
    pending.current = body;
    try {
      const result = await api.salvarFormaIndicacaoParcelamento(companyId, item.id, body);
      if (!result?.ok || !result.indicacao?.revision) throw new Error('Não foi possível confirmar o salvamento. Confira a mesma solicitação.');
      if (active.current) { pending.current = null; setDone(true); onSaved(result.indicacao); }
    } catch (err) {
      if (active.current && [400, 403, 404, 409, 422].includes(err?.status)) { pending.current = null; if ([403, 404, 409].includes(err.status)) setStale(true); }
      if (active.current) setError(err?.message || 'Não foi possível confirmar o salvamento. Tente conferir novamente.');
    } finally { locked.current = false; if (active.current) setBusy(false); }
  }
  return <div className="guides-payment-form" style={{ borderTop: '1px solid var(--border)', paddingBlock: 12, display: 'grid', gap: 8 }}>
    <strong>{item.modalidade || 'Parcelamento'}{item.numeroParcelamento ? ` · ${item.numeroParcelamento}` : ''}</strong>
    <p>{item.descricao}</p>
    <p>{item.atual ? `${names[item.atual.formaPagamento]} · desde ${item.atual.desde}` : 'Forma de pagamento a conferir'}</p>
    {item.historico?.length > 0 && <details><summary>Histórico da configuração</summary>{item.historico.map((h, index) => <p key={index}>{names[h.formaPagamento]} · desde {h.desde} · registrado em {new Date(h.em).toLocaleString('pt-BR')} · usuário {h.usuarioId}</p>)}</details>}
    {canEdit && !done && <>
      <label>Forma de pagamento<select value={forma} disabled={busy || Boolean(pending.current)} onChange={e => setForma(e.target.value)}><option value="">Selecione</option><option value="GUIA_MENSAL">Guia mensal</option><option value="DEBITO_AUTOMATICO">Débito automático</option></select></label>
      <label>Válido a partir de<input type="month" value={desde} disabled={busy || Boolean(pending.current)} onChange={e => setDesde(e.target.value)} /></label>
      <p>A declaração vale a partir do mês escolhido. Não adere ao débito no banco, não cria contrato e não confirma pagamento.</p>
      <Button variant="secondary" disabled={busy || stale || !forma || !desde} onClick={save}>{busy ? 'Salvando…' : pending.current ? 'Conferir salvamento' : 'Confirmar forma de pagamento'}</Button>
    </>}
    {done && <><p role="status">Configuração salva.</p>{canEdit && <Button variant="secondary" onClick={() => { setDone(false); setError(''); setStale(false); }}>Alterar configuração</Button>}</>}
    {error && <p role="alert">{error}</p>}{stale && <Button variant="secondary" onClick={onReload}>Recarregar configuração</Button>}
  </div>;
}
export function FormasIndicacoesParcelamento({ api, companyId, mes, onSaved }) {
  const [open, setOpen] = useState(false), [reload, setReload] = useState(0), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    if (!open || !companyId || !api.getFormasIndicacoesParcelamento) return;
    let live = true; setError(''); setData(null);
    api.getFormasIndicacoesParcelamento(companyId, mes).then(r => {
      if (!r?.ok || !Array.isArray(r.items)) throw new Error('Resposta indisponível.');
      if (live) setData(r);
    }).catch(() => { if (live) setError('Não foi possível carregar as formas de pagamento.'); });
    return () => { live = false; };
  }, [open, companyId, mes, api, reload]);
  if (!api.getFormasIndicacoesParcelamento) return null;
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Formas de pagamento dos parcelamentos sem contrato</summary>
    {open && <>
      {!data && !error && <p role="status">Carregando configurações…</p>}
      {error && <div role="alert">{error}<Button variant="secondary" onClick={() => setReload(v => v + 1)}>Recarregar configurações</Button></div>}
      {data?.items.length === 0 && <p>Nenhuma indicação de parcelamento sem contrato nesta empresa.</p>}
      {data?.items.map(item => <Editor key={`${companyId}:${mes}:${item.id}`} item={item} api={api} companyId={companyId} mes={mes} canEdit={data.canEdit} onReload={() => setReload(v => v + 1)} onSaved={saved => {
        // O servidor devolve a configuração no mês de início; a tela conserva seu recorte.
        const updated = { ...saved, mes, atual: saved.historico?.filter(h => h.desde <= mes).at(-1) || null };
        setData(previous => ({ ...previous, items: previous.items.map(current => current.id === saved.id ? updated : current) }));
        setError('');
        Promise.resolve().then(() => onSaved?.()).catch(() => { setError("Configuração salva; não foi possível atualizar a lista de guias."); });
      }} />)}
    </>}
  </details>;
}
