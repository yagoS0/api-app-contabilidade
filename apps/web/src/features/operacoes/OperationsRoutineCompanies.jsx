import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

const name = c => c.razao || c.razaoSocial || c.nome || c.cnpj || 'Empresa';

export function OperationsRoutineCompanies({ api, companies = [], loading = false, error: companyError, onRefreshCompanies }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(true);
  const [group, setGroup] = useState(null), [query, setQuery] = useState(''), [routine, setRoutine] = useState('');
  const generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    setPending(true); setError('');
    try {
      if (!api?.getOperationRoutines) throw Error('Não foi possível carregar as rotinas.');
      const response = await api.getOperationRoutines();
      if (!Array.isArray(response?.items) || !Array.isArray(response?.routines)) throw Error('Não foi possível carregar as rotinas.');
      if (current === generation.current) setData(response);
    } catch (e) { if (current === generation.current) { setData(null); setError(e.message || 'Não foi possível carregar as rotinas.'); } }
    finally { if (current === generation.current) setPending(false); }
  }
  useEffect(() => {
    load();
    const focus = () => load();
    window.addEventListener('focus', focus);
    return () => { generation.current++; window.removeEventListener('focus', focus); };
  }, [api]);
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
      unavailableReason: indexed.get(c.companyId)?.unavailableReason, known: indexed.has(c.companyId) }))
    .sort((a, b) => name(a).localeCompare(name(b), 'pt-BR'));
  const enabled = c => routine ? c.keys?.includes(routine) : c.keys?.length > 0;
  const applicable = c => c.known && !c.unavailableReason && (c.applicableKeys ? (routine ? c.applicableKeys.includes(routine) : c.applicableKeys.length > 0) : true);
  const count = state => rows.filter(c => applicable(c) && enabled(c) === state).length;
  const visible = rows.filter(c => applicable(c) && enabled(c) === (group === 'enabled') && `${name(c)} ${c.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const open = state => { setGroup(state); setQuery(''); };
  return <section className="operacoes-rotinas-resumo" aria-label="Empresas nas rotinas">
    <div className="operacoes-cabecalho"><h3>Empresas nas rotinas</h3><label>Rotina <select value={routine} onChange={e => setRoutine(e.target.value)} disabled={unavailable}>
      <option value="">Todas as rotinas</option>{data?.routines.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select></label></div>
    <div className="operacoes-rotinas-contadores">
      <button type="button" className="operacoes-quadro" disabled={unavailable} aria-haspopup="dialog" onClick={() => open('enabled')}><span>Habilitadas</span><strong>{unavailable ? '—' : count(true)}</strong></button>
      <button type="button" className="operacoes-quadro" disabled={unavailable} aria-haspopup="dialog" onClick={() => open('disabled')}><span>Não habilitadas</span><strong>{unavailable ? '—' : count(false)}</strong></button>
    </div>
    {pending && <p role="status">Carregando rotinas…</p>}
    {(error || companyError) && <p role="alert">{error || companyError} {retryButton}</p>}
    {!unavailable && rows.some(c => !c.known) && <p role="status">Algumas empresas não têm configuração disponível nesta leitura.</p>}
    {!unavailable && rows.some(c => c.unavailableReason) && <p role="status">Empresas com regime não confirmado ficam fora das contagens. Confira o regime no cadastro dessas empresas.</p>}
    {group && <Modal titulo={group === 'enabled' ? 'Empresas habilitadas' : 'Empresas não habilitadas'} aoFechar={() => setGroup(null)} tamanho="md" className="operacoes-dialogo" rodape={<Button variant="secondary" onClick={() => setGroup(null)}>Fechar</Button>}>
      <div className="operacoes"><label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {unavailable ? <div><p role={error || companyError ? "alert" : "status"}>{pending || loading ? "Atualizando empresas e rotinas…" : error || companyError || "Configuração indisponível. Atualize as rotinas para conferir as empresas."}</p>{retryButton}</div> : <ul className="operacoes-lista-modal">{visible.map(c => <li key={c.companyId}>
          <div><InternalLink href={companyTabPath(c.companyId, 'cadastro')}>{name(c)}</InternalLink><small>{c.cnpj}</small></div>
          <InternalLink className="btn btn-secondary btn-sm" href={companyTabPath(c.companyId, 'automacao')}>Configurar rotinas</InternalLink>
        </li>)}{!visible.length && <li>Nenhuma empresa neste filtro.</li>}</ul>}
      </div>
    </Modal>}
  </section>;
}
