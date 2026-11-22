import { createPortal } from 'react-dom';
import { OperationsGuideActions } from './OperationsGuideActions';
import { OperationsTablePagination } from './OperationsContextualTable';
import { operationsReadQueue } from './operationsReadQueue';
import { RegistrarEnvioExterno } from '../guides/list/components/RegistrarEnvioExterno';
import { Button } from '../../components/ui/Button';
import { useEffect, useRef, useState, useCallback } from 'react';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { lerEnvioDaGuia } from '../guides/lib/envioNaTela';
import { operationDate, operationInstant, operationMoney, reconcileOperationGuides, guideSendBlock } from './operationsDetails';

const paymentOrigin = (source, payment) => source === 'SERPRO' ? payment?.oficialComprovado === true ? 'Confirmada na Receita' : 'SERPRO · evidência a conferir' : ({CLIENTE:'Confirmada pelo cliente — declaração, não comprovante bancário',MANUAL:'Confirmada pelo contador'})[source] || 'Origem não informada';
export function OperationsGuides({ api, rows, visibleRows = rows, filteredRows = rows, competencia, stage, onBusyChange, footerTarget, onSuspendChange, onPreviewChange, companyRows = false }) {
  const [data, setData] = useState({}), [selected,setSelected] = useState({}), [version,setVersion] = useState(0), [busy,setBusy] = useState(false);
  const [reviewing,setReviewingState] = useState(false);
  const setReviewing = useCallback(value => {setReviewingState(value);},[]);
  const [external,setExternal] = useState(null), actions = useRef(null);
  const [paymentView,setPaymentView] = useState('confirmed');
  const [paymentFilter,setPaymentFilter] = useState('all');
  const [paidPage,setPaidPage] = useState(0);
  const [paymentDetail,setPaymentDetail] = useState(null);
  const [documentDetail, setDocumentDetail] = useState(null);
  const [downloadError, setDownloadError] = useState('');
  const downloadContext = useRef(0);
  useEffect(() => { downloadContext.current++; setDocumentDetail(null); return () => { downloadContext.current++; }; }, [api, competencia, stage]);
  const paymentTrigger=useRef(null), paymentHeading=useRef(null), paymentScroll=useRef(null);
  const documentHeading = useRef(null);
  useEffect(()=>{if(paymentDetail)paymentHeading.current?.focus({preventScroll:true});else paymentTrigger.current?.focus({preventScroll:true});},[paymentDetail]);
  useEffect(()=>{if(documentDetail)documentHeading.current?.focus({preventScroll:true});},[documentDetail]);
  useEffect(()=>{onPreviewChange?.(Boolean(paymentDetail || documentDetail || reviewing));return()=>onPreviewChange?.(false);},[paymentDetail,documentDetail,reviewing,onPreviewChange]);
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
  // A company with one paid guide belongs here even when other guides remain open.
  // Unknown/failed reads stay visible; they are never interpreted as no payment.
  const paymentRows = filteredRows.filter(row => {
    const source=data[row.company.companyId], result=source?.guides?reconciled(row):null;
    return !source || source.error || !result || source.evidenceError || result.guides.some(g=>g.paymentStatus===(paymentView==='open'?'OPEN':'PAID') && matchesPaymentFilter(g,source,paymentFilter));
  });
  const paymentPage=Math.min(paidPage,Math.max(0,Math.ceil(paymentRows.length/30)-1));
  const filteredIds=filteredRows.map(r=>r.company.companyId).join('|');
  useEffect(()=>{setPaidPage(0);},[filteredIds,paymentView,paymentFilter,competencia,api]);
  useEffect(()=>{setPaymentFilter('all');},[competencia,api,stage]);
  async function downloadGuide(guide) {
    if (busy || !api?.fetchGuidePdfBlob || guide.status !== 'PROCESSED') return;
    const run = downloadContext.current;
    setBusy(true); setDownloadError('');
    try {
      const blob = await api.fetchGuidePdfBlob(guide.companyId, guide.guideId);
      if (run !== downloadContext.current) return;
      if (!(blob instanceof Blob) || blob.type !== 'application/pdf' || !blob.size) throw Error('PDF indisponível.');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href=url; anchor.download=`guia-${guide.guideId}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (run === downloadContext.current) setDownloadError(error.message || 'Download não confirmado.'); }
    finally { if (run === downloadContext.current) setBusy(false); }
  }
  const groupedTable = <GuideCompanyRows rows={companyRows && stage==='pago' ? paymentRows.slice(paymentPage*30,paymentPage*30+30) : visibleRows} data={data} reconciled={reconciled}
    stage={stage} paymentView={paymentView} paymentFilter={paymentFilter} competencia={competencia} busy={busy}
    eligible={eligible} loading={loadingFilter} selected={effectiveSelection} setSelected={setSelected}
    onOpen={(row,g,event) => {
      paymentTrigger.current=event.currentTarget;
      const id=row.company.companyId, name=row.company.razao||row.company.razaoSocial||row.company.cnpj;
      if(stage==='pago' && g) setPaymentDetail({id,guideId:g.guideId,name});
      else setDocumentDetail({id,guideId:g?.guideId || null,name});
    }} />;
  if (stage === 'pago') {
    const detailSource=paymentDetail && data[paymentDetail.id];
    const detailGuide=detailSource?.guides?.find(g=>g.guideId===paymentDetail.guideId);
    const proof=detailSource?.evidence?.items.find(i=>i.guideId===detailGuide?.guideId), payment=proof?.pagamento;
    const back=()=>{setPaymentDetail(null);requestAnimationFrame(()=>{if(paymentScroll.current)paymentScroll.current.node.scrollTop=paymentScroll.current.top;paymentTrigger.current?.focus({preventScroll:true});});};
    const detailFooter=<>{detailGuide && <Button variant="secondary" disabled={busy || detailGuide.status !== "PROCESSED" || !api?.fetchGuidePdfBlob} onClick={() => downloadGuide(detailGuide)}>Baixar guia</Button>}<Button variant="secondary" disabled={busy} onClick={back}>Voltar</Button><InternalLink className="btn btn-secondary btn-md" href={`${companyTabPath(paymentDetail?.id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink></>;
    return <>
      <div hidden={Boolean(paymentDetail) || reviewing}>
        <label className="operacoes-payment-view">Visão de pagamentos<select aria-label="Visão de pagamentos" disabled={busy} value={paymentView} onChange={e=>{setPaymentView(e.target.value);setPaymentFilter('all');setSelected({});}}><option value="confirmed">Pagamentos confirmados</option><option value="open">Pendentes · conferir pagamento</option></select></label>
        {companyRows && paymentView==='confirmed' && <label className="operacoes-payment-view">Tipo de confirmação<select aria-label="Tipo de confirmação" disabled={busy} value={paymentFilter} onChange={e=>{setPaymentFilter(e.target.value);setSelected({});}}><option value="all">Todas as confirmações</option><option value="client">Cliente</option><option value="serpro">SERPRO</option><option value="manual">Contador</option><option value="recalculated">Recalculadas</option></select></label>}
        {selecting && <div className="operacoes-acoes"><Button variant="secondary" disabled={busy || loadingFilter || !eligible.length} onClick={()=>setSelected(Object.fromEntries(eligible.map(r=>[r.company.companyId,true])))}>Selecionar elegíveis ({eligible.length})</Button><span>{chosen.length} selecionadas · {hidden} em outras páginas{outsideFilter>0 && ` · ${outsideFilter} fora do filtro, não incluídas`}</span></div>}
        {companyRows && groupedTable}{companyRows && !paymentRows.length && <p>Nenhum pagamento confirmado nesta competência.</p>}<div hidden={companyRows} className="operacoes-tabela-scroll" role="region" aria-label="Guias pago" tabIndex={0}><table className="operacoes-tabela operacoes-payment-tabela"><thead><tr>{selecting && <th className="operacoes-coluna-selecao">Sel.</th>}<th>Empresa</th><th className="operacoes-desktop-cell">Guia</th><th>{selecting?'Em aberto':'Valor pago'}</th><th className="operacoes-desktop-cell">Data</th><th className="operacoes-desktop-cell">Origem</th><th>Ação</th></tr></thead><tbody>{visibleRows.flatMap(row=>{
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
        <p>{detailGuide.paymentStatus==='PAID'?paymentOrigin(payment?.origem||detailGuide.paymentStatusSource,payment):'Pagamento não confirmado'}</p>
        <table className="operacoes-tabela operacoes-detail-table"><tbody>{[['Guia',detailGuide.parcelamentoLabel||detailGuide.tipo],['Competência',detailGuide.competencia],['Revisão',proof?.revisao || 'A verificar'],['Valor nominal',operationMoney(detailGuide.valor)],['Valor pago',operationMoney(payment?.valorPago)],['Data do pagamento',operationDate(payment?.dataCivil)],['Vencimento',operationDate(detailGuide.vencimento)],['Confirmação',operationInstant(payment?.registradoEm)],['Baixa',payment?.estadoBaixa||detailGuide.confirmacaoCliente?.estadoBaixa||'Não informada'],['Entrega registrada',lerEnvioDaGuia(detailGuide).resumo]].map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{label}: {value}</td></tr>)}</tbody></table>
        {payment?.valorDeclarado != null && <p>Valor declarado pelo cliente: {operationMoney(payment.valorDeclarado)}</p>}
        {proof?.recalculo && <p className="operacoes-payment-recalculated">Guia recalculada · histórico preservado</p>}
        <h4>Composição da confirmação</h4>
        {(payment?.composicao?.length ? payment.composicao : [{principal:null,juros:null,multa:null}]).map((part,i)=><dl className="operacoes-payment-composition" key={i} aria-label={`Composição da confirmação ${i+1}`}><div><dt>Principal</dt><dd>{operationMoney(part.principal)}</dd></div><div><dt>Juros</dt><dd>{operationMoney(part.juros)}</dd></div><div><dt>Multa</dt><dd>{operationMoney(part.multa)}</dd></div></dl>)}
        {payment?.composicaoOrigem==='CONFIRMACAO_CLIENTE' && <p>Valores do documento confirmado pelo cliente; não representam comprovante bancário.</p>}
        {downloadError && <p role="alert">{downloadError}</p>}{proof?.tentativas?.map((t,i)=><p key={t.id||i}>{t.canal} · {t.destino} · {t.status} · {operationInstant(t.criadoEm)} · {t.revisaoCompativel===true?'Revisão vigente':'Revisão a conferir'}{t.causa&&` · ${t.causa}`}</p>)}{proof?.historicoLimitado&&<p>Histórico limitado; confira a empresa.</p>}
      </>}{footerTarget?createPortal(<div className="operacoes-acoes operacoes-destinos">{detailFooter}</div>,footerTarget):<div className="operacoes-acoes operacoes-destinos">{detailFooter}</div>}</section>}
      {companyRows && !paymentDetail && !reviewing && (footerTarget ? createPortal(<OperationsTablePagination page={paymentPage} total={paymentRows.length} onPage={setPaidPage} disabled={busy || loadingFilter}/>,footerTarget) : <OperationsTablePagination page={paymentPage} total={paymentRows.length} onPage={setPaidPage} disabled={busy || loadingFilter}/>)}
      {selecting && !paymentDetail && <OperationsGuideActions onPreviewChange={setReviewing} ref={actions} api={api} rows={filteredRows} data={data} selected={effectiveSelection} competencia={competencia} stage={stage} selectionPurpose="payments" footerTarget={footerTarget} onChanged={()=>setVersion(v=>v+1)} onBusyChange={setBusy}/>}
    </>;
  }
  return <>
    <div hidden={reviewing}>
    {selecting && !documentDetail && <div className="operacoes-acoes operacoes-guide-selection">
      <label>Selecionar para<select aria-label="Selecionar para" disabled={busy} value={selectionPurpose} onChange={event => {setSelectionPurpose(event.target.value);setSelected({});}}><option value="send">Envio de guias</option><option value="capture">Consulta SERPRO</option></select></label>
      {!companyRows && <Button variant="secondary" disabled={busy || loadingFilter || !eligible.length} onClick={() => setSelected(Object.fromEntries(eligible.map(r => [r.company.companyId,true])))}>Selecionar todas as elegíveis do filtro · {eligible.length}</Button>}
      {(!companyRows || chosen.length>0) && <Button variant="secondary" disabled={busy || !chosen.length} onClick={() => setSelected({})}>Limpar seleção</Button>}
      <span role="status">{loadingFilter ? 'Conferindo empresas do filtro…' : !companyRows ? `${hidden} selecionadas em outras páginas` : chosen.length ? `${chosen.length} selecionadas · ${hidden} em outras páginas` : ''}{outsideFilter > 0 && ` · ${outsideFilter} fora do filtro, não incluídas`}</span>
    </div>}
    {companyRows && <div hidden={Boolean(documentDetail)}>{groupedTable}</div>}
    {companyRows && documentDetail && <div className="operacoes-document-detail"><h3 ref={documentHeading} tabIndex={-1}>{documentDetail.name} · {documentDetail.guideId ? 'Detalhes da guia' : 'Escolha a guia'}</h3><Button variant="secondary" disabled={busy} onClick={() => {setDocumentDetail(null); requestAnimationFrame(() => paymentTrigger.current?.focus());}}>Voltar às empresas</Button></div>}
    {downloadError && <p role="alert">{downloadError}</p>}
    <div hidden={companyRows && !documentDetail} className="operacoes-tabela-scroll" role="region" aria-label={`Guias ${stage}`} tabIndex={0}><table className="operacoes-tabela operacoes-guias-tabela"><thead><tr>{selecting && <th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar empresas elegíveis desta página" disabled={busy || !pageEligible.length} checked={pageEligible.length > 0 && pageEligible.every(r => effectiveSelection[r.company.companyId])} onChange={e => setSelected(old => ({...old,...Object.fromEntries(pageEligible.map(r => [r.company.companyId,e.target.checked]))}))}/></th>}<th>Empresa</th><th>Guia</th><th>{stage === 'enviado' ? 'Canal / destino / resultado' : stage === 'pago' ? paymentView === 'confirmed' ? 'Pagamento confirmado' : 'Pagamento em aberto' : 'Disponibilidade'}</th><th>Valor</th><th>Ações</th></tr></thead><tbody>{visibleRows.filter(row => !companyRows || row.company.companyId === documentDetail?.id).flatMap(row => {
      const {company} = row, id = company.companyId, source = data[id], name = company.razao || company.razaoSocial || company.cnpj;
      const result = source?.guides ? reconciled(row) : null;
      const error = source?.error || (source?.guides && !result ? 'Documento repetido no retorno' : null);
      const documents = result?.guides.filter(g => stage !== 'pago' || g.paymentStatus === (paymentView === 'confirmed' ? 'PAID' : 'OPEN')) || [];
      const entries = [...documents.filter(g => !companyRows || !documentDetail?.guideId || g.guideId === documentDetail.guideId).map(g => ({g,key:g.guideId})), ...(!companyRows && availableStage ? result?.missing || [] : []).map((item,i) => ({item,key:item.key || i}))];
      const isParcel = entry => Boolean(entry.g?.parcelamentoId || entry.g?.parcelamentoLabel || entry.g?.numeroParcela != null || entry.item?.parcela || entry.item?.parcelamentoId);
      entries.sort((a,b) => Number(isParcel(a)) - Number(isParcel(b)));
      if (!entries.length) entries.push({key:'empty'});
      return entries.map(({g,item,key},index) => {
        const proof = source?.evidence?.items.find(i => i.guideId === g?.guideId), payment = proof?.pagamento;
        const expected = row.guideSummary?.items?.find(i => g && i.guideId === g.guideId);
        const block = stage === 'pago' ? null : g ? guideSendBlock(g,proof) : 'Sem guia disponível para envio';
        const label = g?.parcelamentoLabel || expected?.label || g?.tipo || item?.label || '—';
        const state = g ? ({PROCESSED:'Disponível',NEEDS_REVIEW:'Em conferência',PROCESSING:'Em processamento',ERROR:'Erro de processamento',VAZIO:g.vazioPor && g.vazioEm ? 'Dispensado' : 'Ausência registrada',DOCUMENTO_NAO_ARRECADATORIO:'Documento não arrecadatório'})[g.status] || 'A verificar' : item ? item.dispensada ? item.documento : item.revisar ? 'A verificar' : 'Indisponível' : null;
        return <tr key={`${id}:${key}`}>
          {index === 0 && <>{selecting && <td rowSpan={entries.length} className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || !eligible.some(r => r.company.companyId === id)} checked={Boolean(effectiveSelection[id])} onChange={e => setSelected(old => ({...old,[id]:e.target.checked}))}/></label></td>}<th scope="rowgroup" rowSpan={entries.length}>{name}{row.manualInss?.status === 'DOCUMENT_REVIEW' && <small>INSS · Documento para revisão</small>}{error && <p role="alert">Leitura de guias: {error}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>}{source?.evidenceError && <p role="alert">Evidências: {source.evidenceError}</p>}{source?.evidence?.nextOffset != null && <Button variant="secondary" size="sm" disabled={busy} onClick={() => moreEvidence(id)}>Carregar mais evidências</Button>}</th></>}
          <td><small>{isParcel({g,item}) ? 'Parcelamentos' : 'Tributos'} · {g?.competencia || competencia}</small>{label}{g?.numeroParcela != null && !expected?.parcela && <small>Parcela {g.numeroParcela}</small>}{g?.vencimento && <small>Vencimento {operationDate(g.vencimento)}</small>}</td>
          <td>{!source ? <span role="status">Lendo documentos salvos…</span> : !g && !item && !error ? <span>{stage === 'pago' ? paymentView === 'confirmed' ? 'Nenhum pagamento confirmado nesta competência.' : 'Nenhuma guia em aberto nesta competência.' : 'Nenhum documento identificado nesta competência. Isso não dispensa obrigações.'}</span> : availableStage ? <>{state}{g && expected?.documento && expected.documento !== state && <small>Expectativa: {expected.documento}</small>}</> : stage === 'pago' && g ? paymentView === 'open' ? <><p>Pagamento não confirmado</p><small>Competência {g.competencia} · Vencimento {operationDate(g.vencimento)}</small></> : <><p>{paymentOrigin(payment?.origem || g.paymentStatusSource)}</p><small>Data do pagamento: {operationDate(payment?.dataCivil)}</small></> : g ? <><p>{lerEnvioDaGuia(g).resumo}</p>{(proof?.envios || g.envio?.canais || []).map((c,i) => <div key={c.id || i}>{c.canal} · {c.destino || 'Destino não registrado'} · {c.status || 'A verificar'}<small>{operationInstant(c.lidoEm || c.entregueEm || c.enviadoEm || c.em)}</small>{(c.causa || c.erroMensagem) && <p role="alert">Falha: {c.causa || c.erroMensagem}</p>}</div>)}</> : null}
            {g && !availableStage && <details><summary>{stage === 'pago' ? `Detalhes do pagamento de ${label}` : 'Detalhes do documento'}</summary>{stage === 'pago' && paymentView === 'confirmed' && <><p>Entrega registrada: {lerEnvioDaGuia(g).resumo}</p><p>Confirmação: {operationInstant(payment?.registradoEm)}</p><p>Baixa: {payment?.estadoBaixa || g.confirmacaoCliente?.estadoBaixa || 'Não informada'}</p></>}<p>{g.competencia} · Vencimento {operationDate(g.vencimento)}</p>{stage !== 'pago' && <p>{g.paymentStatus === 'PAID' ? paymentOrigin(g.paymentStatusSource) : `Pagamento não confirmado · ${({CLIENTE:'Origem: informação do cliente',SERPRO:'Origem: consulta SERPRO',MANUAL:'Origem: registro manual'})[g.paymentStatusSource] || 'Origem não informada'}`}</p>}{proof?.tentativas?.map((t,i) => <p key={t.id || i}>{t.canal} · {t.destino} · {t.status} · {operationInstant(t.criadoEm)} · {t.revisaoCompativel === true ? 'Revisão vigente' : 'Revisão a conferir'}{t.causa && ` · ${t.causa}`}</p>)}{proof?.historicoLimitado && <p>Histórico limitado; confira a empresa.</p>}</details>}
          </td><td className="operacoes-moeda">{g ? operationMoney(stage === 'pago' && paymentView === 'confirmed' ? payment?.valorPago : g.valor) : '—'}{stage === 'pago' && paymentView === 'confirmed' && g && <small>Valor nominal: {operationMoney(g.valor)}</small>}</td>
          <td><div className="operacoes-acoes">{g && <Button size="sm" variant="secondary" disabled={busy || g.status !== "PROCESSED" || !api?.fetchGuidePdfBlob} onClick={() => downloadGuide(g)}>Baixar guia</Button>}{stage !== 'pago' && g && <Button size="sm" disabled={busy || !g || !permitted(row) || Boolean(block) || Boolean(source?.evidenceError) || !api?.previewOperationsGuideSend || !api?.sendGuidesTask || !api?.listarContatosWhatsapp} onClick={event => actions.current?.prepareSend(g,event.currentTarget)}>{stage === 'enviado' ? 'Reenviar guia' : 'Enviar guia'}</Button>}<InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink>{stage === 'enviado' && g && permitted(row) && <Button size="sm" variant="secondary" disabled={busy || Boolean(guideSendBlock(g,proof,{allowPaid:true})) || !api?.preverEnvioExternoGuia || !api?.registrarEnvioExternoGuia} onClick={() => setExternal(g)}>Registrar envio externo</Button>}</div>{g && block && block !== state && <p>{block}</p>}</td>
        </tr>;
      });
    })}</tbody></table></div>
    </div>{selecting && <OperationsGuideActions onPreviewChange={setReviewing} ref={actions} api={api} rows={filteredRows} data={data} selected={effectiveSelection} competencia={competencia} stage={stage} selectionPurpose={selectionPurpose} footerTarget={footerTarget} onChanged={() => setVersion(v => v + 1)} onBusyChange={setBusy}/>}
    {external && createPortal(<RegistrarEnvioExterno api={api} companyId={external.companyId} guia={external} aoFechar={() => setExternal(null)} aoSalvar={() => setVersion(v => v + 1)}/>, document.body)}
  </>;
}

function matchesPaymentFilter(guide, source, filter) {
  const proof=source?.evidence?.items.find(item=>item.guideId===guide.guideId);
  return filter==='all' || (filter==='recalculated' ? Boolean(proof?.recalculo) : ({client:'CLIENTE',serpro:'SERPRO',manual:'MANUAL'})[filter]===(proof?.pagamento?.origem||guide.paymentStatusSource));
}
function GuideCompanyRows({ rows, data, reconciled, stage, paymentView, paymentFilter, competencia, busy, eligible, loading, selected, setSelected, onOpen }) {
  const paidView = stage === 'pago', selecting = !paidView || paymentView === 'open';
  const labelFor = g => g.parcelamentoLabel || g.tipo || 'Guia';
  const stateFor = (g, proof) => paidView ? g.paymentStatus === 'PAID' ? `${proof?.recalculo ? 'Recalculada · ' : ''}Paga` : 'Pagamento não confirmado'
    : stage === 'enviado' ? lerEnvioDaGuia(g).resumo
    : g.status==='VAZIO' ? g.vazioPor && g.vazioEm ? 'Dispensado' : 'Ausência registrada' : ({ PROCESSED:'Disponível', NEEDS_REVIEW:'Em conferência', PROCESSING:'Em processamento', ERROR:'Erro de processamento' })[g.status] || 'A verificar';
  return <div className="operacoes-tabela-scroll" role="region" aria-label={`Empresas · Guias ${stage}`} tabIndex={0}>
    <table className="operacoes-tabela operacoes-company-guides"><thead><tr>
      {selecting && <th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar todas as empresas elegíveis do filtro" disabled={busy || loading || !eligible.length} checked={eligible.length>0 && eligible.every(r=>selected[r.company.companyId])} onChange={e=>setSelected(Object.fromEntries(eligible.map(r=>[r.company.companyId,e.target.checked])))}/></th>}
      <th>Empresa</th><th>Guias</th>{paidView ? <><th>Data</th><th>Valor pago</th><th>Origem</th></> : stage==='enviado' ? <><th>Canal de envio</th><th>Erros</th></> : <th>Valor disponível</th>}<th>Ações</th>
    </tr></thead><tbody>{rows.map(row=>{
      const id=row.company.companyId, source=data[id], result=source?.guides?reconciled(row):null;
      const name=row.company.razao||row.company.razaoSocial||row.company.cnpj;
      const regime = row.operation?.regime || row.company.regime || row.company.regimeTributario;
      const regimeLabel = ({SIMPLES:'Simples Nacional',SIMPLES_NACIONAL:'Simples Nacional',PRESUMIDO:'Lucro Presumido',LUCRO_PRESUMIDO:'Lucro Presumido',REAL:'Lucro Real',LUCRO_REAL:'Lucro Real',MEI:'MEI'})[regime] || regime || 'Regime a conferir';
      const guides=(result?.guides||[]).filter(g=>!paidView||g.paymentStatus===(paymentView==='open'?'OPEN':'PAID')&&matchesPaymentFilter(g,source,paymentFilter));
      const missing=paidView||stage==='enviado'?[]:result?.missing||[];
      const proofFor = g => source?.evidence?.items.find(p=>p.guideId===g.guideId);
      const channelsFor = g => proofFor(g)?.envios?.length ? proofFor(g).envios : g.envio?.canais || [];
      const errorFor = g => [...channelsFor(g),...(proofFor(g)?.tentativas || [])].filter(c=>c.causa || c.erroMensagem || ['falhou','indeterminado','enviando','INCERTO','EM_PROCESSAMENTO'].includes(c.status));
      const guideValues = render => guides.length ? guides.map(g=><div className="operacoes-guide-fact" key={g.guideId}><small>{labelFor(g)}</small>{render(g,proofFor(g))}</div>) : <span>—</span>;
      return <tr key={id}>
        {selecting && <td><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy || !eligible.some(r=>r.company.companyId===id)} checked={Boolean(selected[id])} onChange={e=>setSelected(old=>({...old,[id]:e.target.checked}))}/></td>}
        <th scope="row">{name}<small>{regimeLabel}</small><small>{row.company.cnpj||'CNPJ não informado'}</small>{row.manualInss?.status==='DOCUMENT_REVIEW'&&<small>INSS · Documento para revisão</small>}</th>
        <td><div className="operacoes-guide-tags">{guides.map(g=>{
          const proof=proofFor(g),sendState=lerEnvioDaGuia(g),failed=g.status==='ERROR'||stage==='enviado'&&sendState.algumFalhou;
          const valid=paidView?g.paymentStatus==='PAID':stage==='enviado'?['EXTERNA','ENVIADA_EMAIL','ENTREGUE','LIDA'].includes(sendState.situacao):g.status==='PROCESSED';
          return <button type="button" className={`operacoes-guide-tag ${failed?'operacoes-guide-tag-error':valid?'operacoes-guide-tag-valid':''}${paidView&&proof?.recalculo?' operacoes-guide-tag-recalculated':''}`} disabled={busy} key={g.guideId} aria-label={`${labelFor(g)} · ${stateFor(g,proof)} · ${name}`} onClick={e=>onOpen(row,g,e)}>{labelFor(g)}<small>{stateFor(g,proof)}</small></button>;
        })}{missing.map((item,i)=><span className="operacoes-guide-tag" key={item.key||i}>{item.label || 'Guia'}<small>{item.dispensada?item.documento:item.revisar?'A verificar':'Indisponível'}</small></span>)}</div>
          {!source?<span role="status">Lendo documentos salvos…</span>:source.error||!result?<p role="alert">Leitura de guias: {source.error||'Identidade documental a conferir'}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>:!guides.length&&!missing.length?<span>{paidView?'Nenhum pagamento identificado neste recorte.':'Nenhum documento identificado; exigibilidade a conferir.'}</span>:null}
          {source?.evidenceError&&<p role="alert">{source.evidenceError}</p>}{source?.evidence?.nextOffset!=null&&<small>Há mais evidências no detalhe da empresa.</small>}
        </td>
        {paidView ? <><td>{guideValues((g,p)=>operationDate(p?.pagamento?.dataCivil))}</td><td className="operacoes-moeda">{guideValues((g,p)=>p?.pagamento?.valorPago != null ? operationMoney(p.pagamento.valorPago) : p?.pagamento?.valorDeclarado != null ? <>{operationMoney(p.pagamento.valorDeclarado)}<small>Declarado pelo cliente</small></> : 'Não disponível')}</td><td>{guideValues((g,p)=>({CLIENTE:'Cliente',MANUAL:'Contador',SERPRO:'SERPRO'})[p?.pagamento?.origem||g.paymentStatusSource]||'A verificar')}</td></> : stage==='enviado' ? <><td>{guideValues(g=>channelsFor(g).map(c=>`${c.canal} · ${c.status}`).join(' / ')||'Canal a verificar')}</td><td>{guideValues(g=>errorFor(g).length ? errorFor(g).map(c=>`${c.canal || 'Envio'}: ${c.causa||c.erroMensagem||'Resultado incerto; conferir antes de repetir'}`).join(' · ') : 'Sem falha registrada')}</td></> : <td className="operacoes-moeda">{guideValues(g=>g.status==='PROCESSED'?operationMoney(g.valor):'Não disponível')}</td>}
        <td><div className="operacoes-row-actions">{stage==='enviado'&&guides.length>0&&<><Button size="sm" variant="secondary" disabled={busy} onClick={e=>onOpen(row,guides.length===1?guides[0]:null,e)}>Reenviar</Button><Button size="sm" variant="secondary" disabled={busy} onClick={e=>onOpen(row,guides.length===1?guides[0]:null,e)}>Marcar envio manual</Button></>}<InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias</InternalLink></div></td>
      </tr>;
    })}</tbody></table>
  </div>;
}
