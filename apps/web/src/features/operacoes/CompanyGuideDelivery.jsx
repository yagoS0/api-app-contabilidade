import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { operationDate, operationInstant } from './operationsDetails';

const labels = { DISABLED: 'Desligado', PAUSED: 'Pausado', WAIT: 'Aguardando guias', REVIEW: 'Conferência necessária', COMPLETE: 'Guias completas', PARTIAL_DEADLINE: 'Envio parcial pelo prazo', PARTIAL_DUE: 'Envio antecipado pelo vencimento', COMPLEMENT: 'Envio complementar', SENT: 'Enviado', PENDING: 'Aguardando', STARTED: 'Tentativa em andamento', UNCERTAIN: 'Resultado incerto' };
function previousMonth() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 2, 1));
  return date.toISOString().slice(0, 7);
}
export function CompanyGuideDelivery({ api, companyId, competencia: selectedCompetencia }) {
  const [month, setMonth] = useState(previousMonth), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const competencia = selectedCompetencia || month;
  const generation = useRef(0), resultRef = useRef(null), focus = useRef(null);
  const load = useCallback(async event => {
    const ticket = ++generation.current;
    focus.current = event?.type ? { ticket, origin: document.activeElement } : null;
    setData(null); setError(''); setBusy(true);
    try {
      if (!api?.getCompanyGuideDelivery) throw new Error('Leitura do envio automático indisponível nesta conexão.');
      const value = await api.getCompanyGuideDelivery(companyId, competencia);
      if (ticket !== generation.current) return;
      if (!value || value.ok === false || value.portalClientId !== companyId || value.competencia !== competencia || !Number.isInteger(value.revision) || !labels[value.status] || !Array.isArray(value.items) || !Array.isArray(value.warnings) || !Array.isArray(value.expectation?.missing)) throw new Error('Não foi possível confirmar o envio desta empresa e competência.');
      setData(value);
    } catch (e) { if (ticket === generation.current) setError(e.message || 'Não foi possível carregar o envio automático.'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }, [api, companyId, competencia]);
  useEffect(() => { const currentGeneration = generation; load(); return () => { currentGeneration.current++; }; }, [load]);
  useEffect(() => {
    if (!busy && focus.current) {
      const request = focus.current; focus.current = null;
      if (request.ticket === generation.current && [document.body, request.origin].includes(document.activeElement)) resultRef.current?.focus();
    }
  }, [busy, data, error]);
  return <section className="operacoes-previa" aria-label="Acompanhamento do envio automático" style={{ marginBlock: 20 }}>
    <h3>Envio das guias por competência</h3>
    {!selectedCompetencia && <label>Competência do envio <input type="month" value={month} disabled={busy} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label>}{' '}
    <Button variant="secondary" disabled={busy} onClick={load}>Atualizar envio automático</Button>
    <div ref={resultRef} tabIndex={-1} role={error ? 'alert' : 'status'}>{busy ? <p>Carregando envio automático…</p> : error ? <p>{error}</p> : data && <p><strong>{labels[data.status]}</strong>{data.paused && data.status !== 'PAUSED' ? ' · Pausa ativa' : ''}</p>}</div>
    {data && !busy && <>
      <p>Limite para envio parcial: {operationDate(data.cutoffDate)}. Documentos pagos ou com envio incerto não são repetidos automaticamente.</p>
      <p>{data.expectation.state === 'KNOWN' ? `${data.expectation.availableCount} de ${data.expectation.requiredCount} obrigações com documento identificado.` : 'Cobertura das obrigações a conferir; não há confirmação de lote completo.'}</p>
      {data.expectation.absenceConfirmedCount > 0 && <p>{data.expectation.absenceConfirmedCount === 1 ? '1 ausência confirmada' : `${data.expectation.absenceConfirmedCount} ausências confirmadas`} nesta competência. Ausência confirmada resolve a obrigação; não representa um documento para enviar.</p>}
      {data.expectation.missing.length > 0 && <ul>{data.expectation.missing.map((item, i) => <li key={`${item.obligationKey}-${i}`}>{item.label}: {item.reason}</li>)}</ul>}
      {data.warnings.length > 0 && <aside aria-label="Avisos do envio"><h4>Conferir</h4><ul>{data.warnings.map(w => <li key={w.id}>{w.message}</li>)}</ul></aside>}
      {data.lastAttempt && <p>Última tentativa: {labels[data.lastAttempt.status] || 'A conferir'} · {operationInstant(data.lastAttempt.finishedAt || data.lastAttempt.startedAt)}</p>}
      <div className="operacoes-tabela-scroll" role="region" aria-label="Guias do envio automático" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Guia</th><th>Vencimento</th><th>Canal e destino</th><th>Situação</th></tr></thead><tbody>{data.items.map(item => <tr key={item.guideId}><th scope="row">{item.tipo}<small>{item.competencia}</small></th><td>{operationDate(item.vencimento)}</td><td>{item.channels?.map(channel => <div key={`${channel.channel}:${channel.destinationLabel}`}><strong>{channel.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'}</strong> · {channel.destinationLabel}<small>{labels[channel.state] || 'A conferir'}{channel.reason ? ` · ${channel.reason}` : ''}</small></div>)}</td><td>{labels[item.state] || 'A conferir'}{item.reason && <p>{item.reason}</p>}</td></tr>)}</tbody></table></div>
      {!data.items.length && <p>Nenhum documento identificado neste retorno. Isso não dispensa obrigações.</p>}
      <p>Esta leitura não envia mensagens. Confira tentativas e documentos em Guias antes de qualquer reenvio manual.</p>
    </>}
  </section>;
}
