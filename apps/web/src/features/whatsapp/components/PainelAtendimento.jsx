import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

export function PainelAtendimento({ children }) {
  const [aberto, setAberto] = useState(false);
  const abrirRef = useRef(null);
  const fecharRef = useRef(null);
  useEffect(() => { if (aberto) fecharRef.current?.focus(); }, [aberto]);
  function fechar() { setAberto(false); abrirRef.current?.focus(); }
  return <>
    <div className="wa-lead-toolbar"><span>Dados do interessado e vínculo com empresa</span>
      <Button ref={abrirRef} variant="secondary" size="sm" aria-expanded={aberto} onClick={() => setAberto(true)}>Atendimento e cadastro</Button>
    </div>
    <aside hidden={!aberto} className="wa-lead-panel" aria-label="Atendimento e cadastro" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } }}>
      <div className="wa-section-heading"><h2>Atendimento e cadastro</h2><Button ref={fecharRef} variant="secondary" size="sm" onClick={fechar} aria-label="Fechar atendimento e cadastro">Fechar</Button></div>
      {children}
    </aside>
  </>;
}
