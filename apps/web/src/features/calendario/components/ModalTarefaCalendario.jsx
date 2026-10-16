import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { CalendarioPeriodoTarefa } from './CalendarioPeriodoTarefa';
import '../tarefa-calendario-editor.css';

const FREQUENCIAS = [['AVULSA', 'Não repetir'], ['DIARIA', 'Todos os dias'], ['SEMANAL', 'Toda semana'], ['MENSAL', 'Todo mês'], ['TRIMESTRAL', 'A cada 3 meses'], ['SEMESTRAL', 'A cada 6 meses'], ['ANUAL', 'Todo ano']];
const PRIORIDADES = [['', 'Sem prioridade'], ['BAIXA', 'Baixa'], ['MEDIA', 'Média'], ['ALTA', 'Alta'], ['URGENTE', 'Urgente']];
const idEmpresa = e => String(e.companyId || e.id);
const regimeEmpresa = e => e.regime || e.regimeTributario || e.taxRegime || e.legacyCompany?.regimeTributario || '';
const nomeEmpresa = e => e.razao || e.razaoSocial || e.nome || e.name || e.legacyCompany?.razaoSocial || 'Empresa';
const dataCurta = value => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
const novoId = () => globalThis.crypto?.randomUUID?.() || `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function ModalTarefaCalendario({ inicial, empresas = [], api, onFechar, onSalvo, onRascunho }) {
  const edicao = Boolean(inicial.tarefaId);
  const [dados, setDados] = useState(() => ({
    titulo: inicial.titulo || '', descricao: inicial.descricao || '',
    config: { recorrencia: 'AVULSA', horarioModo: 'SEM', prioridade: '', ...inicial, ...inicial.config,
      dataInicio: inicial.config?.dataInicio || inicial.dataInicio,
      dataFim: inicial.config?.dataFim || inicial.dataFim || inicial.dataInicio },
    empresasIds: (inicial.empresasIds || (inicial.companyId ? [inicial.companyId] : [])).map(String),
    subtarefas: (inicial.subtarefas || inicial.config?.subtarefas || []).map(s => ({ id: s.id || novoId(), titulo: s.titulo || '' })),
  }));
  const [painel, setPainel] = useState('');
  const [busca, setBusca] = useState('');
  const [regime, setRegime] = useState('');
  const [alcance, setAlcance] = useState('ESTA');
  const [fimRepeticao, setFimRepeticao] = useState(dados.config.repetirAte ? 'DATA' : dados.config.repetirQuantidade ? 'QUANTIDADE' : 'NUNCA');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [descartar, setDescartar] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const tituloRef = useRef(null), painelRef = useRef(null), gatilhoPainel = useRef(null), continuarRef = useRef(null);
  const painelAnterior = useRef(''), descarteAnterior = useRef(false);
  useEffect(() => {
    if (descartar) continuarRef.current?.focus();
    else if (descarteAnterior.current) tituloRef.current?.focus();
    descarteAnterior.current = descartar;
  }, [descartar]);
  useEffect(() => {
    if (painel) painelRef.current?.focus();
    else if (painelAnterior.current) (gatilhoPainel.current?.isConnected ? gatilhoPainel.current : tituloRef.current)?.focus();
    painelAnterior.current = painel;
  }, [painel]);
  const c = dados.config;
  const recorrenteOriginal = (inicial.config?.recorrencia || inicial.recorrencia || 'AVULSA') !== 'AVULSA';
  const set = (chave, value) => { setAlterado(true); setDados(d => ({ ...d, [chave]: value })); };
  const config = patch => { setAlterado(true); if (edicao && ['recorrencia', 'repetirAte', 'repetirQuantidade'].some(k => k in patch)) setAlcance('ESTA_E_PROXIMAS'); setDados(d => ({ ...d, config: { ...d.config, ...patch } })); };
  const abrir = (nome, event) => { gatilhoPainel.current = event.currentTarget; setPainel(p => p === nome ? '' : nome); };
  const fechar = () => descartar ? setDescartar(false) : alterado ? setDescartar(true) : onFechar();
  const filtradas = empresas.filter(e => (!regime || regimeEmpresa(e) === regime) && `${nomeEmpresa(e)} ${e.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')));
  const regimes = [...new Set(empresas.map(regimeEmpresa).filter(Boolean))].sort();
  const horarioTexto = c.horarioModo === 'ATE' ? `Até ${c.horaLimite || '…'}` : c.horarioModo === 'FIXO' ? `${c.horaFim ? '' : 'Às '}${c.horaInicio || '…'}${c.horaFim ? `–${c.horaFim}` : ''}` : 'Sem horário';
  useEffect(() => { onRascunho?.({ ...dados.config, titulo: dados.titulo, descricao: dados.descricao, tipo: 'tarefa', empresasIds: dados.empresasIds }); }, [dados, onRascunho]);

  async function salvar(event) {
    event.preventDefault(); setErro('');
    if (!dados.titulo.trim()) { setErro('Informe o título da tarefa.'); return; }
    if (c.horarioModo === 'FIXO' && !c.horaInicio || c.horarioModo === 'ATE' && !c.horaLimite) { setPainel('data'); setErro('Escolha o horário da tarefa.'); return; }
    if (c.horarioModo === 'FIXO' && c.horaFim && c.horaFim <= c.horaInicio) { setPainel('data'); setErro('O término deve ser posterior ao horário de início, no mesmo dia.'); return; }
    if (c.recorrencia !== 'AVULSA' && fimRepeticao === 'DATA' && (!c.repetirAte || c.repetirAte < c.dataInicio)) { setPainel('data'); setErro('O fim da repetição deve ser igual ou posterior ao início.'); return; }
    if (c.recorrencia !== 'AVULSA' && fimRepeticao === 'QUANTIDADE' && (!Number.isInteger(Number(c.repetirQuantidade)) || Number(c.repetirQuantidade) < 1)) { setPainel('data'); setErro('Informe ao menos uma ocorrência.'); return; }
    const payload = {
      titulo: dados.titulo.trim(), descricao: dados.descricao.trim(), empresasIds: dados.empresasIds,
      subtarefas: dados.subtarefas.filter(s => s.titulo.trim()).map(s => ({ ...s, titulo: s.titulo.trim() })),
      config: {
        dataInicio: c.dataInicio, dataFim: c.dataFim || c.dataInicio,
        recorrencia: c.recorrencia, horarioModo: c.horarioModo,
        horaInicio: c.horarioModo === 'FIXO' ? c.horaInicio : null,
        horaFim: c.horarioModo === 'FIXO' ? c.horaFim || null : null,
        horaLimite: c.horarioModo === 'ATE' ? c.horaLimite : null,
        prioridade: c.prioridade,
        repetirAte: c.recorrencia !== 'AVULSA' && fimRepeticao === 'DATA' ? c.repetirAte : null,
        repetirQuantidade: c.recorrencia !== 'AVULSA' && fimRepeticao === 'QUANTIDADE' ? Number(c.repetirQuantidade) : null,
        diaVencimento: c.recorrencia === 'MENSAL' && c.diaVencimento ? Number(c.diaVencimento) : null,
        dataVencimento: c.recorrencia === 'AVULSA' ? c.dataVencimento || null : null,
      },
    };
    setOcupado(true);
    try {
      const resposta = edicao
        ? await api.acaoTarefaCalendario(inicial.tarefaId, { acao: alcance === 'ESTA_E_PROXIMAS' ? 'EDITAR_SERIE' : 'EDITAR', cicloChave: inicial.cicloChave, alteracoes: payload })
        : await api.criarTarefaCalendario(payload);
      if (resposta?.ok === false) throw new Error(resposta.message || 'Não foi possível salvar a tarefa.');
      onSalvo?.({ ...resposta, dataInicio: c.dataInicio });
    } catch (e) { setErro(e.message || 'Não foi possível salvar a tarefa.'); }
    finally { setOcupado(false); }
  }

  return <Modal titulo={edicao ? 'Editar tarefa' : 'Nova tarefa'} tamanho="sm" className="tarefa-calendario-editor" aoFechar={fechar} ocupado={ocupado} fecharAoClicarFundo={!alterado} fecharAoEscape={descartar || !painel}>
    {descartar ? <div className="tce-discard"><p>Descartar as alterações desta tarefa?</p><div className="tce-actions"><Button ref={continuarRef} variant="secondary" onClick={() => setDescartar(false)}>Continuar editando</Button><Button variant="danger" onClick={onFechar}>Descartar</Button></div></div> : <form onSubmit={salvar} onKeyDown={e => { if (e.key === 'Escape' && painel && !ocupado) { e.stopPropagation(); setPainel(''); } }}>
      <fieldset disabled={ocupado} className="tce-fields">
        <div className="tce-meta">
          <Button type="button" variant="secondary" size="sm" onClick={event => abrir('data', event)} aria-expanded={painel === 'data'}>{horarioTexto}</Button>
          <Button type="button" variant="secondary" size="sm" onClick={event => abrir('data', event)} aria-expanded={painel === 'data'} aria-label="Data e repetição">{dataCurta(c.dataInicio)}{c.dataFim && c.dataFim !== c.dataInicio ? ` – ${dataCurta(c.dataFim)}` : ''}</Button>
          <Button type="button" variant="secondary" size="sm" className="tce-priority" aria-label={`Prioridade: ${PRIORIDADES.find(p => p[0] === c.prioridade)?.[1] || 'Sem prioridade'}`} onClick={event => abrir('prioridade', event)} aria-expanded={painel === 'prioridade'}><span aria-hidden="true">⚑</span><span className={`tce-dot tce-dot-${c.prioridade || 'SEM'}`} /></Button>
        </div>
        <label className="tce-title-label">Título<input ref={tituloRef} className="tce-title" value={dados.titulo} onChange={e => set('titulo', e.target.value)} maxLength={200} placeholder="O que precisa ser feito?" required data-modal-autofocus /></label>
        <label className="tce-description-label">Descrição<textarea value={dados.descricao} onChange={e => set('descricao', e.target.value)} placeholder="Adicionar observações…" rows={2} /></label>
        <Button type="button" variant="secondary" size="sm" className="tce-repeat-summary" onClick={event => abrir('data', event)}>{FREQUENCIAS.find(f => f[0] === c.recorrencia)?.[1]}{c.recorrencia === 'MENSAL' && c.diaVencimento ? ` · vence dia ${c.diaVencimento}` : ''}</Button>
        {painel && <section ref={painelRef} tabIndex={-1} className="tce-panel" aria-label={{ data: 'Data e repetição', prioridade: 'Prioridade', empresas: 'Empresas da tarefa', subtarefas: 'Subtarefas da tarefa' }[painel]}>
          <div className="tce-panel-heading"><span>{{ data: 'Data e repetição', prioridade: 'Prioridade', empresas: 'Empresas', subtarefas: 'Subtarefas' }[painel]}</span><Button type="button" size="sm" variant="secondary" onClick={() => setPainel('')}>Concluir</Button></div>
          {painel === 'data' && <>
            <CalendarioPeriodoTarefa inicio={c.dataInicio} fim={c.dataFim} onChange={(dataInicio, dataFim) => config({ dataInicio, dataFim })} />
            <div className="tce-row"><label>Horário<select value={c.horarioModo} onChange={e => config({ horarioModo: e.target.value })}><option value="SEM">Sem horário</option><option value="FIXO">Horário fixo · às</option><option value="ATE">Horário limite · até</option></select></label>{c.horarioModo !== 'SEM' && <label>Hora<input type="time" value={(c.horarioModo === 'FIXO' ? c.horaInicio : c.horaLimite) || ''} onChange={e => config({ [c.horarioModo === 'FIXO' ? 'horaInicio' : 'horaLimite']: e.target.value })} /></label>}</div>
            {c.horarioModo === 'FIXO' && <label>Término (opcional)<input type="time" value={c.horaFim || ''} min={c.horaInicio || undefined} onChange={e => config({ horaFim: e.target.value })} /></label>}
            <div className="tce-row"><label>Repetição<select value={c.recorrencia} onChange={e => config({ recorrencia: e.target.value })}>{FREQUENCIAS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>{c.recorrencia !== 'AVULSA' && <label>Termina<select value={fimRepeticao} onChange={e => { setFimRepeticao(e.target.value); setAlterado(true); if (edicao) setAlcance('ESTA_E_PROXIMAS'); }}><option value="NUNCA">Nunca</option><option value="DATA">Em uma data</option><option value="QUANTIDADE">Após ocorrências</option></select></label>}</div>
            {c.recorrencia !== 'AVULSA' && fimRepeticao === 'DATA' && <label>Última data de repetição<input type="date" value={c.repetirAte || ''} min={c.dataInicio} onChange={e => config({ repetirAte: e.target.value })} /></label>}
            {c.recorrencia !== 'AVULSA' && fimRepeticao === 'QUANTIDADE' && <label>Número de ocorrências<input type="number" min="1" max="1000" value={c.repetirQuantidade || ''} onChange={e => config({ repetirQuantidade: e.target.value })} /></label>}
            {c.recorrencia === 'MENSAL' && <><label>Vencimento mensal<select value={c.diaVencimento || ''} onChange={e => config({ diaVencimento: e.target.value })}><option value="">Sem vencimento</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>Dia {i + 1}</option>)}</select></label>{c.diaVencimento && <p className="tce-hint">Quando o dia não existir, vale o último dia do mês. Dia 31 vence em 28 ou 29 de fevereiro; nos meses seguintes, continua dia 31.</p>}</>}
            {c.recorrencia === 'AVULSA' && <label>Vencimento (opcional)<input type="date" value={c.dataVencimento || ''} onChange={e => config({ dataVencimento: e.target.value })} /></label>}
            {(c.diaVencimento || c.dataVencimento) && <p className="tce-hint">Enquanto pendente, a tarefa também aparece em vermelho na véspera e no vencimento.</p>}
          </>}
          {painel === 'prioridade' && <div className="tce-colors">{PRIORIDADES.map(([value, text]) => <Button type="button" size="sm" variant="secondary" key={value} aria-pressed={c.prioridade === value} onClick={() => config({ prioridade: value })}><span className={`tce-dot tce-dot-${value || 'SEM'}`} />{text}</Button>)}</div>}
          {painel === 'empresas' && <>
            <label>Buscar empresas<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou CNPJ" /></label>
            <label>Regime tributário<select value={regime} onChange={e => setRegime(e.target.value)}><option value="">Todos os regimes</option>{regimes.map(r => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}</select></label>
            <div className="tce-selection"><Button type="button" size="sm" variant="secondary" onClick={() => set('empresasIds', empresas.map(idEmpresa))}>Todas ({empresas.length})</Button><Button type="button" size="sm" variant="secondary" onClick={() => set('empresasIds', [...new Set([...dados.empresasIds, ...filtradas.map(idEmpresa)])])}>Todas do filtro ({filtradas.length})</Button><Button type="button" size="sm" variant="secondary" onClick={() => set('empresasIds', [])}>Limpar</Button></div>
            <div className="tce-companies">{filtradas.map(e => <label key={idEmpresa(e)} className="tce-check"><input type="checkbox" checked={dados.empresasIds.includes(idEmpresa(e))} onChange={event => set('empresasIds', event.target.checked ? [...dados.empresasIds, idEmpresa(e)] : dados.empresasIds.filter(id => id !== idEmpresa(e)))} /><span>{nomeEmpresa(e)}<small>{regimeEmpresa(e).replaceAll('_', ' ')}</small></span></label>)}{!filtradas.length && <p className="tce-hint">Nenhuma empresa encontrada.</p>}</div>
            <p className="tce-hint" aria-live="polite">{dados.empresasIds.length ? `${dados.empresasIds.length} empresas selecionadas. A tarefa será compartilhada com a equipe autorizada dessas empresas.` : 'Sem empresas, esta tarefa fica no seu calendário pessoal.'}</p>
          </>}
          {painel === 'subtarefas' && <><p className="tce-hint">Cada empresa terá seu próprio checklist.</p>{dados.subtarefas.map((s, i) => <div className="tce-subtask" key={s.id}><label><span className="tce-sr">Subtarefa {i + 1}</span><input value={s.titulo} maxLength={200} placeholder="Nome da subtarefa" onChange={e => set('subtarefas', dados.subtarefas.map(item => item.id === s.id ? { ...item, titulo: e.target.value } : item))} /></label><Button type="button" variant="secondary" size="sm" aria-label={`Remover subtarefa ${i + 1}`} onClick={() => set('subtarefas', dados.subtarefas.filter(item => item.id !== s.id))}>×</Button></div>)}<Button type="button" variant="secondary" size="sm" onClick={() => set('subtarefas', [...dados.subtarefas, { id: novoId(), titulo: '' }])}>+ Adicionar subtarefa</Button></>}
        </section>}
        {edicao && (recorrenteOriginal || c.recorrencia !== 'AVULSA') && <label className="tce-scope">Aplicar alterações<select value={alcance} onChange={e => setAlcance(e.target.value)}><option value="ESTA">Somente esta ocorrência</option><option value="ESTA_E_PROXIMAS">Esta e as próximas</option></select></label>}
        {erro && <p role="alert" className="tce-error">{erro}</p>}
        <footer className="tce-footer"><div><Button type="button" variant="secondary" size="sm" onClick={event => abrir('empresas', event)} aria-expanded={painel === 'empresas'}>Empresas <span className="tce-count">{dados.empresasIds.length}</span></Button><Button type="button" variant="secondary" size="sm" onClick={event => abrir('subtarefas', event)} aria-expanded={painel === 'subtarefas'}>Subtarefas <span className="tce-count">{dados.subtarefas.length}</span></Button></div><Button type="submit" size="sm" disabled={ocupado}>{ocupado ? 'Salvando…' : edicao ? 'Salvar' : 'Criar tarefa'}</Button></footer>
      </fieldset>
      {ocupado && <p role="status" className="tce-hint">Salvando tarefa…</p>}
    </form>}
  </Modal>;
}
