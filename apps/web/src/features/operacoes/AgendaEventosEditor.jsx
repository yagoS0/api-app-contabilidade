import { AgendaVencimentoAdoption } from './AgendaVencimentoAdoption';
import { ReferenciaVencimentoEditor } from './ReferenciaVencimentoEditor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useEdicaoPendente } from '../configuracoes/ProtecaoEdicao.shared';
import './agendaEventos.css';

const taxes = ['SIMPLES','IRPJ','CSLL','PIS','COFINS','ISS','INSS','FGTS','PARCELAMENTO'];
const actions = [
  ['captura','Buscar guia','businessDaysBefore','dias úteis antes'],
  ['lembretes.before','Avisar antes','businessDays','dias úteis antes'],
  ['lembretes.onDue','Avisar no vencimento',null,'no vencimento'],
  ['lembretes.after','Avisar depois','businessDays','dias úteis depois'],
];
const clone = value => JSON.parse(JSON.stringify(value));
const get = (object, path) => path.split('.').reduce((value,key)=>value?.[key],object);
function put(object,path,value) { const result=clone(object), keys=path.split('.');let node=result;for(const key of keys.slice(0,-1)) node=node[key]??=( {} );node[keys.at(-1)]=value;return result; }
function leaves(object,prefix='') { return Object.entries(object).flatMap(([key,value])=>value!==null&&typeof value==='object'?leaves(value,prefix+key+'.'):[[prefix+key,value]]); }
const hourLabel = value => Number.isInteger(value) ? `${String(value).padStart(2,'0')}:00` : 'Não definido';
const originLabel = value => ({GLOBAL_DEFAULT:'Padrão do escritório',GLOBAL_TRIBUTO:'Imposto no escritório',EMPRESA_DEFAULT:'Padrão da empresa',EMPRESA_TRIBUTO:'Personalizado'})[value] || 'Sem configuração';
function parameterLabel(path) {
  const parts=path.split('.');const tax=parts[1];const field=parts.at(-1);const action=parts.slice(2,-1).join('.');
  return `${tax==='SIMPLES'?'DAS Simples':tax} · ${actions.find(([key])=>key===action)?.[1]||action} · ${{enabled:'participação',hour:'horário',businessDays:'dias úteis',businessDaysBefore:'antecedência'}[field]||field}`;
}

// Preparatory policy only. This editor never changes legacy selections, pauses or execution mode.
export function AgendaEventosEditor({api,companyId,canEdit=false,disabled=false,onDirty,onSaved,snapshot,onReview}) {
  const [data,setData]=useState(null),[patch,setPatch]=useState({}),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false),[preview,setPreview]=useState(false),[needsReload,setNeedsReload]=useState(false);
  const [selectedTax,setSelectedTax]=useState('SIMPLES');
  const [referenceDirty,setReferenceDirty]=useState(false);
  const [referenceReview,setReferenceReview]=useState(false);
  const [adoptionReview,setAdoptionReview]=useState(false);
  const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
  const discardedSnapshot=useRef(null);
  const snapshotIdentity=useCallback(value=>JSON.stringify([companyId||null,value?.companyId||null,companyId?value?.revision:value?.agendaEventos?.revision,value?.agendaEventos?.globalRevision||null]),[companyId]);
  const generation=useRef(0),pending=useRef(null),working=useRef(false),heading=useRef(null),trigger=useRef(null),feedback=useRef(null);
  const dirty=leaves(patch).length>0;
  useEdicaoPendente(dirty);
  useEffect(()=>{onDirty?.(dirty||referenceDirty||adoptionReview);return()=>onDirty?.(false);},[dirty,referenceDirty,adoptionReview,onDirty]);
  useEffect(()=>{if(preview)heading.current?.focus();},[preview]);
  useEffect(()=>{onReview?.(preview||adoptionReview||referenceReview);return()=>onReview?.(false);},[preview,adoptionReview,referenceReview,onReview]);
  const valid=useCallback(value=>{
    const policy=value?.agendaEventos;
    return value?.ok!==false && (!companyId || value.companyId===companyId) && policy?.schemaVersion===1 &&
      typeof (companyId?value.revision:policy.revision)==='string' && Number.isSafeInteger(policy.version) && policy.version >= 0 &&
      typeof policy.relativeConsumerReady==='boolean' && ['LEGADO','RELATIVO_V1'].includes(policy.executionMode);
  },[companyId]);
  const load=useCallback(async({fresh=false}={})=>{
    if(fresh)discardedSnapshot.current=snapshotIdentity(snapshotRef.current);
    const ticket=++generation.current;working.current=true;setBusy(true);setError('');setNotice('');setData(null);setPatch({});setPreview(false);pending.current=null;setNeedsReload(false);
    try { const value=await (!fresh&&snapshotRef.current&&snapshotIdentity(snapshotRef.current)!==discardedSnapshot.current&&valid(snapshotRef.current)?Promise.resolve(snapshotRef.current):companyId?api.getCompanyAutomation(companyId):api.getRotinas());if(ticket!==generation.current)return;
      if(!valid(value))throw Error('Configuração por imposto indisponível nesta conexão. Nenhum parâmetro foi ativado.');setData(value);
    } catch(e){if(ticket===generation.current)setError(e.message||'Não foi possível ler a configuração.');}
    finally{if(ticket===generation.current){working.current=false;setBusy(false);}}
  },[api,companyId,valid,snapshotIdentity]);
  useEffect(()=>{load();return()=>{generation.current++;};},[load]);
  useEffect(()=>{if(snapshot&&snapshotIdentity(snapshot)!==discardedSnapshot.current&&valid(snapshot)&&!dirty&&!referenceDirty&&!adoptionReview&&!pending.current&&!working.current)setData(snapshot);},[snapshot,valid,dirty,referenceDirty,adoptionReview,snapshotIdentity]);
  const policy=data?.agendaEventos, stored=companyId?policy?.overrides:policy;
  const locked=adoptionReview||referenceDirty||!canEdit||disabled||busy||preview||needsReload||Boolean(pending.current);
  const effective=(tax,action,field)=>companyId?get(policy?.effective,`${tax}.${action}.${field}`):get(policy?.tributos,`${tax}.${action}.${field}`)??get(policy?.defaults,`${action}.${field}`);
  const inherited=(tax,action,field)=>companyId?get(policy?.inherited,`${tax}.${action}.${field}`):get(policy?.defaults,`${action}.${field}`);
  function originAt(tax,action,field) {
    const path=`tributos.${tax}.${action}.${field}`,edited=get(patch,path);
    if(edited!==undefined&&edited!==null)return 'Personalização não salva';
    if(edited===null)return companyId?originLabel(policy?.inheritedOrigins?.[tax]?.[`${action}.${field}`]):get(policy?.defaults,`${action}.${field}`)===undefined?'Sem configuração':'Padrão do escritório';
    return companyId?originLabel(policy?.origins?.[tax]?.[`${action}.${field}`]):get(stored,path)===undefined?(get(policy?.defaults,`${action}.${field}`)===undefined?'Sem configuração':'Padrão do escritório'):'Personalizado';
  }
  function discard() {
    if(busy||working.current||pending.current)return;
    setPatch({});setPreview(false);setError('');setNotice('Rascunho descartado. Configuração salva preservada.');
    requestAnimationFrame(()=>feedback.current?.focus());
  }
  function valueAt(path) { const edited=get(patch,path);return edited===undefined?get(stored,path):edited; }
  function edit(path,value) {setNotice('');setError('');setPatch(old=>put(old,path,value));}
  function restore(tax,action,offset) {setPatch(old=>{let next=old;for(const field of ['enabled','hour',...(offset?[offset]:[])])next=put(next,`tributos.${tax}.${action}.${field}`,null);return next;});}
  const invalid=leaves(patch).some(([path,value])=>value!==null&&(path.endsWith('.enabled')?typeof value!=='boolean':!Number.isInteger(value)||value< (path.endsWith('.hour')?0:1)||value>(path.endsWith('.hour')?23:31)));
  async function save() {
    if(working.current||!preview||!dirty||invalid||needsReload||!canEdit||disabled)return;
    const ticket=generation.current;
    const input=pending.current||{requestId:crypto.randomUUID(),...(companyId?{expectedRevision:data.revision,agendaEventos:{patch}}:{agendaEventos:{expectedRevision:policy.revision,patch}})};
    pending.current=input;working.current=true;setBusy(true);setError('');
    try {const result=await (companyId?api.saveCompanyAutomation(companyId,input):api.saveRotinas(input));if(ticket!==generation.current)return;
      if(!valid(result) || result.agendaEventos.version <= policy.version || result.agendaEventos.revision === policy.revision)throw Error('Retorno não confirma a configuração salva. Confira antes de continuar.');
      const saved=companyId?result.agendaEventos.overrides:result.agendaEventos;
      if(leaves(input.agendaEventos.patch).some(([path,value])=>value===null?get(saved,path)!==undefined:get(saved,path)!==value))throw Error('O retorno não confirmou todos os parâmetros. A intenção foi preservada.');
      setData(result);setPatch({});setPreview(false);pending.current=null;setNotice('Parâmetros salvos. Habilitações e pausas preservadas. Os novos horários valem para rotinas que já usam este calendário.');onSaved?.(result);
    }catch(e){if(ticket===generation.current){setError(e.message||'Salvamento não confirmado.');if([403,409,422].includes(e.status))setNeedsReload(true);}}
    finally{if(ticket===generation.current){working.current=false;setBusy(false);requestAnimationFrame(()=>feedback.current?.focus());}}
  }
  return <section className="agenda-eventos" aria-label="Configuração por imposto">
    <header><h3>{companyId?'Parâmetros desta empresa':'Padrões do escritório por imposto'}</h3><span>Horário de Brasília</span></header>
    <div ref={feedback} tabIndex={-1} role={error?'alert':'status'}>{error||notice}{busy&&<p>Conferindo configuração…</p>}</div>
    {data&&<><div hidden={preview||adoptionReview||referenceReview} className="agenda-eventos-state"><strong>{policy.executionMode==='RELATIVO_V1'?'Lembretes por imposto: calendário por vencimento salvo':policy.relativeConsumerReady?'Lembretes por imposto preparados; calendário anterior em uso':'Parâmetros preparados; calendário por imposto indisponível'}</strong><span>Para interromper a execução atual, use a pausa geral ou a pausa da empresa.</span></div>
    {disabled&&<p role="status">Conclua as alterações no outro formulário antes de editar estes parâmetros.</p>}
    <div hidden={preview||referenceReview}>{companyId?<AgendaVencimentoAdoption api={api} companyId={companyId} snapshot={data} tributo={selectedTax} canEdit={canEdit} disabled={disabled||busy||dirty||referenceDirty||preview||Boolean(pending.current)||needsReload} onReview={setAdoptionReview} onSaved={result=>{setData(result);onSaved?.(result);}}/>:<p>O uso é definido em cada empresa.</p>}</div>
    <div hidden={adoptionReview}>{!preview?<><div hidden={referenceReview}><label className="agenda-eventos-tax">Imposto<select aria-label="Imposto a configurar" value={selectedTax} disabled={busy||referenceDirty||adoptionReview} onChange={e=>setSelectedTax(e.target.value)}>{taxes.map(tax=><option key={tax} value={tax}>{tax==='SIMPLES'?'DAS Simples':tax}</option>)}</select></label><div className="agenda-eventos-table"><table><thead><tr><th>Imposto</th><th>Ação</th><th>Participação</th><th>Quando</th><th>Horário</th><th>Origem / ações</th></tr></thead><tbody>{[selectedTax].flatMap(tax=>actions.map(([action,label,offset,unit],index)=>{
      const base=`tributos.${tax}.${action}`,participation=valueAt(base+'.enabled'),days=offset?valueAt(base+'.'+offset):undefined,hour=valueAt(base+'.hour');
      return <tr key={base}>{index===0&&<th scope="rowgroup" rowSpan={actions.length}>{tax==='SIMPLES'?'DAS Simples':tax}</th>}<th scope="row">{label}{action==='captura'&&policy.capabilities?.capture!==true&&<small>Busca por vencimento indisponível. A primeira captura ainda não está disponível nesta versão.</small>}</th>
        <td data-label="Participação"><select aria-label={`${tax} ${label} participação`} disabled={locked} value={participation==null?'inherit':String(participation)} onChange={e=>edit(base+'.enabled',e.target.value==='inherit'?null:e.target.value==='true')}><option value="inherit">Usar padrão</option><option value="true">Participa</option><option value="false">Não participa</option></select><small aria-label={`${tax} ${label} participação efetiva`}>{effective(tax,action,'enabled')===true?'Participa atualmente':'Sem participação salva'}</small></td>
        <td data-label="Quando">{offset?<label><input aria-label={`${tax} ${label} antecedência`} type="number" min="1" max="31" disabled={locked} value={days??''} placeholder={String(inherited(tax,action,offset)??'Definir')} onChange={e=>edit(base+'.'+offset,e.target.value===''?null:Number(e.target.value))}/>{unit}</label>:unit}</td>
        <td data-label="Horário"><select aria-label={`${tax} ${label} horário`} disabled={locked} value={hour??''} onChange={e=>edit(base+'.hour',e.target.value===''?null:Number(e.target.value))}><option value="">Herdar · {hourLabel(inherited(tax,action,'hour'))}</option>{Array.from({length:24},(_,i)=><option key={i} value={i}>{hourLabel(i)}</option>)}</select></td>
        <td data-label="Origem"><dl><dt>Participação</dt><dd>{originAt(tax,action,'enabled')}</dd>{offset&&<><dt>Antecedência</dt><dd>{originAt(tax,action,offset)}</dd></>}<dt>Horário</dt><dd>{originAt(tax,action,'hour')}</dd></dl><Button variant="secondary" size="sm" disabled={locked} onClick={()=>restore(tax,action,offset)}>Restaurar padrão</Button></td></tr>;
    }))}</tbody></table></div></div>{companyId&&selectedTax!=='PARCELAMENTO'&&<ReferenciaVencimentoEditor key={`${companyId}:${selectedTax}`} api={api} companyId={companyId} companyName={data.companyName} tributo={selectedTax==='SIMPLES'?'DAS':selectedTax} canEdit={canEdit&&!disabled&&!dirty&&!busy&&!pending.current} onDirty={setReferenceDirty} onReview={setReferenceReview}/>}<div hidden={referenceReview}><p className="agenda-eventos-note">DARF misto: um aviso por documento e marco, no horário mais antecipado dos impostos participantes. Busca exige integração e vencimento fiscal comprovado.</p>
    <div className="agenda-eventos-actions"><Button ref={trigger} disabled={locked||!dirty||invalid} onClick={()=>setPreview(true)}>Conferir parâmetros</Button>{dirty&&<><span>Alterações não salvas</span><Button variant="secondary" disabled={busy||Boolean(pending.current)} onClick={discard}>Descartar rascunho</Button></>}</div></div></>:<div className="agenda-eventos-preview"><h4 ref={heading} tabIndex={-1}>Conferir parâmetros por imposto</h4><table><thead><tr><th>Parâmetro</th><th>Alteração</th></tr></thead><tbody>{leaves(patch).map(([path,value])=><tr key={path}><th scope="row">{parameterLabel(path)}</th><td>{value===null?'Restaurar herança':typeof value==='boolean'?(value?'Participa':'Não participa'):path.endsWith('.hour')?hourLabel(value):`${value} dias úteis`}</td></tr>)}</tbody></table><p>Salvar parâmetros não liga as automações nem executa consultas ou envios.</p><Button disabled={busy||needsReload||disabled} onClick={save}>{pending.current?'Conferir salvamento com a mesma solicitação':'Salvar parâmetros'}</Button><Button variant="secondary" disabled={busy||Boolean(pending.current)} onClick={()=>{setPreview(false);requestAnimationFrame(()=>trigger.current?.focus());}}>Voltar à edição</Button></div>}
    <table hidden={referenceReview} className="agenda-eventos-policy"><tbody><tr><th>Consulta de pagamento</th><td>Uma consulta em D+2 úteis, somente sem confirmação e sem recálculo. Independente do dia escolhido para o aviso posterior.</td></tr><tr><th>Confirmação e contabilidade</th><td>Pagamento confirmado encerra lembretes. Mês fechado continua protegido.</td></tr></tbody></table></div></>}
    {error&&<Button variant="secondary" disabled={busy||disabled||(Boolean(pending.current)&&!needsReload)} onClick={()=>{if(!pending.current||needsReload)load({fresh:true});}}>{dirty?'Descartar rascunho e recarregar configuração':'Recarregar configuração'}</Button>}
  </section>;
}
