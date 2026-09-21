import { useEffect, useState } from 'react';
import { linhaDoMes } from '../lib/tabelaFluxoLeitura';
import { Modal } from '../../../components/ui/Modal';
import { CARDS_FLUXO, resumoMensal, linhasDoCard } from '../../../../../../packages/shared/src/fluxoMensal';
const brl=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const mesLabel=comp=>new Date(comp+'-15T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
const origem = p => ({FATO:'Realizado',COMPROMISSO:'A pagar',PREVISAO:'Previsto'}[p] || 'Origem não informada');

export function FluxoLeitura({api,companyId,competenciaReferencia,razaoSocial,titulo="Relatórios · Fluxo de caixa"}) {
  const [dados,setDados]=useState(null),[erro,setErro]=useState(null),[detalhe,setDetalhe]=useState(null);
  useEffect(()=>{let vivo=true;setDados(null);setErro(null);setDetalhe(null);Promise.resolve().then(()=>api.getFluxoCaixa(companyId,{janelaInicio:competenciaReferencia})).then(r=>{if(!vivo)return;if(r?.ok===false||r?.demonstracao!==false||!Array.isArray(r?.meses))throw new Error(r?.message||'A resposta não contém o fluxo real desta empresa.');setDados(r);}).catch(e=>{if(vivo)setErro(e.message||'Não foi possível carregar o fluxo.');});return()=>{vivo=false;};},[api,companyId,competenciaReferencia]);
  const inicio=competenciaReferencia||dados?.cicloAtual;
  const mes=dados?.meses.find(m=>m.competencia===inicio);
  const total=resumoMensal(mes,linhaDoMes);
  const card=CARDS_FLUXO.find(c=>c.chave===detalhe);
  return <div className="fluxo-mensal" style={{padding:'16px clamp(12px, 2vw, 28px)',minWidth:0}}>
    <h2>{titulo}</h2><p>{razaoSocial||'Empresa'}{inicio?' · '+mesLabel(inicio):''}</p>
    {erro?<p role="alert">Não foi possível ler o fluxo. {erro}</p>:!dados?<p role="status">Carregando fluxo…</p>:!mes?<p role="status">Este mês não veio na consulta. Não é possível afirmar que está sem movimento.</p>:<>
      <div className="fluxo-mensal-cards">{CARDS_FLUXO.map(c=><button type="button" className="fluxo-mensal-card" key={c.chave} onClick={()=>setDetalhe(c.chave)} aria-label={'Ver '+c.rotulo.toLowerCase()+' de '+mesLabel(inicio)}>
        <span>{c.rotulo}</span><strong>{brl(total[c.chave]?.valor)}</strong>
        <small>{c.chave==='folha'&&dados.folha?.disponivel===false?'Folha não disponível':total[c.chave]?.status==='forecast'?'Inclui valores a pagar ou previstos':total[c.chave]?'Movimentações registradas':'Sem movimentos informados'}</small>
        {c.descricao&&<small>{c.descricao}</small>}<span className="fluxo-mensal-link">Ver detalhes →</span>
      </button>)}</div>
      <p>Acumulado projetado: {brl(mes.saldo?.final)} · Não representa saldo bancário.</p>
      {(dados.semMes?.length>0||dados.foraDoHorizonte>0)&&<p role="status">Fora dos cards: {dados.semMes?.length||0} registro(s) sem mês definido; {dados.foraDoHorizonte||0} fora do horizonte.</p>}
      {(dados.recorrenciaIndisponivel||dados.saidasDoClienteIndisponiveis)&&<p role="status">Parte das fontes do fluxo está indisponível. Os valores exibidos não afirmam que essas fontes estejam zeradas.</p>}
    </>}
    {card&&mes&&<Modal titulo={card.rotulo+' · '+mesLabel(inicio)} aoFechar={()=>setDetalhe(null)} tamanho="lg">
      <p>{card.descricao||'Movimentos do mês'} · {brl(total[detalhe]?.valor)}</p>
      {linhasDoCard(mes,detalhe,linhaDoMes).length?<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>Descrição</th><th>Dia</th><th>Situação</th><th>Valor</th></tr></thead><tbody>{linhasDoCard(mes,detalhe,linhaDoMes).map((l,i)=><tr key={i}><td style={{padding:12}}>{l.rotulo||'Movimento'}{l.base?.frase&&<small style={{display:'block',color:'var(--text-muted)'}}>{l.base.frase}</small>}</td><td>{l.dia||'Sem dia definido'}</td><td>{origem(l.procedencia)}</td><td style={{whiteSpace:'nowrap',textAlign:'right'}}>{detalhe==='resultado'?(l.direcao==='ENTRADA'?'+ ':'− '):''}{brl(l.valor)}</td></tr>)}</tbody></table></div>:<p>Sem movimentos informados para este card.</p>}
    </Modal>}
  </div>;
}
