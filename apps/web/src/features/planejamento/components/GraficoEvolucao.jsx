const brl=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function GraficoEvolucao({serie}) {
  const linhas=[{chave:'faturamento',nome:'Faturamento documental',cor:'#b49be9'},{chave:'resultado',nome:'Resultado da DRE',cor:'#77c9bc'}];
  const valores=serie.flatMap(m=>linhas.map(l=>m.indicadores[l.chave])).filter(Number.isFinite);
  if(!valores.length)return <p className="bi-empty">Sem valores para desenhar a evolução.</p>;
  const min=Math.min(0,...valores),max=Math.max(1,...valores),largura=780,altura=230;
  const x=i=>64+i*690/Math.max(1,serie.length-1),y=v=>180-(v-min)/(max-min)*160;
  return <figure className="bi-evolucao"><div className="bi-grafico-legenda">{linhas.map(l=><span key={l.chave}><i style={{background:l.cor}}/>{l.nome}</span>)}</div><svg viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Evolução de faturamento e resultado">
    {[0,.5,1].map(t=>{const v=min+(max-min)*t;return <g key={t}><line x1="64" x2="754" y1={y(v)} y2={y(v)} stroke="currentColor" opacity=".1"/><text x="54" y={y(v)+4} textAnchor="end">{v.toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1})}</text></g>;})}
    {linhas.map(l=>{let anterior=false;const path=serie.map((m,i)=>{const v=m.indicadores[l.chave];if(!Number.isFinite(v)){anterior=false;return '';}const trecho=`${anterior?'L':'M'}${x(i)},${y(v)}`;anterior=true;return trecho;}).join(' ');return <g key={l.chave}><path d={path} stroke={l.cor} fill="none" strokeWidth="2.5"/>{serie.map((m,i)=>Number.isFinite(m.indicadores[l.chave])&&<circle key={m.competencia} cx={x(i)} cy={y(m.indicadores[l.chave])} r="3.5" fill={l.cor}><title>{m.competencia} · {l.nome}: {brl(m.indicadores[l.chave])}</title></circle>)}</g>;})}
    {serie.map((m,i)=><text key={m.competencia} x={x(i)} y="211" textAnchor="middle">{m.competencia.slice(5)}/{m.competencia.slice(2,4)}</text>)}
  </svg></figure>;
}
