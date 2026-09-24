import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import './clientesRelatorio.css';
const brl=v=>v==null?'Sem base':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=v=>v==null?'Sem base':`${v>0?'+':''}${v.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
const parte=v=>v==null?'Sem base':`${v.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
const mes=v=>v?`${v.slice(5)}/${v.slice(0,4)}`:'Não informado';
const doc=v=>v.length===11?v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
const compacto=v=>Number(v).toLocaleString('pt-BR',{notation:'compact',maximumFractionDigits:1});

function Evolucao({serie,titulo}) {
 const w=640,h=220,p=42,max=Math.max(1,...serie.map(s=>s.valor||0)),largura=(w-p*2)/Math.max(1,serie.length);
 return <figure className="clientes-figura"><figcaption>{titulo}</figcaption><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={titulo}>
   {[0,.5,1].map(f=><g key={f}><line x1={p} x2={w-8} y1={h-35-f*150} y2={h-35-f*150} stroke="currentColor" opacity=".15"/><text x={p-5} y={h-31-f*150} textAnchor="end" fontSize="11" fill="currentColor">{compacto(max*f)}</text></g>)}
   {serie.map((s,i)=>{const x=p+i*largura+4,altura=(s.valor||0)/max*150;return <g key={s.mes}><title>{mes(s.mes)}: {s.valor==null?'Sem registro':brl(s.valor)}</title><rect x={x} y={h-35-altura} width={Math.max(2,largura-10)} height={altura} rx="3" fill="#ab8de8"/><text x={x+largura/2-5} y={h-19} textAnchor="middle" fill="currentColor" fontSize="10">{s.mes.slice(5)}</text>{s.valor==null&&<text x={x+largura/2-5} y={h-45} textAnchor="middle" fill="currentColor" fontSize="13">—</text>}</g>;})}
 </svg><p className="clientes-legenda">{mes(serie[0]?.mes)} a {mes(serie.at(-1)?.mes)} · Valores em reais. Traço: sem registro observado.</p>
 <details><summary>Ver valores do gráfico</summary><table><tbody>{serie.map(s=><tr key={s.mes}><th>{mes(s.mes)}</th><td>{s.valor==null?'Sem registro':brl(s.valor)}</td></tr>)}</tbody></table></details></figure>;
}

function Composicao({linhas}){
 if(linhas.some(l=>l.valor==null)) return <p>Comparação indisponível até o fechamento contábil dos meses comparados.</p>;
 const max=Math.max(1,...linhas.map(l=>Math.abs(l.valor)));
 return <div className="clientes-composicao">{linhas.map(l=><div key={l.nome}><div><span>{l.nome}</span><strong>{brl(l.valor)}</strong></div><div className="clientes-trilho"><span style={{width:`${Math.abs(l.valor)/max*100}%`,background:l.valor<0?'#e6af76':'#ab8de8'}}/></div></div>)}</div>;
}

function ClienteDetalhe({cliente,fechar,imprimindo}){
 const ref=useRef(null),[pagina,setPagina]=useState(1);
 useEffect(()=>{ref.current?.focus();},[]);
 return <section className="bi-card clientes-detalhe" ref={ref} tabIndex={-1} aria-label={`Detalhamento de ${cliente.nome}`}><div className="clientes-heading"><div><h2>{cliente.nome}</h2><p>{doc(cliente.documento)}</p></div><button onClick={fechar}>Fechar detalhe</button></div>
   <div className="clientes-kpis"><div><span>Faturamento no período</span><strong>{brl(cliente.atual)}</strong></div><div><span>Acumulado até a referência</span><strong>{brl(cliente.acumulado)}</strong><small>Desde {mes(cliente.primeira)} · histórico observado</small></div><div><span>Ticket médio por nota</span><strong>{brl(cliente.ticket)}</strong><small>{cliente.quantidade} nota(s) no período</small></div><div><span>Última competência observada</span><strong>{mes(cliente.ultima)}</strong><small>{cliente.recorrente==null?'Recorrência indisponível':cliente.recorrente?'Faturou em pelo menos 3 dos últimos 4 meses':'Sem recorrência de 3 dos últimos 4 meses'}</small></div></div>
   <Evolucao serie={cliente.serie} titulo="Evolução deste cliente"/>
   <h3>Notas que compõem o período</h3><div className="bi-scroll"><table><thead><tr><th>Nota</th><th>Competência</th><th>Valor</th></tr></thead><tbody>{(imprimindo?cliente.notas:cliente.notas.slice((pagina-1)*25,pagina*25)).map(n=><tr key={n.id}><td>{n.numero||'Sem número'}</td><td>{mes(n.competencia)}</td><td>{brl(n.valor)}</td></tr>)}</tbody></table></div>{!cliente.notas.length&&<p>Sem notas observadas no período.</p>}
   {cliente.notas.length>25&&<div className="clientes-acoes"><button disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Notas anteriores</button><span>Página {pagina}</span><button disabled={pagina*25>=cliente.notas.length} onClick={()=>setPagina(p=>p+1)}>Próximas notas</button></div>}
 </section>;
}

export function ClientesRelatorio({api,empresaId,empresaNome,de,ate,comparar,embutido=false,limitarGraficoAoPeriodo=false,competenciasFechadas=null}){
 const [imprimindo,setImprimindo]=useState(false);
 const [resposta,setResposta]=useState(null),[erro,setErro]=useState(''),[tentativa,setTentativa]=useState(0),[busca,setBusca]=useState(''),[filtro,setFiltro]=useState('periodo'),[ordem,setOrdem]=useState('maior'),[selecionado,setSelecionado]=useState(null),[pagina,setPagina]=useState(1);
 const chave=`${empresaId}|${de}|${ate}|${comparar}`,base=resposta?.chave===chave?resposta.dados:null;
 const r=base&&limitarGraficoAoPeriodo?{...base,serie:base.serie.filter(m=>m.mes>=de&&m.mes<=ate&&(!competenciasFechadas||competenciasFechadas.includes(m.mes))),clientes:base.clientes.map(c=>({...c,serie:c.serie.filter(m=>m.mes>=de&&m.mes<=ate&&(!competenciasFechadas||competenciasFechadas.includes(m.mes)))}))}:base;
 const consultaAtual=useRef(chave),ativo=useRef(true);consultaAtual.current=chave;
 useEffect(()=>{ativo.current=true;return()=>{ativo.current=false;};},[]);
 useEffect(()=>{let vivo=true;setErro('');setSelecionado(null);setPagina(1);Promise.resolve().then(()=>api.getAnaliseClientes(empresaId,{de,ate,comparar})).then(d=>{if(!d||d.ok===false)throw new Error(d?.message||'Resposta inválida.');if(vivo)setResposta({chave,dados:d});}).catch(e=>{if(vivo)setErro(e.message);});return()=>{vivo=false;};},[api,empresaId,de,ate,comparar,chave,tentativa]);
 if(erro)return <section role="alert">{erro} <button onClick={()=>{setResposta(null);setTentativa(n=>n+1);}}>Recarregar clientes</button></section>;
 if(!r)return <p role="status">Carregando relatório de clientes…</p>;
 const s=r.resumo,ativos=r.clientes.filter(c=>c.atual>0),top=ativos.slice(0,5),restante=s.total-top.reduce((v,c)=>v+c.atual,0);
 const texto=busca.toLocaleLowerCase('pt-BR'),linhas=r.clientes.filter(c=>(filtro==='todos'||filtro==='periodo'&&(c.atual>0||c.anterior>0)||filtro==='alertas'&&c.disparidade)&&(`${c.nome} ${c.documento} ${doc(c.documento)}`.toLocaleLowerCase('pt-BR').includes(texto)));
 linhas.sort((a,b)=>ordem==='menor'?a.atual-b.atual:ordem==='variacao'?a.diferenca-b.diferenca:b.atual-a.atual);
 async function imprimir(){
   const chaveSolicitada=chave;
   const limpar=()=>{document.body.classList.remove('imprimindo-clientes');if(ativo.current)setImprimindo(false);};
   setImprimindo(true);
   try {
     const atual=await api.getAnaliseClientes(empresaId,{de,ate,comparar});
     if(!ativo.current||consultaAtual.current!==chaveSolicitada)return;
     if(!atual||atual.ok===false)throw Error(atual?.message||'Não foi possível validar o fechamento para impressão.');
     flushSync(()=>{setResposta({chave:chaveSolicitada,dados:atual});setImprimindo(true);});
     document.body.classList.add('imprimindo-clientes');
     window.addEventListener('afterprint',limpar,{once:true});
     try{window.print();}finally{window.removeEventListener('afterprint',limpar);limpar();}
   }catch(e){if(ativo.current&&consultaAtual.current===chaveSolicitada)setErro(e.message||'Não foi possível preparar a impressão.');}
   finally{limpar();}
 }

 return <section className="clientes-report" aria-label="Relatório de clientes">
   <div className="clientes-heading"><div><h2>Carteira de clientes</h2>{!embutido&&<p>{mes(de)} a {mes(ate)} · Comparação: {mes(r.anterior.de)} a {mes(r.anterior.ate)}</p>}</div><button className="clientes-nao-imprimir" disabled={imprimindo} onClick={imprimir}>{imprimindo?'Validando fechamento…':'Imprimir / salvar PDF'}</button></div>

   {r.demonstracao&&!embutido&&<p className="bi-aviso">Relatório de demonstração · Valores e clientes fictícios.</p>}

   {(r.parcial||r.invalidas>0)&&<div className="bi-aviso">{r.parcial&&<p>Período em andamento: as variações não representam fechamento mensal.</p>}{r.invalidas>0&&<p>{r.invalidas} registro(s) inválido(s) fora da análise. Confira a origem antes de concluir sobre o crescimento.</p>}</div>}
   <section className="clientes-resumo-bloco" aria-label="Visão geral da carteira">
     <h3 className="clientes-bloco-titulo">Visão geral</h3>
     <div className="clientes-kpis bi-card clientes-visao-geral">
       <div><span>Clientes ativos no período</span><strong>{s.ativos}</strong><small>{s.recorrentes==null?'Recorrência indisponível':s.recorrentes+' recorrentes'}</small></div>
       <div><span>Faturamento identificado</span><strong>{brl(s.total)}</strong><small>No período</small></div>
       <div><span>Ticket médio</span><strong>{brl(s.media)}</strong><small>Por cliente</small></div>
       <div className="clientes-concentracao"><span>Concentração Top 5</span><strong>{parte(s.top5)}</strong><small>Do faturamento identificado nos 5 maiores clientes</small>{s.top5>=90&&<small className="clientes-concentracao-contexto">Alta concentração da carteira</small>}</div>
     </div>
   </section>
   {r.semIdentificacao>0&&<section className="clientes-resumo-bloco" aria-label="Qualidade dos dados">
     <h3 className="clientes-bloco-titulo">Atenção</h3>
     <div className="bi-card clientes-qualidade"><div className="clientes-qualidade-texto"><span className="clientes-qualidade-icone" aria-hidden="true">⚠</span><div><h4>Faturamento sem identificação</h4><p>{r.semIdentificacao} notas sem CPF/CNPJ válido</p></div></div><strong>{brl(r.valorSemIdentificacao)}</strong></div>
   </section>}
   <section className="clientes-resumo-bloco" aria-label="Movimentação da carteira">
     <h3 className="clientes-bloco-titulo">Movimentação da carteira</h3>
     <div className="clientes-kpis bi-card clientes-movimentacao"><div><span>Novos clientes</span><strong>{s.novos??'Sem base'}</strong><small>Primeira emissão observada no período</small></div><div><span>Sem faturamento no período</span><strong>{s.semFaturamento??'Sem base'}</strong><small>Tinham faturamento no período anterior</small></div></div>
   </section>
   <section className="bi-card"><h3>Concentração e recorrência</h3><div className="clientes-kpis">{[['Maior cliente',parte(s.top1)],['3 maiores',parte(s.top3)],['3 maiores na comparação',parte(s.top3Anterior)],['Taxa de recorrência',parte(s.taxaRecorrencia)],['Receita dos recorrentes',brl(s.receitaRecorrentes)]].map(([n,v])=><div key={n}><span>{n}</span><strong>{v}</strong></div>)}</div><details><summary>Critério de recorrência</summary><p>Recorrente: faturou em pelo menos 3 dos últimos 4 meses até {mes(ate)}. Taxa: recorrentes com faturamento no período / clientes com faturamento no período. Receita observada desses clientes, não MRR contratual.</p></details></section>
   <div className="clientes-grade"><section className="bi-card"><h3>Distribuição do faturamento</h3><p>Participação dos maiores clientes na carteira identificada.</p>{top.length?<><div className="clientes-faixa" role="img" aria-label={`Cinco maiores: ${parte(s.top5)} do faturamento`}>{[...top.map(c=>({nome:c.nome,valor:c.atual})),{nome:'Demais clientes',valor:restante}].filter(l=>l.valor>0).map((l,i)=><span key={l.nome} title={`${l.nome}: ${brl(l.valor)}`} style={{width:`${l.valor/s.total*100}%`,background:['#bda2f3','#8f7aca','#647cb2','#799da2','#a0b4a6','#555568'][i]}}/>)}</div><ol className="clientes-ranking-curto">{top.map(c=><li key={c.documento}><button onClick={()=>setSelecionado(c.documento)}>{c.nome}</button><strong>{parte(c.participacao)}</strong></li>)}</ol><p>Demais clientes: {brl(restante)}</p></>:<p>Sem faturamento identificado para calcular concentração.</p>}</section><section className="bi-card"><Evolucao serie={r.serie} titulo={limitarGraficoAoPeriodo?"Faturamento identificado no período":"Faturamento identificado · 12 meses"}/></section></div>
   <div className="clientes-grade"><section className="bi-card"><h3>De onde veio a variação?</h3><p>De {brl(s.anterior)} para {brl(s.total)} · Diferença de {brl(s.anterior==null?null:s.total-s.anterior)}.</p><Composicao linhas={[["Novos no histórico",'novos'],['Clientes sem faturamento na base anterior','semBase'],['Expansão em clientes existentes','expansao'],['Redução em clientes existentes','reducao'],['Clientes sem faturamento no período','semFaturamento']].map(([nome,k])=>({nome,valor:r.ponte[k]}))}/><small>Ausência de nota não comprova encerramento do contrato.</small></section><section className="bi-card"><h3>Referências da carteira</h3><div className="clientes-referencias"><p><span>Maior faturamento no período</span><strong>{s.maior?.nome||'Sem base'}</strong>{brl(s.maior?.atual)}</p><p><span>Menor faturamento positivo</span><strong>{s.menor?.nome||'Sem base'}</strong>{brl(s.menor?.atual)}</p><p><span>Ticket médio por nota</span><strong>{brl(s.ticket)}</strong>Não se confunde com faturamento médio por cliente.</p></div></section></div>
   <section className="bi-card"><h3>Valores fora do padrão habitual</h3><details><summary>Como identificamos as disparidades</summary><p>Variação de pelo menos 30% contra a mediana dos seis meses anteriores, com faturamento observado em pelo menos três deles. A referência usa o último mês encerrado. É um pedido de conferência, não um erro confirmado.</p></details>{r.clientes.some(c=>c.disparidade)?<ul>{r.clientes.filter(c=>c.disparidade).slice(0,5).map(c=><li key={c.documento}><button onClick={()=>setSelecionado(c.documento)}>{c.nome}</button>: {brl(c.disparidade.atual)} em {mes(c.disparidade.mes)}, habitual {brl(c.disparidade.mediana)} ({pct(c.disparidade.variacao)}).</li>)}</ul>:<p>Sem disparidades identificadas nos meses fechados com histórico suficiente.</p>}</section>
   <section className="bi-card"><div className="clientes-heading"><h3>Clientes e evolução</h3><div className="clientes-acoes clientes-nao-imprimir"><label>Buscar cliente<input value={busca} onChange={e=>{setBusca(e.target.value);setPagina(1);}} placeholder="Nome ou CPF/CNPJ"/></label><label>Exibir<select value={filtro} onChange={e=>{setFiltro(e.target.value);setPagina(1);}}><option value="periodo">Períodos comparados</option><option value="todos">Todo o histórico</option><option value="alertas">Com disparidade</option></select></label><label>Ordenar<select value={ordem} onChange={e=>{setOrdem(e.target.value);setPagina(1);}}><option value="maior">Maior faturamento</option><option value="menor">Menor faturamento</option><option value="variacao">Maior redução em reais</option></select></label></div></div><div className="bi-scroll"><table><thead><tr><th>Cliente</th><th>Atual</th><th>Anterior</th><th>Variação</th><th>Participação</th><th>Última competência</th></tr></thead><tbody>{(imprimindo?linhas:linhas.slice((pagina-1)*20,pagina*20)).map(c=><tr key={c.documento}><td><button onClick={()=>setSelecionado(c.documento)}>{c.nome}</button><small>{doc(c.documento)} · {c.situacao}</small></td><td>{brl(c.atual)}</td><td>{brl(c.anterior)}</td><td>{pct(c.variacao)}<small>{brl(c.diferenca)}</small></td><td>{parte(c.participacao)}</td><td>{mes(c.ultima)}</td></tr>)}</tbody></table></div><p>{linhas.length} cliente(s) no filtro · Página {pagina} de {Math.max(1,Math.ceil(linhas.length/20))}. O PDF inclui todos os clientes do filtro.</p>{linhas.length>20&&<div className="clientes-acoes clientes-nao-imprimir"><button disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Página anterior</button><button disabled={pagina*20>=linhas.length} onClick={()=>setPagina(p=>p+1)}>Próxima página</button></div>}</section>
   {selecionado&&r.clientes.find(c=>c.documento===selecionado)&&<ClienteDetalhe imprimindo={imprimindo} key={selecionado} cliente={r.clientes.find(c=>c.documento===selecionado)} fechar={()=>setSelecionado(null)}/>}
   <details className="bi-metodologia"><summary>Fontes e limites da análise de clientes</summary><p className="clientes-legenda">Empresa de referência: {empresaNome || (r.demonstracao?'Empresa de demonstração':empresaId)} · Consulta em {r.hoje}. Histórico observado desde {mes(r.inicioHistorico)}. Faturamento documentado, não recebimento nem LTV estimado.</p>{r.avisos?.map((aviso,i)=><p key={i}>{aviso}</p>)}<footer className="clientes-legenda">Fonte: notas emitidas autorizadas, agrupadas por CPF/CNPJ completo. A primeira nota disponível não comprova a data de início do contrato. O faturamento acumulado termina em {mes(ate)}; não estima receita futura, recebimento ou rentabilidade do cliente. Lacunas de captura podem afetar recorrência e comparações.</footer></details>
 </section>;
}
