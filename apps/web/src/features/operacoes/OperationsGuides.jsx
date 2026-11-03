import { OperationsGuideActions } from './OperationsGuideActions';
import { CompanyGuideDelivery } from './CompanyGuideDelivery';
import { Button } from '../../components/ui/Button';
import { useEffect, useState } from 'react';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { lerEnvioDaGuia } from '../guides/lib/envioNaTela';
import { operationDate, operationInstant, operationMoney, reconcileOperationGuides } from './operationsDetails';

export function OperationsGuides({ api, rows, visibleRows = rows, competencia, stage, onManualInss, onBusyChange }) {
  const [data, setData] = useState({}), [selected,setSelected] = useState({}), [version,setVersion] = useState(0), [busy,setBusy] = useState(false);
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  useEffect(() => {
    let active = true; setData({});
    (async () => {
      for (const id of ids.split('|').filter(Boolean)) {
        let value;
        try {
          if (!api?.getCompanyGuides) throw Error('Leitura de documentos indisponível');
          const guides = await api.getCompanyGuides(id);
          if (!Array.isArray(guides)) throw Error('Resposta de documentos inválida');
          value = { guides };
          if(api.getOperationsGuideEvidence) {
            try { const evidence = await api.getOperationsGuideEvidence(id,competencia); if(evidence?.companyId!==id || evidence.competencia!==competencia || !Array.isArray(evidence.items)) throw Error('Resposta de evidências inválida'); value.evidence=evidence; }
            catch(e) { value.evidenceError=e.message; }
          }
        } catch (e) { value = { error: e.message }; }
        if (!active) return;
        setData(old => ({ ...old, [id]: value }));
      }
    })();
    return () => { active = false; };
  }, [api, ids, competencia, version]);
  useEffect(()=>{setSelected({});},[api,ids,competencia,stage]);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  async function moreEvidence(id) {
    const source=data[id];if(busy||source?.evidence?.nextOffset==null)return;
    setBusy(true);
    try { const next=await api.getOperationsGuideEvidence(id,competencia,source.evidence.nextOffset);
      if(next?.companyId!==id||next.competencia!==competencia||!Array.isArray(next.items))throw Error('Resposta de evidências inválida');
      setData(old=>old[id]!==source?old:({...old,[id]:{...source,evidence:{...next,items:[...source.evidence.items,...next.items]}}}));
    }catch(e){setData(old=>old[id]!==source?old:({...old,[id]:{...source,evidenceError:e.message}}));}finally{setBusy(false);}
  }
  const writable = visibleRows.filter(r=>['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole)&&data[r.company.companyId]?.guides);
  return <>
    <p>As barras contam empresas. Pagamento, envio e disponibilidade são evidências separadas.</p>
    <div className="operacoes-tabela-scroll" role="region" aria-label={`Guias ${stage}`} tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar empresas elegíveis exibidas" disabled={busy||!writable.length} checked={writable.length>0&&writable.every(r=>selected[r.company.companyId])} onChange={e=>setSelected(old=>({...old,...Object.fromEntries(writable.map(r=>[r.company.companyId,e.target.checked]))}))}/></th><th>Empresa</th><th>{stage==='disponivel'?'Guia esperada / documento':'Guia'}</th><th>{stage==='enviado'?'Canal / destino / resultado':stage==='pago'?'Pagamento confirmado':'Disponibilidade / valor'}</th><th>Detalhes / ações</th></tr></thead><tbody>{visibleRows.map(row=>{
      const {company}=row, id=company.companyId, source=data[id], name=company.razao||company.razaoSocial||company.cnpj;
      let result,error=source?.error;
      if(source?.guides){try{result=reconcileOperationGuides(source.guides,row,competencia);}catch(e){error=e.message;}}
      const documents=result?.guides.filter(g=>stage!=='pago'||g.paymentStatus==='PAID')||[];
      return <tr key={id}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name}`} disabled={busy||!writable.some(r=>r.company.companyId===id)} checked={Boolean(selected[id])} onChange={e=>setSelected(old=>({...old,[id]:e.target.checked}))}/></label></td><th scope="row">{name}{row.manualInss&&<><small>INSS manual · {({PENDING_DOCUMENT:'Aguardando documento',DOCUMENT_REVIEW:'Documento para revisão',DOCUMENT_AVAILABLE:'Documento disponível',DOCUMENT_ABSENT:'Ausência registrada',NOT_APPLICABLE:'Não aplicável'})[row.manualInss.status]||'A verificar'}</small><Button size="sm" variant="secondary" disabled={busy} onClick={()=>onManualInss?.(row)}>Ver detalhes do INSS manual</Button></>}</th><td colSpan={2}>
        {!source&&<p role="status">Lendo documentos salvos…</p>}{error&&<p role="alert">Leitura de guias: {error}. Abra Guias para conferir a fonte; não há confirmação de ausência.</p>}
        {(stage==='disponivel'||stage==='guias')&&<div aria-label="Cobertura das obrigações e parcelas da barra">{(row.guideSummary?.items||[]).filter(item=>!documents.some(g=>g.guideId===item.guideId)).map(item=><div className="operacoes-guia-linha" key={item.key}><strong>{item.label}</strong><span>{item.documento} · {operationMoney(result?.guides.find(g=>g.guideId===item.guideId)?.valor)}<small>Envio: {item.comunicacao} · Pagamento: {item.pagamento}</small></span></div>)}</div>}
        {documents.map(g=>{const proof=source.evidence?.items.find(i=>i.guideId===g.guideId),payment=proof?.pagamento,expected=row.guideSummary?.items?.find(i=>i.guideId===g.guideId);return <div className="operacoes-guia-linha" key={g.guideId}><strong>{g.parcelamentoLabel||expected?.label||g.tipo||'Tipo a verificar'}{g.numeroParcela!=null&&` · Parcela ${g.numeroParcela}`}</strong><div>
          {stage==='pago'?<><strong>Valor pago: <span className="operacoes-moeda">{operationMoney(payment?.valorPago)}</span></strong><small>Valor nominal: {operationMoney(g.valor)}{g.valorRecalculado!=null&&` · Recalculado: ${operationMoney(g.valorRecalculado)}`}</small><p>{({CLIENTE:'Confirmada pelo cliente — declaração, não comprovante bancário',SERPRO:'Confirmada na Receita',MANUAL:'Confirmada pelo contador'})[payment?.origem||g.paymentStatusSource]||'Origem não informada'}</p><small>Data do pagamento: {operationDate(payment?.dataCivil)}</small><small>Confirmação: {operationInstant(payment?.registradoEm)}</small><small>Baixa: {payment?.estadoBaixa||g.confirmacaoCliente?.estadoBaixa||'Não informada'}</small></>:stage==='enviado'?<><p>{lerEnvioDaGuia(g).resumo}</p>{(proof?.envios||g.envio?.canais||[]).map((c,i)=><div key={c.id||c.tentativaId||i}>{c.canal} · {c.destino||'Destino não registrado'} · {c.status||'A verificar'}<small>{operationInstant(c.lidoEm||c.entregueEm||c.enviadoEm||c.em)}</small>{(c.causa||c.erroMensagem)&&<p>Falha: {c.causa||c.erroMensagem}</p>}</div>)}</>:<><strong className="operacoes-moeda">{operationMoney(g.valor)}</strong><small>{({PROCESSED:'Processado',NEEDS_REVIEW:'Em conferência',PROCESSING:'Em processamento',ERROR:'Erro de processamento',VAZIO:'Ausência registrada',DOCUMENTO_NAO_ARRECADATORIO:'Documento não arrecadatório'})[g.status]||'A verificar'}</small></>}
          <details><summary>Documento {g.guideId}</summary><p>{g.competencia} · Vencimento {operationDate(g.vencimento)}</p>{expected&&<p>Expectativa: {expected.documento} · Envio: {expected.comunicacao} · Pagamento: {expected.pagamento}</p>}{stage!=='pago'&&<p>{g.paymentStatus==='PAID'?({CLIENTE:'Confirmada pelo cliente — declaração, não comprovante bancário',SERPRO:'Confirmada na Receita',MANUAL:'Confirmada pelo contador'})[g.paymentStatusSource]||'Origem não informada':'Pagamento não confirmado'}{g.paymentStatus!=='PAID'&&` · ${{CLIENTE:'Origem: informação do cliente',SERPRO:'Origem: consulta SERPRO',MANUAL:'Origem: registro manual'}[g.paymentStatusSource]||'Origem não informada'}`}</p>}<p>Revisão: {proof?.revisao||g.versaoPagamento||'Não informada'}</p>{proof?.tentativas?.map(t=><p key={t.id}>Tentativa {t.id} · {t.canal} · {t.destino} · {t.status} · {operationInstant(t.criadoEm)} · Revisão {t.revisaoCompativel===true?'compatível':t.revisaoCompativel===false?'histórica':'não comprovada'}{t.causa&&` · ${t.causa}`}</p>)}{proof?.historicoLimitado&&<p>Histórico limitado; confira a empresa.</p>}{stage!=='enviado'&&(proof?.envios||g.envio?.canais||[]).map((c,i)=><p key={c.id||i}>{c.canal} · {c.destino||'Destino não registrado'} · {c.status}{(c.causa||c.erroMensagem)&&<span>Falha: {c.causa||c.erroMensagem}</span>}</p>)}{(proof?.envios||g.envio?.canais||[]).some(c=>['indeterminado','enviando','INCERTO','EM_PROCESSAMENTO'].includes(c.status))&&<p>Resultado incerto ou em processamento exige conciliação antes de repetir envio.</p>}</details>
        </div></div>;})}
        {result&&!documents.length&&<p>{stage==='pago'?'Nenhuma guia paga identificada neste retorno.':'Nenhum documento identificado nesta competência.'} Isso não dispensa obrigações.</p>}{result?.missing.length>0&&<p>Sem documento reconciliado por identidade: {result.missing.map(i=>i.label||i.key).join(', ')}. Confira vigência e débito automático.</p>}
      </td><td>{source?.evidenceError&&<p role="alert">Evidências: {source.evidenceError}</p>}{source?.evidence?.nextOffset!=null&&<div><p>Este retorno é limitado; há mais evidências.</p><Button variant="secondary" size="sm" disabled={busy} onClick={()=>moreEvidence(id)}>Carregar mais evidências</Button></div>}{api?.getCompanyGuideDelivery&&<details><summary>Comunicação da empresa</summary><CompanyGuideDelivery api={api} companyId={id} competencia={competencia}/></details>}<InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id,'guides')}?competencia=${encodeURIComponent(competencia)}`}>Abrir Guias — conferir canais e reenvio</InternalLink></td></tr>;
    })}</tbody></table></div>
    <OperationsGuideActions api={api} rows={rows} data={data} selected={selected} competencia={competencia} stage={stage} onChanged={()=>setVersion(v=>v+1)} onBusyChange={setBusy}/>
  </>;
}
