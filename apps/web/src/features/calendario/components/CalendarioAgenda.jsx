import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuTarefaCalendario } from './MenuTarefaCalendario';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { ModalTarefaCalendario } from './ModalTarefaCalendario';
import { PainelTarefaCalendario } from './PainelTarefaCalendario';
import { AtividadeAgenda as Atividade } from './AtividadeAgenda';
import { LinhaHorarioAtual } from './LinhaHorarioAtual';
import { useRelogioAgenda } from './LinhaHorarioAtual.shared.js';
import { useGestosAgenda } from './useGestosAgenda';
import { ALTURA_HORA, HORA_INICIAL } from '../lib/escalaAgenda';
import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { expandirTarefaCalendario } from '../../../../../../packages/shared/src/tarefasCalendario.js';
import { dataBR, dataLocal, diasDoPeriodo, fimVisual, minutos, posicionarHorarios } from '../lib/agendaWorkspace';
import { deslocarMes } from '../lib/periodosCalendario';
import { configDoGestoTarefa } from '../lib/gestoTarefaUnificada';
import { prepararTarefasCalendario, projetarTarefasCalendario } from '../lib/tarefasUnificadas';

const conferir=out=>{if(!out||out.ok===false)throw new Error(out?.message||'Não foi possível atualizar o calendário.');return out;};
const original=item=>item.atividadeOriginal||item;
const faixa=item=>!item.horaInicio||item.horarioModo==='ATE';
const EMPRESAS_VAZIAS=[];

export function CalendarioAgenda({api,empresas=EMPRESAS_VAZIAS,onOpenCompany,companyIdFixo=null,initialContext,onContextChange,somenteDia=false}){
  const [referencia,setReferencia]=useState(initialContext?.referencia||dataLocal());
  const [visao,setVisao]=useState(somenteDia?'dia':['mes','semana','dia','lista'].includes(initialContext?.visao)?initialContext.visao:'mes');
  const [itens,setItens]=useState([]),[carregando,setCarregando]=useState(true),[erro,setErro]=useState(''),[revisao,setRevisao]=useState(0);
  const [aviso,setAviso]=useState(''),[contextoCarregado,setContextoCarregado]=useState('');
  const [recuperacaoDuplicacao,setRecuperacaoDuplicacao]=useState(null);
  const focoPendente=useRef(null),workspaceRef=useRef(null);
  const [empresasCarregadas,setEmpresasCarregadas]=useState(EMPRESAS_VAZIAS);
  const [scrollbar,setScrollbar]=useState(0);
  const carteira=empresas.length?empresas:empresasCarregadas;
  const [criacao,setCriacao]=useState(null),[detalhe,setDetalhe]=useState(null),[exclusao,setExclusao]=useState(null);
  const [ocupado,setOcupado]=useState(false),[busca,setBusca]=useState(''),[mostrarConcluidas,setMostrarConcluidas]=useState(true);
  const horasRef=useRef(null),mesRef=useRef(null),faixaRef=useRef(null),leituraRef=useRef(0),salvandoRef=useRef(false),contextoAplicado=useRef(false);
  const agora=useRelogioAgenda();
  const dias=useMemo(()=>diasDoPeriodo(referencia,visao),[referencia,visao]);
  const inicio=dias[0],fim=dias.at(-1);
  const contextoAtual=useRef('');contextoAtual.current=[inicio,fim,companyIdFixo].join('|');
  const carteiraChave=JSON.stringify(carteira);
  const carteiraLeitura=useMemo(()=>JSON.parse(carteiraChave),[carteiraChave]);
  const recarregar=useCallback(()=>{leituraRef.current+=1;setRevisao(v=>v+1);},[]);
  useEffect(()=>{
    if(ocupado||!focoPendente.current)return;
    const destino=focoPendente.current;
    focoPendente.current=null;
    const elemento=destino.isConnected&&!destino.disabled?destino:workspaceRef.current?.querySelector('button[aria-label="Período anterior"]');
    elemento?.focus({preventScroll:true});
  },[ocupado,exclusao]);
  useEffect(()=>{
    if(empresas.length||!companyIdFixo||!api.listCompanies)return;
    let ativo=true;
    Promise.resolve(api.listCompanies()).then(out=>{if(ativo)setEmpresasCarregadas(Array.isArray(out)?out:out.companies||[]);}).catch(e=>{if(ativo)setErro(e.message||'Não foi possível carregar as empresas.');});
    return()=>{ativo=false;};
  },[api,empresas.length,companyIdFixo]);
  useEffect(()=>{onContextChange?.({referencia,visao});},[referencia,visao,onContextChange]);
  useEffect(()=>{
    let ativo=true;const leitura=++leituraRef.current;
    setCarregando(true);setErro('');
    Promise.resolve().then(()=>api.listarTarefasCalendario({inicio,fim,companyId:companyIdFixo})).then(conferir).then(out=>{
      if(!ativo||leitura!==leituraRef.current)return;
      if(!Array.isArray(out.itens))throw new Error('Resposta inválida do calendário.');
      const proximos=prepararTarefasCalendario(out.itens,carteiraLeitura);setItens(proximos);setContextoCarregado([inicio,fim,companyIdFixo].join('|'));
      setDetalhe(atual=>atual?proximos.find(i=>i.tarefaId===atual.tarefaId&&i.cicloChave===atual.cicloChave)||null:null);
    }).catch(e=>{if(ativo&&leitura===leituraRef.current)setErro(e.message);}).finally(()=>{if(ativo&&leitura===leituraRef.current)setCarregando(false);});
    return()=>{ativo=false;};
  },[api,inicio,fim,companyIdFixo,revisao,carteiraLeitura]);
  useEffect(()=>{if(horasRef.current)horasRef.current.scrollTop=HORA_INICIAL*ALTURA_HORA;},[visao]);
  useEffect(()=>{
    const scroll=horasRef.current;
    if(!scroll){setScrollbar(0);return;}
    const medir=()=>setScrollbar(scroll.offsetWidth-scroll.clientWidth);
    medir();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(medir);observer.observe(scroll);
    return()=>observer.disconnect();
  },[visao]);
  useEffect(()=>{const c=initialContext?.obrigacoesModal;if(!contextoAplicado.current&&c?.criar){contextoAplicado.current=true;const data=c.dataInicio||referencia;setCriacao({dataInicio:data,dataFim:c.dataFim||data,companyId:c.companyId||companyIdFixo});}},[initialContext,referencia,companyIdFixo]);
  const contextoChave=[inicio,fim,companyIdFixo].join('|');
  const filtrados=useMemo(()=>contextoCarregado===contextoChave?itens.filter(i=>(mostrarConcluidas||!i.resolvido)&&i.titulo.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))):[],[itens,busca,mostrarConcluidas,contextoCarregado,contextoChave]);
  const blocos=useMemo(()=>projetarTarefasCalendario(filtrados,inicio,fim,agora.data),[filtrados,inicio,fim,agora.data]);
  const horarios=useMemo(()=>Object.fromEntries(dias.map(d=>[d,posicionarHorarios(blocos.filter(i=>!faixa(i)&&i.dataInicio===d))])),[blocos,dias]);
  const criar=useCallback((data,hora)=>{setErro('');setCriacao({dataInicio:data,dataFim:data,companyId:companyIdFixo,...(hora==null?{}:{horarioModo:'FIXO',horaInicio:`${String(hora).padStart(2,'0')}:00`})});},[companyIdFixo]);
  const criarPeriodo=useCallback(patch=>setCriacao({...patch,horarioModo:patch.horaInicio?'FIXO':'SEM',companyId:companyIdFixo}),[companyIdFixo]);
  const atualizarRascunho=useCallback(patch=>setCriacao(atual=>atual?{...atual,...patch}:atual),[]);
  const executar=useCallback(async(item,dados)=>{
    if(salvandoRef.current)throw new Error('Aguarde a alteração em andamento.');salvandoRef.current=true;setOcupado(true);setErro('');setAviso('');
    const contexto=contextoAtual.current;leituraRef.current+=1;
    try{
      const out=conferir(await api.acaoTarefaCalendario(item.tarefaId,{cicloChave:item.cicloChave,...dados}));
      if(contexto===contextoAtual.current&&out.tarefa){
        const confirmados=prepararTarefasCalendario(expandirTarefaCalendario(out.tarefa,inicio,fim),carteira).filter(i=>!companyIdFixo||i.empresasIds.includes(companyIdFixo));
        setItens(atuais=>[...atuais.filter(i=>i.tarefaId!==out.tarefa.id),...confirmados]);
        setDetalhe(atual=>atual?.tarefaId===out.tarefa.id?confirmados.find(i=>i.cicloChave===atual.cicloChave)||null:atual);
      }
      // Relê o contexto atual, sem aplicar a resposta de uma tela anterior.
      recarregar();return out;
    }
    catch(e){if(contexto===contextoAtual.current)setErro(e.message);throw e;}finally{salvandoRef.current=false;setOcupado(false);if(contexto===contextoAtual.current)setCarregando(false);}
  },[api,recarregar,inicio,fim,carteira,companyIdFixo]);
  const salvarGesto=useCallback((projecao,patch)=>{
    const item=original(projecao),config=configDoGestoTarefa(projecao,patch);
    void executar(item,{acao:'EDITAR',alteracoes:{titulo:item.titulo,descricao:item.descricao,empresasIds:item.empresasIds,subtarefas:item.subtarefas,config}}).catch(()=>{});
  },[executar]);
  const baseGestos=useGestosAgenda({dias,horasRef,mesRef,faixaRef,mensal:visao==='mes',salvar:salvarGesto,criar:criarPeriodo,bloqueado:ocupado||carregando||Boolean(criacao||detalhe)});
  const gestos={...baseGestos,permiteRedimensionar:true,habilitada:i=>!i.projecaoAlerta&&baseGestos.habilitada(i)};
  const abrir=item=>{setErro('');setDetalhe(original(item));};
  async function concluirNaGrade(projecao){const item=original(projecao);if(item.empresas?.length||item.subtarefas?.length){abrir(item);return;}try{await executar(item,{acao:item.resolvido?'REABRIR':'CONCLUIR'});}catch{/* erro visível */}}
  const duplicar=async(projecao,novaIntencao=false)=>{
    const item=original(projecao),chave=`${item.tarefaId}|${item.cicloChave}`,contexto=contextoAtual.current;
    if(salvandoRef.current)return;
    setRecuperacaoDuplicacao(null);
    const chaveStorage=`altan:calendario:duplicacao:${chave}`,gatilho=document.activeElement;
    let intencaoId;
    try{
      intencaoId=(!novaIntencao&&sessionStorage.getItem(chaveStorage))||crypto.randomUUID();
      sessionStorage.setItem(chaveStorage,intencaoId);
    }catch{setErro('Não foi possível guardar esta tentativa com segurança. A duplicação não foi enviada. Habilite o armazenamento desta aba e tente novamente.');return;}
    try{
      await executar(item,{acao:'DUPLICAR',intencaoId});
      // Falhar ao limpar conserva a mesma tentativa; nunca arrisca criar outra cópia.
      try{sessionStorage.removeItem(chaveStorage);}catch{/* recuperação idempotente permanece */}
      if(contexto===contextoAtual.current)setAviso('Ocorrência duplicada como tarefa avulsa e pendente. A cópia pode ser editada.');
    }catch(e){
      // Apenas a recusa definitiva tipada oferece uma NOVA ação. Timeout e demais
      // erros conservam a intenção; não há repetição automática nem novo UUID.
      if(e.code==='CALENDAR_COPY_DELETED'&&e.status===409&&contexto===contextoAtual.current)setRecuperacaoDuplicacao({item,contexto});
    }
    finally{if(contexto===contextoAtual.current)focoPendente.current=gatilho;}
  };
  const pedirExclusao=item=>setExclusao({item:original(item),serie:false});
  function navegar(passo){setReferencia(d=>visao==='mes'||visao==='lista'?deslocarMes(d,passo):somarDiasAgenda(d,passo*(visao==='semana'?7:1)));}
  function mudouPainel(atual){if(atual){setDetalhe(atual);setItens(anteriores=>anteriores.map(i=>i.tarefaId===atual.tarefaId&&i.cicloChave===atual.cicloChave?atual:i));}recarregar();}
  async function excluir(){try{await executar(exclusao.item,{acao:exclusao.serie?'EXCLUIR_SERIE':'EXCLUIR'});focoPendente.current=workspaceRef.current?.querySelector('button[aria-label="Período anterior"]');setExclusao(null);setDetalhe(null);}catch{/* confirmação preservada */}}
  const tituloPeriodo=visao==='mes'||visao==='lista'?new Date(`${referencia}T12:00:00Z`).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}):visao==='dia'?dataBR(referencia):`${dataBR(inicio)} – ${dataBR(fim)}`;
  return <section ref={workspaceRef} className="agenda-workspace agenda-unified" aria-label="Calendário de tarefas" style={{'--days':dias.length,'--agenda-hour-height':`${ALTURA_HORA}px`,'--agenda-scrollbar':`${scrollbar}px`}}>
    <div className="agenda-toolbar"><div className="agenda-navigation"><Button variant="secondary" size="sm" aria-label="Período anterior" onClick={()=>navegar(-1)}>‹</Button><Button variant="secondary" size="sm" aria-label="Próximo período" onClick={()=>navegar(1)}>›</Button><h2>{tituloPeriodo}</h2><Button variant="secondary" size="sm" onClick={()=>setReferencia(dataLocal())}>Hoje</Button></div><div className="agenda-toolbar-actions">{!somenteDia&&<label>Visualização <select value={visao} onChange={e=>setVisao(e.target.value)}><option value="mes">Mês</option><option value="semana">Semana</option><option value="dia">Dia</option><option value="lista">Lista</option></select></label>}<Button size="sm" onClick={()=>criar(referencia)}>+ Nova tarefa</Button></div></div>
    {erro&&<div className="agenda-error" role="alert">{erro} {recuperacaoDuplicacao?.contexto===contextoChave?<Button variant="secondary" size="sm" disabled={ocupado} onClick={()=>{if(recuperacaoDuplicacao.contexto===contextoAtual.current)void duplicar(recuperacaoDuplicacao.item,true);}}>Iniciar nova duplicação</Button>:<button type="button" onClick={recarregar}>Tentar novamente</button>}</div>}
    <div className="agenda-refresh-status">{(carregando||ocupado||aviso)&&<span role="status">{ocupado?'Salvando alteração…':carregando?'Atualizando calendário…':aviso}</span>}</div>
    {visao==='lista'?<div className="agenda-list"><div className="agenda-list-filter"><label>Buscar tarefa<input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Título da tarefa"/></label><label><input type="checkbox" checked={mostrarConcluidas} onChange={e=>setMostrarConcluidas(e.target.checked)}/> Mostrar concluídas</label></div>
      {filtrados.map(item=><div className="agenda-list-row" key={item.id}><button type="button" className="agenda-list-name" onClick={()=>abrir(item)}><span><strong>{item.titulo}</strong><small>{dataBR(item.dataInicio)}{item.dataFim!==item.dataInicio?` – ${dataBR(item.dataFim)}`:''}{item.empresas.length?` · ${item.empresas.filter(e=>e.concluida).length}/${item.empresas.length} empresas`:''}{item.resolvido?' · Concluída':''}</small></span></button><div className="agenda-list-actions">{item.dataVencimento&&<span className={!item.resolvido&&item.dataVencimento<dataLocal()?'agenda-error':''}>{!item.resolvido&&item.dataVencimento<dataLocal()?'Atrasada · ':'Vence '}{dataBR(item.dataVencimento)}</span>}<MenuTarefaCalendario item={item} onDuplicar={duplicar} onExcluir={pedirExclusao} disabled={ocupado}/><Button variant="secondary" size="sm" disabled={ocupado} onClick={()=>setExclusao({item,serie:true})}>Excluir série</Button></div></div>)}
      {!filtrados.length&&!carregando&&<p className="agenda-empty">Nenhuma tarefa neste período.</p>}
    </div>:visao==='mes'?<div className="agenda-month" ref={mesRef}><div className="agenda-weekdays">{['seg.','ter.','qua.','qui.','sex.','sáb.','dom.'].map(d=><span key={d}>{d}</span>)}</div>
      {Array.from({length:6},(_,n)=>{const semana=dias.slice(n*7,n*7+7);return <div className="agenda-month-week" data-agenda-month-week={semana[0]} key={semana[0]}><div className="agenda-month-dates">{semana.map(d=><button type="button" key={d} className={`${d===dataLocal()?'is-today':''} ${d.slice(0,7)!==referencia.slice(0,7)?'is-outside':''}`} aria-label={`Criar tarefa em ${dataBR(d)}`} onClick={()=>criar(d)}>{Number(d.slice(8))}</button>)}</div><div className="agenda-unified-month-cells">{semana.map(d=><div className="agenda-unified-month-cell" key={d}>{blocos.filter(i=>i.dataInicio===d).map(item=><Atividade key={item.id} item={item} abrir={abrir} gestos={gestos} onConcluir={concluirNaGrade} onDuplicar={duplicar} onExcluir={pedirExclusao} bloqueado={ocupado} mostrarHorario/>)}<button type="button" className="agenda-unified-add" aria-label={`Adicionar tarefa em ${dataBR(d)}`} onClick={()=>criar(d)}>+</button></div>)}</div></div>;})}
    </div>:<div className="agenda-time-view"><div className="agenda-time-header">{dias.map(d=><button type="button" key={d} className={`agenda-day-head${d===dataLocal()?' is-today':''}`} onClick={()=>criar(d)} aria-label={`Criar tarefa em ${dataBR(d)}`}><small>{new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR',{weekday:'short',timeZone:'UTC'})}</small><strong>{Number(d.slice(8))}</strong></button>)}<span className="agenda-time-gutter"/></div>
      <div className="agenda-all-day"><div className="agenda-unified-all-day" ref={faixaRef} style={{gridTemplateColumns:`repeat(${dias.length},minmax(0,1fr))`}}>{dias.map(d=><div key={d} data-agenda-all-day={d}>{blocos.filter(i=>faixa(i)&&i.dataInicio===d).map(item=><Atividade key={item.id} item={item} abrir={abrir} gestos={gestos} onConcluir={concluirNaGrade} onDuplicar={duplicar} onExcluir={pedirExclusao} bloqueado={ocupado} mostrarHorario/>)}<button type="button" className="agenda-unified-add" aria-label={`Tarefa sem horário em ${dataBR(d)}`} onClick={()=>criar(d)}>+</button></div>)}</div><span className="agenda-time-gutter"/></div>
      <div className="agenda-time-scroll" ref={horasRef}><div className="agenda-time-columns" style={{'--days':dias.length}}>{dias.map(d=><div key={d} className={`agenda-time-day${d===dataLocal()?' is-today':''}`}>
        {Array.from({length:24},(_,hora)=><button type="button" key={hora} className="agenda-time-slot" aria-label={`Criar tarefa em ${dataBR(d)} às ${String(hora).padStart(2,'0')}:00`} onPointerDown={e=>gestos.iniciarCriacao(e,d)} onPointerMove={gestos.mover} onPointerUp={gestos.terminar} onPointerCancel={gestos.cancelar} onLostPointerCapture={gestos.cancelar} onClick={e=>gestos.clicarHorario(e,d,hora)}/>)}
        {horarios[d].map(({item,coluna,colunas,extensao=1})=><Atividade key={item.id} item={item} abrir={abrir} gestos={gestos} onConcluir={concluirNaGrade} onDuplicar={duplicar} onExcluir={pedirExclusao} bloqueado={ocupado} mostrarHorario style={{position:'absolute',top:minutos(item.horaInicio)/60*ALTURA_HORA,height:Math.max(28,(fimVisual(item)-minutos(item.horaInicio))/60*ALTURA_HORA-2),width:`calc(${100*extensao/colunas}% - 5px)`,left:`calc(${coluna*100/colunas}% + 2px)`}}/>)}</div>)}{gestos.previa&&!gestos.previa.mensal&&<div className="agenda-drag-preview" aria-hidden="true" style={{left:gestos.previa.left,width:gestos.previa.width,top:minutos(gestos.previa.horaInicio)/60*ALTURA_HORA,height:Math.max(28,(fimVisual(gestos.previa)-minutos(gestos.previa.horaInicio))/60*ALTURA_HORA-2)}}><strong>{gestos.previa.horaInicio}–{gestos.previa.horaFim}</strong><span>{gestos.previa.item.titulo}</span></div>}<LinhaHorarioAtual dias={dias} agora={agora}/><div className="agenda-hours" aria-hidden="true">{Array.from({length:24},(_,h)=><span key={h}>{String(h).padStart(2,'0')}:00</span>)}</div></div></div>
    </div>}
    {!somenteDia&&<div className="agenda-unified-legend"><span>Tarefas por empresa</span><span className="agenda-deadline-legend">Véspera e vencimento em destaque</span></div>}
    {gestos.previa?.mensal&&<div className="agenda-drag-preview agenda-date-preview" aria-hidden="true" style={{position:'fixed',left:gestos.previa.left,top:gestos.previa.top,width:gestos.previa.width,height:gestos.previa.height}}><strong>{dataBR(gestos.previa.dataInicio)}{gestos.previa.dataFim!==gestos.previa.dataInicio?` – ${dataBR(gestos.previa.dataFim)}`:''}</strong><span>{gestos.previa.item.titulo}</span></div>}
    {criacao&&<ModalTarefaCalendario inicial={criacao} empresas={carteira} api={api} onRascunho={atualizarRascunho} onFechar={()=>setCriacao(null)} onSalvo={()=>{setCriacao(null);recarregar();}}/>}
    {detalhe&&!criacao&&!exclusao&&<PainelTarefaCalendario item={detalhe} api={api} onFechar={()=>setDetalhe(null)} onChanged={mudouPainel} onEditar={()=>{setCriacao({...detalhe,config:{...detalhe.config,dataInicio:detalhe.dataInicio,dataFim:detalhe.dataFim}});setDetalhe(null);}} onExcluir={()=>setExclusao({item:detalhe,serie:false})} onOpenCompany={onOpenCompany}/>}
    {exclusao&&<Modal titulo={exclusao.serie?'Excluir série?':'Excluir ocorrência?'} aoFechar={()=>setExclusao(null)} ocupado={ocupado} tamanho="sm" rodape={<><Button variant="secondary" disabled={ocupado} onClick={()=>setExclusao(null)}>Cancelar</Button><Button variant="danger" disabled={ocupado} onClick={excluir}>{ocupado?'Excluindo…':'Excluir'}</Button></>}><p>{exclusao.item.titulo}</p><p>{exclusao.serie?'Todas as ocorrências serão retiradas do calendário. O histórico será preservado.':'A ocorrência será retirada para todas as empresas vinculadas. As outras repetições serão mantidas.'}</p>{erro&&<p className="agenda-error" role="alert">{erro}</p>}</Modal>}
  </section>;
}
