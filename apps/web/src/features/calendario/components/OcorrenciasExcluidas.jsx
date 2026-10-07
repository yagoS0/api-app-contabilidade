import { useEffect, useState } from 'react';
import { dataBR } from '../lib/agendaWorkspace';

export function OcorrenciasExcluidas({api,inicio,fim,companyId,busca,onChanged}) {
  const [itens,setItens]=useState([]),[erro,setErro]=useState(''),[ocupado,setOcupado]=useState(false),[carregando,setCarregando]=useState(true),[revisao,setRevisao]=useState(0);
  useEffect(()=>{let ativo=true;setCarregando(true);setErro('');api.getOcorrenciasExcluidas(inicio,fim,companyId).then(r=>{if(r.ok===false)throw new Error(r.message);if(ativo)setItens(r.itens || []);}).catch(e=>{if(ativo)setErro(e.message);}).finally(()=>{if(ativo)setCarregando(false);});return()=>{ativo=false;};},[api,inicio,fim,companyId,revisao]);
  const grupos=new Map();
  for(const i of itens.filter(i=>i.titulo.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')))) {
    const chave=[i.regraId || i.id,i.titulo,i.dataInicio,i.dataFim,i.restauravel].join('|');
    if(!grupos.has(chave))grupos.set(chave,{...i,itens:[]});
    grupos.get(chave).itens.push(i);
  }
  async function restaurar(ids) {setOcupado(true);setErro('');try{const r=await api.restaurarOcorrenciasAgenda(ids);if(r.ok===false)throw new Error(r.message);setRevisao(n=>n+1);onChanged();}catch(e){setErro(e.message);}finally{setOcupado(false);}}
  return <div><p>Ocorrências empresariais excluídas entre {dataBR(inicio)} e {dataBR(fim)}. Restaurar mantém os registros e suas conclusões.</p>{erro && <p role="alert">{erro}</p>}{carregando ? <p role="status">Carregando exclusões…</p> : [...grupos.values()].map(g=><div className="agenda-list-row" key={g.id}><div><strong>{g.titulo}</strong><p>{dataBR(g.dataInicio)} – {dataBR(g.dataFim)} · {g.itens.length} empresa(s)</p><details><summary>Empresas</summary>{g.itens.map(i=><p key={i.id}>{i.empresa}</p>)}</details></div><button className="btn btn-secondary btn-sm" disabled={ocupado || !g.restauravel} onClick={()=>restaurar(g.itens.map(i=>i.id))}>Restaurar ocorrência</button></div>)}{!carregando && !itens.length && <p>Nenhuma ocorrência excluída neste período.</p>}</div>;
}
