import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

const name = c => c.razao || c.razaoSocial || c.nome || c.cnpj || 'Empresa';
const EMPTY_COMPANIES = [];

export function OperationsRoutineCompanies({ api, companies = EMPTY_COMPANIES, competencia, loading = false, error: companyError, onRefreshCompanies }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(true);
  const [group, setGroup] = useState(null), [query, setQuery] = useState('');
  const [consultas, setConsultas] = useState(null);
  const [consultaError, setConsultaError] = useState('');
  const [consultaRetry, setConsultaRetry] = useState(0);
  useEffect(() => { setGroup(null); }, [competencia, api]);
  useEffect(() => {
    let cancelled = false;
    setConsultas(null); setConsultaError('');
    Promise.resolve().then(() => {
      if (!competencia) throw Error('Selecione uma competência para conferir erros de consulta.');
      if (!api?.getOperationConsultas) throw Error('Leitura de erros de consulta indisponível.');
      return api.getOperationConsultas(competencia);
    }).then(out => {
      if (out?.ok === false || !Array.isArray(out?.items) || out.total !== out.items.length || out.competencia !== competencia) throw Error('Contagem de consultas indisponível.');
      if (!cancelled) setConsultas({ ...out, competencia });
    }).catch(e => { if (!cancelled) setConsultaError(e.message); });
    return () => { cancelled = true; };
  }, [api, competencia, companies, consultaRetry]);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setPending(true); setError('');
    try {
      if (!api?.getOperationRoutines) throw Error('Não foi possível carregar as rotinas.');
      const response = await api.getOperationRoutines();
      if (!Array.isArray(response?.items) || !Array.isArray(response?.routines)) throw Error('Não foi possível carregar as rotinas.');
      if (current === generation.current) setData(response);
    } catch (e) { if (current === generation.current) { setData(null); setError(e.message || 'Não foi possível carregar as rotinas.'); } }
    finally { if (current === generation.current) setPending(false); }
  }, [api]);
  useEffect(() => { const generationDaExecucao = generation;
    load();
    const focus = () => load();
    window.addEventListener('focus', focus);
    return () => { generationDaExecucao.current++; window.removeEventListener('focus', focus); };
  }, [load, api]);
  async function retry() {
    try {
      if (companyError) await onRefreshCompanies?.();
      await load();
    } catch { setError('Não foi possível atualizar as empresas. Tente novamente.'); }
  }
  const retryButton = (error || companyError) && (!companyError || onRefreshCompanies) ? <Button size="sm" variant="secondary" onClick={retry} disabled={pending || loading}>Tentar novamente</Button> : null;
  const unavailable = pending || loading || Boolean(error || companyError) || !data;
  const indexed = new Map((data?.items || []).map(c => [c.companyId, c]));
  const rows = [...new Map(companies.filter(c => c.companyId && String(c.status || '').toUpperCase() !== 'INATIVA').map(c => [c.companyId, c])).values()]
    .map(c => ({ ...c, keys: indexed.get(c.companyId)?.enabledKeys, applicableKeys: indexed.get(c.companyId)?.applicableKeys,
      unavailableReason: indexed.get(c.companyId)?.unavailableReason, known: Array.isArray(indexed.get(c.companyId)?.enabledKeys) }))
    .sort((a, b) => name(a).localeCompare(name(b), 'pt-BR'));
  const applicable = c => c.known && !c.unavailableReason && Array.isArray(c.applicableKeys) && c.applicableKeys.length > 0;
  const enabled = c => applicable(c) && c.applicableKeys.every(key => c.keys.includes(key));
  const count = state => rows.filter(c => applicable(c) && enabled(c) === state).length;
  const unknown = rows.filter(c => !applicable(c));
  const consultaItems = competencia && consultas?.competencia === competencia ? consultas.items.filter(item => rows.some(c => c.companyId === item.companyId)) : null;
  const source = rows.filter(c => applicable(c) && enabled(c) === (group === 'enabled'));
  const visible = source.filter(c => `${name(c)} ${c.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const errors = consultaItems?.filter(item => name(rows.find(c => c.companyId === item.companyId)).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const tabs = [['errors', 'Erros', consultaItems?.length], ['disabled', 'Desabilitadas', unavailable ? null : count(false)], ['enabled', 'Habilitadas', unavailable ? null : count(true)]];
  const total = count(true) + count(false);
  function keyboard(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (next == null) return;
    event.preventDefault(); setGroup(tabs[next][0]);
    event.currentTarget.parentElement.children[next].focus();
  }
  return <section className="operacoes-rotinas-unico" aria-label="Rotinas">
    <button type="button" className="operacoes-rotinas-card" aria-haspopup="dialog" onClick={() => { setGroup('errors'); setQuery(''); }}>
      <span className="operacoes-cabecalho"><strong>Rotinas</strong><span className="operacoes-erro" aria-label="Consultas com erro">{consultaItems?.length ? `⚠ ${consultaItems.length}` : consultaItems ? '' : '—'}</span></span>
      <span className="operacoes-pizza" aria-hidden="true" style={{ background: unavailable || !total ? 'var(--border)' : `conic-gradient(var(--state-ok) ${count(true) / total * 100}%, var(--state-danger) 0)` }} />
      <span>Habilitadas / desabilitadas</span><strong>{unavailable ? '— / —' : `${count(true)} / ${count(false)}`}</strong>
      {!unavailable && unknown.length > 0 && <small>{unknown.length} a verificar</small>}
    </button>
    <small>Seleção por empresa. Agenda global e pausa SERPRO permanecem independentes.</small>
    {pending && <p role="status">Carregando rotinas…</p>}
    {(error || companyError) && <p role="alert">{error || companyError} {retryButton}</p>}
    {consultaError && <p role="alert">{consultaError} <Button size="sm" variant="secondary" onClick={() => setConsultaRetry(n => n + 1)}>Atualizar erros de consultas</Button></p>}
    {group && <Modal titulo="Rotinas" aoFechar={() => setGroup(null)} tamanho="lg" className="operacoes-dialogo" rodape={<Button variant="secondary" onClick={() => setGroup(null)}>Fechar</Button>}>
      <div className="app-tabs" role="tablist" aria-label="Situação das rotinas">{tabs.map(([key, label, count], index) => <button type="button" role="tab" id={`rotinas-tab-${key}`} aria-selected={group === key} aria-controls="rotinas-painel" tabIndex={group === key ? 0 : -1} className={`app-tab${group === key ? ' is-active' : ''}`} key={key} onKeyDown={e => keyboard(e, index)} onClick={() => setGroup(key)}>{label} · {count ?? '—'}</button>)}</div>
      <label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div role="tabpanel" id="rotinas-painel" aria-labelledby={`rotinas-tab-${group}`} tabIndex={0}>
        {group === 'errors' ? <>
          <p>Competência {competencia || 'não selecionada'} · Consultas SERPRO. Tentativas incertas ou bloqueadas não resolvem erros anteriores.</p>
          {!consultaItems || loading || companyError ? <p role="status">{consultaError || companyError || 'Carregando consultas…'}</p> : <ul className="operacoes-lista-modal">{errors.map(item => <li key={item.id}>
            <div><strong>{name(rows.find(c => c.companyId === item.companyId))}</strong><small>Etapa interrompida: {item.action}</small><p>{item.errorMessage || 'Erro sem detalhe registrado'}</p>{item.tentativaPosterior && <small>Tentativa posterior {item.tentativaPosterior.situacao} · erro anterior preservado</small>}</div>
            <InternalLink href={companyTabPath(item.companyId, ['certificado', 'automacao', 'sitfis', 'cadastroFiscal', 'guides', 'lancamentos'].includes(item.correctionTab) ? item.correctionTab : 'automacao') + '?competencia=' + encodeURIComponent(competencia)}>Corrigir erro</InternalLink>
          </li>)}{!errors.length && <li>Nenhuma consulta com erro neste recorte.</li>}</ul>}
        </> : unavailable ? <p role="status">{error || companyError || 'Atualizando rotinas…'}</p> : <ul className="operacoes-lista-modal">{visible.map(c => <li key={c.companyId}><strong>{name(c)}</strong><InternalLink href={companyTabPath(c.companyId, 'automacao')}>Abrir configurações</InternalLink></li>)}{!visible.length && <li>Nenhuma empresa neste filtro.</li>}</ul>}
        {!unavailable && unknown.length > 0 && <details><summary>A verificar · {unknown.length}</summary><p>Aplicabilidade ou configuração indisponível. Essas empresas não contam como desabilitadas.</p><ul>{unknown.map(c => <li key={c.companyId}>{name(c)} · <InternalLink href={companyTabPath(c.companyId, 'automacao')}>Conferir configuração</InternalLink></li>)}</ul></details>}
      </div>
    </Modal>}
  </section>;
}
