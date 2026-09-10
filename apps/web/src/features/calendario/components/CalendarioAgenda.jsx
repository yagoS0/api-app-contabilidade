import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { ModalAtividade } from './ModalAtividade';
import { ModalObrigacao } from '../../obrigacoes/components/ModalObrigacao';
import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { agruparAtividades, CORES_PRIORIDADE, dataBR, dataExtenso, dataLocal, diasDoPeriodo, faixasDoPeriodo, itensDasObrigacoes, minutos, posicionarHorarios, RECORRENCIAS } from '../lib/agendaWorkspace';

const conferir = out => { if (out?.ok === false) throw new Error(out.message || 'Não foi possível atualizar a agenda.'); return out; };
const obrigacao = i => i.tipo === 'obrigacao';
const faixa = i => !i.horaInicio || i.dataInicio !== i.dataFim;
const ICONE = <svg aria-hidden="true" width="13" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="2" stroke="currentColor"/><path d="M6 6h4M6 9h4" stroke="currentColor"/></svg>;
function Atividade({ item, abrir, style }) {
  return <button type="button" className={`agenda-event${item.resolvido ? ' is-complete' : ''}`} style={{ '--event-color': CORES_PRIORIDADE[item.prioridade || ''], ...style }} onClick={e => { e.stopPropagation(); abrir(item); }} title={`${item.titulo} · ${dataBR(item.dataInicio)}${item.dataFim !== item.dataInicio ? ` a ${dataBR(item.dataFim)}` : ''}`}>
    {obrigacao(item) && ICONE}<span>{item.titulo}</span>{item.itens?.length > 1 && <small>{item.itens.length}</small>}
  </button>;
}
function Faixas({ itens, dias, abrir, criar, mes = false }) {
  const [expandido, setExpandido] = useState(false);
  const segmentos = faixasDoPeriodo(itens, dias);
  const limite = mes ? 3 : 4;
  const quantidade = Math.max(0,...segmentos.map(s => s.linha + 1));
  const linhas = expandido ? quantidade : Math.min(limite, quantidade);
  return <div className={`agenda-bands${mes ? ' is-month' : ''}`}>
    <div className="agenda-band-grid" style={{ '--days': dias.length, gridTemplateRows: `repeat(${Math.max(1,linhas)}, 29px)` }}>
      {dias.map((d, i) => <button type="button" key={d} className={`agenda-band-empty${d === dataLocal() ? ' is-today' : ''}`} style={{ gridColumn: i + 1, gridRow: `1 / ${Math.max(1,linhas)+1}` }} aria-label={`Criar atividade em ${dataBR(d)}`} onClick={() => criar(d)} />)}
      {segmentos.filter(s => s.linha < linhas).map(s => <Atividade key={s.item.id} item={s.item} abrir={abrir} style={{ gridColumn: `${s.inicio+1} / ${s.fim+2}`, gridRow: s.linha+1 }} />)}
    </div>
    {quantidade > limite && <button type="button" className="agenda-more" onClick={() => setExpandido(v => !v)}>{expandido ? 'Recolher' : `Mais ${segmentos.filter(s => s.linha >= limite).length} atividades`}</button>}
  </div>;
}

export function CalendarioAgenda({ api, empresas = [], onOpenCompany, companyIdFixo = null, initialContext, onContextChange }) {
  const [referencia, setReferencia] = useState(initialContext?.referencia || dataLocal());
  const [visao, setVisao] = useState(['mes','semana','dia','lista'].includes(initialContext?.visao) ? initialContext.visao : initialContext?.visao === 'agenda' ? 'lista' : 'semana');
  const [visaoCalendario, setVisaoCalendario] = useState('semana');
  const [dados, setDados] = useState({ obrigacoes: [], regras: [], tarefas: [], itens: [], ocultos: [], fiscais: [], opcoes: {} });
  const [carregando, setCarregando] = useState(true), [erro, setErro] = useState(''), [revisao, setRevisao] = useState(0);
  const [criacao, setCriacao] = useState(null), [detalhe, setDetalhe] = useState(null), [confirmacao, setConfirmacao] = useState(null), [edicaoLegada, setEdicaoLegada] = useState(null);
  const [ocupado, setOcupado] = useState(false), [filtroLista, setFiltroLista] = useState('TODAS'), [busca, setBusca] = useState('');
  const horasRef = useRef(null);
  const contextoAplicado = useRef(false);
  const [scrollbar, setScrollbar] = useState(0);
  const dias = useMemo(() => diasDoPeriodo(referencia, visao), [referencia, visao]);
  const inicio = dias[0], fim = dias.at(-1);
  const recarregar = () => setRevisao(v => v + 1);
  useEffect(() => { onContextChange?.({ referencia, visao }); }, [referencia, visao, onContextChange]);
  useEffect(() => {
    let ativo = true; setCarregando(true); setErro('');
    const meses = [...new Set(dias.map(d => d.slice(0,7)))];
    Promise.resolve().then(() => Promise.all([api.listObrigacoes({ companyId: companyIdFixo }), api.getTarefasAgenda(inicio, fim), api.listRegrasObrigacao(), ...meses.map(m => api.getCalendario(m, companyIdFixo))]))
      .then(resultados => {
        resultados.forEach(conferir);
        if (!ativo) return;
        const [obs, tasks, rules, ...calendarios] = resultados;
        const fiscais = [...new Map(calendarios.flatMap(c => (c.dias || []).flatMap(d => d.itens.filter(i => ['guia','marco'].includes(i.tipo)).map(i => ({ ...i, dataInicio: i.dataInicio || d.data, dataFim: i.dataFim || d.data, data: d.data })))).map(i => [`${i.tipo}|${i.id}`,i])).values()];
        setDados({ obrigacoes: obs.obrigacoes || [], regras: (rules.regras || []).filter(r => r.ativa !== false), tarefas: tasks.tarefas || [], itens: companyIdFixo ? [] : tasks.itens || [], ocultos: tasks.ocultos || [], fiscais, opcoes: obs.opcoes });
      }).catch(e => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [api, inicio, fim, companyIdFixo, revisao]);
  useEffect(() => { if (horasRef.current) horasRef.current.scrollTop = 7 * 56; }, [visao]);
  useEffect(() => {
    const el=horasRef.current;if(!el)return;
    const medir=()=>setScrollbar(el.offsetWidth-el.clientWidth);medir();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(medir);observer.observe(el);return()=>observer.disconnect();
  },[visao]);
  const atividades = useMemo(() => agruparAtividades([
    ...itensDasObrigacoes(dados.obrigacoes), ...dados.itens,
    ...dados.fiscais.filter(i => !dados.ocultos.includes(`${i.tipo}|${i.id}`)),
  ].filter(i => i.dataFim >= inicio && i.dataInicio <= fim)), [dados, inicio, fim]);
  useEffect(() => {
    const contexto=initialContext?.obrigacoesModal;
    if(!contexto || contextoAplicado.current || carregando)return;
    contextoAplicado.current=true;
    if(contexto.criar) {
      const data=contexto.dataInicio || dataLocal();
      setCriacao({dataInicio:data,dataFim:contexto.dataFim || data,companyId:contexto.companyId || null});
    } else if(contexto.ocorrenciaId) {
      const item=itensDasObrigacoes(dados.obrigacoes).find(i=>i.ocorrenciaId===contexto.ocorrenciaId);
      if(item){setReferencia(item.dataInicio);setDetalhe({...item,itens:[item]});}
    }
  },[carregando,dados.obrigacoes,initialContext]);
  const series = useMemo(() => {
    const mapa = new Map();
    for (const o of dados.obrigacoes) {
      const key = companyIdFixo ? o.obrigacaoId : o.regraId || o.obrigacaoId;
      if (!mapa.has(key)) mapa.set(key, { id: key, titulo: o.nome, tipo: o.tipo === 'TAREFA' ? 'tarefa' : 'obrigacao', prioridade: o.agendaConfig?.prioridade || '', recorrencia: o.periodicidade, obrigacaoId: companyIdFixo || !o.regraId ? o.obrigacaoId : null, regraId: companyIdFixo ? null : o.regraId, empresas: [], original: o });
      mapa.get(key).empresas.push(o);
    }
    if (!companyIdFixo) for (const r of dados.regras) {
      const key = r.regraId || r.id;
      if (!mapa.has(key)) mapa.set(key, { id: key, titulo: r.nome, tipo: 'obrigacao', regraId: key, recorrencia: r.periodicidade, prioridade: r.agendaConfig?.prioridade || '', empresas: [] });
    }
    return [...mapa.values(), ...(!companyIdFixo ? dados.tarefas.map(t => ({ id: t.id, tarefaId: t.id, titulo: t.titulo, tipo: 'tarefa', recorrencia: t.config.recorrencia, prioridade: t.config.prioridade, original: t, empresas: [] })) : [])]
      .filter(s => (filtroLista === 'TODAS' || s.tipo === filtroLista) && s.titulo.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')))
      .sort((a,b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  }, [dados, filtroLista, busca, companyIdFixo]);
  const criar = useCallback((data, hora) => { setErro(''); setCriacao({ dataInicio: data, dataFim: data, ...(hora != null ? { horaInicio: `${String(hora).padStart(2,'0')}:00`, horaFim: `${String(Math.min(23,hora+1)).padStart(2,'0')}:${hora === 23 ? '59' : '00'}` } : {}), companyId: companyIdFixo }); }, [companyIdFixo]);
  function navegar(passo) {
    if (visao === 'mes' || visao === 'lista') { const d = new Date(`${referencia.slice(0,7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth()+passo); setReferencia(d.toISOString().slice(0,10)); }
    else setReferencia(somarDiasAgenda(referencia, passo * (visao === 'dia' ? 1 : 7)));
  }
  async function agir(fn, fechar = true) {
    setOcupado(true); setErro('');
    try { conferir(await fn()); if (fechar) { setDetalhe(null); setConfirmacao(null); setEdicaoLegada(null); } recarregar(); }
    catch(e) { setErro(e.message); } finally { setOcupado(false); }
  }
  async function excluir(alvo, serie) {
    if (serie) {
      if (alvo.tarefaId) return api.acaoTarefaAgenda(alvo.tarefaId, { acao: 'EXCLUIR_SERIE' });
      return api.excluirSerieAgenda(alvo.regraId ? { regraId: alvo.regraId } : { obrigacaoId: alvo.obrigacaoId });
    }
    const itens = alvo.itens || [alvo];
    if (itens[0].fonte === 'OBRIGACAO') return api.excluirOcorrenciasAgenda(itens.map(i => i.ocorrenciaId));
    for (const i of itens) {
      conferir(await (i.tarefaId ? api.acaoTarefaAgenda(i.tarefaId, { acao: 'EXCLUIR', cicloChave: i.cicloChave }) : api.ocultarItemAgenda({ tipo: i.tipo, id: i.id, mes: i.dataInicio.slice(0,7) })));
    }
    return { ok: true };
  }
  function abrirSerie(s) {
    const itens = s.empresas.flatMap(o => itensDasObrigacoes([o]));
    const ordenados = itens.sort((a,b) => a.dataInicio.localeCompare(b.dataInicio));
    const proxima = ordenados.find(i => i.dataFim >= dataLocal() && !i.resolvido) || ordenados.at(-1);
    if (s.tarefaId) {
      const t = s.original, c = t.config;
      setDetalhe({ ...c, titulo: t.titulo, descricao: t.descricao, tipo: 'tarefa', somenteSerie: true });
    } else if (proxima) setDetalhe(agruparAtividades(itens.filter(i => i.cicloChave === proxima.cicloChave))[0]);
    else setDetalhe({ titulo: s.titulo, tipo: 'obrigacao', somenteSerie: true, empresasVazias: true });
  }
  const periodo = visao === 'dia' ? dataExtenso(referencia) : visao === 'semana' ? `${Number(inicio.slice(8))}–${Number(fim.slice(8))} ${new Date(`${fim}T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}` : new Date(`${referencia}T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const cabecalhos = ds => <div className="agenda-day-headings" style={{ '--days': ds.length }}>{ds.map(d => <button key={d} className={d === dataLocal() ? 'is-today' : ''} aria-current={d === dataLocal() ? 'date' : undefined} onClick={() => { setReferencia(d); setVisao('dia'); }}><span>{new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR',{weekday:'short',timeZone:'UTC'}).replace('.','')}</span><strong>{Number(d.slice(8))}</strong></button>)}</div>;
  return <section className="agenda-workspace" aria-label="Calendário de atividades" style={{'--agenda-scrollbar':`${scrollbar}px`}}>
    <header className="agenda-toolbar"><div className="agenda-period-nav">{visao !== 'lista' && <><Button variant="secondary" size="sm" aria-label="Período anterior" onClick={() => navegar(-1)}>‹</Button><Button variant="secondary" size="sm" aria-label="Próximo período" onClick={() => navegar(1)}>›</Button></>}<h2>{visao === 'lista' ? 'Atividades' : periodo}</h2>{visao !== 'lista' && <Button variant="secondary" size="sm" onClick={() => setReferencia(dataLocal())}>Hoje</Button>}</div>
      <div className="agenda-view-nav">{visao !== 'lista' && <select aria-label="Visualização do calendário" value={visao} onChange={e => setVisao(e.target.value)}><option value="semana">Semana</option><option value="dia">Dia</option><option value="mes">Mês</option></select>}<Button variant="secondary" size="sm" aria-pressed={visao === 'lista'} onClick={() => { if (visao === 'lista') setVisao(visaoCalendario); else { setVisaoCalendario(visao); setVisao('lista'); } }}>{visao === 'lista' ? 'Calendário' : 'Lista'}</Button></div></header>
    {erro && !detalhe && !confirmacao && !edicaoLegada && <div className="agenda-error" role="alert">{erro} <button onClick={recarregar}>Tentar novamente</button></div>}
    {carregando && <div className="agenda-loading" role="status">Atualizando agenda…</div>}
    {visao === 'lista' ? <div className="agenda-list"><div className="agenda-list-filters"><input aria-label="Buscar atividades" placeholder="Buscar atividade" value={busca} onChange={e => setBusca(e.target.value)}/><select aria-label="Filtrar atividades" value={filtroLista} onChange={e => setFiltroLista(e.target.value)}><option value="TODAS">Todas</option><option value="tarefa">Tarefas</option><option value="obrigacao">Obrigações</option></select></div>
      {series.map(s => <div className="agenda-list-row" key={s.id}><button className="agenda-list-name" onClick={() => abrirSerie(s)} style={{ '--event-color': CORES_PRIORIDADE[s.prioridade] }}>{obrigacao(s) && ICONE}<span><strong>{s.titulo}</strong><small>{RECORRENCIAS[s.recorrencia]}{s.empresas.length ? ` · ${s.empresas.length} ${s.empresas.length === 1 ? 'empresa' : 'empresas'}` : ''}</small></span></button><div className="agenda-list-actions">{s.original?.obrigacaoId && !s.original.agendaConfig && <Button variant="secondary" size="sm" onClick={() => setEdicaoLegada(s.original)}>Editar</Button>}<Button variant="secondary" size="sm" onClick={() => setConfirmacao({ alvo: s, serie: true })}>Excluir série</Button></div></div>)}
      {!series.length && !carregando && <p className="agenda-empty">Nenhuma atividade encontrada.</p>}
    </div> : visao === 'mes' ? <div className="agenda-month"><div className="agenda-weekdays">{['seg.','ter.','qua.','qui.','sex.','sáb.','dom.'].map(d => <span key={d}>{d}</span>)}</div>{Array.from({length:6},(_,n) => { const semana = dias.slice(n*7,n*7+7); return <div className="agenda-month-week" key={semana[0]}><div className="agenda-month-dates">{semana.map(d => <button key={d} className={`${d === dataLocal() ? 'is-today' : ''} ${d.slice(0,7) !== referencia.slice(0,7) ? 'is-outside' : ''}`} aria-label={`Criar atividade em ${dataBR(d)}`} onClick={() => criar(d)}>{Number(d.slice(8))}</button>)}</div><Faixas itens={atividades} dias={semana} abrir={setDetalhe} criar={criar} mes /></div>; })}</div>
    : <div className="agenda-time-view"><div className="agenda-time-header">{cabecalhos(dias)}<span className="agenda-time-gutter" /></div><div className="agenda-all-day"><Faixas key={`${inicio}:${visao}`} itens={atividades.filter(faixa)} dias={dias} abrir={setDetalhe} criar={criar}/><span className="agenda-time-gutter" /></div><div className="agenda-time-scroll" ref={horasRef}><div className="agenda-time-columns" style={{ '--days': dias.length }}>{dias.map(d => <div key={d} className={`agenda-time-day${d === dataLocal() ? ' is-today' : ''}`}>
      {Array.from({length:24},(_,hora) => <button key={hora} type="button" className="agenda-time-slot" aria-label={`Criar atividade em ${dataBR(d)} às ${String(hora).padStart(2,'0')}:00`} onClick={() => criar(d,hora)}/>)}
      {posicionarHorarios(atividades.filter(i => !faixa(i) && i.dataInicio === d)).map(({item,coluna,colunas}) => <Atividade key={item.id} item={item} abrir={setDetalhe} style={{ position:'absolute', top: minutos(item.horaInicio)/60*56, height: Math.max(22,(minutos(item.horaFim)-minutos(item.horaInicio))/60*56-2), width:`calc(${100/colunas}% - 5px)`, left:`calc(${coluna*100/colunas}% + 2px)` }}/>)}</div>)}<div className="agenda-hours" aria-hidden="true">{Array.from({length:24},(_,h) => <span key={h}>{String(h).padStart(2,'0')}:00</span>)}</div></div></div></div>}
    {criacao && <ModalAtividade inicial={criacao} empresas={empresas} api={api} onFechar={() => setCriacao(null)} onSalvo={({dataInicio}) => { setCriacao(null); setReferencia(dataInicio); recarregar(); }}/ >}
    {detalhe && !confirmacao && <Modal titulo={detalhe.titulo} aoFechar={() => { setDetalhe(null); setErro(''); }} ocupado={ocupado} lateral>
      <div className="agenda-detail"><p className="agenda-detail-period">{dataBR(detalhe.dataInicio)}{detalhe.dataFim !== detalhe.dataInicio ? ` – ${dataBR(detalhe.dataFim)}` : ''}{detalhe.horaInicio ? ` · ${detalhe.horaInicio}–${detalhe.horaFim}` : ''}</p>{detalhe.descricao && <p className="agenda-description">{detalhe.descricao}</p>}
      {detalhe.itens?.length > 1 && <div className="agenda-progress"><span>{detalhe.itens.filter(i => i.resolvido).length} de {detalhe.itens.length} concluídas</span><progress max={detalhe.itens.length} value={detalhe.itens.filter(i => i.resolvido).length}/></div>}
      {(detalhe.itens || []).map(i => <div className="agenda-company-row" key={i.id}><div><strong>{i.empresa || i.titulo}</strong>{i.dataVencimento && obrigacao(i) && <small>Vencimento fiscal · {dataBR(i.dataVencimento)}</small>}<small>{i.resolvido ? 'Concluída' : 'Pendente'}</small></div><div className="agenda-company-actions">{i.fonte === 'OBRIGACAO' && !i.conclusaoAutomatica && <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => agir(async () => { const out = conferir(await (i.resolvido ? api.reabrirOcorrencia(i.ocorrenciaId) : api.concluirOcorrencia(i.ocorrenciaId))); setDetalhe(d => ({ ...d, itens: d.itens.map(x => x.id === i.id ? { ...x, resolvido: !x.resolvido } : x) })); return out; },false)}>{i.resolvido ? 'Reabrir' : 'Concluir'}</Button>}{i.tarefaId && <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => agir(() => api.acaoTarefaAgenda(i.tarefaId, { cicloChave: i.cicloChave, acao: i.resolvido ? 'REABRIR' : 'CONCLUIR' }))}>{i.resolvido ? 'Reabrir' : 'Concluir'}</Button>}{i.companyId && onOpenCompany && <Button size="sm" variant="secondary" onClick={() => onOpenCompany(i.companyId)}>Abrir empresa</Button>}{detalhe.itens.length > 1 && <button className="agenda-text-action" disabled={ocupado} onClick={() => setConfirmacao({ alvo:i })}>Excluir ocorrência</button>}</div></div>)}
      {detalhe.empresasVazias && <p>Nenhuma ocorrência ativa para esta obrigação.</p>}
      {erro && <p className="agenda-error" role="alert">{erro}</p>}
      {!detalhe.somenteSerie && <div className="agenda-form-actions">{(detalhe.itens?.[0]?.tarefaId || detalhe.fonte === 'OBRIGACAO') && <Button variant="secondary" disabled={ocupado} onClick={() => { setCriacao(detalhe.fonte === 'OBRIGACAO' ? { ...detalhe, ocorrenciaIds:detalhe.itens.map(i=>i.ocorrenciaId) } : detalhe.itens[0]); setDetalhe(null); }}>Editar</Button>}<Button variant="danger" disabled={ocupado} onClick={() => setConfirmacao({ alvo: detalhe })}>Excluir ocorrência</Button></div>}</div>
    </Modal>}
    {confirmacao && <Modal titulo={confirmacao.serie ? 'Excluir série completa?' : 'Excluir esta ocorrência?'} aoFechar={() => { setConfirmacao(null); setErro(''); }} ocupado={ocupado} tamanho="sm" rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setConfirmacao(null)}>Cancelar</Button><Button variant="danger" disabled={ocupado} onClick={() => agir(() => excluir(confirmacao.alvo,confirmacao.serie))}>{ocupado ? 'Excluindo…' : 'Excluir'}</Button></>}><p>{confirmacao.alvo.titulo}</p><p>{confirmacao.serie ? 'Todas as ocorrências desta série serão removidas do calendário.' : `${confirmacao.alvo.itens?.length > 1 ? `${confirmacao.alvo.itens.length} empresas neste período. ` : ''}As próximas ocorrências serão mantidas.`}</p>{erro && <p className="agenda-error" role="alert">{erro}</p>}</Modal>}
    {edicaoLegada && <ModalObrigacao inicial={edicaoLegada} empresas={empresas} opcoes={dados.opcoes} onFechar={() => setEdicaoLegada(null)} salvando={ocupado} erro={erro} onSalvar={d => agir(() => api.updateObrigacao(edicaoLegada.obrigacaoId,d))}/ >}
  </section>;
}
