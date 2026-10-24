import { marcadorProcuracao } from '../fiscal/serpro/lib/procuracao';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';

const name = c => c.razao || c.razaoSocial || c.nome || c.cnpj || 'Empresa';

export function OperationsRoutineCompanies({ api, companies = [], competencia, loading = false, error: companyError, onRefreshCompanies }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [pending, setPending] = useState(true);
  const [group, setGroup] = useState(null), [query, setQuery] = useState(''), [routine, setRoutine] = useState('');
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
  const enabled = c => routine ? c.keys?.includes(routine) : c.keys?.length > 0;
  const applicable = c => c.known && !c.unavailableReason && (c.applicableKeys ? (routine ? c.applicableKeys.includes(routine) : c.applicableKeys.length > 0) : true);
  const count = state => rows.filter(c => applicable(c) && enabled(c) === state).length;
  const procura = key => rows.filter(c => marcadorProcuracao(c.serproStatus).chave === key);
  const consultaItems = competencia && consultas?.competencia === competencia && Array.isArray(consultas?.items) ? consultas.items.filter(item => rows.some(c => c.companyId === item.companyId)) : null;
  const source = group === 'procUnknown' ? rows.filter(c => !['ativa', 'regularizar'].includes(marcadorProcuracao(c.serproStatus).chave)) : group === 'procEnabled' ? procura('ativa') : group === 'procDisabled' ? procura('regularizar') : rows.filter(c => applicable(c) && enabled(c) === (group === 'enabled'));
  const visible = source.filter(c => `${name(c)} ${c.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const open = state => { setGroup(state); setQuery(''); };
  return <section className="operacoes-rotinas-resumo" aria-label="Empresas nas rotinas">
    <div className="operacoes-cabecalho"><h3>Consultas</h3><label>Rotina <select value={routine} onChange={e => setRoutine(e.target.value)} disabled={unavailable}>
      <option value="">Todas as rotinas</option>{data?.routines.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select></label></div>
    <div className="operacoes-rotinas-contadores">
      <button type="button" className="operacoes-quadro" disabled={unavailable} aria-haspopup="dialog" onClick={() => open('enabled')}><span>Habilitadas</span><strong>{unavailable ? '—' : count(true)}</strong></button>
      <button type="button" className="operacoes-quadro" aria-label={`Rotinas: Não habilitadas ${unavailable ? '—' : count(false)}`} disabled={unavailable} aria-haspopup="dialog" onClick={() => open('disabled')}><span>Não habilitadas</span><strong>{unavailable ? '—' : count(false)}</strong></button>
      <button type="button" className="operacoes-quadro" disabled={loading || !!companyError || !consultaItems}
        onClick={() => open('errors')}><span>Erros</span><strong className="operacoes-erro">{consultaItems ? consultaItems.length : '—'}</strong><small>consultas com erro</small></button>
      <div className="operacoes-quadro"><span>Empresas com procuração</span><div className="operacoes-procuracoes" role="group" aria-label="Procurações">
        <button type="button" disabled={loading || !!companyError} onClick={() => open('procEnabled')}>Habilitadas <strong>{loading || companyError ? '—' : procura('ativa').length}</strong></button>
        <button type="button" disabled={loading || !!companyError} onClick={() => open('procDisabled')}>Não habilitadas <strong>{loading || companyError ? '—' : procura('regularizar').length}</strong></button>
      </div><button type="button" className="operacoes-procuracao-incerta" disabled={loading || !!companyError} onClick={() => open('procUnknown')}>{loading || companyError ? '—' : rows.filter(c => !['ativa','regularizar'].includes(marcadorProcuracao(c.serproStatus).chave)).length} a verificar</button></div>
    </div>
    {consultaError && <p role={api?.getOperationConsultas ? 'alert' : 'status'}>{consultaError} {api?.getOperationConsultas && <Button size="sm" variant="secondary" onClick={() => setConsultaRetry(n => n + 1)}>Atualizar erros de consultas</Button>}</p>}
    {pending && <p role="status">Carregando rotinas…</p>}
    {(error || companyError) && <p role="alert">{error || companyError} {retryButton}</p>}
    {!unavailable && rows.some(c => !c.known) && <p role="status">Algumas empresas não têm configuração disponível nesta leitura.</p>}
    {!unavailable && rows.some(c => c.unavailableReason) && <p role="status">Empresas com regime não confirmado ficam fora das contagens. Confira o regime no cadastro dessas empresas.</p>}
    {group && <Modal titulo={group === 'errors' ? 'Consultas com erro' : group === 'procUnknown' ? 'Procuração a verificar' : group === 'procEnabled' ? 'Procuração habilitada' : group === 'procDisabled' ? 'Procuração não habilitada' : group === 'enabled' ? 'Empresas habilitadas' : 'Empresas não habilitadas'} aoFechar={() => setGroup(null)} tamanho="md" className="operacoes-dialogo" rodape={<Button variant="secondary" onClick={() => setGroup(null)}>Fechar</Button>}>
      <div className="operacoes"><label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {group === 'errors' ? <><p>Competência {competencia} · último resultado efetivo da mesma consulta SERPRO. Recusas e tentativas incertas não resolvem erros anteriores. Não inclui chamadas sem competência registrada nem emissão, transmissão ou envio.</p>
          {!consultaItems || loading || companyError ? <p role="alert">{consultaError || companyError || 'Carregando consultas…'}</p> : <ul className="operacoes-lista-modal">{consultaItems.filter(item => `${name(rows.find(c => c.companyId === item.companyId))} ${rows.find(c => c.companyId === item.companyId)?.cnpj || ''}`.toLowerCase().includes(query.toLowerCase())).map(item =>
            <li key={item.id}><div><strong>{name(rows.find(c => c.companyId === item.companyId))}</strong><small>{item.action} · {item.errorMessage || 'Erro sem detalhe registrado'}</small>{item.tentativaPosterior && <small>{item.tentativaPosterior.situacao === 'incerta' ? 'Tentativa posterior com resultado incerto' : item.tentativaPosterior.situacao === 'em_processamento' ? 'Tentativa posterior em processamento' : 'Tentativa posterior bloqueada'} · erro anterior preservado</small>}</div>
              <InternalLink href={companyTabPath(item.companyId, 'automacao') + '?competencia=' + encodeURIComponent(competencia)}>Configurar consultas</InternalLink></li>)}</ul>}
          {consultaItems?.length === 0 && <p>Nenhuma consulta com erro neste recorte.</p>}
        </> : (group.startsWith('proc') ? loading || companyError : unavailable) ? <div><p role={error || companyError ? "alert" : "status"}>{pending || loading ? "Atualizando empresas e rotinas…" : error || companyError || "Configuração indisponível. Atualize as rotinas para conferir as empresas."}</p>{retryButton}</div> : <ul className="operacoes-lista-modal">{visible.map(c => <li key={c.companyId}>
          <div><InternalLink href={companyTabPath(c.companyId, 'cadastro')}>{name(c)}</InternalLink><small>{c.cnpj}</small></div>
          <InternalLink className="btn btn-secondary btn-sm" href={companyTabPath(c.companyId, 'automacao')}>Configurar rotinas</InternalLink>
        </li>)}{!visible.length && <li>Nenhuma empresa neste filtro.</li>}</ul>}
      </div>
    </Modal>}
  </section>;
}
