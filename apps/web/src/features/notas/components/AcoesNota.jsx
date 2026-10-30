import { useEffect, useRef, useState } from 'react';
import { baixarDocumentoUrl, validarDocumentoBlob } from '../lib/documentoIndividual';
import { lerRecusaDanfse } from '../lib/danfseDaNota';
import '../notas.css';

function Icone({ tipo }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {tipo === 'PDF' ? <><path d="M6 9V3h12v6M6 17H3V9h18v8h-3" /><path d="M6 14h12v7H6zM17 12h1" /></>
      : tipo === 'XML' ? <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" /></>
        : <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>}
  </svg>;
}

// The key isolates in-flight requests and blob URLs even when the parent reuses a row/modal.
export function AcoesNota(props) {
  const { nota, companyId, contexto } = props;
  const revisao = JSON.stringify([companyId, nota.id, contexto, nota.updatedAt, nota.xmlHash, nota.status, nota.statusEfetivo]);
  return <AcoesNoContexto key={revisao} {...props} />;
}
function AcoesNoContexto({ nota, companyId, api }) {
  const [capacidades, setCapacidades] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [fallback, setFallback] = useState(null);
  const vivo = useRef(true), lock = useRef(false), consulta = useRef(null);
  const abort = useRef(new AbortController()), recursos = useRef([]);
  useEffect(() => {
    vivo.current = true;
    abort.current = new AbortController();
    consulta.current = null;
    return () => {
      vivo.current = false; abort.current.abort();
      for (const r of recursos.current) { clearInterval(r.timer); clearTimeout(r.timeout); r.viewer?.close(); if (r.url) URL.revokeObjectURL(r.url); }
      recursos.current = [];
    };
  }, []);
  async function conferir() {
    if (!api?.getAcoesNota || !companyId) throw new Error('Consulta de documentos indisponível nesta tela.');
    const signal = abort.current.signal;
    // Share only an in-flight read. List rows do not always carry a document
    // revision, so each new intent must be able to discover an imported XML.
    if (!consulta.current) {
      const pendente = api.getAcoesNota(companyId, nota.id, { signal })
      .then(out => {
        if (!out?.XML?.estado || !out?.PDF?.estado || !out.revisao) throw new Error('Não foi possível conferir os documentos.');
        if (vivo.current && !signal.aborted) { setCapacidades(out); setErro(''); }
        return out;
      }).finally(() => { if (consulta.current === pendente) consulta.current = null; });
      consulta.current = pendente;
    }
    return consulta.current;
  }
  function focar(formato) {
    const signal = abort.current.signal;
    conferir().then(out => { if (vivo.current && !signal.aborted) setAviso(out[formato]?.motivo || ''); })
      .catch(e => { if (vivo.current && !signal.aborted) setErro(e.message); });
  }
  async function abrir(formato) {
    if (lock.current || !api?.fetchDocumentoNota) return;
    const signal = abort.current.signal;
    lock.current = true; setOcupado(true); setErro(''); setAviso(''); setFallback(null);
    const recurso = { viewer: null, url: null };
    recursos.current.push(recurso);
    try {
      // Reserve the viewer during the user's gesture; no document is navigated until validated.
      if (formato === 'PDF') {
        try { recurso.viewer = window.open('about:blank', '_blank'); if (recurso.viewer) recurso.viewer.opener = null; }
        catch { recurso.viewer = null; }
      }
      const caps = await conferir();
      if (!vivo.current || signal.aborted) return;
      if (caps[formato]?.estado !== 'disponivel') throw new Error(caps[formato]?.motivo || 'Disponibilidade do documento a verificar.');
      if (!api?.fetchDocumentoNota) throw new Error('Download indisponível nesta tela.');
      const out = await api.fetchDocumentoNota(companyId, nota.id, formato, { signal });
      await validarDocumentoBlob(out.blob, formato);
      if (!vivo.current || signal.aborted) return;
      recurso.url = URL.createObjectURL(out.blob);
      if (formato === 'PDF') {
        if (recurso.viewer && !recurso.viewer.closed) {
          recurso.viewer.location.replace(recurso.url);
          recurso.timer = setInterval(() => { if (recurso.viewer.closed) { URL.revokeObjectURL(recurso.url); recurso.url = null; clearInterval(recurso.timer); } }, 1000);
        } else setFallback({ url: recurso.url, nome: out.nome });
      } else {
        baixarDocumentoUrl(recurso.url, out.nome);
        recurso.timeout = setTimeout(() => { if (recurso.url) URL.revokeObjectURL(recurso.url); recurso.url = null; }, 60000);
      }
    } catch (e) {
      recurso.viewer?.close();
      if (recurso.url) { URL.revokeObjectURL(recurso.url); recurso.url = null; }
      if (vivo.current && !signal.aborted) {
        const recusa = lerRecusaDanfse(e);
        setErro([recusa.texto, recusa.motivo, recusa.porQue].filter(Boolean).join(' '));
      }
    } finally { lock.current = false; if (vivo.current && !signal.aborted) setOcupado(false); }
  }
  const cancelar = nota.papel === 'DEST' ? 'Nota recebida: somente o emissor pode cancelar.' : 'Cancelamento fiscal indisponível nesta etapa.';
  return <div className="nota-acoes" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <div className="nota-acoes__botoes" role="group" aria-label={`Documentos da nota ${nota.numero || nota.id}`}>
      {['PDF', 'XML'].map(formato => {
        const cap = capacidades?.[formato];
        const label = formato === 'PDF' ? 'Abrir / imprimir PDF' : 'Baixar XML';
        return <button key={formato} type="button" className="nota-acao" aria-label={`${label} da nota ${nota.numero || nota.id}`}
          title={!api?.fetchDocumentoNota ? 'Documentos indisponíveis nesta tela.' : cap?.motivo || (cap ? label : `${label} — conferir disponibilidade`)}
          disabled={!api?.fetchDocumentoNota}
          aria-disabled={ocupado || cap?.estado === 'indisponivel' || !api?.fetchDocumentoNota}
          onFocus={() => focar(formato)} onClick={() => { if (!ocupado) abrir(formato); }}><Icone tipo={formato} /></button>;
      })}
      <button type="button" className="nota-acao" aria-label={`Cancelar nota ${nota.numero || nota.id} — ${cancelar}`} aria-disabled="true" title={cancelar} onFocus={() => setAviso(cancelar)} onClick={() => setAviso(cancelar)}><Icone tipo="cancelar" /></button>
    </div>
    {ocupado && <span role="status">Preparando documento…</span>}
    {erro && <span role="alert">{erro}</span>}
    {aviso && <span role="status">{aviso}</span>}
    {fallback && <span role="status">Visualizador bloqueado. <a href={fallback.url} download={fallback.nome}>Baixar PDF</a></span>}
  </div>;
}
