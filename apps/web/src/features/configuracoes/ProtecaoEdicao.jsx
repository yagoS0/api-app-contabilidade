import { useWorkspaceNavigation } from '../../app/navigation/WorkspaceNavigation.shared';
import { ContextoEdicao } from './ProtecaoEdicao.shared.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';


// Cada editor informa sua própria diferença em relação ao último valor salvo.
// Abrir uma tela ou receber uma atualização da API não marca o cadastro como alterado.
export function ProtecaoEdicao({ children }) {
  const workspace = useWorkspaceNavigation();
  return workspace ? <>{children}</> : <ProtecaoLocal>{children}</ProtecaoLocal>;
}
function ProtecaoLocal({ children }) {
  const editores = useRef(new Set());
  const generation = useRef(0), currentIntent = useRef(null), replayLink = useRef(null);
  const [pendente, setPendente] = useState(false);
  const [saida, setSaida] = useState(null);
  const registrar = useCallback((id, alterado) => {
    if (editores.current.has(id) !== Boolean(alterado)) generation.current++;
    if (alterado) editores.current.add(id);
    else editores.current.delete(id);
    setPendente(editores.current.size > 0);
  }, []);
  const confirmarSaida = useCallback((continuar) => {
    if (!editores.current.size) { continuar(); return; }
    const intent = { continuar, generation: generation.current };
    currentIntent.current = intent; setSaida(intent);
  }, []);
  function cancelar() { currentIntent.current = null; setSaida(null); }
  function confirmarTransicao() {
    if (!saida || currentIntent.current !== saida) return;
    if (saida.generation !== generation.current) { cancelar(); return; }
    const continuar = saida.continuar;
    cancelar();
    continuar(); // Does not clear registrations or claim remote cancellation.
  }
  useEffect(() => {
    if (!pendente) return;
    const avisar = (e) => { if (editores.current.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [pendente]);
  function conferirLink(e) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest?.('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    if (replayLink.current === link) { replayLink.current = null; return; }
    const destino = new URL(link.href, window.location.href);
    if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
    if (editores.current.size) {
      e.preventDefault(); e.stopPropagation();
      confirmarSaida(() => {
        replayLink.current = link;
        try { link.click(); } finally { replayLink.current = null; }
      });
    }
  }
  return <ContextoEdicao.Provider value={{ registrar, confirmarSaida }}>
    <div onClickCapture={conferirLink}>{children}</div>
    {saida && <Modal titulo="Alterações não salvas" tamanho="sm" aoFechar={cancelar}>
      <p>Há edição pendente. Sair pode perder edições locais. Gravações já iniciadas podem continuar e não serão canceladas. Esta confirmação não comprova salvamento nem descarte.</p>
      <Button onClick={cancelar}>Continuar editando</Button>{' '}
      <Button variant="secondary" onClick={confirmarTransicao}>Sair sem confirmação</Button>
    </Modal>}
  </ContextoEdicao.Provider>;
}
