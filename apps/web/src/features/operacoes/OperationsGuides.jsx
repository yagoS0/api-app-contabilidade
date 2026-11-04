import { createPortal } from 'react-dom';
import { OperationsGuideActions } from './OperationsGuideActions';
import { operationsReadQueue } from './operationsReadQueue';
import { RegistrarEnvioExterno } from '../guides/list/components/RegistrarEnvioExterno';
import { Button } from '../../components/ui/Button';
import { useEffect, useRef, useState, useCallback } from 'react';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { lerEnvioDaGuia } from '../guides/lib/envioNaTela';
import { operationDate, operationInstant, operationMoney, reconcileOperationGuides, guideSendBlock } from './operationsDetails';

const paymentOrigin = source => ({CLIENTE:'Confirmada pelo cliente — declaração, não comprovante bancário',SERPRO:'Confirmada na Receita',MANUAL:'Confirmada pelo contador'})[source] || 'Origem não informada';
export function OperationsGuides({ api, rows, visibleRows = rows, filteredRows = rows, competencia, stage, onBusyChange, footerTarget, onSuspendChange, onPreviewChange }) {
  const [data, setData] = useState({}), [selected,setSelected] = useState({}), [version,setVersion] = useState(0), [busy,setBusy] = useState(false);
  const [reviewing,setReviewingState] = useState(false);
  const setReviewing = useCallback(value => {setReviewingState(value);onPreviewChange?.(value);},[onPreviewChange]);
  const [external,setExternal] = useState(null), actions = useRef(null);
  const [paymentView,setPaymentView] = useState('confirmed');
  const [paymentDetail,setPaymentDetail] = useState(null);
  const paymentTrigger=useRef(null), paymentHeading=useRef(null), paymentScroll=useRef(null);
  useEffect(()=>{if(paymentDetail)paymentHeading.current?.focus({preventScroll:true});else paymentTrigger.current?.focus({preventScroll:true});onPreviewChange?.(Boolean(paymentDetail));},[paymentDetail,onPreviewChange]);
  const [selectionPurpose,setSelectionPurpose] = useState(stage === 'pago' ? 'payments' : 'send');
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  useEffect(()=>{setPaymentDetail(null);},[api,ids,competencia,stage]);
  useEffect(() => {
    let active = true; setData({});
    operationsReadQueue(ids.split('|').filter(Boolean), async id => {
      let value;
      try {
        if (!api?.getCompanyGuides) throw Error('Leitura de documentos indisponível');
        const guides = await api.getCompanyGuides(id);
        if (!active) return;
        if (!Array.isArray(guides) || guides.some(g => !g || g.companyId !== id || !g.guideId)) throw Error('Resposta de documentos inválida');
        value = { guides };
        if(api.getOperationsGuideEvidence) {
          try { const evidence = await api.getOperationsGuideEvidence(id,competencia); if(evidence?.companyId!==id || evidence.competencia!==competencia || !Array.isArray(evidence.items)) throw Error('Resposta de evidências inválida'); value.evidence=evidence; }
          catch(e) { value.evidenceError=e.message; }
        }
      } catch (e) { value = { error: e.message }; }
      if (active) setData(old => ({ ...old, [id]: value }));
    }, { isActive: () => active });
    return () => { active = false; };
  }, [api, ids, competencia, version]);
  useEffect(()=>{setSelected({});setExternal(null);setPaymentView('confirmed');setSelectionPurpose(stage === 'pago' ? 'payments' : 'send');},[api,ids,competencia,stage]);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  useEffect(()=>{onSuspendChange?.(Boolean(external));return()=>onSuspendChange?.(false);},[external,onSuspendChange]);
  async function moreEvidence(id) {
    const source=data[id];if(busy||source?.evidence?.nextOffset==null)return;
    setBusy(true);
    try { const next=await api.getOperationsGuideEvidence(id,competencia,source.evidence.nextOffset);
      if(next?.companyId!==id||next.competencia!==competencia||!Array.isArray(next.items))throw Error('Resposta de evidências inválida');
      setData(old=>old[id]!==source?old:({...old,[id]:{...source,evidence:{...next,items:[...source.evidence.items,...next.items]}}}));
    }catch(e){setData(old=>old[id]!==source?old:({...old,[id]:{...source,evidenceError:e.message}}));}finally{setBusy(false);}
  }
  const permitted = row => ['ACCOUNTANT','FIRM_ADMIN'].includes(row.company.myRole);
  const reconciled = row => { try { return reconcileOperationGuides(data[row.company.companyId]?.guides || [], row, competencia); } catch { return null; } };
  // Capture allows companies without documents; send validates each document separately.
  const canSend = (row, guide) => !data[row.company.companyId]?.evidenceError && !guideSendBlock(guide, data[row.company.companyId]?.evidence?.items.find(item => item.guideId === guide.guideId));
  const eligible = filteredRows.filter(row => {
    const source = data[row.company.companyId], result = reconciled(row);
    return (stage !== 'pago' || paymentView === 'open') && permitted(row) && Array.isArray(source?.guides) && result && (selectionPurpose === 'capture' || result.guides.some(guide => selectionPurpose === 'payments' ? guide.paymentStatus === 'OPEN' : canSend(row, guide)));
  });
  const loadingFilter = filteredRows.some(row => !data[row.company.companyId]);
  const inFilter = new Set(filteredRows.map(r => r.company.companyId));
  const eligibleIds = new Set(eligible.map(row => row.company.companyId));
  const effectiveSelection = Object.fromEntries(Object.entries(selected).filter(([id]) => inFilter.has(id) && eligibleIds.has(id)));
  const outsideFilter = Object.entries(selected).filter(([id, value]) => value && !inFilter.has(id)).length;
  const chosen = eligible.filter(r => effectiveSelection[r.company.companyId]);
  const hidden = chosen.filter(r => !visibleRows.some(v => v.company.companyId === r.company.companyId)).length;
  const pageEligible = eligible.filter(r => visibleRows.some(v => v.company.companyId === r.company.companyId));
  const availableStage = !['enviado','pago'].includes(stage);
  const selecting = stage !== 'pago' || paymentView === 'open';
  if (stage === 'pago') {
    const detailSource=paymentDetail && data[paymentDetail.id];
    const detailGuide=detailSource?.guides?.find(g=>g.guideId===paymentDetail.guideId);
    const proof=detailSource?.evidence?.items.find(i=>i.guideId===detailGuide?.guideId), payment=proof?.pagamento;
    const back=()=>{setPaymentDetail(null);requestAnimationFrame(()=>{if(paymentScroll.current)paymentScroll.current.node.scrollTop=paymentScroll.current.top;paymentTrigger.current?.focus({preventScroll:true});});};
    const detailFooter=<><Button variant="secondary" disabled={busy} onClick={back}>Voltar</Button><InternalLink className="btn btn-secondary btn-md" href={`${companyTabPath(paymentDetail?.id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink></>;
    return <>
      <div hidden={Boolean(paymentDetail) || reviewing}>
        <label className="operacoes-payment-view">Visão de pagamentos<select aria-label="Visão de pagamentos" disabled={busy} value={paymentView} onChange={e=>{setPaymentView(e.target.value);setSelected({});}}><option value="confirmed">Pagamentos confirmados</option><option value="open">Pendentes · conferir pagamento</option></select></label>
        {selecting && <div className="operacoes-acoes"><Button variant="secondary" disabled={busy || loadingFilter || !eligible.length} onClick={()=>setSelected(Object.fromEntries(eligible.map(r=>[r.company.companyId,true])))}>Selecionar elegíveis ({eligible.length})</Button><span>{chosen.length} selecionadas · {hidden} em outras páginas{outsideFilter>0 && ` · ${outsideFilter} fora do filtro, não incluídas`}</span></div>}
        <div className="operacoes-tabela-scroll" role="region" aria-label="Guias pago" tabIndex={0}><table className="operacoes-tabela operacoes-payment-tabela"><thead><tr>{selecting && <th className="operacoes-coluna-selecao">Sel.</th>}<th>Empresa</th><th className="operacoes-desktop-cell">Guia</th><th>{selecting?'Em aberto':'Valor pago'}</th><th className="operacoes-desktop-cell">Data</th><th className="operacoes-desktop-cell">Origem</th><th>Ação</th></tr></thead><tbody>{visibleRows.flatMap(row=>{
          const id=row.company.companyId,name=row.company.razao||row.company.razaoSocial||row.company.cnpj,source=data[id],result=source?.guides?reconciled(row):null;
          const error=source?.error||(source?.guides&&!result?'Documento repetido no retorno':null);
          const guides=result?.guides.filter(g=>g.paymentStatus===(selecting?'OPEN':'PAID'))||[];
          return (guides.length?guides:[null]).map((g,index)=>{
            const evidence=source?.evidence?.items.find(i=>i.guideId===g?.guideId),paid=evidence?.pagamento;
            const origin=({CLIENTE:'Cliente',MANUAL:'Contador',SERPRO:'Receita'})[paid?.origem||g?.paymentStatusSource]||'A verificar';
            return <tr key={`${id}:${g?.guideId||'empty'}`}>
              {index===0 && <>{selecting && <td rowSpan={guides.length||1} className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy||!eligibleIds.has(id)} checked={Boolean(effectiveSelection[id])} onChange={e=>setSelected(old=>({...old,[id]:e.target.checked}))}/></label></td>}<th scope="rowgroup" rowSpan={guides.length||1}>{name}{row.manualInss?.status==='DOCUMENT_REVIEW' && <small>INSS · Documento para revisão</small>}{error && <p role="alert">Leitura de guias: {error}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>}{source?.evidenceError && <p role="alert">Evidências: {source.evidenceError}</p>}{source?.evidence?.nextOffset!=null && <Button variant="secondary" size="sm" disabled={busy} onClick={()=>moreEvidence(id)}>Carregar mais evidências</Button>}</th></>}
              <td className="operacoes-desktop-cell">{g?.parcelamentoLabel||g?.tipo||'—'}</td><td>{g?<>{operationMoney(selecting?g.valor:paid?.valorPago)}<small className="operacoes-mobile-cell">{g.parcelamentoLabel||g.tipo} · {selecting?'Pagamento não confirmado':`${operationDate(paid?.dataCivil)} · ${origin}`}</small></>:!source?<span role="status">Lendo documentos salvos…</span>:!error?<span>{selecting?'Nenhuma guia em aberto nesta competência.':'Nenhum pagamento confirmado nesta competência.'}</span>:null}</td>
              <td className="operacoes-desktop-cell">{g?operationDate(paid?.dataCivil):'—'}</td><td className="operacoes-desktop-cell">{g?origin:'—'}</td><td>{g?<Button size="sm" variant="secondary" disabled={busy} aria-label={`Detalhes do pagamento de ${g.parcelamentoLabel||g.tipo} · ${name}`} onClick={e=>{paymentTrigger.current=e.currentTarget;const node=e.currentTarget.closest('.modal-corpo');paymentScroll.current=node?{node,top:node.scrollTop}:null;setPaymentDetail({id,guideId:g.guideId,name});}}>Detalhes</Button>:<InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink>}</td>
            </tr>;
          });
        })}</tbody></table></div>
      </div>
      {paymentDetail && <section aria-label="Detalhes do pagamento"><h3 ref={paymentHeading} tabIndex={-1}>{paymentDetail.name} · {competencia}</h3>{!detailGuide?<p role="alert">Documento alterado ou indisponível. Confira Guias.</p>:<>
        <p>{detailGuide.paymentStatus==='PAID'?paymentOrigin(payment?.origem||detailGuide.paymentStatusSource):'Pagamento não confirmado'}</p>
        <table className="operacoes-tabela operacoes-detail-table"><tbody>{[['Guia',detailGuide.parcelamentoLabel||detailGuide.tipo],['Competência',detailGuide.competencia],['Valor nominal',operationMoney(detailGuide.valor)],['Valor pago',operationMoney(payment?.valorPago)],['Data do pagamento',operationDate(payment?.dataCivil)],['Vencimento',operationDate(detailGuide.vencimento)],['Confirmação',operationInstant(payment?.registradoEm)],['Baixa',payment?.estadoBaixa||detailGuide.confirmacaoCliente?.estadoBaixa||'Não informada'],['Entrega registrada',lerEnvioDaGuia(detailGuide).resumo]].map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{label}: {value}</td></tr>)}</tbody></table>
        {proof?.tentativas?.map((t,i)=><p key={t.id||i}>{t.canal} · {t.destino} · {t.status} · {operationInstant(t.criadoEm)} · {t.revisaoCompativel===true?'Revisão vigente':'Revisão a conferir'}{t.causa&&` · ${t.causa}`}</p>)}{proof?.historicoLimitado&&<p>Histórico limitado; confira a empresa.</p>}
      </>}{footerTarget?createPortal(<div className="operacoes-acoes operacoes-destinos">{detailFooter}</div>,footerTarget):<div className="operacoes-acoes operacoes-destinos">{detailFooter}</div>}</section>}
      {selecting && !paymentDetail && <OperationsGuideActions onPreviewChange={setReviewing} ref={actions} api={api} rows={filteredRows} data={data} selected={effectiveSelection} competencia={competencia} stage={stage} selectionPurpose="payments" footerTarget={footerTarget} onChanged={()=>setVersion(v=>v+1)} onBusyChange={setBusy}/>}
    </>;
  }
  return <>
    <div hidden={reviewing}>{stage === 'pago' && <div className="operacoes-filtros operacoes-payment-view"><label>Visão de pagamentos<select aria-label="Visão de pagamentos" disabled={busy} value={paymentView} onChange={event => {setPaymentView(event.target.value);setSelected({});}}><option value="confirmed">Pagamentos confirmados</option><option value="open">Pendentes · conferir pagamento</option></select></label><p>{paymentView === 'confirmed' ? 'Confirmações registradas nesta competência.' : 'Selecione empresas com guias em aberto visíveis nesta lista. A consulta exige prévia e pode gerar custo.'}</p></div>}{selecting && <div className="operacoes-acoes operacoes-guide-selection">{stage !== 'pago' && <label>Selecionar para<select aria-label="Selecionar para" disabled={busy} value={selectionPurpose} onChange={event => {setSelectionPurpose(event.target.value);setSelected({});}}><option value="send">Envio de guias</option><option value="capture">Consulta SERPRO</option></select></label>}<Button variant="secondary" disabled={busy || loadingFilter || !eligible.length} onClick={() => setSelected(Object.fromEntries(eligible.map(r => [r.company.companyId,true])))}>Selecionar todas as elegíveis do filtro · {eligible.length}</Button><Button variant="secondary" disabled={busy || !chosen.length} onClick={() => setSelected({})}>Limpar seleção</Button><span role="status">{loadingFilter ? "Conferindo empresas do filtro…" : `${hidden} selecionadas em outras páginas`}{outsideFilter > 0 && ` · ${outsideFilter} fora do filtro, não incluídas`}</span></div>}
    <div className="operacoes-tabela-scroll" role="region" aria-label={`Guias ${stage}`} tabIndex={0}><table className="operacoes-tabela operacoes-guias-tabela"><thead><tr>{selecting && <th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar empresas elegíveis desta página" disabled={busy || !pageEligible.length} checked={pageEligible.length > 0 && pageEligible.every(r => effectiveSelection[r.company.companyId])} onChange={e => setSelected(old => ({...old,...Object.fromEntries(pageEligible.map(r => [r.company.companyId,e.target.checked]))}))}/></th>}<th>Empresa</th><th>Guia</th><th>{stage === 'enviado' ? 'Canal / destino / resultado' : stage === 'pago' ? paymentView === 'confirmed' ? 'Pagamento confirmado' : 'Pagamento em aberto' : 'Disponibilidade'}</th><th>Valor</th><th>Ações</th></tr></thead><tbody>{visibleRows.flatMap(row => {
      const {company} = row, id = company.companyId, source = data[id], name = company.razao || company.razaoSocial || company.cnpj;
      const result = source?.guides ? reconciled(row) : null;
      const error = source?.error || (source?.guides && !result ? 'Documento repetido no retorno' : null);
      const documents = result?.guides.filter(g => stage !== 'pago' || g.paymentStatus === (paymentView === 'confirmed' ? 'PAID' : 'OPEN')) || [];
      const entries = [...documents.map(g => ({g,key:g.guideId})), ...(availableStage ? result?.missing || [] : []).map((item,i) => ({item,key:item.key || i}))];
      if (!entries.length) entries.push({key:'empty'});
      return entries.map(({g,item,key},index) => {
        const proof = source?.evidence?.items.find(i => i.guideId === g?.guideId), payment = proof?.pagamento;
        const expected = row.guideSummary?.items?.find(i => g && i.guideId === g.guideId);
        const block = stage === 'pago' ? null : g ? guideSendBlock(g,proof) : 'Sem guia disponível para envio';
        const label = g?.parcelamentoLabel || expected?.label || g?.tipo || item?.label || '—';
        const state = g ? ({PROCESSED:'Disponível',NEEDS_REVIEW:'Em conferência',PROCESSING:'Em processamento',ERROR:'Erro de processamento',VAZIO:g.vazioPor && g.vazioEm ? 'Dispensado' : 'Ausência registrada',DOCUMENTO_NAO_ARRECADATORIO:'Documento não arrecadatório'})[g.status] || 'A verificar' : item ? item.dispensada ? item.documento : item.revisar ? 'A verificar' : 'Indisponível' : null;
        return <tr key={`${id}:${key}`}>
          {index === 0 && <>{selecting && <td rowSpan={entries.length} className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || !eligible.some(r => r.company.companyId === id)} checked={Boolean(effectiveSelection[id])} onChange={e => setSelected(old => ({...old,[id]:e.target.checked}))}/></label></td>}<th scope="rowgroup" rowSpan={entries.length}>{name}{row.manualInss?.status === 'DOCUMENT_REVIEW' && <small>INSS · Documento para revisão</small>}{error && <p role="alert">Leitura de guias: {error}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>}{source?.evidenceError && <p role="alert">Evidências: {source.evidenceError}</p>}{source?.evidence?.nextOffset != null && <Button variant="secondary" size="sm" disabled={busy} onClick={() => moreEvidence(id)}>Carregar mais evidências</Button>}</th></>}
          <td>{label}{g?.numeroParcela != null && !expected?.parcela && <small>Parcela {g.numeroParcela}</small>}</td>
          <td>{!source ? <span role="status">Lendo documentos salvos…</span> : !g && !item && !error ? <span>{stage === 'pago' ? paymentView === 'confirmed' ? 'Nenhum pagamento confirmado nesta competência.' : 'Nenhuma guia em aberto nesta competência.' : 'Nenhum documento identificado nesta competência. Isso não dispensa obrigações.'}</span> : availableStage ? <>{state}{g && expected?.documento && expected.documento !== state && <small>Expectativa: {expected.documento}</small>}</> : stage === 'pago' && g ? paymentView === 'open' ? <><p>Pagamento não confirmado</p><small>Competência {g.competencia} · Vencimento {operationDate(g.vencimento)}</small></> : <><p>{paymentOrigin(payment?.origem || g.paymentStatusSource)}</p><small>Data do pagamento: {operationDate(payment?.dataCivil)}</small></> : g ? <><p>{lerEnvioDaGuia(g).resumo}</p>{(proof?.envios || g.envio?.canais || []).map((c,i) => <div key={c.id || i}>{c.canal} · {c.destino || 'Destino não registrado'} · {c.status || 'A verificar'}<small>{operationInstant(c.lidoEm || c.entregueEm || c.enviadoEm || c.em)}</small>{(c.causa || c.erroMensagem) && <p role="alert">Falha: {c.causa || c.erroMensagem}</p>}</div>)}</> : null}
            {g && !availableStage && <details><summary>{stage === 'pago' ? `Detalhes do pagamento de ${label}` : 'Detalhes do documento'}</summary>{stage === 'pago' && paymentView === 'confirmed' && <><p>Entrega registrada: {lerEnvioDaGuia(g).resumo}</p><p>Confirmação: {operationInstant(payment?.registradoEm)}</p><p>Baixa: {payment?.estadoBaixa || g.confirmacaoCliente?.estadoBaixa || 'Não informada'}</p></>}<p>{g.competencia} · Vencimento {operationDate(g.vencimento)}</p>{stage !== 'pago' && <p>{g.paymentStatus === 'PAID' ? paymentOrigin(g.paymentStatusSource) : `Pagamento não confirmado · ${({CLIENTE:'Origem: informação do cliente',SERPRO:'Origem: consulta SERPRO',MANUAL:'Origem: registro manual'})[g.paymentStatusSource] || 'Origem não informada'}`}</p>}{proof?.tentativas?.map((t,i) => <p key={t.id || i}>{t.canal} · {t.destino} · {t.status} · {operationInstant(t.criadoEm)} · {t.revisaoCompativel === true ? 'Revisão vigente' : 'Revisão a conferir'}{t.causa && ` · ${t.causa}`}</p>)}{proof?.historicoLimitado && <p>Histórico limitado; confira a empresa.</p>}</details>}
          </td><td className="operacoes-moeda">{g ? operationMoney(stage === 'pago' && paymentView === 'confirmed' ? payment?.valorPago : g.valor) : '—'}{stage === 'pago' && paymentView === 'confirmed' && g && <small>Valor nominal: {operationMoney(g.valor)}</small>}</td>
          <td><div className="operacoes-acoes">{stage !== 'pago' && g && <Button size="sm" disabled={busy || !g || !permitted(row) || Boolean(block) || Boolean(source?.evidenceError) || !api?.previewOperationsGuideSend || !api?.sendGuidesTask || !api?.listarContatosWhatsapp} onClick={event => actions.current?.prepareSend(g,event.currentTarget)}>{stage === 'enviado' ? 'Reenviar guia' : 'Enviar guia'}</Button>}<InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink>{stage === 'enviado' && g && permitted(row) && <Button size="sm" variant="secondary" disabled={busy || Boolean(guideSendBlock(g,proof,{allowPaid:true})) || !api?.preverEnvioExternoGuia || !api?.registrarEnvioExternoGuia} onClick={() => setExternal(g)}>Registrar envio externo</Button>}</div>{g && block && block !== state && <p>{block}</p>}</td>
        </tr>;
      });
    })}</tbody></table></div>
    </div>{selecting && <OperationsGuideActions onPreviewChange={setReviewing} ref={actions} api={api} rows={filteredRows} data={data} selected={effectiveSelection} competencia={competencia} stage={stage} selectionPurpose={selectionPurpose} footerTarget={footerTarget} onChanged={() => setVersion(v => v + 1)} onBusyChange={setBusy}/>}
    {external && createPortal(<RegistrarEnvioExterno api={api} companyId={external.companyId} guia={external} aoFechar={() => setExternal(null)} aoSalvar={() => setVersion(v => v + 1)}/>, document.body)}
  </>;
}
