import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';

const ContextoEdicao = createContext(null);

// Cada editor informa sua própria diferença em relação ao último valor salvo.
// Abrir uma tela ou receber uma atualização da API não marca o cadastro como alterado.
export function ProtecaoEdicao({ children }) {
  const editores = useRef(new Set());
  const [pendente, setPendente] = useState(false);
  const [saida, setSaida] = useState(null);
  const registrar = useCallback((id, alterado) => {
    if (alterado) editores.current.add(id);
    else editores.current.delete(id);
    setPendente(editores.current.size > 0);
  }, []);
  const confirmarSaida = useCallback((continuar) => {
    if (!editores.current.size) { continuar(); return; }
    setSaida(() => continuar);
  }, []);
  function descartar() {
    editores.current.clear();
    setPendente(false);
    setSaida(null);
    saida?.();
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
    const destino = new URL(link.href, window.location.href);
    if (destino.pathname === window.location.pathname && destino.search === window.location.search) return;
    if (editores.current.size) {
      e.preventDefault(); e.stopPropagation();
      confirmarSaida(() => link.click());
    }
  }
  return <ContextoEdicao.Provider value={{ registrar, confirmarSaida }}>
    <div onClickCapture={conferirLink}>{children}</div>
    {saida && <Modal titulo="Alterações não salvas" tamanho="sm" aoFechar={()=>setSaida(null)}>
      <p>Você tem alterações não salvas nesta configuração. Deseja descartá-las e sair?</p>
      <Button onClick={()=>setSaida(null)}>Continuar editando</Button>{' '}
      <Button variant="secondary" onClick={descartar}>Descartar e sair</Button>
    </Modal>}
  </ContextoEdicao.Provider>;
}

export function useEdicaoPendente(pendente) {
  const contexto = useContext(ContextoEdicao);
  const id = useId();
  const registrar = contexto?.registrar;
  useEffect(() => {
    registrar?.(id, Boolean(pendente));
    return () => registrar?.(id, false);
  }, [registrar, id, pendente]);
}

export function useConfirmarSaida() {
  return useContext(ContextoEdicao)?.confirmarSaida || ((continuar) => continuar());
}
