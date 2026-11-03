import { decidirCanaisAoLiberar, resumirWhatsapp } from '../guides/lib/canalDeEnvio';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';

const name = row => row.company.razao || row.company.razaoSocial || row.company.cnpj;
export function OperationsGuideActions({ api, rows, data, selected, competencia, stage, onChanged, onBusyChange }) {
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [results, setResults] = useState([]);
  const [whatsapp, setWhatsapp] = useState(false), [resend, setResend] = useState(false);
  const actionRef=useRef(null), previewHeading=useRef(null);
  useEffect(()=>{if(preview)previewHeading.current?.focus();},[preview]);
  const lock = useRef(false), context = useRef(0);
  const signature = JSON.stringify([competencia, rows.map(r => [r.company.companyId, r.company.myRole]), selected]);
  useEffect(() => { context.current++; setPreview(null); setResults([]); return () => { context.current++; }; }, [api, signature]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const chosen = rows.filter(r => selected[r.company.companyId] && ['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole));
  const documents = chosen.flatMap(r => (data[r.company.companyId]?.guides || []).filter(g => g.companyId === r.company.companyId && g.competencia === competencia).map(g => ({ ...g, row: r })));
  async function prepare(kind) {
    if (lock.current) return;
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
      for (const row of chosen) {
        const companyId = row.company.companyId;
        const cadastro = await api.listarContatosWhatsapp(companyId);
        if(run !== context.current) return;
        if(!['EMAIL','WHATSAPP','PERGUNTAR'].includes(cadastro?.canalPadraoEnvio)) throw Error('Configuração de canais indisponível. Nenhum envio iniciado.');
        const decisao=decidirCanaisAoLiberar(cadastro), whatsappRequested=decisao.whatsapp || (decisao.perguntar && whatsapp);
        const candidates = documents.filter(g => g.companyId === companyId && g.paymentStatus !== 'PAID').map(g => ({ guideId: g.guideId, reenviarConfirmado: resend }));
        if (!candidates.length) continue;
        const out = await api.previewOperationsGuideSend(companyId, competencia, { items: candidates, whatsappRequested });
        if (run !== context.current) return;
        if (out?.ok === false || out?.preview?.companyId !== companyId || out.preview.competencia !== competencia) throw Error('Prévia inválida; atualize as guias.');
        const requested=new Set(candidates.map(i=>i.guideId));
        if(!Array.isArray(out.preview.items) || new Set(out.preview.items.map(i=>i.guideId)).size!==out.preview.items.length || out.preview.items.some(i=>!requested.has(i.guideId)||!i.revisao||!Array.isArray(i.canais)||i.canais.some(c=>!['EMAIL','WHATSAPP'].includes(c))||!Array.isArray(i.destinatarios?.emails)||!Array.isArray(i.destinatarios?.telefones))) throw Error('Itens ou destinatários da prévia incompatíveis. Nenhum envio iniciado.');
        refused.push(...(out.preview.refused || []).map(i => `${name(row)} · ${i.guideId}: ${i.motivo}`));
        if (out.preview.token && out.preview.items?.length) items.push({ row, ...out.preview, whatsappRequested });
      }
      setPreview({ kind, items, refused, whatsapp });
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
  return <section aria-label="Ações das guias"><p>{chosen.length} empresas selecionadas. As ações usam somente documentos desta competência. Débito automático e INSS manual mantêm seus fluxos próprios.</p>
    {stage === 'enviado' && <div className="operacoes-acoes"><label><input type="checkbox" checked={whatsapp} disabled={busy} onChange={e => {setWhatsapp(e.target.checked);setPreview(null);}}/> Para preferência PERGUNTAR: incluir WhatsApp</label><label><input type="checkbox" checked={resend} disabled={busy} onChange={e => {setResend(e.target.checked);setPreview(null);}}/> Confirmar intenção de reenvio de documentos já enviados</label></div>}
    <div className="operacoes-acoes"><Button ref={actionRef} disabled={busy || !chosen.length || (stage === 'pago' && !api?.buscarPagamentoGuia) || (stage === 'enviado' && (!api?.previewOperationsGuideSend || !api?.listarContatosWhatsapp || !api?.sendGuidesTask))} onClick={() => prepare(stage === 'pago' ? 'payments' : stage === 'enviado' ? 'send' : 'capture')}>{stage === 'pago' ? 'Consultar pagamentos' : stage === 'enviado' ? 'Conferir envio / reenvio' : 'Consultar guias'}</Button></div>
    {preview && <div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir ação · {competencia}</h3>{preview.kind === 'capture' && <p>Consulta SERPRO pode gerar custo. Lucro Presumido pode executar duas chamadas pagas e gerar provisões; depende de flags e mês fechado. Parcelamentos e espécies sem integração devem ser consultados no fluxo individual, com seu alcance próprio.</p>}{preview.kind === 'payments' && <p>Somente guias OPEN listadas abaixo; pagas não serão consultadas novamente. Consulta pode gerar custo e não confirma pagamento por si só.</p>}{preview.kind === 'send' && <p>Revisão, canais e destinatários serão revalidados antes da saída. Preferências cadastradas e números ativos determinam os canais por empresa. E-mail já enviado é preservado quando o pedido é somente WhatsApp. Prévia expirada exige nova conferência.</p>}<ul>{preview.items.map((item,i) => <li key={i}>{name(item.row)} · {item.guideId || item.method || `Prévia válida até ${item.expiresAt}`}{item.items && <ul>{item.items.map(g => <li key={g.guideId}>{g.guideId} · revisão {g.revisao} · {g.canais.join(', ')} · {[...(g.destinatarios.emails || []), ...(g.destinatarios.telefones || []).map(t => t.telefoneE164)].join(', ')}</li>)}</ul>}</li>)}</ul>{preview.refused?.map((reason,i) => <p role="alert" key={i}>{reason}</p>)}{!preview.items.length && <p>Nenhum item elegível nesta seleção. Confira a aplicabilidade e o fluxo individual em Guias.</p>}<Button disabled={busy || !preview.items.length} onClick={execute}>Confirmar ação nos itens listados</Button> <Button variant="secondary" disabled={busy} onClick={() => {setPreview(null);actionRef.current?.focus();}}>Cancelar</Button></div>}
    {busy && <p role="status">Processando os itens conferidos…</p>}{results.map((r,i) => <p role="status" key={i}>{r}</p>)}
  </section>;
}
