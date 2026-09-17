import { useEffect, useId, useRef, useState } from 'react';
const mes = s => `${s.slice(5)}/${s.slice(0,4)}`;
const mover=(s,n)=>{const [a,m]=s.split('-').map(Number);return new Date(Date.UTC(a,m-1+n,1)).toISOString().slice(0,7);};
export function FiltroPeriodo({de,ate,comparar,onAplicar,competenciasFechadas}) {
  const [aberto,setAberto]=useState(false),[rascunho,setRascunho]=useState({de,ate,comparar});
  const raiz=useRef(null),botao=useRef(null),inicio=useRef(null),id=useId();
  function fechar(){setAberto(false);botao.current?.focus();}
  useEffect(()=>{
    if(!aberto)return;
    inicio.current?.focus();
    const fora=e=>{if(!raiz.current?.contains(e.target))setAberto(false);};
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();fechar();}};
    document.addEventListener('pointerdown',fora);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',fora);document.removeEventListener('keydown',escape);};
  },[aberto]);
  const n=s=>Number(s.slice(0,4))*12+Number(s.slice(5));
  const pendentes=[];
  if(competenciasFechadas&&/^\d{4}-(0[1-9]|1[0-2])$/.test(rascunho.de)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(rascunho.ate)&&rascunho.de<=rascunho.ate&&n(rascunho.ate)-n(rascunho.de)<24){for(let m=rascunho.de;m<=rascunho.ate;m=mover(m,1))if(!competenciasFechadas.includes(m))pendentes.push(m);}
  const valido=/^\d{4}-(0[1-9]|1[0-2])$/.test(rascunho.de)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(rascunho.ate)&&rascunho.de<=rascunho.ate&&n(rascunho.ate)-n(rascunho.de)<24&&pendentes.length===0;
  function atalho(tipo){setRascunho(v=>({...v,de:tipo==='ano'?`${v.ate.slice(0,4)}-01`:mover(v.ate,tipo==='12'?-11:tipo==='6'?-5:tipo==='3'?-2:0)}));}
  return <div ref={raiz} className="bi-periodo">
    <button ref={botao} type="button" className="bi-periodo-botao" aria-expanded={aberto} aria-controls={id} aria-haspopup="dialog" onClick={()=>{setRascunho({de,ate,comparar});setAberto(v=>!v);}}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></svg>
      <span>{!de||!ate?'Selecionar período':de===ate?mes(de):`${mes(de)} — ${mes(ate)}`}</span><span aria-hidden="true">⌄</span><span className="bi-sr-only">Filtrar período</span>
    </button>
    {aberto&&<form id={id} className="bi-periodo-painel" role="dialog" aria-label="Filtrar período" onSubmit={e=>{e.preventDefault();if(valido){onAplicar(rascunho);fechar();}}}>
      <div className="bi-painel-titulo"><h2>Período contábil</h2><button type="button" className="bi-icon-button" aria-label="Fechar filtros" onClick={fechar}>×</button></div>
      {competenciasFechadas&&<label>Mês fechado<select aria-label="Escolher mês fechado" value="" onChange={e=>{if(e.target.value)setRascunho(v=>({...v,de:e.target.value,ate:e.target.value}));}}><option value="">Selecione um mês</option>{[...competenciasFechadas].sort().reverse().map(m=><option key={m} value={m}>{mes(m)}</option>)}</select></label>}
      <div className="bi-periodo-datas"><label>De<input ref={inicio} type="month" value={rascunho.de} onChange={e=>setRascunho(v=>({...v,de:e.target.value}))}/></label><label>Até<input type="month" value={rascunho.ate} onChange={e=>setRascunho(v=>({...v,ate:e.target.value}))}/></label></div>
      <div className="bi-atalhos bi-periodo-atalhos">{[['mes','Mês'],['3','3 meses'],['6','6 meses'],['12','12 meses'],['ano','Acumulado no ano']].map(([k,n])=><button type="button" key={k} disabled={!/^\d{4}-(0[1-9]|1[0-2])$/.test(rascunho.ate)} onClick={()=>atalho(k)}>{n}</button>)}</div>
      <label>Comparar com<select value={rascunho.comparar} onChange={e=>setRascunho(v=>({...v,comparar:e.target.value}))}><option value="anterior">Período anterior</option><option value="ano">Mesmo período do ano anterior</option></select></label>
      {!valido&&<p role="alert">{pendentes.length?`Sem fechamento contábil: ${pendentes.map(mes).join(', ')}. Confira em Lançamentos.`:'Escolha um intervalo de até 24 meses.'}</p>}
      <div className="bi-painel-acoes"><button type="button" onClick={fechar}>Cancelar</button><button className="bi-primary" disabled={!valido}>Aplicar período</button></div>
    </form>}
  </div>;
}
