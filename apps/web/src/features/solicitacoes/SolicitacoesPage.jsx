import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageShell } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/Button';
import { useSolicitacoes } from './hooks/useSolicitacoes';
import { FiltrosSolicitacoes } from './components/FiltrosSolicitacoes';
import { TabelaSolicitacoes } from './components/TabelaSolicitacoes';
import './solicitacoes.css';

const erros = {
  sessao: 'Sessão expirada. Entre novamente para consultar as solicitações.',
  acesso: 'Acesso negado às solicitações deste escopo.',
  cursor: 'Esta posição da lista expirou ou o acesso mudou. Recomece pela primeira página.',
  falha: 'Não foi possível atualizar as solicitações.',
};

export function SolicitacoesPage({ api, usuario, onBack, posicoes }) {
  const location = useLocation();
  const navigate = useNavigate();
  const leitura = useSolicitacoes({ api, usuario, search: location.search });
  const localPositions = useRef(new Map());
  const positions = posicoes || localPositions.current;
  const scrollRef = useRef(null);
  const statusRef = useRef(null);
  const restored = useRef(null);
  const scope = useRef({ api, usuario });
  if (scope.current.api !== api || scope.current.usuario !== usuario) {
    localPositions.current.clear(); restored.current = null; scope.current = { api, usuario };
  }
  useEffect(() => {
    if (location.pathname !== '/solicitacoes') navigate({ pathname: '/solicitacoes', search: location.search }, { replace: true });
  }, [location.pathname, location.search, navigate]);
  useLayoutEffect(() => {
    if (!leitura.data || restored.current === location.search) return;
    const saved = positions.get(location.search);
    if (saved && scrollRef.current) { scrollRef.current.scrollTop = saved.top; scrollRef.current.scrollLeft = saved.left; }
    restored.current = location.search;
  }, [leitura.data, location.search, positions]);
  useEffect(() => { restored.current = null; }, [location.search]);
  function guardarPosicao() {
    if (scrollRef.current) positions.set(location.search, { top: scrollRef.current.scrollTop, left: scrollRef.current.scrollLeft });
  }
  function alterar(changes, paginacao = false) {
    guardarPosicao();
    const params = changes === null ? new URLSearchParams() : new URLSearchParams(location.search);
    if (!paginacao) params.delete('cursor');
    for (const [key, value] of Object.entries(changes || {})) {
      if (value === undefined) params.delete(key); else params.set(key, String(value));
    }
    navigate({ pathname: '/solicitacoes', search: params.toString() });
  }
  function executarComFoco(action) {
    // O botão de recuperação desaparece ao iniciar a leitura. O status existe
    // durante carga, sucesso e erro; focar somente neste gesto explícito evita
    // sequestrar o teclado quando a janela volta ao foco ou chega uma resposta.
    statusRef.current?.focus({ preventScroll: true });
    action();
  }
  const { data, error, loading, invalidos } = leitura;
  return <PageShell title="Solicitações" onBack={onBack} contentClassName="solicitacoes" actions={<Button variant="secondary" onClick={() => executarComFoco(leitura.carregar)} disabled={loading || invalidos.length > 0}>Atualizar</Button>}>
    <FiltrosSolicitacoes search={location.search} alterar={alterar} data={data} />
    <div ref={statusRef} tabIndex={-1} role="status" aria-label="Estado da consulta de solicitações" aria-live="polite" className="solicitacoes__status">
      {loading ? data ? 'Atualizando…' : 'Carregando solicitações…' : data ? `${data.total} solicitações no recorte selecionado · ${data.itens.length} nesta página${error ? ' · Dados desatualizados' : ''}` : ''}
    </div>
    {invalidos.length > 0 && <div role="alert">Filtro inválido na URL: {invalidos.join(', ')}. <Button variant="secondary" onClick={() => executarComFoco(() => alterar(null))}>Recomeçar consulta</Button></div>}
    {error && <div role="alert" className="solicitacoes__error">{erros[error]} {data && 'Os dados anteriores deste mesmo recorte estão desatualizados.'}
      {error === 'cursor' ? <Button variant="secondary" onClick={() => executarComFoco(() => alterar({ cursor: undefined }, true))}>Recomeçar pela primeira página</Button> : <Button variant="secondary" onClick={() => executarComFoco(leitura.carregar)}>Tentar novamente</Button>}
    </div>}
    {data && (data.itens.length ? <TabelaSolicitacoes data={data} scrollRef={scrollRef} onScroll={guardarPosicao} /> : <p>{data.total === 0 ? 'Nenhuma solicitação neste recorte.' : 'Nenhuma solicitação nesta posição. Volte à primeira página.'}</p>)}
    <nav className="solicitacoes__pagination" aria-label="Paginação das solicitações">
      <Button variant="secondary" disabled={!leitura.filtros.cursor || loading || invalidos.length > 0} onClick={() => executarComFoco(() => alterar({ cursor: undefined }, true))}>Primeira página</Button>
      <Button variant="secondary" disabled={!data?.proximoCursor || loading || Boolean(error) || invalidos.length > 0} onClick={() => executarComFoco(() => alterar({ cursor: data.proximoCursor }, true))}>Próxima página</Button>
    </nav>
  </PageShell>;
}
