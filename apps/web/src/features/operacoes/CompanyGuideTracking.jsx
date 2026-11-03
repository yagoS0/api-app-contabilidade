import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';

const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'A verificar';
const phases = { ANTES: 'Dois dias úteis antes', NO_VENCIMENTO: 'Dia de comunicação do vencimento', DEPOIS: 'Dois dias úteis depois' };
const historicalPhase = aviso => aviso.politica === 'D2_D0_D2_V1' ? phases[aviso.fase] || 'Aviso histórico' : ({ ANTES: 'Antes do vencimento', NO_VENCIMENTO: 'Comunicação do vencimento', DEPOIS: 'Depois do vencimento' })[aviso.fase] || 'Aviso histórico';
const results = { PAGA: 'Pagamento confirmado', NAO_LOCALIZADO: 'Pagamento não localizado · exige conferência', INCONCLUSIVO: 'Resultado inconclusivo · exige conferência', ERRO: 'Falha na consulta · exige conferência' };
const messages = { ENVIADO: 'Aviso enviado', JA_ENVIADO: 'Aviso já enviado', PENDENTE: 'Aviso pendente', RESERVADO: 'Aviso reservado · conferir antes de repetir', INDETERMINADO: 'Envio incerto · exige conferência', CANCELADO: 'Aviso interrompido' };
function previousMonth() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const m = Number(p.month); return `${m === 1 ? Number(p.year) - 1 : p.year}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
}
export function CompanyGuideTracking({ api, companyId }) {
  const [competencia, setCompetencia] = useState(previousMonth), [data, setData] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), resultRef = useRef(null), focus = useRef(null);
  const load = useCallback(async event => {
    const ticket = ++generation.current;
    focus.current = event?.type ? { ticket, origin: document.activeElement } : null;
    setBusy(true); setError(''); setData(null);
    try {
      const value = await api.getCompanyGuideTracking(companyId, competencia);
      if (ticket !== generation.current) return;
      if (!value || value.ok === false || value.portalClientId !== companyId || value.competencia !== competencia || !Array.isArray(value.items)) throw Error('invalid');
      setData(value);
    } catch { if (ticket === generation.current) setError('Não foi possível carregar o acompanhamento desta empresa. Atualize a leitura; nenhuma consulta fiscal será iniciada.'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }, [api, companyId, competencia]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (busy || !focus.current || focus.current.ticket !== generation.current) return;
    if ([document.body, focus.current.origin].includes(document.activeElement)) resultRef.current?.focus();
    focus.current = null;
  }, [busy, data, error]);
  return <section className="operacoes-previa" aria-label="Acompanhamento das guias" style={{ marginBlock: 20, minWidth: 0 }}>
    <h3>Acompanhamento das guias</h3>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
      <label>Competência de apuração <input type="month" value={competencia} disabled={busy} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setCompetencia(e.target.value); }} /></label>
      <Button variant="secondary" onClick={load} disabled={busy}>Atualizar acompanhamento</Button>
    </div>
    <div ref={resultRef} tabIndex={-1} role={error ? 'alert' : 'status'} aria-busy={busy}>
      {busy ? <p>Carregando acompanhamento…</p> : error ? <p>{error}</p> : data && <>
        <p>{data.enabled ? 'Empresa aderiu ao acompanhamento em dois dias úteis.' : 'Acompanhamento em dois dias úteis desligado.'} {data.paused ? 'Automações pausadas; os resultados e pendências continuam abaixo.' : 'Execução sujeita à seleção, agenda e autorizações.'}</p>
        <p>{data.template?.mensagem || 'Modelos WhatsApp e entrega da revisão atual precisam de conferência.'}</p>
        {!data.items.length && <p>Nenhuma guia encontrada nesta competência. Isso não comprova dispensa de obrigações.</p>}
      </>}
    </div>
    {!busy && !error && data?.items.map((item, index) => <article key={item.guideId} style={{ marginBlock: 16, overflowWrap: 'anywhere' }} aria-label={`Guia ${index + 1}`}>
      <h4>Guia {index + 1} · {item.documento === 'SIMPLES' ? 'DAS' : item.documento || 'Documento a conferir'}</h4>
      <p>Vencimento no documento: {date(item.calendario?.vencimentoNominal)} · Comunicação do vencimento: {date(item.calendario?.vencimentoComunicacao)}</p>
      <p>Antes: {date(item.calendario?.antes)} · Depois: {date(item.calendario?.depois)} · Brasília</p>
      <p>{item.entrega?.comprovada ? 'Entrega comprovada da revisão atual.' : 'Entrega da revisão atual não comprovada.'} {item.encerrada ? 'Acompanhamento encerrado.' : phases[item.fase] || 'Sem aviso previsto para hoje.'}</p>
      <p>Consulta única: {!item.consulta ? 'não iniciada' : item.consulta.status === 'INICIADA' ? 'reservada ou interrompida · exige conferência, sem nova tentativa automática' : results[item.consulta.resultado] || 'exige conferência'}.</p>
      {item.consulta?.revisaoCompativel === false && <p>A tentativa pertence a outra revisão. Trocar o PDF não autoriza repetir a consulta.</p>}
      {item.motivo && <p>{item.motivo}</p>}
      {item.historico?.length > 0 && <ul aria-label="Histórico dos avisos">{item.historico.map((a, i) => <li key={i}>{historicalPhase(a)}: {messages[a.status] || 'Situação a conferir'}{a.revisaoCompativel === false ? ' · revisão anterior ou desconhecida' : ''}{a.motivo && <p>{a.motivo}</p>}</li>)}</ul>}
    </article>)}
  </section>;
}
