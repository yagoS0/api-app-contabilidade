import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FechamentoModal } from '../apuracao/components/FechamentoModal';
import { FluxoPgdasPanel } from '../apuracao/components/FluxoPgdasPanel';
const apiIds = new WeakMap(); let nextApiId = 0;
function apiIdentity(api) { if (!apiIds.has(api)) apiIds.set(api, ++nextApiId); return apiIds.get(api); }
const fiscalLabels = { NAO_TRANSMITIDA: 'Não transmitida', EM_PROCESSAMENTO: 'Em processamento', REJEITADA: 'Rejeitada', DESCONHECIDA: 'Resultado desconhecido', CONFIRMADA: 'Confirmada' };
export function OperationsFiscalWorkspace(props) { return <FiscalWorkspace key={`${props.item.companyId}:${props.competencia}:${apiIdentity(props.api)}`} {...props} />; }
function FiscalWorkspace({ api, item, competencia, onClose, onChanged, onBusyChange, canWrite = () => false }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false), [formBusy, setFormBusy] = useState(false), [externalBusy, setExternalBusy] = useState(false);
  const [form, setForm] = useState(null), [action, setAction] = useState(null), [reason, setReason] = useState(''), [message, setMessage] = useState('');
  const [fiscalMessages,setFiscalMessages] = useState([]);
  const context = useRef({ api }), generation = useRef(0), lock = useRef(false), heading = useRef(null);
  if (context.current?.api !== api) context.current = { api };
  const occupied = busy || formBusy || externalBusy, allowed = canWrite(item.companyId);
  useEffect(() => { onBusyChange?.(occupied); return () => onBusyChange?.(false); }, [occupied, onBusyChange]);
  async function reload() {
    const current = context.current, version = ++generation.current; setReading(true); setError('');
    try {
      const [a, f] = await Promise.all([api.getAptidaoFiscalFechamento(item.companyId, competencia), api.getFechamento(item.companyId, competencia)]);
      if (context.current !== current || version !== generation.current) return;
      if (a?.ok !== true || a.aptidao?.portalClientId !== item.companyId || a.aptidao?.competencia !== competencia || f?.ok === false) throw Error('Não foi possível conferir o contexto fiscal.');
      setData({ aptidao: a.aptidao, fechamento: f.dados || f });
    } catch (e) { if (context.current === current && version === generation.current) setError(e.message || 'Leitura fiscal indisponível.'); }
    finally { if (context.current === current && version === generation.current) setReading(false); }
  }
  useEffect(() => { context.current = { api }; heading.current?.focus(); void reload(); return () => { generation.current++; context.current = null; }; }, [api]);
  const externalApi = useMemo(() => ({ ...api, registrarEntregaPgdasExterna: typeof api.registrarEntregaPgdasExterna === 'function' ? async (...args) => {
    const current = context.current; setExternalBusy(true);
    try { return await api.registrarEntregaPgdasExterna(...args); }
    finally { if (context.current === current) setExternalBusy(false); }
  } : undefined }), [api]);
  async function perform() {
    if (lock.current || occupied || reading || error || !allowed || !action) return;
    const current = context.current, chosen = action;
    if (chosen === 'retificar' && (!reason.trim() || data?.aptidao?.capacidades?.retificar !== true)) return;
    if (['reconciliar', 'encerrar'].includes(chosen) && data?.aptidao?.capacidades?.reconciliar !== true) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const out = chosen === 'retificar' ? await api.reabrirFechamento(item.companyId, competencia, reason.trim()) : await api.conferirTransmissaoFechamento(item.companyId, competencia, ...(chosen === 'encerrar' ? [{encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:competencia}] : []));
      if (context.current !== current) return;
      if (out?.ok !== true || chosen === 'encerrar' && out.result?.encerradaSemDespacho !== true || chosen === 'retificar' && out.result?.snapshot?.estado !== 'aberta') throw Error(out?.message || 'Resultado não confirmado. Recarregue para conferir a tentativa.');
      setFiscalMessages(out.result?.mensagens || out.result?.transmissao?.mensagens || []);
      setAction(null); setReason(''); setMessage(chosen === 'retificar' ? 'Reabertura registrada. Confira o formulário antes de transmitir a retificadora.' : out.result?.mensagem || 'Conferência concluída. Verifique os fatos e pendências abaixo.');
      await reload(); if (context.current === current && chosen === 'retificar') setForm('retificar');
    } catch (e) { if (context.current === current) setError(e.message || 'Resultado desconhecido. Recarregue antes de outra ação.'); }
    finally { lock.current = false; if (context.current === current) setBusy(false); }
  }
  const apt = data?.aptidao, blocked = occupied || reading || !!error || !allowed;
  return <section className="operacoes-conferencia-detalhe" aria-label="Apuração na central de Operações">
    <h3 ref={heading} tabIndex={-1}>{item.name} · {competencia}</h3>
    {reading && <p role="status">Conferindo apuração e tentativa fiscal…</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {fiscalMessages.map((m,i)=><p key={i}>Mensagem da última conferência: {typeof m==='string'?m:[m.codigo,m.texto||m.mensagem].filter(Boolean).join(': ')}</p>)}
    {apt && <><p><strong>Tentativa fiscal:</strong> {fiscalLabels[apt.fiscal?.estado] || 'A verificar'}. {apt.fiscal?.motivo}</p>
      {apt.declaracao?.confirmada && <p>Declaração localizada/confirmada · origem {apt.declaracao.origem || 'DESCONHECIDA'} · {apt.declaracao.numeroDeclaracao || 'número indisponível'}.
        {apt.fiscal?.estado === 'DESCONHECIDA' && ' A tentativa Altan continua sem correlação; nenhuma nova transmissão está autorizada.'}</p>}
      {(apt.impedimentos || []).map((text, i) => <p key={i}>{typeof text === 'string' ? text : text.mensagem || text.message || 'Aptidão pendente'}</p>)}
      {(apt.pendencias || []).map((p, i) => <p key={i}>Pendência: {typeof p === 'string' ? p : p.motivo || p.message || 'Conferir evidência'}</p>)}
    </>}
    <div className="operacoes-acoes"><Button variant="secondary" disabled={occupied || reading} onClick={reload}>Recarregar estado fiscal</Button>
      <Button variant="secondary" disabled={blocked || form != null} onClick={() => setForm('calcular')}>Preparar cálculo individual</Button>
      <Button variant="secondary" disabled={blocked || apt?.capacidades?.retificar !== true} onClick={() => setAction('retificar')}>Reabrir para retificar</Button>
      <Button variant="secondary" disabled={blocked || apt?.capacidades?.reconciliar !== true} onClick={() => setAction('reconciliar')}>Conferir transmissão</Button>
      <Button variant="secondary" disabled={blocked || apt?.capacidades?.reconciliar !== true} onClick={() => setAction('encerrar')}>Encerrar tentativa não enviada</Button>
    </div>
    {action && <section aria-label="Confirmar ação fiscal"><p>{action === 'retificar' ? 'Reabrir preserva a declaração anterior. A transmissão da retificadora exige outra confirmação.' : action === 'encerrar' ? 'Confirmar encerramento da tentativa desta empresa e competência exibidas acima. O servidor somente encerrará se comprovar ausência de despacho; uma tentativa enviada ou incerta permanece protegida. Esta ação não transmite nem libera reenvio por ausência de resposta.' : 'Consultar/conferir a tentativa não autoriza reenviá-la. A consulta externa pode consumir o serviço contratado.'}</p>
      {action === 'retificar' && <label>Motivo da reabertura<textarea value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>}
      <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Cancelar ação</Button>
      <Button disabled={blocked || action === 'retificar' && !reason.trim()} onClick={perform}>Confirmar {action === 'retificar' ? 'reabertura' : action === 'encerrar' ? 'encerramento sem despacho' : 'conferência'}</Button>
    </section>}
    {!form && data && <FluxoPgdasPanel api={externalApi} dados={data.fechamento} companyId={item.companyId} competencia={competencia} razao={item.name} ocupado={blocked || ['DESCONHECIDA', 'EM_PROCESSAMENTO'].includes(apt?.fiscal?.estado)} onChanged={reload} />}
    {form && <FechamentoModal embedded disabled={!allowed || !!error} api={api} portalClientId={item.companyId} competencia={competencia} razao={item.name} retificar={form === 'retificar'} onBusyChange={setFormBusy} onChanged={reload} onClose={() => { if (!occupied) { setForm(null); void reload(); } }} />}
    {form && <Button variant="secondary" disabled={occupied} onClick={() => { setForm(null); void reload(); }}>Voltar à situação fiscal</Button>}
    <Button variant="secondary" disabled={occupied} onClick={() => { onChanged?.(); onClose?.(); }}>Voltar às operações</Button>
  </section>;
}