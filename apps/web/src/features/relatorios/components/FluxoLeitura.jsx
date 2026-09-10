import { useEffect, useRef, useState } from 'react';
import { COLUNAS, linhaDoMes, linhasDosDias } from '../lib/tabelaFluxoLeitura';
import { somarCompetencia } from '../lib/vocabularioFluxo';
const brl=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const mesLabel=comp=>new Date(`${comp}-15T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
function Celula({valor}) {
  return <td style={{padding:'8px',textAlign:'right',whiteSpace:'nowrap',color:valor?.status==='forecast'?'var(--state-warn)':'var(--text)',fontVariantNumeric:'tabular-nums'}}>{brl(valor?.valor)}{valor?.status==='forecast'&&<span style={{display:'block',fontSize:12}}>previsto</span>}</td>;
}
function Mes({mes,competencia,comFolha}) {
  const scroll=useRef(null);
  const hoje=new Date(),mesHoje=`${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
  const diaHoje=mesHoje===competencia?hoje.getDate():null;
  const colunas=COLUNAS.filter(c=>comFolha||c.chave!=='folha');
  useEffect(()=>{const row=scroll.current?.querySelector('[data-hoje="true"]');if(row)scroll.current.scrollTop=Math.max(0,row.offsetTop-row.offsetHeight*5);},[competencia,diaHoje,mes]);
  if(!mes)return <section><h3>{mesLabel(competencia)}</h3><p>Este mês não veio na consulta. Não é possível afirmar que está sem movimento.</p></section>;
  const dias=linhasDosDias(mes,new Date(Number(competencia.slice(0,4)),Number(competencia.slice(5)),0).getDate());
  const total=linhaDoMes(mes);
  return <section style={{minWidth:0,border:'1px solid var(--border)',borderRadius:12,padding:12}}>
    <h3 style={{margin:'0 0 12px',textTransform:'capitalize'}}>{mesLabel(competencia)}</h3>
    <p style={{fontSize:14}}>Acumulado no início do mês: {brl(mes.saldo?.inicial)} · final: {brl(mes.saldo?.final)}</p>
    <div ref={scroll} tabIndex={0} role="region" aria-label={`Fluxo diário de ${mesLabel(competencia)}`} style={{maxHeight:440,overflow:'auto',position:'relative'}}>
      <table style={{width:'100%',minWidth:560,borderCollapse:'collapse',fontSize:14}}>
        <thead style={{position:'sticky',top:0,background:'var(--bg-panel, var(--bg-subtle))',zIndex:1}}><tr><th>Dia</th>{colunas.map(c=><th key={c.chave} style={{padding:8,textAlign:'right'}}>{c.rotulo}</th>)}</tr></thead>
        <tbody>{dias.dias.map(d=><tr key={d.dia} data-hoje={d.dia===diaHoje} style={{height:40,background:d.dia===diaHoje?'var(--state-neutral-surface)':undefined,borderBottom:'1px solid var(--border)'}}><th scope="row">{String(d.dia).padStart(2,'0')}{d.dia===diaHoje?' · hoje':''}</th>{colunas.map(c=><Celula key={c.chave} valor={d[c.chave]}/>)}</tr>)}</tbody>
        <tfoot style={{position:"sticky",bottom:0,background:"var(--bg-panel, var(--bg-subtle))",zIndex:1}}><tr><th>Total do mês</th>{colunas.map(c=><Celula key={c.chave} valor={total[c.chave]}/>)}</tr></tfoot>
      </table>
    </div>
    {dias.semDia&&<p style={{fontSize:13,color:'var(--text-muted)'}}>O total e o resultado diário incluem valores previstos sem dia específico: {colunas.filter(c=>!['resultado','saldo'].includes(c.chave)&&dias.semDia[c.chave]).map(c=>`${c.rotulo}: ${brl(dias.semDia[c.chave].valor)}`).join(' · ')}.</p>}
  </section>;
}
export function FluxoLeitura({api,companyId,competenciaReferencia,razaoSocial}) {
  const [dados,setDados]=useState(null),[erro,setErro]=useState(null);
  useEffect(()=>{let vivo=true;setDados(null);setErro(null);Promise.resolve().then(()=>api.getFluxoCaixa(companyId,{janelaInicio:competenciaReferencia})).then(r=>{if(!vivo)return;if(r?.ok===false||r?.demonstracao!==false||!Array.isArray(r?.meses))throw new Error(r?.message||'A resposta não contém o fluxo real desta empresa.');setDados(r);}).catch(e=>{if(vivo)setErro(e.message||'Não foi possível carregar o fluxo.');});return()=>{vivo=false;};},[api,companyId,competenciaReferencia]);
  const inicio=competenciaReferencia||dados?.cicloAtual;
  return <div style={{ padding: "16px clamp(12px, 2vw, 28px)", minWidth: 0 }}><h2>Relatórios · Fluxo de caixa</h2><p>{razaoSocial||'Empresa'} · {inicio?`${mesLabel(inicio)} e ${mesLabel(somarCompetencia(inicio,1))}`:''}</p><p style={{fontSize:14,color:'var(--text-muted)'}}>Visualização do fluxo do cliente. Resultado mensal e acumulado projetado são separados. O acumulado transporta automaticamente as movimentações desde o histórico disponível; não representa saldo bancário conciliado.</p>
    {erro?<p role="alert">Não foi possível ler o fluxo. {erro}</p>:!dados?<p role="status">Carregando fluxo…</p>:<>
      {!dados.acumulado?.calculoInicio&&<p>Ainda não há histórico de movimentações para calcular o acumulado.</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 570px), 1fr))',gap:16}}>{[inicio,somarCompetencia(inicio,1)].map(comp=><Mes key={comp} competencia={comp} mes={dados.meses.find(m=>m.competencia===comp)} comFolha={dados.folha?.disponivel}/>)}</div>
      {(dados.semMes?.length>0||dados.foraDoHorizonte>0)&&<p role="status">Fora das tabelas: {dados.semMes?.length||0} registro(s) sem mês definido; {dados.foraDoHorizonte||0} fora do horizonte.</p>}
      {(dados.recorrenciaIndisponivel||dados.saidasDoClienteIndisponiveis)&&<p role="status">Parte das fontes do fluxo está indisponível. Os valores exibidos não afirmam que essas fontes estejam zeradas.</p>}
    </>}
  </div>;
}
