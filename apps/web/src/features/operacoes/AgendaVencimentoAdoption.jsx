import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// The API snapshot is JSON. Keep the reviewed copy independent of browser clone support.
const copySnapshot = value => JSON.parse(JSON.stringify(value));
function validAdoptionSnapshot(value, companyId) {
  const p = value?.agendaEventos;
  return value?.ok !== false && value?.companyId === companyId && Boolean(value?.companyName?.trim()) && hash(value?.revision)
    && p?.schemaVersion === 1 && hash(p.modeRevision) && Number.isSafeInteger(p.modeVersion) && p.modeVersion >= 0
    && ['LEGADO', 'RELATIVO_V1'].includes(p.executionMode) && p.relativeConsumerReady === true
    && p.capabilities?.reminders === true && p.capabilities?.paymentD2 === true && p.capabilities?.capture === false
    && typeof value.automationPolicy?.paused === 'boolean' && typeof value.globalAutomationPolicy?.paused === 'boolean'
    && typeof value.serproPolicy?.paused === 'boolean' && typeof value.lembretes?.enabled === 'boolean'
    && typeof value.lembretes?.agenda?.enabled === 'boolean' && typeof value.acompanhamentoGuias?.enabled === 'boolean'
    && Array.isArray(value.rotinas);
}
const hour = n => Number.isInteger(n) ? `${String(n).padStart(2, '0')}:00` : 'Horário não definido';
const mode = value => value === 'RELATIVO_V1' ? 'Por vencimento' : 'Horário anterior';

export function AgendaVencimentoAdoption({ api, companyId, snapshot, tributo, canEdit = false, disabled = false, onSaved, onReview }) {
  const [review, setReview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false);
  const pending = useRef(null), working = useRef(false), generation = useRef(0);
  const heading = useRef(null), trigger = useRef(null), status = useRef(null);
  useEdicaoPendente(Boolean(review));
  useEffect(() => { onReview?.(Boolean(review)); return () => onReview?.(false); }, [review, onReview]);
  useEffect(() => { if (review) heading.current?.focus(); }, [review]);
  useEffect(() => () => { generation.current++; }, [companyId, api]);
  function open() {
    if (disabled || !canEdit || !validAdoptionSnapshot(snapshot, companyId)) return;
    setReview(copySnapshot(snapshot)); setError(''); setNotice(''); setConflict(false);
  }
  function back() {
    if (working.current || pending.current) return;
    setReview(null); setError(''); setConflict(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function reconcile() {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); const ticket = generation.current;
    try {
      const result = await api.getCompanyAutomation(companyId);
      if (ticket !== generation.current) return;
      if (!validAdoptionSnapshot(result, companyId)) throw Error('Leitura incompatível com esta empresa.');
      if (pending.current) setNotice('Estado atual conferido. Para confirmar o resultado do pedido, repita a mesma solicitação.');
      else { setReview(copySnapshot(result)); setConflict(false); onSaved?.(result); }
    } catch (e) { if (ticket === generation.current) setError(e.message || 'Leitura indisponível.'); }
    finally { if (ticket === generation.current) { working.current = false; setBusy(false); } }
  }
  async function confirm() {
    if (working.current || !review || !canEdit || disabled || conflict) return;
    const command = pending.current || { expectedRevision: review.revision, requestId: crypto.randomUUID(), agendaEventos: { executionMode: 'RELATIVO_V1' } };
    pending.current = command; working.current = true; setBusy(true); setError(''); const ticket = generation.current;
    try {
      const result = await api.saveCompanyAutomation(companyId, command);
      if (ticket !== generation.current) return;
      if (!validAdoptionSnapshot(result, companyId) || result.agendaEventos.executionMode !== 'RELATIVO_V1'
        || result.agendaEventos.modeVersion < review.agendaEventos.modeVersion
        || (review.agendaEventos.executionMode !== 'RELATIVO_V1' && (result.agendaEventos.modeVersion !== review.agendaEventos.modeVersion + 1 || result.agendaEventos.modeRevision === review.agendaEventos.modeRevision || result.revision === review.revision))) {
        throw Error('Resposta não confirma a adoção. A solicitação foi preservada.');
      }
      pending.current = null; setReview(null); onSaved?.(result);
      setNotice('Uso por vencimento confirmado. Habilitações e pausas preservadas.');
      requestAnimationFrame(() => status.current?.focus());
    } catch (e) {
      if (ticket !== generation.current) return;
      if ([403, 409, 422].includes(e.status)) { pending.current = null; setConflict(true); }
      setError(e.message || 'Resultado incerto. Confira a leitura ou repita a mesma solicitação.');
    } finally { if (ticket === generation.current) { working.current = false; setBusy(false); } }
  }
  const paused = review?.globalAutomationPolicy.paused ? 'Pausa geral' : review?.automationPolicy.paused ? 'Pausa desta empresa' : null;
  const configuredTaxes = Object.entries(review?.agendaEventos.effective || {}).filter(([, parameters]) =>
    parameters?.captura?.enabled === true || Object.values(parameters?.lembretes || {}).some(rule => rule?.enabled === true));
  const reviewedTaxes = configuredTaxes.length ? configuredTaxes : [[tributo, review?.agendaEventos.effective?.[tributo] || {}]];
  const reminderState = paused || (!review?.lembretes.enabled ? 'Empresa não selecionada' : !review.lembretes.agenda.enabled ? 'Agenda global desligada' : 'Habilitada; sujeita às guardas de cada guia');
  return <section aria-label="Uso do agendamento por vencimento">
    <div ref={status} tabIndex={-1} role="status">{notice}</div>
    {error && <p role="alert">{error}</p>}
    {!review ? <>{canEdit && <Button ref={trigger} variant="secondary" disabled={disabled || !validAdoptionSnapshot(snapshot, companyId)} onClick={open}>Revisar uso nesta empresa</Button>}</> : <div className="agenda-eventos-preview">
      <h4 ref={heading} tabIndex={-1}>Usar agendamento por vencimento</h4>
      <p>{review.companyName}</p>
      <p>Lembretes: {mode(review.agendaEventos.executionMode)} → Por vencimento, por imposto. Coleta de notas, cálculo e ADN mantêm suas agendas; a primeira busca de guias continua indisponível.</p>
      <div className="agenda-eventos-table"><table><thead><tr><th>Imposto / ação</th><th>Regra salva</th><th>Disponibilidade / estado</th></tr></thead><tbody>
        {reviewedTaxes.flatMap(([tax, parameters]) => ['before', 'onDue', 'after'].map((key, index) => { const rule = parameters?.lembretes?.[key]; return <tr key={`${tax}-${key}`}><th scope="row">{tax === 'SIMPLES' ? 'DAS Simples' : tax} · {['Avisar antes', 'Avisar no vencimento', 'Avisar depois'][index]}</th><td data-label="Regra salva">{rule?.enabled === true ? `${key === 'onDue' ? 'No vencimento' : `${rule.businessDays ?? 'Não definido'} dias úteis ${key === 'before' ? 'antes' : 'depois'}`} · ${hour(rule.hour)}` : 'Sem participação salva'}</td><td data-label="Estado">{reminderState}</td></tr>; }))}
        <tr><th scope="row">Consulta de pagamento</th><td data-label="Regra salva">Uma consulta em D+2 úteis, independente do aviso posterior.</td><td data-label="Estado">{paused || (review.serproPolicy.paused ? 'SERPRO pausado' : review.acompanhamentoGuias.enabled ? 'Selecionada; depende da agenda e das guardas' : 'Acompanhamento desligado')}</td></tr>
        <tr><th scope="row">Buscar guia</th><td data-label="Regra salva">Parâmetros preservados</td><td data-label="Estado">Busca automática indisponível. Referência salva não habilita a primeira captura.</td></tr>
      </tbody></table></div>
      <details><summary>Condições da consulta</summary><p>Somente sem confirmação do cliente e sem guia recalculada, respeitando agenda, seleção, pausas e custos SERPRO. Falha ou resultado incerto exige conferência; não autoriza outra consulta. Confirmação preserva a origem e a baixa idempotente; mês fechado exige correção contábil explícita.</p></details>
      <p>Esta alteração escolhe o calendário. Não altera habilitações nem remove pausas. Rotinas já habilitadas e sem pausa poderão executar pelo novo calendário.</p>
      <div className="agenda-eventos-actions"><Button disabled={busy || conflict || disabled || !canEdit} onClick={confirm}>{pending.current ? 'Conferir com a mesma solicitação' : 'Confirmar uso por vencimento'}</Button><Button variant="secondary" disabled={busy || Boolean(pending.current)} onClick={back}>Voltar</Button>{(pending.current || conflict) && <Button variant="secondary" disabled={busy} onClick={reconcile}>{conflict ? 'Reler e revisar configuração' : 'Conferir estado atual'}</Button>}</div>
    </div>}
  </section>;
}
