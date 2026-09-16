import { useState } from "react";
import "./planejamentoAvancado.css";
export function SecaoPlanejamento({ titulo, children }) {
  const [aberto, setAberto] = useState(false);
  return <details className="planejamento-avancado" data-print-hide open={aberto} style={{ border: "1px solid #44475A", borderRadius: 8, padding: 12 }}>
    <summary style={{ cursor: "pointer" }} onClick={e => { e.preventDefault(); setAberto(v => !v); }}>{titulo}</summary>
    {aberto ? children : null}
  </details>;
}
