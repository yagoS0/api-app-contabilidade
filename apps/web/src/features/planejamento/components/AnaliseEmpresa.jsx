import { FiltroPeriodo } from './FiltroPeriodo';
import { GraficoEvolucao } from './GraficoEvolucao';
import { BaseSocios } from './BaseSocios';
import { BaseTributaria } from './BaseTributaria';
import { BaseGerencial } from './BaseGerencial';
import { ImprimirRelatorio } from './ImprimirRelatorio';
import { estatisticaMensal } from '../../../../../../packages/shared/src/analise/gestao.js';
import { useEffect, useState } from 'react';
import { FluxoLeitura } from '../../relatorios/components/FluxoLeitura';
import { ClientesRelatorio } from './ClientesRelatorio';
import './analiseEmpresa.css';

const moeda = v => v == null ? 'Sem dados' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percentual = v => v == null ? 'Sem dados' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const mes = s => s ? `${s.slice(5)}/${s.slice(0,4)}` : 'Sem competência';
function mover(s, n) { const [y,m] = s.split('-').map(Number); return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7); }
const secoes = [['geral','Visão geral'],['clientes','Clientes'],['resultado','Resultado'],['impostos','Tributário'],['projecao','Projeção']];
const nomes = { faturamento: 'Faturamento documental', resultado: 'Resultado da DRE', margemLiquida: 'Margem líquida', despesas: 'Despesas', tributos: 'Guias da competência' };
const destinos = { faturamento:'geral', resultado:'resultado', margemLiquida:'resultado', despesas:'despesas', tributos:'impostos' };
const despesas = ['pessoal','gerais','tributarias','depreciacao','despesasFinanceiras'];
const ePercentual = k => k.startsWith('margem') || k === 'carga';

function Variacao({ valor, pontos = false }) {
  if (!valor) return null;
  return <span>{valor.percentual != null ? `${valor.percentual > 0 ? '+' : ''}${percentual(valor.percentual)}` : valor.texto}{valor.absoluta != null && !pontos ? ` · ${moeda(valor.absoluta)}` : ''}</span>;
}

function DetalheConta({ api, empresaId, conta, de, ate, fechar }) {
  const [pagina,setPagina] = useState(1), [dados,setDados] = useState(null), [erro,setErro] = useState('');
  useEffect(() => { let vivo=true; setDados(null); setErro('');
    Promise.resolve().then(() => api.getAnaliseLancamentos(empresaId,{ conta: conta.reduzido, de, ate, pagina })).then(r => { if(vivo) { if(r?.ok === false) throw new Error(r.message); setDados(r); } }).catch(e => { if(vivo) setErro(e.message); });
    return () => { vivo=false; };
  },[api,empresaId,conta,de,ate,pagina]);
  return <section className="bi-card" aria-label="Lançamentos da conta"><button type="button" onClick={fechar}>Fechar detalhe</button><h3>{conta.nome} · {conta.reduzido}</h3><p>{mes(de)} a {mes(ate)} · Valores por débito e crédito, antes do sinal de apresentação da DRE.</p>
    {erro ? <p role="alert">{erro}</p> : !dados ? <p role="status">Carregando lançamentos…</p> : <><div className="bi-scroll"><table><thead><tr><th>Competência</th><th>Histórico</th><th>Movimentos</th><th>Origem</th></tr></thead><tbody>{dados.linhas.map(e => <tr key={e.id}><td>{mes(e.competencia)}</td><td>{e.historico} {e.status === 'RASCUNHO' && ' · Rascunho'}</td><td>{e.lines.map((l,i)=><div key={i}>{l.tipo}: {moeda(l.valor)}</div>)}</td><td>{e.sourceGuideId ? <a href={`/companies/${empresaId}/guides`}>Consultar guia na empresa</a> : 'Documento não vinculado nesta consulta'}</td></tr>)}</tbody></table></div>{!dados.linhas.length && <p>Nenhum lançamento encontrado.</p>}<button disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> <span>Página {pagina}</span> <button disabled={!dados.temMais} onClick={()=>setPagina(p=>p+1)}>Próxima</button></>}
  </section>;
}

export function AnaliseEmpresa({ api, empresaId, empresaNome, empresaCnpj }) {
  const hoje = new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,7);
  const [de,setDe] = useState(()=>mover(hoje,-1)), [ate,setAte] = useState(()=>mover(hoje,-1));
  const [comparar,setComparar] = useState('anterior'), [secao,setSecao] = useState('geral');
  const [resposta,setResposta] = useState(null), [erro,setErro] = useState(''), [tentativa,setTentativa] = useState(0), [conta,setConta] = useState(null);
  const chave = `${empresaId}:${de}:${ate}:${comparar}`;
  const dados = resposta?.chave === chave ? resposta.dados : null;
  useEffect(() => { let vivo=true; setErro(''); setConta(null);
    if (!de || !ate || de>ate) { setErro('Informe um intervalo válido.'); return; }
    Promise.resolve().then(()=>api.getAnalisePlanejamento(empresaId,{de,ate,comparar})).then(r=>{if(!r || r.ok===false) throw new Error(r?.message||'Resposta inválida.'); if(vivo)setResposta({chave,dados:r});}).catch(e=>{if(vivo)setErro(e.message||'Não foi possível carregar a análise.');});
    return ()=>{vivo=false;};
  },[api,empresaId,de,ate,comparar,chave,tentativa]);
  const atual = dados?.atual, anterior = dados?.anterior;
  const serie = dados?.serie.slice(-12)||[];
  const guiasPeriodo = dados?.guias.filter(g=>g.competencia>=de&&g.competencia<=ate)||[];
  const compromissos = dados?.guias.filter(g=>g.paymentStatus!=='PAID').sort((a,b)=>String(a.vencimento||'9999').localeCompare(String(b.vencimento||'9999')))||[];
  const somarGuias = list => !list.length || list.some(g=>g.valor==null) ? null : list.reduce((s,g)=>s+Math.round(g.valor*100),0)/100;
  const estatistica = estatisticaMensal((dados?.serie||[]).filter(m=>m.competencia>=de&&m.competencia<=ate).map(m=>({valor:m.indicadores.faturamento})));
  return <section className="analise-empresa">
    <header className="bi-cabecalho"><div><h1>Relatórios da empresa</h1><span className="bi-contexto"> {empresaNome}</span></div><div className="bi-acoes"><FiltroPeriodo de={de} ate={ate} comparar={comparar} onAplicar={v=>{setDe(v.de);setAte(v.ate);setComparar(v.comparar);}}/>{dados&&<ImprimirRelatorio key={chave} api={api} empresaId={empresaId} empresaNome={empresaNome} empresaCnpj={empresaCnpj} dados={dados} de={de} ate={ate} comparar={comparar}/>}</div></header>
    <nav className="bi-tabs" aria-label="Seções da análise">{secoes.map(([k,n])=><button key={k} aria-pressed={secao===k||(k==='resultado'&&secao==='despesas')} onClick={()=>{setSecao(k);setConta(null);}}>{n}</button>)}</nav>
    {erro ? <div role="alert">{erro} <button onClick={()=>{setResposta(null);setTentativa(n=>n+1);}}>Tentar novamente</button></div> : !dados ? <p role="status">Carregando análise…</p> : <>
      {dados.demonstracao && <p className="bi-aviso">Ambiente de demonstração · Dados fictícios para testes.</p>}
      <p className="bi-contexto">{mes(de)} a {mes(ate)} comparado com {mes(anterior.de)} a {mes(anterior.ate)} · Consulta em {dados.hoje}</p>
      {secao==='clientes' && <ClientesRelatorio key={empresaId} api={api} empresaId={empresaId} empresaNome={empresaNome} de={de} ate={ate} comparar={comparar}/>}
      {(atual.parcial||anterior.parcial) && <p className="bi-aviso">Dados parciais · Confira a cobertura antes de interpretar o crescimento.</p>}
      {secao==='geral' && <>
        <div className="bi-cards">{Object.entries(nomes).map(([k,n])=><button className="bi-card" key={k} onClick={()=>setSecao(destinos[k])}><span>{n}</span><strong>{ePercentual(k)?percentual(atual.indicadores[k]):moeda(atual.indicadores[k])}</strong><small>Anterior: {ePercentual(k)?percentual(anterior.indicadores[k]):moeda(anterior.indicadores[k])}</small><small><Variacao valor={dados.variacoes[k]} pontos={ePercentual(k)}/></small></button>)}</div>
        <section className="bi-card"><h2>Evolução mensal · últimos 12 meses</h2><GraficoEvolucao serie={serie}/><details><summary>Ver valores mensais</summary><p>Faturamento documental e resultado contábil têm fontes diferentes. Ausências não são zero.</p><div className="bi-scroll"><table><thead><tr><th>Mês</th><th>Faturamento</th><th>Resultado da DRE</th><th>Margem líquida</th><th>Despesas</th></tr></thead><tbody>{serie.map(m=><tr key={m.competencia}><td>{mes(m.competencia)}</td><td>{moeda(m.indicadores.faturamento)}</td><td>{moeda(m.indicadores.resultado)}</td><td>{percentual(m.indicadores.margemLiquida)}</td><td>{moeda(m.indicadores.despesas)}</td></tr>)}</tbody></table></div></details></section>
        <section className="bi-card"><h2>Referências do período</h2><div className="bi-cards">{[['Média mensal',estatistica.media],['Menor mês observado',estatistica.minimo],['Maior mês observado',estatistica.maximo],['Oscilação (desvio mensal)',estatistica.desvio]].map(([n,v])=><div key={n}><h3>{n}</h3><strong>{moeda(v)}</strong></div>)}</div><p>{estatistica.quantidade} mês(es) com registros; {estatistica.ausentes} sem base. Meses ausentes não entram como zero.</p></section>
        <section className="bi-card"><h2>O que mudou?</h2>{[['Faturamento documental','faturamento'],['Resultado da DRE','resultado'],['Despesas','despesas']].map(([n,k])=>dados.variacoes[k]?.absoluta!=null&&<p key={k}>{n}: <Variacao valor={dados.variacoes[k]} pontos={ePercentual(k)}/></p>)}{dados.insights.length?dados.insights.map((i,n)=><p key={n}>{i.texto} <button onClick={()=>setSecao(i.secao)}>Ver composição</button></p>):<p>{atual.parcial||anterior.parcial?'Conclua a conferência dos períodos para habilitar alertas de evolução.':'Nenhuma regra de alerta acionada nos períodos comparados.'}</p>}</section>
      </>}
      {(secao==='resultado'||secao==='despesas')&&<div className="bi-atalhos"><button aria-pressed={secao==='resultado'} onClick={()=>setSecao('resultado')}>DRE completa</button><button aria-pressed={secao==='despesas'} onClick={()=>setSecao('despesas')}>Despesas por categoria</button></div>}
      {(secao==='resultado'||secao==='despesas') && <section className="bi-card"><h2>{secao==='resultado'?'DRE gerencial comparativa':'Despesas por categoria'}</h2><p>Por competência e plano de contas. DRE gerencial, não é peça fiscal. Custos e IRPJ/CSLL ficam em linhas próprias da DRE.</p>
        {secao==='resultado'&&<div className="bi-cards">{['margemBruta','margemOperacional','margemLiquida'].map((k,i)=><div key={k}><h3>{['Margem bruta','Margem operacional','Margem líquida'][i]}</h3><strong>{percentual(atual.indicadores[k])}</strong><p><Variacao valor={dados.variacoes[k]} pontos={ePercentual(k)}/></p><small>Base: receita líquida da DRE.</small></div>)}</div>}
        <div className="bi-scroll"><table><thead><tr><th>Categoria / conta</th><th>Atual</th><th>Anterior</th><th>Variação</th>{secao==='despesas'&&<th>% da receita líquida</th>}</tr></thead><tbody>{atual.dre.linhas.filter(l=>secao==='resultado'||despesas.includes(l.chave)).map(l=>{const a=atual.dre.semLancamento?null:l.valor;const b=anterior.dre.semLancamento?null:anterior.dre.linhas.find(x=>x.chave===l.chave)?.valor; return <tr key={l.chave}><td>{l.contas?.length?<details><summary>{l.rotulo}</summary>{l.contas.map(c=><p key={c.codigo}><button onClick={()=>setConta(c)}>{c.nome||c.codigo} · {c.reduzido}</button> {moeda(c.valor)}</p>)}</details>:l.rotulo}</td><td>{moeda(a)}</td><td>{moeda(b)}</td><td>{a==null||b==null?'Sem base':moeda(a-b)}</td>{secao==='despesas'&&<td>{atual.dre.linhas.find(x=>x.chave==='receitaLiquida')?.valor>0?percentual(-a/atual.dre.linhas.find(x=>x.chave==='receitaLiquida').valor*100):'Sem base'}</td>}</tr>;})}</tbody></table></div>
        {atual.dre.naoClassificado?.length>0&&<details><summary>Contas pendentes de classificação</summary>{atual.dre.naoClassificado.map((g,i)=><p key={i}>{g.frase} · {moeda(g.valor)}</p>)}</details>}
      </section>}
      {secao==='resultado'&&<BaseGerencial key={empresaId} api={api} empresaId={empresaId} dre={atual.dre}/>}
      {secao==='resultado'&&<BaseSocios key={empresaId+de+ate} api={api} empresaId={empresaId} de={de} ate={ate} resultado={atual.indicadores.resultado}/>}
      {conta && <DetalheConta key={`${empresaId}:${conta.codigo}:${de}:${ate}`} api={api} empresaId={empresaId} conta={conta} de={de} ate={ate} fechar={()=>setConta(null)}/>}
      {secao==='impostos'&&<><BaseTributaria key={empresaId+ate} api={api} empresaId={empresaId} referencia={ate}/><div className="bi-cards"><div className="bi-card"><h3>Guias da competência</h3><strong>{moeda(atual.indicadores.tributos)}</strong><p>Sem parcelamentos.</p></div><div className="bi-card"><h3>Carga das guias sobre faturamento</h3><strong>{percentual(atual.indicadores.carga)}</strong><p>Somente documentos disponíveis.</p></div><div className="bi-card"><h3>Guias pagas da competência</h3><strong>{moeda(somarGuias(guiasPeriodo.filter(g=>g.paymentStatus==='PAID')))}</strong><p>Status atual; inclui parcelas. Não é pagamento ocorrido no período.</p></div></div><section className="bi-card"><h2>Composição por competência</h2><Guias guias={guiasPeriodo}/></section><section className="bi-card"><h2>Compromissos em aberto · posição atual</h2><p>Independente do período da DRE. Ordenados pelo vencimento; inclui atrasadas e parcelamentos fiscais.</p><Guias guias={compromissos}/></section></>}
      {secao==='projecao'&&<><p className="bi-aviso">Projeção financeira · Previsto, compromisso e pago são estados diferentes. Acumulado projetado não representa saldo bancário.</p><FluxoLeitura api={api} companyId={empresaId} competenciaReferencia={ate} titulo="Projeção financeira"/></>}
      <details className="bi-card"><summary>Cobertura e origem dos dados</summary><p>Janela consultada: {mes(dados.cobertura[0]?.competencia)} a {mes(dados.cobertura.at(-1)?.competencia)}. Registro presente não atesta completude. Ausência não significa zero.</p><div className="bi-scroll"><table><thead><tr><th>Mês</th><th>Lançamentos</th><th>Notas válidas</th><th>Guias correntes</th></tr></thead><tbody>{dados.cobertura.map(m=><tr key={m.competencia}><td>{mes(m.competencia)}</td>{['contabilidade','faturamento','guias'].map(k=><td key={k}>{k==='faturamento'&&m.semFaturamentoConfirmado?'Sem faturamento confirmado':k==='contabilidade'&&m.fechadoContabilEm?'Fechamento registrado':m[k]?'Com registros':'Sem registros'}</td>)}</tr>)}</tbody></table></div>{dados.avisos.map((a,i)=><p key={i}>{a}</p>)}</details>
    </>}
  </section>;
}
function Guias({guias}) { return !guias.length?<p>Sem guias disponíveis neste recorte.</p>:<div className="bi-scroll"><table><thead><tr><th>Guia</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Situação</th></tr></thead><tbody>{guias.map(g=><tr key={g.id}><td>{g.tipo}{g.parcelamentoId?` · Parcela ${g.numeroParcela||'não informada'}`:''}</td><td>{mes(g.competencia)}</td><td>{g.vencimento?String(g.vencimento).slice(0,10).split('-').reverse().join('/'):'Não informado'}</td><td>{moeda(g.valor)}</td><td>{g.paymentStatus==='PAID'?'Paga':g.paymentStatus==='OVERDUE'?'Em atraso':'Em aberto'}{!g.liberadaCliente?' · Não liberada ao cliente':''}</td></tr>)}</tbody></table></div>; }
