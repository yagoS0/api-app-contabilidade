import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared';
import { validIdentity, validCivilDate, validReferenceResponse, civilLabel } from './referenciaVencimentoView';
import './referenciaVencimento.css';

const blank = {dataCivil:'',descricaoFonte:'',motivo:'',confirmacao:false};
// Mount with key companyId + tributo; parent must prevent context change while onDirty is true.
export function ReferenciaVencimentoEditor({api,companyId,companyName,tributo,canEdit=false,onDirty,onReview}) {
  const [identity,setIdentity]=useState({tributo,tipoPeriodo:'',competencia:''});
  const [saved,setSaved]=useState(null),[draft,setDraft]=useState(blank),[step,setStep]=useState('identity');
  const [action,setAction]=useState('CONFIRMAR'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false);
  const seq=useRef(0),pending=useRef(null),lock=useRef(false),heading=useRef(null),trigger=useRef(null),identityFocus=useRef(null),status=useRef(null);
  const dirty=step==='edit'||step==='preview'||uncertain;
  useEdicaoPendente(dirty);
  useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
  useEffect(()=>{seq.current++;return()=>{seq.current++;};},[api,companyId,tributo]);
  useEffect(()=>{if(step==='preview')heading.current?.focus();},[step]);
  useEffect(()=>{onReview?.(step==='preview');return()=>onReview?.(false);},[step,onReview]);
  const activeIdentity=identity.tributo===tributo && validIdentity(identity);
  const feedback = text => {setNotice(text);requestAnimationFrame(()=>status.current?.focus());};
  async function read() {
    if(lock.current||!activeIdentity)return;
    const ticket=++seq.current;lock.current=true;setBusy(true);setError('');
    try {const result=await api.getDueDateReference(companyId,identity);if(ticket!==seq.current)return;
      if(!validReferenceResponse(result,companyId,identity))throw Error('Resposta da referência incompatível. Confira novamente.');
      if(pending.current){feedback('Leitura conferida. Confirme o resultado repetindo a mesma solicitação; não foi criada outra referência.');return;}
      setSaved(result);setStep('summary');setConflict(false);
    }catch(e){if(ticket===seq.current)setError(e.message||'Não foi possível ler a referência.');}
    finally{if(ticket===seq.current){lock.current=false;setBusy(false);}}
  }
  function edit(kind) {if(!canEdit||busy||pending.current||!saved)return;setAction(kind);setDraft({...blank,dataCivil:saved.reference?.dataCivil||'',descricaoFonte:saved.reference?.descricaoFonte||''});setStep('edit');setError('');setNotice('');}
  function discard() {if(busy||pending.current)return;setDraft(blank);setStep(conflict?'identity':'summary');if(conflict)setSaved(null);setConflict(false);requestAnimationFrame(()=>(conflict?identityFocus.current:trigger.current)?.focus());}
  const fieldsValid=action==='REVOGAR'?Boolean(draft.motivo.trim()):validCivilDate(draft.dataCivil)&&Boolean(draft.descricaoFonte.trim())&&draft.confirmacao&&Boolean(draft.motivo.trim());
  async function save() {
    if(lock.current||!canEdit||!saved||!fieldsValid||conflict||!activeIdentity)return;
    if(!pending.current)pending.current={identidade:{...identity},acao:action,expectedRevision:saved.revision,requestId:crypto.randomUUID(),motivo:draft.motivo.trim(),...(action==='CONFIRMAR'?{dataCivil:draft.dataCivil,origem:'CONFIRMADA_CONTADOR',descricaoFonte:draft.descricaoFonte.trim(),confirmacao:true}:{})};
    const command=pending.current,ticket=++seq.current;lock.current=true;setBusy(true);setError('');
    try {const result=await api.saveDueDateReference(companyId,command);if(ticket!==seq.current)return;
      if(!validReferenceResponse(result,companyId,identity)||result.revision!==command.expectedRevision+1||result.reference?.status!==(command.acao==='REVOGAR'?'REVOGADA':'ATIVA')||(command.acao==='CONFIRMAR'&&(result.reference.dataCivil!==command.dataCivil||result.reference.descricaoFonte!==command.descricaoFonte)))throw Error('Resultado do registro não confirmado. Confira a mesma solicitação.');
      pending.current=null;setUncertain(false);setSaved(result);setDraft(blank);setStep('summary');feedback(action==='REVOGAR'?'Referência revogada; histórico preservado.':'Referência salva somente para este período. Nenhuma busca foi ativada.');
    }catch(e){if(ticket!==seq.current)return;
      const code=e.code||e.details?.code||e.details?.error;
      if(([403,409,422].includes(e.status)||['REFERENCE_CHANGED','INVALID_REFERENCE','REFERENCE_NOT_ACTIVE','ACCESS_CHANGED','FORBIDDEN'].includes(code))){pending.current=null;setUncertain(false);setConflict(true);setError(`${e.message} Descarte a edição e releia o período antes de conferir novamente.`);}
      else {setUncertain(true);setError('Resultado incerto. Confira a leitura ou repita a mesma solicitação. Não crie outro pedido.');}
    }finally{if(ticket===seq.current){lock.current=false;setBusy(false);}}
  }
  const locked=busy||uncertain||!canEdit;
  return <section className="referencia-vencimento" aria-label={`Vencimento de referência ${tributo}`}>
    <h4>Vencimento de referência · {tributo}</h4>
    <p>{companyName || companyId}</p>
    <div ref={status} tabIndex={-1} role="status">{notice}</div>{error&&<p role="alert">{error}</p>}
    {step==='identity'?<><div className="referencia-campos"><label>Tipo do período<select ref={identityFocus} value={identity.tipoPeriodo} disabled={busy} onChange={e=>setIdentity({...identity,tipoPeriodo:e.target.value,competencia:''})}><option value="">Selecionar</option><option value="MENSAL">Mensal</option><option value="TRIMESTRAL">Trimestral</option></select></label><label>Período<input aria-label="Período da referência" disabled={busy||!identity.tipoPeriodo} placeholder={identity.tipoPeriodo==='TRIMESTRAL'?'AAAA-T1':'AAAA-MM'} value={identity.competencia} onChange={e=>setIdentity({...identity,competencia:e.target.value})}/></label></div><Button disabled={busy||!activeIdentity||!api?.getDueDateReference} onClick={read}>Consultar referência salva</Button></>:<>
    {step==='summary'&&<><dl><dt>Período</dt><dd>{identity.competencia} · {identity.tipoPeriodo==='MENSAL'?'Mensal':'Trimestral'}</dd><dt>Vencimento</dt><dd>{civilLabel(saved?.reference?.dataCivil)}</dd><dt>Origem</dt><dd>{saved?.reference?'Confirmada pelo contador':'Não informada'}</dd><dt>Situação</dt><dd>{saved?.reference?.status==='REVOGADA'?'Revogada':saved?.reference?'Registrada':'Sem referência'}</dd></dl>{saved?.reference&&<details><summary>Ver registro</summary><p>{saved.reference.descricaoFonte}</p><p>Responsável: {saved.reference.confirmedBy} · {new Date(saved.reference.confirmedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p><p>Versão {saved.revision}</p></details>}<div className="referencia-acoes">{canEdit&&<Button ref={trigger} disabled={busy||!api?.saveDueDateReference} onClick={()=>edit('CONFIRMAR')}>{saved?.reference?'Alterar referência':'Informar vencimento'}</Button>}{canEdit&&saved?.reference?.status==='ATIVA'&&<Button variant="secondary" disabled={busy} onClick={()=>edit('REVOGAR')}>Revogar referência</Button>}<Button variant="secondary" disabled={busy} onClick={()=>{setSaved(null);setStep('identity');}}>Escolher outro período</Button></div></>}
    {step==='edit'&&<><div className="referencia-campos">{action==='CONFIRMAR'&&<><label>Vencimento<input type="date" disabled={locked} value={draft.dataCivil} onChange={e=>setDraft({...draft,dataCivil:e.target.value})}/></label><label>Fonte / observação<input maxLength={300} disabled={locked} value={draft.descricaoFonte} onChange={e=>setDraft({...draft,descricaoFonte:e.target.value,...(!saved?.reference?{motivo:e.target.value}:{})})}/></label></>}{(action==='REVOGAR'||saved?.reference)&&<label>Motivo do registro<input maxLength={300} disabled={locked} value={draft.motivo} onChange={e=>setDraft({...draft,motivo:e.target.value})}/></label>}</div>{action==='CONFIRMAR'&&<label><input type="checkbox" disabled={locked} checked={draft.confirmacao} onChange={e=>setDraft({...draft,confirmacao:e.target.checked})}/> Conferi esta data para esta empresa, tributo e período</label>}<div className="referencia-acoes"><Button disabled={locked||!fieldsValid} onClick={()=>setStep('preview')}>Revisar referência</Button><Button variant="secondary" disabled={busy} onClick={discard}>Descartar edição</Button></div></>}
    {step==='preview'&&<><h4 ref={heading} tabIndex={-1}>{action==='REVOGAR'?'Conferir revogação':'Conferir referência'}</h4><dl><dt>Empresa / tributo</dt><dd>{companyName||companyId} · {tributo}</dd><dt>Período</dt><dd>{identity.tipoPeriodo} · {identity.competencia}</dd>{action==='CONFIRMAR'&&<><dt>Vencimento</dt><dd>{civilLabel(draft.dataCivil)}</dd><dt>Fonte</dt><dd>{draft.descricaoFonte}</dd></>}<dt>Motivo</dt><dd>{draft.motivo}</dd></dl><div className="referencia-acoes"><Button disabled={busy||conflict||!canEdit} onClick={save}>{uncertain?'Conferir com a mesma solicitação':action==='REVOGAR'?'Confirmar revogação':'Confirmar referência'}</Button><Button variant="secondary" disabled={busy||uncertain} onClick={()=>setStep('edit')}>Voltar à edição</Button>{uncertain&&<Button variant="secondary" disabled={busy} onClick={read}>Conferir leitura salva</Button>}{conflict&&<Button variant="secondary" disabled={busy} onClick={discard}>Descartar edição</Button>}</div></>}
    </>}
    <p className="referencia-limite">Vale somente para o período escolhido. Vencimento do documento prevalece. Referência trimestral não comprova capacidade de busca; ISS e FGTS também dependem de integração validada. Busca automática indisponível; salvar não consulta o Fisco nem ativa rotinas.</p>
  </section>;
}
