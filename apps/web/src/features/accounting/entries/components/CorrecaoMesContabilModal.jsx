import { useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
export function CorrecaoMesContabilModal({ competencia, ocupado, erro, aoConfirmar, aoFechar }) {
  const [motivo, setMotivo] = useState("");
  return <Modal titulo="Corrigir mês fechado" tamanho="sm" ocupado={ocupado} aoFechar={aoFechar}>
    <form onSubmit={e => { e.preventDefault(); if (motivo.trim() && !ocupado) aoConfirmar(motivo.trim()); }} style={{ display: "grid", gap: 12 }}>
      <p>Competência {competencia}. Somente a contabilidade será reaberta. Declarações, guias, envios e pagamentos permanecem registrados.</p>
      <p>As alterações terão histórico e aviso até uma nova conferência do mês.</p>
      <label>Motivo da correção<textarea autoFocus required maxLength={2000} value={motivo} disabled={ocupado} onChange={e => setMotivo(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 100 }} /></label>
      {erro && <p role="alert">{erro}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button type="submit" disabled={ocupado || !motivo.trim()}>{ocupado ? "Salvando…" : "Corrigir mês fechado"}</Button><Button type="button" variant="secondary" disabled={ocupado} onClick={aoFechar}>Cancelar</Button></div>
    </form>
  </Modal>;
}
