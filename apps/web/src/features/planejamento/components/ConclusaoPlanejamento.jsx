import { useId } from "react";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
export function ConclusaoPlanejamento({ value = {}, onChange }) {
  const id = useId();
  return <SecaoPlanejamento titulo="Conclusão do contador e próxima revisão">
    <label htmlFor={`${id}-texto`} style={{ display: "grid", gap: 6, margin: "12px 0" }}>Conclusão, condições e ações recomendadas
      <textarea id={`${id}-texto`} rows={4} maxLength={4000} value={value.texto || ""} onChange={e => onChange({ ...value, texto: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
    </label>
    <label htmlFor={`${id}-data`}>Data da próxima revisão <input id={`${id}-data`} type="date" value={value.revisarEm || ""} onChange={e => onChange({ ...value, revisarEm: e.target.value })} /></label>
    <p style={{ fontSize: ".8rem" }}>Estes campos acompanham o cenário salvo e o relatório. A data registra o planejamento da revisão; não agenda notificações.</p>
  </SecaoPlanejamento>;
}
