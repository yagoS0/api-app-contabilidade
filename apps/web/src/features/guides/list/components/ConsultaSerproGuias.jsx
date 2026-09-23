import { useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { useConfirmacao } from "../../../../components/ui/useConfirmacao";
import { formatCompetencia } from "../../../../lib/competencia";

export function ConsultaSerproGuias({ companyId, competencia, regime, onConsultar }) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const trava = useRef(false);
  const vivo = useRef(true);
  const menu = useRef(null);
  const { pedir, dialogo } = useConfirmacao();
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    const fechar = (e) => { if (!menu.current?.contains(e.target)) setAberto(false); };
    const tecla = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("pointerdown", fechar);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fechar); document.removeEventListener("keydown", tecla); };
  }, []);
  async function buscar(tipo) {
    if (trava.current || !companyId || !competencia) return;
    trava.current = true;
    setAberto(false);
    setOcupado(true);
    try {
      const ok = await pedir({ titulo: `Consultar ${tipo === "das" ? "DAS" : "INSS"}`, acao: "Consultar guia",
        texto: `Competência fiscal: ${formatCompetencia(competencia)}. A busca pode consumir consultas pagas no SERPRO. Documentos já disponíveis são reaproveitados quando possível. Esta ação busca a guia; não confirma pagamento e não força recálculo.` });
      if (ok && vivo.current) await onConsultar(tipo, companyId, competencia);
    } finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  const simples = String(regime || "").toUpperCase().includes("SIMPLES");
  return <>
    <div ref={menu} style={{ position: "relative" }}>
      <Button variant="secondary" size="sm" type="button" disabled={ocupado || !competencia}
        aria-expanded={aberto} onClick={() => setAberto(v => !v)}>{ocupado ? "Consultando…" : "Consultar SERPRO"}</Button>
      {aberto && <div style={{ position: "absolute", top: "100%", zIndex: 210, padding: 12, minWidth: 260, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, display: "grid", gap: 8 }}>
        <small>Competência fiscal: {formatCompetencia(competencia)}</small>
        <Button variant="secondary" onClick={() => buscar("das")} disabled={!simples}>Buscar DAS — Simples Nacional</Button>
        {!simples && <small>DAS disponível para empresas do Simples Nacional.</small>}
        <Button variant="secondary" onClick={() => buscar("inss")}>Buscar INSS — DCTFWeb</Button>
      </div>}
    </div>
    {dialogo}
  </>;
}
