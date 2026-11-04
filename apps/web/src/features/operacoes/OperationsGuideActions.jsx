import { createPortal } from 'react-dom';
import { guideSendBlock, reconcileOperationGuides, operationMoney, operationInstant, operationDate } from './operationsDetails';
import { decidirCanaisAoLiberar, resumirWhatsapp } from '../guides/lib/canalDeEnvio';
import { forwardRef, useImperativeHandle, useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '../../components/ui/Button';

const name = row => row.company.razao || row.company.razaoSocial || row.company.cnpj;
export const OperationsGuideActions = forwardRef(function OperationsGuideActions({ api, rows, data, selected, competencia, stage, onChanged, onBusyChange, footerTarget, selectionPurpose = 'send', onPreviewChange }, ref) {
  const [preview, setPreviewState] = useState(null), [busy, setBusy] = useState(false), [results, setResults] = useState([]);
  const setPreview = useCallback(value => { setPreviewState(value); onPreviewChange?.(Boolean(value)); }, [onPreviewChange]);
  const [whatsapp, setWhatsapp] = useState(false), [resend, setResend] = useState(false);
  const actionRef=useRef(null), previewHeading=useRef(null), triggerRef=useRef(null), resultRef=useRef(null), previewWasOpen=useRef(false);
  useEffect(()=>{
    if(preview) previewHeading.current?.focus();
    else if(previewWasOpen.current && !busy) (triggerRef.current?.isConnected ? triggerRef.current : actionRef.current)?.focus();
    previewWasOpen.current = Boolean(preview);
  },[preview,busy]);
  useEffect(() => { if (!busy && results.length) resultRef.current?.focus(); }, [busy, results]);
  const lock = useRef(false), context = useRef(0);
  const signature = JSON.stringify([competencia, rows.map(r => [r.company.companyId, r.company.myRole]), selected, stage, selectionPurpose]);
  useEffect(() => { context.current++; setPreview(null); setResults([]); return () => { context.current++; }; }, [api, signature, setPreview]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => { context.current++; setPreview(null); }, [data, setPreview]);
  const chosen = rows.filter(r => selected[r.company.companyId] && ['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole));
  const documentsFor = list => list.flatMap(r => { try { return reconcileOperationGuides(data[r.company.companyId]?.guides || [], r, competencia).guides.map(g => ({ ...g, row: r })); } catch { return []; } });
  const documents = documentsFor(chosen);
  const canSend = g => !data[g.companyId]?.evidenceError && !guideSendBlock(g, data[g.companyId]?.evidence?.items.find(i => i.guideId === g.guideId));
  useImperativeHandle(ref, () => ({ prepareSend: (guide, trigger) => prepare('send', guide, trigger) }));
  async function prepare(kind, onlyGuide, trigger = document.activeElement, options = {whatsapp,resend}) {
    if (lock.current) return;
    triggerRef.current = trigger;
    setResults([]); const run = context.current;
    if (kind === 'payments') { setPreview({ kind, items: documents.filter(g => g.paymentStatus === 'OPEN') }); return; }
    if (kind === 'capture') {
      // Only integrations established for the company's actual regime are offered.
      const items = chosen.flatMap(row => {
        const regime = String(row.company.regime || row.company.regimeTributario || '').toUpperCase();
        const methods = regime.includes('SIMPLES') ? ['captureSerproPgdasd'] : regime.includes('PRESUMIDO') ? ['captureSerproLp'] : [];
        if (!row.manualInss && row.guideSummary?.items?.some(i => i.key === 'inss')) methods.push('syncSerproInss');
        return methods.filter(method => api?.[method]).map(method => ({ row, method }));
      });
      setPreview({ kind, items }); return;
    }
    lock.current = true; setBusy(true);
    try {
      const items = [], refused = [];
      let perguntar = false, resendRelevant = false;
      for (const row of (onlyGuide ? rows.filter(r => r.company.companyId === onlyGuide.companyId && ['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole)) : chosen)) {
        const companyId = row.company.companyId;
        const candidates = documentsFor([row]).filter(g => (!onlyGuide || g.guideId === onlyGuide.guideId) && canSend(g)).map(g => ({ guideId: g.guideId, reenviarConfirmado: options.resend }));
        if (!candidates.length) continue;
        const cadastro = await api.listarContatosWhatsapp(companyId);
        if(run !== context.current) return;
        if(!['EMAIL','WHATSAPP','PERGUNTAR'].includes(cadastro?.canalPadraoEnvio)) throw Error('Configuração de canais indisponível. Nenhum envio iniciado.');
        const decisao=decidirCanaisAoLiberar(cadastro), whatsappRequested=decisao.whatsapp || (decisao.perguntar && options.whatsapp);
        perguntar ||= decisao.perguntar;
        resendRelevant ||= documentsFor([row]).some(g => candidates.some(c => c.guideId === g.guideId) && (g.envio?.jaEnviada || g.emailStatus === "SENT"));
        const out = await api.previewOperationsGuideSend(companyId, competencia, { items: candidates, whatsappRequested });
        if (run !== context.current) return;
        if (out?.ok === false || out?.preview?.companyId !== companyId || out.preview.competencia !== competencia) throw Error('Prévia inválida; atualize as guias.');
        const requested=new Set(candidates.map(i=>i.guideId));
        if(!Array.isArray(out.preview.items) || new Set(out.preview.items.map(i=>i.guideId)).size!==out.preview.items.length || out.preview.items.some(i=>!requested.has(i.guideId)||!i.revisao||!Array.isArray(i.canais)||i.canais.some(c=>!['EMAIL','WHATSAPP'].includes(c))||!Array.isArray(i.destinatarios?.emails)||!Array.isArray(i.destinatarios?.telefones))) throw Error('Itens ou destinatários da prévia incompatíveis. Nenhum envio iniciado.');
        refused.push(...(out.preview.refused || []).map(i => `${name(row)} · ${i.guideId}: ${i.motivo}`));
        if (out.preview.token && out.preview.items?.length) items.push({ row, ...out.preview, whatsappRequested, perguntar:decisao.perguntar, resendRelevant:documentsFor([row]).some(g => candidates.some(c => c.guideId === g.guideId) && (g.envio?.jaEnviada || g.emailStatus === "SENT")) });
      }
      setPreview({ kind, items, refused, onlyGuide, perguntar, resendRelevant });
    } catch (e) { if (run === context.current) setResults([e.message]); }
    finally { lock.current = false; setBusy(false); }
  }
  async function execute() {
    if (lock.current || !preview?.items.length) return;
    const action = preview, run = context.current;
    lock.current = true; setBusy(true); setPreview(null); setResults([]);
    try {
      for (const item of action.items) {
        if (run !== context.current) return;
        let result;
        try {
          let out;
          if (action.kind === 'payments') out = await api.buscarPagamentoGuia(item.guideId);
          else if (action.kind === 'capture') out = await api[item.method](item.row.company.companyId, { competencia });
          else out = await api.sendGuidesTask(item.companyId, { items: item.items.map(i => ({ guideId:i.guideId, reenviarConfirmado:i.reenviarConfirmado })), competencia, operationsPreviewToken:item.token, whatsappRequested:item.whatsappRequested });
          if(action.kind === 'send') {
            if(!Array.isArray(out)) throw Error('Resultados por guia indisponíveis; confira o histórico.');
            const expected=new Set(item.items.map(i=>i.guideId));
            if(out.some(r=>!expected.has(r.guideId)) || new Set(out.map(r=>r.guideId)).size!==out.length) throw Error('Identidade dos resultados incompatível.');
            const messages=item.items.map(g=>{const r=out.find(r=>r.guideId===g.guideId);const detail=r?.whatsapp ? `E-mail: ${r.email?.message || (r.email?.envio?.preservado?'Preservado, sem reenvio':'Confira o histórico deste canal')}. ${resumirWhatsapp(r.whatsapp).texto}` : r?.texto;return `${g.guideId}: ${detail || 'Resultado não confirmado; confira histórico e canais antes de repetir.'}`;});
            result=`${name(item.row)} · ${messages.join(' · ')}`;
          } else result = `${name(item.row)}${item.guideId ? ` · ${item.guideId}` : ''}: ${out?.message || out?.mensagem || (out?.ok === true ? 'Solicitação processada. Confira o resultado salvo por guia/canal.' : 'Resultado não confirmado. Confira a fonte antes de repetir.')}`;
        } catch (e) { result = `${name(item.row)}: ${e.message}. Resultado incerto; concilie na empresa antes de repetir.`; }
        if (run !== context.current) return;
        setResults(old => [...old, result]);
      }
      onChanged?.();
    } finally { lock.current = false; setBusy(false); }
  }
  const controls = preview ? <div className="operacoes-guide-footer"><Button disabled={busy || !preview.items.length} onClick={execute}>Confirmar ação nos itens listados</Button> <Button variant="secondary" disabled={busy} onClick={() => {setPreview(null);(triggerRef.current?.isConnected ? triggerRef.current : actionRef.current)?.focus();}}>Cancelar</Button></div> : <div className="operacoes-guide-footer">{stage !== 'pago' && <Button ref={actionRef} disabled={busy || selectionPurpose === 'capture' || !documents.some(canSend) || !api?.previewOperationsGuideSend || !api?.listarContatosWhatsapp || !api?.sendGuidesTask} onClick={() => prepare('send')}>{stage === 'enviado' ? 'Conferir envio / reenvio' : 'Enviar selecionadas'}</Button>}<Button variant="secondary" disabled={busy || !chosen.length || (stage === 'pago' && !api?.buscarPagamentoGuia)} onClick={() => prepare(stage === 'pago' ? 'payments' : 'capture')}>{stage === 'pago' ? 'Consultar pagamentos' : 'Consultar guias · SERPRO'}</Button><span>{chosen.length} empresas selecionadas</span></div>;
  return <section aria-label="Ações das guias">{footerTarget ? createPortal(controls, footerTarget) : controls}

    {preview && <div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir ação · {competencia}</h3>{preview.kind === 'capture' && <p>Consulta SERPRO pode gerar custo. Lucro Presumido pode executar duas chamadas pagas e gerar provisões; depende de flags e mês fechado. Parcelamentos e espécies sem integração devem ser consultados no fluxo individual, com seu alcance próprio.</p>}{preview.kind === 'payments' && <p>Somente guias OPEN listadas abaixo; pagas não serão consultadas novamente. Consulta pode gerar custo e não confirma pagamento por si só.</p>}{preview.kind === 'send' && <p>Revisão, canais e destinatários serão revalidados antes da saída. Preferências cadastradas e números ativos determinam os canais por empresa. E-mail já enviado é preservado quando o pedido é somente WhatsApp. Prévia expirada exige nova conferência.</p>}{preview.kind === 'send' && <div className="operacoes-acoes">{preview.perguntar && <label><input type="checkbox" checked={whatsapp} disabled={busy} onChange={e=>{const value=e.target.checked;setWhatsapp(value);prepare('send',preview.onlyGuide,triggerRef.current,{whatsapp:value,resend});}}/> Incluir WhatsApp nas empresas que pedem confirmação</label>}{preview.resendRelevant && <label><input type="checkbox" checked={resend} disabled={busy} onChange={e=>{const value=e.target.checked;setResend(value);prepare('send',preview.onlyGuide,triggerRef.current,{whatsapp,resend:value});}}/> Reenviar documentos já enviados</label>}</div>}
      <div className="operacoes-tabela-scroll"><table className="operacoes-tabela"><thead><tr><th>Empresa</th><th>Guia / consulta</th><th>Valor</th>{preview.kind === 'send' && <><th>Canal</th><th>Destinatário</th></>}</tr></thead><tbody>{preview.items.flatMap((item,index)=>(item.items || [item]).map((g,j)=>{
        const source = documentsFor([item.row]).find(doc=>doc.guideId===g.guideId);
        const label = source?.parcelamentoLabel || source?.tipo || ({captureSerproPgdasd:'DAS Simples',captureSerproLp:'Tributos do Lucro Presumido',syncSerproInss:'INSS'})[item.method] || 'Guia';
        return <tr key={`${index}:${j}`}><th scope="rowgroup">{name(item.row)}</th><td>{label}{source?.vencimento && <small>Vencimento: {operationDate(source.vencimento)}</small>}</td><td className="operacoes-moeda">{operationMoney(source?.valor)}</td>{preview.kind === 'send' && <><td>{g.canais.join(', ')}</td><td>{[...(g.destinatarios.emails || []), ...(g.destinatarios.telefones || []).map(t=>t.telefoneE164)].join(', ')}</td></>}</tr>;
      }))}</tbody></table></div>{preview.kind === 'send' && <details><summary>Detalhes da conferência</summary>{preview.items.map((item,i)=><div key={i}><p>{name(item.row)} · Validade: {operationInstant(item.expiresAt)}</p>{item.items.map(g=><p key={g.guideId}>Documento {g.guideId} · Revisão {g.revisao}</p>)}</div>)}</details>}{preview.refused?.map((reason,i) => <p role="alert" key={i}>{reason}</p>)}{!preview.items.length && <p>Nenhum item elegível nesta seleção. Confira a aplicabilidade e o fluxo individual em Guias.</p>}</div>}
    <div ref={resultRef} tabIndex={-1} aria-live="polite">{busy && <p role="status">Processando os itens conferidos…</p>}{results.map((r,i) => <p role="status" key={i}>{r}</p>)}</div>
  </section>;
});
