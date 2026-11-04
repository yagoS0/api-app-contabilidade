import { operationsReadQueue } from './operationsReadQueue';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { classificacaoDocumentalProcuracao, dataProcuracao } from '../fiscal/serpro/lib/procuracao';

const name = c => c.razao || c.razaoSocial || c.cnpj;
export function OperationsProcurationTable({ api, rows, competencia, onClose, onChanged, onRequest, initialFilter = 'all' }) {
  const [data,setData]=useState({}), [checked,setChecked]=useState({}), [query,setQuery]=useState(''), [filter,setFilter]=useState(initialFilter);
  const [preview,setPreview]=useState(null), [busy,setBusy]=useState(false), [results,setResults]=useState({});
  const actionRef=useRef(null),previewHeading=useRef(null);
  useEffect(()=>{if(preview)previewHeading.current?.focus();},[preview]);
  const generation=useRef(0), lock=useRef(false);
  useEffect(() => {setFilter(initialFilter);setQuery('');}, [initialFilter,competencia]);
  const ids=rows.map(r=>r.company.companyId).sort().join('|');
  useEffect(()=>{const run=++generation.current;setData({});setChecked({});setPreview(null);setResults({});setBusy(false);
    operationsReadQueue(ids.split('|').filter(Boolean), async id => {let item;try{const r=await api.getSerproCompanyProcuration(id);if(r?.ok!==true||!r.result||r.result.companyId!==id)throw Error('Leitura indisponível');item={value:r.result};}catch(e){item={error:e.message};}if(run!==generation.current)return;setData(old=>({...old,[id]:item}));}, { isActive: () => run === generation.current });
    return()=>{generation.current++;};
  },[api,ids,competencia]);
  const category=id=>classificacaoDocumentalProcuracao(data[id]?.error ? null : data[id]?.value || rows.find(r=>r.company.companyId===id)?.company.serproStatus).chave;
  const visible=rows.filter(r=>`${name(r.company) || ''} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))&&(filter==='all'||category(r.company.companyId)===filter));
  const reading = rows.some(row => !data[row.company.companyId]);
  const errors = rows.filter(row => data[row.company.companyId]?.error);
  const eligible=visible.filter(r=>['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole)&&data[r.company.companyId]);
  const allowed=useRef(new Set());allowed.current=new Set(rows.filter(r=>['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole)).map(r=>r.company.companyId));
  const chosen=rows.filter(r=>checked[r.company.companyId]&&allowed.current.has(r.company.companyId));
  async function execute(){if(lock.current||!preview)return;lock.current=true;setBusy(true);const run=generation.current;
    try{for(const row of preview){if(run!==generation.current)return;const id=row.company.companyId;let result;try{
      if(!allowed.current.has(id))throw Error('Acesso mudou; atualize a seleção.');const out=await api.checkSerproCompanyProcuration(id);if(out?.ok!==true||!out.result)throw Error('Resultado não confirmado; confira a tentativa antes de repetir.');
      if(run!==generation.current)return;const saved=await api.getSerproCompanyProcuration(id);if(saved?.ok!==true||!saved.result||saved.result.companyId!==id)throw Error('Consulta retornou, mas a leitura salva está indisponível.');
      if(run!==generation.current)return;setData(old=>({...old,[id]:{value:saved.result}}));result=out.result.reutilizado?'Evidência salva reutilizada.':'Consulta concluída; confira vínculo, serviços e vigência.';
    }catch(e){result=e.message;}if(run===generation.current)setResults(old=>({...old,[id]:result}));}if(run===generation.current)onChanged?.();}
    finally{lock.current=false;if(run===generation.current){setBusy(false);setPreview(null);setChecked({});}}
  }
  return <Modal titulo="Procuração" tamanho="lg" className="operacoes-dialogo operacoes-design" ocupado={busy} aoFechar={onClose} rodape={<><span>{chosen.length} empresas selecionadas</span><Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button><Button ref={actionRef} disabled={busy||!chosen.length||!api?.checkSerproCompanyProcuration} onClick={()=>setPreview(chosen)}>Buscar procurações · SERPRO</Button></>}>
    <p>Competência de trabalho {competencia}. Vigência documental e autorização para cada serviço são verificações distintas.</p>
    <div className="operacoes-filtros"><label>Buscar empresa<input type="search" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)}/></label><label>Situação<select value={filter} disabled={busy} onChange={e=>setFilter(e.target.value)}><option value="all">Todas</option><option value="positive">Ativa</option><option value="negative">Sem procuração vigente</option><option value="unknown">A verificar</option></select></label></div>
    {preview&&<div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir consulta de procurações</h3><p>A consulta pode consumir chamadas pagas ao SERPRO. Serão consultadas somente estas empresas, inclusive selecionadas fora da busca atual. Erro não comprova ausência de procuração.</p><ul>{preview.map(r=><li key={r.company.companyId}>{name(r.company)}</li>)}</ul><Button disabled={busy} onClick={execute}>Confirmar consulta</Button> <Button variant="secondary" disabled={busy} onClick={()=>{setPreview(null);actionRef.current?.focus();}}>Cancelar</Button></div>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Procurações das empresas" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao"><input type="checkbox" aria-label="Selecionar empresas elegíveis exibidas" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(r=>checked[r.company.companyId])} onChange={e=>{setPreview(null);setChecked(old=>({...old,...Object.fromEntries(eligible.map(r=>[r.company.companyId,e.target.checked]))}));}}/></th><th>Empresa</th><th>Situação da procuração</th><th>Serviços autorizados / vigência</th><th>Resultado</th></tr></thead><tbody>{visible.map(({company})=>{const id=company.companyId,source=data[id],value=source?.value,marker=classificacaoDocumentalProcuracao(value);return <tr key={id}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar ${name(company)}`} disabled={busy||!eligible.some(r=>r.company.companyId===id)} checked={!!checked[id]} onChange={e=>{setPreview(null);setChecked(old=>({...old,[id]:e.target.checked}));}}/></label></td><th scope="row">{name(company)}</th><td>{!source?'Lendo…':source.error?<span role="alert">{source.error}</span>:marker.rotulo}{marker.orientacao&&<small>{marker.orientacao}</small>}</td><td>{value?.systems?.length?value.systems.join(' · '):'Serviços não confirmados'}<small>Vigência: {dataProcuracao(value?.validUntil)}</small></td><td>{results[id]||'Nenhuma consulta solicitada nesta tela'}{onRequest&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>onRequest(company)}>Pedir procuração</Button>}</td></tr>;})}</tbody></table></div>{reading && <p role="status">Atualizando procurações…</p>}{errors.length > 0 && <p role="alert">Não foi possível verificar {errors.length} empresa(s). Confira o filtro A verificar; falha não comprova ausência de procuração.</p>}{!reading && !visible.length && <p>Nenhuma empresa neste filtro.</p>}
  </Modal>;
}
