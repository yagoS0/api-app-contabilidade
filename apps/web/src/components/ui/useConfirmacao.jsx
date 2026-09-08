import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

// Confirmação visual assíncrona. Fechar, Esc e desmontar equivalem a cancelar.
export function useConfirmacao() {
  const [pedido, setPedido] = useState(null);
  const resolver = useRef(null);
  useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);
  const pedir = useCallback((opcoes) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setPedido(opcoes);
  }), []);
  function responder(aceito) {
    resolver.current?.(aceito);
    resolver.current = null;
    setPedido(null);
  }
  const dialogo = pedido ? <div style={{ position: "relative", zIndex: 2000 }}><Modal titulo={pedido.titulo} tamanho="sm" aoFechar={() => responder(false)} rodape={<>
    <Button variant="secondary" onClick={() => responder(false)}>Cancelar</Button>
    <Button variant={pedido.perigo ? "danger" : "primary"} onClick={() => responder(true)}>{pedido.acao || "Confirmar"}</Button>
  </>}>
    <p style={{ whiteSpace: "pre-wrap" }}>{pedido.texto}</p>
    {pedido.itens?.length > 0 && <ul style={{ overflowWrap: "anywhere" }}>{pedido.itens.map((item, index) => <li key={index}>{item}</li>)}</ul>}
  </Modal></div> : null;
  return { pedir, dialogo };
}
