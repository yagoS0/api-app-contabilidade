import { MODELOS_OBRIGACOES_CARTEIRA, chaveDaObrigacaoCarteira } from '@contabilidade/shared/fluxo-carteira';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { BotaoCopiar } from '../../../components/ui/BotaoCopiar';
import { formatarCnpj, soDigitosCnpj } from '../../onboarding/lib/brasilApi';
import { ModalAtividade } from './ModalAtividade';
import { OcorrenciasExcluidas } from './OcorrenciasExcluidas';
import { AtividadeAgenda as Atividade } from './AtividadeAgenda';
import { LinhaHorarioAtual, useRelogioAgenda } from './LinhaHorarioAtual';
import { useGestosAgenda } from './useGestosAgenda';
import { ALTURA_HORA, HORAS_VISIVEIS, HORA_INICIAL } from '../lib/escalaAgenda';
import { criarLeiturasAgenda } from '../lib/leiturasAgenda';
import { lerMarcosAgenda } from '../lib/lerMarcosAgenda';
import { useEdicoesAgenda } from './useEdicoesAgenda';
import { ModalObrigacao } from '../../obrigacoes/components/ModalObrigacao';
import { somarDiasAgenda, ocorrenciasDaTarefa } from '../../../../../../packages/shared/src/agenda.js';
import { agruparAtividades, blocosDiarios, corAtividade, dataBR, dataExtenso, dataLocal, diasDoPeriodo, faixasDoPeriodo, itensDasObrigacoes, fimVisual, horarioAtividade, minutos, posicionarHorarios, RECORRENCIAS } from '../lib/agendaWorkspace';

const conferir = out => { if (out?.ok === false) throw new Error(out.message || 'Não foi possível atualizar a agenda.'); return out; };
const chaveEtapa = i => chaveDaObrigacaoCarteira(i.verificador) || (i.tipo === 'fluxo' || i.fonte === 'CARTEIRA' ? i.chave : null);
const podeConcluirNaLista = i => Boolean(chaveEtapa(i) || i.tarefaId || (i.fonte === 'OBRIGACAO' && i.ocorrenciaId));
const automaticaNaLista = i => chaveEtapa(i) ? ['obter_guias','enviar_guias','contabilizar'].includes(chaveEtapa(i)) : Boolean(i.conclusaoAutomatica);
const obrigacao = i => i.tipo === 'obrigacao';
const faixa = i => !i.horaInicio || i.dataInicio !== i.dataFim;
const ICONE = <svg aria-hidden="true" width="13" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="2" stroke="currentColor"/><path d="M6 6h4M6 9h4" stroke="currentColor"/></svg>;
function Faixas({ itens, dias, abrir, criar, mes = false, gestos, onConcluir }) {
  const [expandido, setExpandido] = useState(false);
  const segmentos = faixasDoPeriodo(itens, dias);
  const limite = mes ? 3 : 4;
  const quantidade = Math.max(0,...segmentos.map(s => s.linha + 1));
  const linhas = mes || expandido ? quantidade : Math.min(limite, quantidade);
  return <div className={`agenda-bands${mes ? ' is-month' : ''}`}>
    <div className="agenda-band-grid" style={{ '--days': dias.length, gridTemplateRows: `repeat(${Math.max(1,linhas)}, 29px)` }}>
      {dias.map((d, i) => <button type="button" key={d} className={`agenda-band-empty${d === dataLocal() ? ' is-today' : ''}`} style={{ gridColumn: i + 1, gridRow: `1 / ${Math.max(1,linhas)+1}` }} aria-label={`Criar atividade em ${dataBR(d)}`} onClick={() => criar(d)} />)}
      {segmentos.filter(s => s.linha < linhas).map(s => <Atividade gestos={gestos} onConcluir={onConcluir} key={s.item.id} item={s.item} abrir={abrir} style={{ gridColumn: `${s.inicio+1} / ${s.fim+2}`, gridRow: s.linha+1 }} />)}
    </div>
    {!mes && quantidade > limite && <button type="button" className="agenda-more" onClick={() => setExpandido(v => !v)}>{expandido ? 'Recolher' : `Mais ${segmentos.filter(s => s.linha >= limite).length} atividades`}</button>}
  </div>;
}

export function CalendarioAgenda({ api, empresas = [], onOpenCompany, companyIdFixo = null, initialContext, onContextChange }) {
  const [itensCarteira,setItensCarteira]=useState([]), [erroCarteira,setErroCarteira]=useState('');
  const [conclusoesLocais, setConclusoesLocais] = useState({});
  const conclusaoEmpresaRef = useRef(new Set());
  const versaoConclusaoRef = useRef(0);
  const [empresasSalvando, setEmpresasSalvando] = useState(new Set());
  const agora = useRelogioAgenda();
  const [referencia, setReferencia] = useState(initialContext?.referencia || dataLocal());
  const [visao, setVisao] = useState(['mes','semana','dia','lista'].includes(initialContext?.visao) ? initialContext.visao : initialContext?.visao === 'agenda' ? 'lista' : 'semana');
  const [visaoCalendario, setVisaoCalendario] = useState('semana');
  const [dadosConfirmados, setDados] = useState({ obrigacoes: [], regras: [], tarefas: [], itens: [], ocultos: [], fiscais: [], opcoes: {} });
  const [carregando, setCarregando] = useState(true), [erro, setErro] = useState(''), [revisao, setRevisao] = useState(0);
  const [criacao, setCriacao] = useState(null), [detalhe, setDetalhe] = useState(null), [confirmacao, setConfirmacao] = useState(null), [edicaoLegada, setEdicaoLegada] = useState(null);
  const [ocupado, setOcupado] = useState(false), [filtroLista, setFiltroLista] = useState('TODAS'), [busca, setBusca] = useState('');
  const horasRef = useRef(null), mesRef = useRef(null);
  const leituras = useMemo(() => criarLeiturasAgenda(), [api, companyIdFixo]);
  useEffect(() => {
    const scroll = horasRef.current;
    if (!scroll?.closest('.dashboard-home-page--agenda')) return;
    const ajustar = () => { scroll.style.height = Math.max(240, window.innerHeight - scroll.getBoundingClientRect().top - 16) + 'px'; };
    ajustar();
    window.addEventListener('resize', ajustar);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(ajustar) : null;
    for (const element of scroll.closest('.agenda-workspace').querySelectorAll('.agenda-toolbar, .agenda-time-header, .agenda-all-day')) observer?.observe(element);
    return () => { window.removeEventListener('resize', ajustar); observer?.disconnect(); };
  }, [visao, carregando]);
  const leiturasRef = useRef(0);
  const edicoes = useEdicoesAgenda({ api, onErro: setErro });
  const dados = useMemo(() => edicoes.aplicar(dadosConfirmados, !companyIdFixo), [dadosConfirmados, edicoes.aplicar, companyIdFixo]);
  const contextoAplicado = useRef(false);
  const [scrollbar, setScrollbar] = useState(0);
  const dias = useMemo(() => diasDoPeriodo(referencia, visao), [referencia, visao]);
  const inicio = dias[0], fim = dias.at(-1);
  const recarregar = () => { leituras.limpar(); setRevisao(v => v + 1); };
  const salvarGesto = useCallback((item, patch) => {
    leituras.limpar();
    return edicoes.salvar(item, patch).finally(() => leituras.limpar());
  }, [edicoes.salvar, leituras]);
  const editarOcorrencia = (item, patch) => {
    leituras.limpar();
    void edicoes.editar(item, patch).finally(() => leituras.limpar());
    setCriacao(null);
  };
  useEffect(()=>{
    if(!api.getAgendaCarteira)return;
    let ativo=true;setErroCarteira('');setItensCarteira([]);
    api.getAgendaCarteira(inicio,fim,companyIdFixo).then(r=>{conferir(r);if(ativo)setItensCarteira(r.itens || []);}).catch(e=>{if(ativo)setErroCarteira(e.message);});
    return()=>{ativo=false;};
  },[api,inicio,fim,companyIdFixo,revisao]);
  useEffect(() => { onContextChange?.({ referencia, visao }); }, [referencia, visao, onContextChange]);
  useEffect(() => {
    let ativo = true; setCarregando(true); setErro('');
    const consulta = ++leiturasRef.current;
    const leitura = edicoes.capturarLeitura();
    const versaoConclusao = versaoConclusaoRef.current;
    const pendentesConclusao = new Set(conclusaoEmpresaRef.current);
    Promise.resolve().then(() => Promise.all([leituras.ler(`obrigacoes:${inicio}:${fim}`, () => api.listObrigacoes({ companyId: companyIdFixo, inicio, fim })), leituras.ler(`tarefas:${inicio}:${fim}`, () => api.getTarefasAgenda(inicio, fim))]))
      .then(resultados => {
        resultados.forEach(conferir);
        if (!ativo || consulta !== leiturasRef.current) return;
        const [obs, tasks] = resultados;
        setDados(d => ({ ...d, obrigacoes: obs.obrigacoes || [], tarefas: tasks.tarefas || [], itens: companyIdFixo ? [] : tasks.itens || [], ocultos: tasks.ocultos || [], opcoes: obs.opcoes }));
        setConclusoesLocais(xs => Object.fromEntries(Object.entries(xs).filter(([id, x]) => x.versao > versaoConclusao || pendentesConclusao.has(id) || conclusaoEmpresaRef.current.has(id))));
        edicoes.confirmarLeitura(leitura);
      }).catch(e => { if (ativo) setErro(e.message); }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [api, inicio, fim, companyIdFixo, revisao]);
  useEffect(() => {
    let ativo = true;
    leituras.ler('regras', () => api.listRegrasObrigacao())
      .then(out => { if (ativo) setDados(d => ({...d, regras:out.regras || []})); })
      .catch(e => { if (ativo) setErro(e.message); });
    lerMarcosAgenda(api, leituras, dias, companyIdFixo)
      .then(fiscais => { if (ativo) setDados(d => ({...d, fiscais})); })
      .catch(e => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [api, leituras, inicio, fim, companyIdFixo, revisao]);
  useEffect(() => {
    if (carregando || ocupado || edicoes.quantidade || !edicoes.temAlteracoes) return;
    let ativo = true;
    // Consolida uma sequência de gestos sem recarregar regras, marcos ou bloquear a grade.
    const timer = setTimeout(async () => {
      const consulta = ++leiturasRef.current, leitura = edicoes.capturarLeitura();
      try {
        const [obs,tasks] = await Promise.all([api.listObrigacoes({companyId:companyIdFixo,inicio,fim}),api.getTarefasAgenda(inicio,fim)]);
        conferir(obs); conferir(tasks);
        if (!ativo || consulta !== leiturasRef.current || !edicoes.confirmarLeitura(leitura)) return;
        setDados(d => ({...d,obrigacoes:obs.obrigacoes || [],tarefas:tasks.tarefas || [],itens:companyIdFixo ? [] : tasks.itens || [],ocultos:tasks.ocultos || []}));
      } catch(e) { if (ativo && consulta === leiturasRef.current) setErro(e.message); }
    },400);
    return () => { ativo = false; clearTimeout(timer); };
  }, [api,inicio,fim,companyIdFixo,carregando,ocupado,revisao,edicoes.quantidade,edicoes.temAlteracoes,edicoes.aplicar]);
  useEffect(() => { if (horasRef.current) horasRef.current.scrollTop = HORA_INICIAL * ALTURA_HORA; }, [visao]);
  useEffect(() => {
    const el=horasRef.current;if(!el)return;
    const medir=()=>setScrollbar(el.offsetWidth-el.clientWidth);medir();
    if(typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(medir);observer.observe(el);return()=>observer.disconnect();
  },[visao]);
  const atividades = useMemo(() => agruparAtividades([
    ...itensDasObrigacoes(dados.obrigacoes), ...dados.itens, ...itensCarteira.filter(i => !dados.obrigacoes.some(o => o.companyId === i.companyId && chaveDaObrigacaoCarteira(o.verificador) === i.chave && o.ocorrencias.some(oc => oc.competenciaRef === i.competencia))),
    ...dados.fiscais.filter(i => !dados.ocultos.includes(`${i.tipo}|${i.id}`)),
  ].filter(i => i.dataFim >= inicio && i.dataInicio <= fim).map(i => conclusoesLocais[i.id] ? { ...i, ...conclusoesLocais[i.id].patch } : i)).map(i => ({...i, salvando:edicoes.pendente(i)})), [dados, itensCarteira, inicio, fim, edicoes.pendente, conclusoesLocais]);
  const blocos = useMemo(() => blocosDiarios(atividades, inicio, fim), [atividades, inicio, fim]);
  const horarios = useMemo(() => Object.fromEntries(dias.map(d => [d,posicionarHorarios(blocos.filter(i => !faixa(i) && i.dataInicio === d))])), [blocos,dias]);
  useEffect(() => {
    const contexto=initialContext?.obrigacoesModal;
    if(!contexto || contextoAplicado.current || carregando)return;
    contextoAplicado.current=true;
    if(contexto.criar) {
      const data=contexto.dataInicio || dataLocal();
      setCriacao({dataInicio:data,dataFim:contexto.dataFim || data,companyId:contexto.companyId || null});
    } else if(contexto.ocorrenciaId) {
      const item=itensDasObrigacoes(dados.obrigacoes).find(i=>i.ocorrenciaId===contexto.ocorrenciaId);
      if(item){setReferencia(item.dataInicio);abrirAtividade({...item,itens:[item]});}
    }
  },[carregando,dados.obrigacoes,initialContext]);
  const series = useMemo(() => {
    if (filtroLista === 'EXCLUIDAS') return [];
    if (filtroLista === 'PAUSADAS') return dados.regras.filter(r => r.ativa === false && r.nome.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR'))).map(r => ({id:r.regraId || r.id,regraId:r.regraId || r.id,titulo:r.nome,tipo:'obrigacao',recorrencia:r.periodicidade,empresas:[],pausada:true}));
    const mapa = new Map();
    for (const o of dados.obrigacoes) {
      const key = companyIdFixo ? o.obrigacaoId : o.regraId || o.agendaConfig?.grupoTarefaId || o.obrigacaoId;
      if (!mapa.has(key)) mapa.set(key, { id: key, grupoTarefaId: companyIdFixo ? null : o.agendaConfig?.grupoTarefaId, titulo: o.nome, tipo: o.tipo === 'TAREFA' ? 'tarefa' : 'obrigacao', prioridade: o.agendaConfig?.prioridade || '', recorrencia: o.periodicidade, obrigacaoId: companyIdFixo || !o.regraId ? o.obrigacaoId : null, regraId: companyIdFixo ? null : o.regraId, empresas: [], original: o });
      mapa.get(key).empresas.push(o);
    }
    if (!companyIdFixo) for (const r of dados.regras.filter(r => r.ativa !== false)) {
      const key = r.regraId || r.id;
      if (!mapa.has(key)) mapa.set(key, { id: key, titulo: r.nome, tipo: 'obrigacao', regraId: key, recorrencia: r.periodicidade, prioridade: r.agendaConfig?.prioridade || '', empresas: [] });
    }
    const modelos = MODELOS_OBRIGACOES_CARTEIRA.filter(m => !dados.regras.some(r => (r.verificador === m.verificador || !r.verificador && r.nome === m.titulo) && (r.escopo === 'TODAS' || r.escopo === m.escopo && m.filtros?.regimes?.every(regime => r.filtros?.regimes?.includes(regime)))) && !(companyIdFixo && dados.obrigacoes.some(o => o.companyId === companyIdFixo && o.verificador === m.verificador)));
    return [...mapa.values(), ...modelos.map(m => ({...m,tipo:'obrigacao',modeloCarteira:m,recorrencia:'MENSAL',empresas:[]})), ...(!companyIdFixo ? dados.tarefas.map(t => {
      const versao = t.config.versoes?.at(-1), config = versao?.config || t.config;
      return { id:t.id, tarefaId:t.id, titulo:versao?.titulo || t.titulo, tipo:'tarefa', recorrencia:config.recorrencia, prioridade:config.prioridade, original:t, configAtual:config, empresas:[] };
    }) : [])]
      .filter(s => (filtroLista === 'TODAS' || s.tipo === filtroLista) && s.titulo.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')))
      .sort((a,b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  }, [dados, filtroLista, busca, companyIdFixo]);
  const criar = useCallback((data, hora) => { setErro(''); setCriacao({ dataInicio: data, dataFim: data, ...(hora != null ? { horaInicio: `${String(hora).padStart(2,'0')}:00`, horaFim: `${String(Math.min(23,hora+1)).padStart(2,'0')}:${hora === 23 ? '59' : '00'}` } : {}), companyId: companyIdFixo }); }, [companyIdFixo]);
  const criarPeriodo = useCallback(patch => { const cell = document.activeElement?.getBoundingClientRect?.(); setErro(''); setCriacao({...patch,companyId:companyIdFixo, ancora:cell?.width ? {x:cell.right + 12,y:cell.top} : null}); }, [companyIdFixo]);
  const atualizarRascunho = useCallback(patch => setCriacao(atual => atual ? {...atual,...patch} : atual), []);
  function abrirAtividade(item) {
    if(item.fonte==='CARTEIRA' || item.tipo==='fluxo'){const original=item.itens?.[0] || item;setErro('');setDetalhe({...item,somenteSerie:true,itens:[{...original,competenciaRef:original.competenciaRef || original.competencia}]});return;}
    if (edicoes.pendente(item)) return;
    item = item.atividadeOriginal ? { ...item.atividadeOriginal, diaSelecionado: item.diaSelecionado } : item;
    setErro('');
    if (item.tipo === 'tarefa' && (item.itens?.length || 1) === 1) {
      const tarefa = { ...(item.itens?.[0] || item), ...(item.diaSelecionado ? {diaSelecionado:item.diaSelecionado} : {}) };
      setCriacao(tarefa.fonte === 'OBRIGACAO' ? { ...tarefa, ocorrenciaIds: [tarefa.ocorrenciaId] } : tarefa);
    } else setDetalhe(item);
  }
  async function alterarConclusaoTarefa() {
    const resolvido = !criacao.resolvido;
    conferir(await (criacao.tarefaId
      ? api.acaoTarefaAgenda(criacao.tarefaId, { cicloChave: criacao.cicloChave, acao: resolvido ? 'CONCLUIR' : 'REABRIR' })
      : resolvido ? api.concluirOcorrencia(criacao.ocorrenciaId) : api.reabrirOcorrencia(criacao.ocorrenciaId)));
    setCriacao(atual => ({ ...atual, resolvido }));
    recarregar();
  }
  function navegar(passo) {
    if (visao === 'mes' || visao === 'lista') { const d = new Date(`${referencia.slice(0,7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth()+passo); setReferencia(d.toISOString().slice(0,10)); }
    else setReferencia(somarDiasAgenda(referencia, passo * (visao === 'dia' ? 1 : 7)));
  }
  async function agir(fn, fechar = true) {
    setOcupado(true); setErro('');
    try { conferir(await fn()); if (fechar) { setDetalhe(null); setConfirmacao(null); setEdicaoLegada(null); } recarregar(); }
    catch(e) { setErro(e.message); } finally { setOcupado(false); }
  }
  function atualizarEmpresa(item, patch) {
    const versao = ++versaoConclusaoRef.current;
    setConclusoesLocais(xs => ({ ...xs, [item.id]: { versao, patch: { ...xs[item.id]?.patch, ...patch } } }));
    setDetalhe(d => d ? { ...d, itens: d.itens.map(i => i.id === item.id ? { ...i, ...patch } : i) } : d);
  }
  async function concluirEtapaEmpresa(item) {
    if (conclusaoEmpresaRef.current.has(item.id) || ocupado || automaticaNaLista(item) || !podeConcluirNaLista(item)) return;
    conclusaoEmpresaRef.current.add(item.id);
    setEmpresasSalvando(xs => new Set([...xs, item.id]));
    atualizarEmpresa(item, { resolvido: !item.resolvido, erroConclusao: '' });
    leituras.limpar();
    let salvo = false;
    try {
      const chave = chaveEtapa(item);
      const desejado = !item.resolvido;
      if (chave) {
        const detalheEmpresa = conferir(await api.getFluxoCarteira(item.companyId, item.competenciaRef));
        const tarefa = detalheEmpresa.fluxo.tarefas.find(t => t.chave === chave);
        if (!tarefa) throw new Error('Esta tarefa não se aplica à empresa nesta competência.');
        if (Boolean(tarefa.concluida) === desejado) {
          atualizarEmpresa(item, { resolvido: desejado }); return;
        }
        if (tarefa.automatica || (!desejado && !tarefa.dados?.conclusao)) throw new Error('Esta etapa acompanha a operação registrada na empresa.');
        if (desejado && tarefa.aguardando?.length) throw new Error('Conclua as etapas anteriores antes de concluir esta tarefa.');
        const corpo = { acao: desejado ? 'concluir' : 'reabrir', competencia: item.competenciaRef, versao: tarefa.versao || 0, hash: tarefa.hash };
        if (chave === 'importar' && desejado) {
          const pendentes = (detalheEmpresa.lancamentos || []).filter(e => !e.importado);
          if (!pendentes.length || pendentes.some(e => !e.importavel)) throw new Error('Feche o mês e exporte os lançamentos antes de confirmar a importação.');
          corpo.entryIds = pendentes.map(e => e.id);
        }
        conferir(await api.salvarFluxoTarefa(item.companyId, chave, corpo));
        salvo = true;
        atualizarEmpresa(item, { resolvido: desejado });
        const atualizado = conferir(await api.getFluxoCarteira(item.companyId, item.competenciaRef));
        atualizarEmpresa(item, { resolvido: Boolean(atualizado.fluxo.tarefas.find(t => t.chave === chave)?.concluida) });
      } else {
        conferir(await (item.tarefaId
          ? api.acaoTarefaAgenda(item.tarefaId, { cicloChave:item.cicloChave, acao:desejado ? 'CONCLUIR' : 'REABRIR' })
          : desejado ? api.concluirOcorrencia(item.ocorrenciaId) : api.reabrirOcorrencia(item.ocorrenciaId)));
        salvo = true; atualizarEmpresa(item, { resolvido: desejado });
      }
    } catch(e) {
      atualizarEmpresa(item, { ...(!salvo ? { resolvido: Boolean(item.resolvido) } : {}), erroConclusao: salvo ? 'Alteração salva. Não foi possível atualizar a conferência; reabra a tarefa para consultar o estado atual.' : e.message });
    } finally {
      leituras.limpar();
      conclusaoEmpresaRef.current.delete(item.id);
      setEmpresasSalvando(xs => { const proximo = new Set(xs); proximo.delete(item.id); return proximo; });
    }
  }
  async function concluirNaGrade(item) {
    if (ocupado || item.salvando || item.tipo !== 'tarefa' || item.itens?.length > 1 || item.conclusaoAutomatica) return;
    const tarefa = item.itens?.[0] || item;
    await agir(() => tarefa.tarefaId
      ? api.acaoTarefaAgenda(tarefa.tarefaId, { cicloChave:tarefa.cicloChave, acao:tarefa.resolvido ? 'REABRIR' : 'CONCLUIR' })
      : tarefa.resolvido ? api.reabrirOcorrencia(tarefa.ocorrenciaId) : api.concluirOcorrencia(tarefa.ocorrenciaId), false);
  }
  async function excluir(alvo, serie, alcance = "ESTA") {
    if (serie) {
      if (alvo.tarefaId) return api.acaoTarefaAgenda(alvo.tarefaId, { acao: 'EXCLUIR_SERIE' });
      return api.excluirSerieAgenda(alvo.grupoTarefaId ? { grupoTarefaId: alvo.grupoTarefaId } : alvo.regraId ? { regraId: alvo.regraId } : { obrigacaoId: alvo.obrigacaoId });
    }
    const itens = alvo.itens || [alvo];
    if (alvo.ocorrenciaIds || itens[0].fonte === 'OBRIGACAO') {
      const ids = alvo.ocorrenciaIds || itens.map(i => i.ocorrenciaId);
      return alvo.diaSelecionado ? api.excluirOcorrenciasAgenda(ids, alcance, alvo.diaSelecionado) : api.excluirOcorrenciasAgenda(ids, alcance);
    }
    for (const i of itens) {
      conferir(await (i.tarefaId ? api.acaoTarefaAgenda(i.tarefaId, { acao: 'EXCLUIR', cicloChave: i.cicloChave, alcance }) : api.ocultarItemAgenda({ tipo: i.tipo, id: i.id, mes: i.dataInicio.slice(0,7) })));
    }
    return { ok: true };
  }
  function configurarObrigacao(regraId) {
    if (edicoes.pendenteSerie({regraId})) return;
    const regra = dados.regras.find(r => (r.regraId || r.id) === regraId);
    if (!regra) return;
    const ocorrencia = itensDasObrigacoes(dados.obrigacoes).find(i => i.regraId === regraId);
    const config = regra.agendaConfig || { dataInicio: ocorrencia?.dataInicio || referencia, dataFim: ocorrencia?.dataFim || referencia };
    setCriacao({ ...config, titulo: regra.nome, descricao: regra.descricao, tipo: 'obrigacao', recorrencia: regra.periodicidade, regraEdicao: regra });
    setDetalhe(null);
  }
  function abrirSerie(s) {
    if(s.modeloCarteira){
      setCriacao({titulo:s.titulo,tipo:'obrigacao',recorrencia:'MENSAL',dataInicio:'',dataFim:'',companyId:companyIdFixo,modeloCarteira:{...s.modeloCarteira,...(companyIdFixo ? {escopo:'SELECAO_MANUAL'} : {})}});
      return;
    }
    const noPeriodo = dados.itens.filter(i => i.tarefaId === s.tarefaId);
    const itens = s.tarefaId
      ? noPeriodo.length ? noPeriodo : ocorrenciasDaTarefa(s.original, s.configAtual.dataInicio, s.configAtual.dataFim)
      : s.empresas.flatMap(o => itensDasObrigacoes([o]));
    const ordenados = itens.sort((a,b) => a.dataInicio.localeCompare(b.dataInicio));
    const proxima = ordenados.find(i => i.dataFim >= dataLocal() && !i.resolvido) || ordenados.at(-1);
    if (proxima) abrirAtividade(agruparAtividades(itens.filter(i => i.cicloChave === proxima.cicloChave))[0]);
    else setDetalhe({ titulo: s.titulo, tipo: s.tipo, somenteSerie: true, empresasVazias: true });
  }
  const obrigacaoEmEdicao = criacao && dados.obrigacoes.find(o => o.obrigacaoId === criacao.obrigacaoId);
  const inicialEdicao = criacao && {
    ...criacao,
    recorrencia: criacao.recorrencia || obrigacaoEmEdicao?.periodicidade || 'AVULSA',
    obrigacaoOriginal: obrigacaoEmEdicao,
    regraOriginal: dados.regras.find(r => (r.regraId || r.id) === criacao.regraId),
  };
  const gestos = useGestosAgenda({ dias, horasRef, salvar:salvarGesto, mesRef, mensal:visao === 'mes', criar:criarPeriodo, bloqueado:carregando || ocupado });
  const vencimentoComum = detalhe?.itens?.length && detalhe.itens.every(i => obrigacao(i) && i.dataVencimento === detalhe.itens[0].dataVencimento) ? detalhe.itens[0].dataVencimento : null;
  const periodo = visao === 'dia' ? dataExtenso(referencia) : visao === 'semana' ? `${Number(inicio.slice(8))}–${Number(fim.slice(8))} ${new Date(`${fim}T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}` : new Date(`${referencia}T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const cabecalhos = ds => <div className="agenda-day-headings" style={{ '--days': ds.length }}>{ds.map(d => <button key={d} className={d === dataLocal() ? 'is-today' : ''} aria-current={d === dataLocal() ? 'date' : undefined} onClick={() => { setReferencia(d); setVisao('dia'); }}><span>{new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR',{weekday:'short',timeZone:'UTC'}).replace('.','')}</span><strong>{Number(d.slice(8))}</strong></button>)}</div>;
  return <section onPointerDownCapture={gestos.resetarClique} onClickCapture={gestos.clicar} className="agenda-workspace" aria-label="Calendário de atividades" style={{'--agenda-hour-height': ALTURA_HORA + 'px', '--agenda-visible-hours': HORAS_VISIVEIS, '--agenda-scrollbar':`${scrollbar}px`}}>
    <header className="agenda-toolbar"><div className="agenda-period-nav">{visao !== 'lista' && <><Button variant="secondary" size="sm" aria-label="Período anterior" onClick={() => navegar(-1)}>‹</Button><Button variant="secondary" size="sm" aria-label="Próximo período" onClick={() => navegar(1)}>›</Button></>}<h2>{visao === 'lista' ? 'Atividades' : periodo}</h2>{visao !== 'lista' && <Button variant="secondary" size="sm" onClick={() => setReferencia(dataLocal())}>Hoje</Button>}</div>
      <div className="agenda-view-nav">{visao !== 'lista' && <select aria-label="Visualização do calendário" value={visao} onChange={e => { if (visao === 'mes' && e.target.value === 'semana') setReferencia(dataLocal()); setVisao(e.target.value); }}><option value="semana">Semana</option><option value="dia">Dia</option><option value="mes">Mês</option></select>}<Button variant="secondary" size="sm" aria-pressed={visao === 'lista'} onClick={() => { if (visao === 'lista') setVisao(visaoCalendario); else { setVisaoCalendario(visao); setVisao('lista'); } }}>{visao === 'lista' ? 'Calendário' : 'Lista'}</Button></div></header>
    {erroCarteira && <p role="alert">Tarefas: {erroCarteira} <button type="button" onClick={recarregar}>Atualizar</button></p>}
    {erro && !detalhe && !confirmacao && !edicaoLegada && <div className="agenda-error" role="alert">{erro} <button onClick={recarregar}>Tentar novamente</button></div>}
    {edicoes.quantidade > 0 && <div className="agenda-saving" role="status">Salvando alterações…</div>}
    {carregando && <div className="agenda-loading" role="status">Atualizando agenda…</div>}
    {visao === 'lista' ? <div className="agenda-list"><div className="agenda-list-filters"><input aria-label="Buscar atividades" placeholder="Buscar atividade" value={busca} onChange={e => setBusca(e.target.value)}/><select aria-label="Filtrar atividades" value={filtroLista} onChange={e => setFiltroLista(e.target.value)}><option value="TODAS">Todas</option><option value="tarefa">Tarefas</option><option value="obrigacao">Obrigações</option>{api.getOcorrenciasExcluidas && <option value="EXCLUIDAS">Ocorrências excluídas</option>}{!companyIdFixo && <option value="PAUSADAS">Obrigações pausadas</option>}</select></div>
      {filtroLista === 'EXCLUIDAS' && <OcorrenciasExcluidas api={api} inicio={inicio} fim={fim} companyId={companyIdFixo} busca={busca} onChanged={recarregar}/>}
      {series.map(s => <div className="agenda-list-row" key={s.id}><button className="agenda-list-name" disabled={s.pausada} onClick={() => abrirSerie(s)} style={{ '--event-color': corAtividade(s) }}>{obrigacao(s) && ICONE}<span><strong>{s.titulo}</strong><small>{s.pausada ? 'Pausada · histórico preservado' : s.modeloCarteira ? 'Configurar prazo e empresas' : RECORRENCIAS[s.recorrencia]}{s.empresas.length === 1 ? ` · ${s.empresas[0].empresa || 'Empresa vinculada'}` : s.empresas.length ? ` · ${s.empresas.length} empresas` : ''}</small></span></button><div className="agenda-list-actions">{s.modeloCarteira && <Button variant="secondary" size="sm" onClick={() => abrirSerie(s)}>Configurar obrigação</Button>}{!s.pausada && s.regraId && dados.regras.some(r => (r.regraId || r.id) === s.regraId) && <Button variant="secondary" size="sm" disabled={edicoes.pendenteSerie(s)} onClick={() => configurarObrigacao(s.regraId)}>Configurar obrigação</Button>}{s.original?.obrigacaoId && !s.original.agendaConfig && <Button variant="secondary" size="sm" disabled={edicoes.pendenteSerie(s)} onClick={() => setEdicaoLegada(s.original)}>Editar</Button>}{s.regraId && api.updateRegraObrigacao && <Button variant="secondary" size="sm" disabled={ocupado || edicoes.pendenteSerie(s)} onClick={() => agir(() => api.updateRegraObrigacao(s.regraId,{ativa:Boolean(s.pausada)}),false)}>{s.pausada ? 'Retomar obrigação' : 'Pausar obrigação'}</Button>}{!s.pausada && !s.modeloCarteira && <Button variant="secondary" size="sm" disabled={edicoes.pendenteSerie(s)} onClick={() => setConfirmacao({ alvo: s, serie: true })}>Excluir série</Button>}</div></div>)}
      {filtroLista !== 'EXCLUIDAS' && !series.length && !carregando && <p className="agenda-empty">Nenhuma atividade encontrada.</p>}
    </div> : visao === 'mes' ? <div className="agenda-month" ref={mesRef}><div className="agenda-weekdays">{['seg.','ter.','qua.','qui.','sex.','sáb.','dom.'].map(d => <span key={d}>{d}</span>)}</div>{Array.from({length:6},(_,n) => { const semana = dias.slice(n*7,n*7+7); return <div className="agenda-month-week" data-agenda-month-week={semana[0]} key={semana[0]}><div className="agenda-month-dates">{semana.map(d => <button key={d} className={`${d === dataLocal() ? 'is-today' : ''} ${d.slice(0,7) !== referencia.slice(0,7) ? 'is-outside' : ''}`} aria-label={`Criar atividade em ${dataBR(d)}`} onClick={() => criar(d)}>{Number(d.slice(8))}</button>)}</div><Faixas onConcluir={concluirNaGrade} itens={blocos} dias={semana} abrir={abrirAtividade} criar={criar} gestos={gestos} mes /></div>; })}{gestos.previa?.mensal && <div className="agenda-month-drop-target" aria-hidden="true" style={{position:"fixed",left:gestos.previa.left,top:gestos.previa.top,width:gestos.previa.width,height:gestos.previa.height}}/>}</div>
    : <div className="agenda-time-view"><div className="agenda-time-header">{cabecalhos(dias)}<span className="agenda-time-gutter" /></div><div className="agenda-all-day"><Faixas onConcluir={concluirNaGrade} key={`${inicio}:${visao}`} gestos={gestos} itens={blocos.filter(faixa)} dias={dias} abrir={abrirAtividade} criar={criar}/><span className="agenda-time-gutter" /></div><div className="agenda-time-scroll" ref={horasRef}><div className="agenda-time-columns" style={{ '--days': dias.length }}>{dias.map(d => <div key={d} className={`agenda-time-day${d === dataLocal() ? ' is-today' : ''}`}>
      {Array.from({length:24},(_,hora) => <button key={hora} type="button" className="agenda-time-slot" aria-label={`Criar atividade em ${dataBR(d)} às ${String(hora).padStart(2,'0')}:00`} onPointerDown={e=>gestos.iniciarCriacao(e,d)} onPointerMove={gestos.mover} onPointerUp={gestos.terminar} onPointerCancel={gestos.cancelar} onLostPointerCapture={gestos.cancelar} onClick={e=>gestos.clicarHorario(e,d,hora)}/>)}
      {criacao && !criacao.tarefaId && !criacao.ocorrenciaIds && !criacao.regraEdicao && criacao.horaInicio && criacao.dataInicio === d && <div className="agenda-selected-slot" aria-hidden="true" style={{top:minutos(criacao.horaInicio)/60*ALTURA_HORA,height:Math.max(22,(minutos(criacao.horaFim || criacao.horaInicio)-minutos(criacao.horaInicio))/60*ALTURA_HORA)}}>{criacao.titulo || 'Nova tarefa'} · {criacao.horaInicio}–{criacao.horaFim}</div>}
      {horarios[d].map(({item,coluna,colunas,extensao = 1}) => <Atividade mostrarHorario onConcluir={concluirNaGrade} gestos={gestos} key={item.id} item={item} abrir={abrirAtividade} style={{ '--event-left':`${coluna*100/colunas}%`, position:'absolute', top: minutos(item.horaInicio)/60*ALTURA_HORA, height: Math.max(22,(fimVisual(item)-minutos(item.horaInicio))/60*ALTURA_HORA-2), width:`calc(${100*extensao/colunas}% - 5px)`, left:`calc(${coluna*100/colunas}% + 2px)` }}/>)}</div>)}{gestos.previa && <div className={`agenda-drag-preview${gestos.previa.tipoGesto === 'criar' ? ' is-creating' : ''}`} aria-live="polite" style={{'--event-color':corAtividade(gestos.previa.item),left:gestos.previa.left,width:gestos.previa.width,top:minutos(gestos.previa.horaInicio)/60*ALTURA_HORA,height:Math.max(22,(fimVisual(gestos.previa)-minutos(gestos.previa.horaInicio))/60*ALTURA_HORA-2)}}><strong>{horarioAtividade(gestos.previa)}{gestos.previa.horaFim && <small>{minutos(gestos.previa.horaFim)-minutos(gestos.previa.horaInicio)} min</small>}</strong><span>{gestos.previa.item.titulo}</span></div>}<LinhaHorarioAtual dias={dias} agora={agora}/><div className="agenda-hours" aria-hidden="true">{Array.from({length:24},(_,h) => <span key={h}>{String(h).padStart(2,'0')}:00</span>)}</div></div></div></div>}
    {criacao && <ModalAtividade key={criacao.regraEdicao?.regraId || criacao.regraEdicao?.id || 'atividade'} inicial={inicialEdicao} onRascunho={atualizarRascunho} onOpenCompany={onOpenCompany} empresas={empresas} api={api} onAlterarConclusao={criacao.tipo === 'tarefa' && !(criacao.ocorrenciaIds?.length > 1) && !criacao.conclusaoAutomatica ? alterarConclusaoTarefa : undefined} onExcluir={criacao.tarefaId || criacao.ocorrenciaIds ? () => { setConfirmacao({ alvo:criacao }); setCriacao(null); } : undefined} onConfigurarObrigacao={criacao.regraId && dados.regras.some(r => (r.regraId || r.id) === criacao.regraId) ? () => configurarObrigacao(criacao.regraId) : undefined} onFechar={() => setCriacao(null)} onEditarOcorrencia={editarOcorrencia} onSalvo={() => { setCriacao(null); recarregar(); }}/ >}
    {detalhe && !confirmacao && <Modal titulo={detalhe.titulo} aoFechar={() => { setDetalhe(null); setErro(''); }} ocupado={ocupado || empresasSalvando.size > 0} lateral rodape={!detalhe.somenteSerie && <div className="agenda-form-actions">{(detalhe.itens?.[0]?.tarefaId || detalhe.fonte === 'OBRIGACAO') && <Button variant="secondary" disabled={ocupado || empresasSalvando.size > 0} onClick={() => { setCriacao(detalhe.fonte === 'OBRIGACAO' ? { ...detalhe, ocorrenciaIds:detalhe.itens.map(i=>i.ocorrenciaId) } : detalhe.itens[0]); setDetalhe(null); }}>Editar</Button>}<Button variant="danger" disabled={ocupado || empresasSalvando.size > 0} onClick={() => setConfirmacao({ alvo: detalhe })}>Excluir ocorrência</Button></div>}>
      <div className="agenda-detail">{detalhe.regraId && dados.regras.some(r => (r.regraId || r.id) === detalhe.regraId) && <button className="agenda-text-action" onClick={() => configurarObrigacao(detalhe.regraId)}>Configurar obrigação</button>}<p className="agenda-detail-period">{dataBR(detalhe.dataInicio)}{detalhe.dataFim !== detalhe.dataInicio ? ` – ${dataBR(detalhe.dataFim)}` : ''}{detalhe.horaInicio ? ` · ${horarioAtividade(detalhe)}` : ''}</p>{vencimentoComum && <p className="agenda-detail-deadline">{chaveDaObrigacaoCarteira(detalhe.verificador) ? 'Prazo interno' : 'Vencimento fiscal'} · {dataBR(vencimentoComum)}</p>}{detalhe.descricao && <p className="agenda-description">{detalhe.descricao}</p>}
      {detalhe.itens?.length > 1 && <div className="agenda-progress"><span>{detalhe.itens.filter(i => i.resolvido).length} de {detalhe.itens.length} concluídas</span><progress max={detalhe.itens.length} value={detalhe.itens.filter(i => i.resolvido).length}/></div>}
      {(detalhe.itens || []).map(i => <div className={`agenda-company-row${i.resolvido ? ' is-complete' : ''}`} key={i.id}>
        {podeConcluirNaLista(i) && <input className="agenda-company-checkbox" type="checkbox" aria-label={`${i.resolvido ? 'Reabrir' : 'Concluir'} ${detalhe.titulo} para ${i.empresa || i.titulo}`} checked={Boolean(i.resolvido)} disabled={ocupado || empresasSalvando.has(i.id) || automaticaNaLista(i)} onChange={() => concluirEtapaEmpresa(i)} />}
        <div className="agenda-company-identity">
          <strong className="agenda-company-name">{i.empresa || i.titulo}</strong>
          {i.companyId && <small>{soDigitosCnpj(i.cnpj) ? <BotaoCopiar valor={soDigitosCnpj(i.cnpj)} rotulo={`Copiar o CNPJ de ${i.empresa || i.titulo} sem máscara`} titulo="Copiar CNPJ">{formatarCnpj(i.cnpj)}</BotaoCopiar> : 'CNPJ não informado'}</small>}
          {!vencimentoComum && i.dataVencimento && obrigacao(i) && <small>{chaveEtapa(i) ? 'Prazo interno' : 'Vencimento fiscal'} · {dataBR(i.dataVencimento)}</small>}
          <small className="agenda-company-status" aria-live="polite">{empresasSalvando.has(i.id) ? 'Salvando…' : i.resolvido ? 'Concluída' : 'Pendente'}</small>
          {automaticaNaLista(i) && <small>Atualizado pela operação da empresa.</small>}
          {chaveEtapa(i) === 'importar' && !i.resolvido && <small>Marcar confirma todos os lançamentos pendentes como importados no ERP.</small>}
          {i.erroConclusao && <p className="agenda-error" role="alert">{i.erroConclusao}</p>}
        </div>
        <div className="agenda-company-actions">
          {i.companyId && onOpenCompany && <Button size="sm" variant="secondary" disabled={ocupado || empresasSalvando.size > 0} onClick={() => onOpenCompany(i.companyId)}>Abrir empresa</Button>}
          {detalhe.itens.length > 1 && i.ocorrenciaId && <button className="agenda-text-action" disabled={ocupado || empresasSalvando.size > 0} onClick={() => setConfirmacao({ alvo:{...i,diaSelecionado:detalhe.diaSelecionado} })}>Excluir ocorrência</button>}
        </div>
      </div>)}
      {detalhe.empresasVazias && <p>Nenhuma ocorrência ativa para esta obrigação.</p>}
      {erro && <p className="agenda-error" role="alert">{erro}</p>}
      </div>
    </Modal>}
    {confirmacao && <Modal titulo={confirmacao.serie ? 'Excluir série completa?' : 'Excluir esta ocorrência?'} aoFechar={() => { setConfirmacao(null); setErro(''); }} ocupado={ocupado} tamanho="sm" rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setConfirmacao(null)}>Cancelar</Button><Button variant="danger" disabled={ocupado} onClick={() => agir(() => excluir(confirmacao.alvo,confirmacao.serie,confirmacao.alcance || "ESTA"))}>{ocupado ? 'Excluindo…' : 'Excluir'}</Button></>}><p>{confirmacao.alvo.titulo}</p><p>{dataBR(confirmacao.alvo.diaSelecionado || confirmacao.alvo.dataInicio)}{!confirmacao.alvo.diaSelecionado && confirmacao.alvo.dataFim !== confirmacao.alvo.dataInicio ? ` – ${dataBR(confirmacao.alvo.dataFim)}` : ''}</p>{!confirmacao.serie && (confirmacao.alvo.tarefaId || confirmacao.alvo.ocorrenciaId || confirmacao.alvo.ocorrenciaIds || confirmacao.alvo.itens?.some(i => i.tarefaId || i.ocorrenciaId)) && <fieldset disabled={ocupado} style={{border:0,padding:0,display:'grid',gap:10}}><legend>Quais ocorrências deseja excluir?</legend>{[['ESTA','Somente esta ocorrência'],['ESTA_E_PROXIMAS','Esta e todas as próximas'],['ESTA_E_ANTERIORES','Esta e todas as anteriores']].map(([valor,rotulo]) => <label key={valor}><input type="radio" name="alcanceExclusao" value={valor} checked={(confirmacao.alcance || 'ESTA') === valor} onChange={() => setConfirmacao(c => ({...c,alcance:valor}))}/> {rotulo}</label>)}</fieldset>}<p>{confirmacao.serie ? 'Todas as ocorrências desta série serão removidas do calendário.' : `${confirmacao.alvo.itens?.length > 1 ? `${confirmacao.alvo.itens.length} empresas neste período. ` : ''}${confirmacao.alcance === 'ESTA_E_PROXIMAS' ? 'As anteriores serão mantidas.' : confirmacao.alcance === 'ESTA_E_ANTERIORES' ? 'As próximas serão mantidas.' : 'As anteriores e próximas serão mantidas.'}`}</p>{erro && <p className="agenda-error" role="alert">{erro}</p>}</Modal>}
    {edicaoLegada && <ModalObrigacao inicial={edicaoLegada} empresas={empresas} opcoes={dados.opcoes} onFechar={() => setEdicaoLegada(null)} salvando={ocupado} erro={erro} onSalvar={d => agir(() => api.updateObrigacao(edicaoLegada.obrigacaoId,d))}/ >}
  </section>;
}
