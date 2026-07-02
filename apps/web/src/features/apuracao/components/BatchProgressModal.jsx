// Q15.7 — Modal de progresso da fila de transmissão em lote.
// Faz polling em GET /firm/apuracao/batch/:jobId até concluir.
import { useEffect, useRef, useState } from "react";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

const STATUS_COR = { ok: "#69FF47", erro: "#FF4757", pendente: PANEL.muted, processando: "#8BE9FD" };

export function BatchProgressModal({ api, jobId, onClose, onDone }) {
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const out = await api.getApuracaoBatch(jobId);
        if (!alive) return;
        setJob(out?.job || null);
        setItems(out?.items || []);
        if (out?.job?.status === "completed") {
          clearInterval(timer.current);
          onDone?.();
        }
      } catch { /* mantém polling */ }
    }
    poll();
    timer.current = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(timer.current); };
  }, [api, jobId, onDone]);

  // Q44: "driver" — processa a fila sob demanda (o worker de fundo pode estar desligado; sem isto
  // o lote ficava "pendente" pra sempre). Chama run-now em loop até concluir. ⚠ transmite de verdade.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; alive && i < 60; i++) {
        let out;
        try { out = await api.runApuracaoBatch?.(jobId); } catch { break; }
        if (!alive || !out) break; // run-now indisponível → deixa o worker/poll cuidar
        const j = out.job;
        if (!j || j.status === "completed" || (j.pendenteCount || 0) === 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    return () => { alive = false; };
  }, [api, jobId]);

  const total = job?.totalEmpresas || items.length || 0;
  const feito = (job?.okCount || 0) + (job?.errorCount || 0);
  const pct = total > 0 ? Math.round((feito / total) * 100) : 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 22, width: "min(94vw, 640px)", maxHeight: "88vh", overflowY: "auto", color: PANEL.text, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>📤 Transmissão em lote</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: PANEL.muted, marginBottom: 4 }}>
            <span>{feito}/{total} processadas</span>
            <span>{job?.status === "completed" ? "✓ concluído" : "processando…"}</span>
          </div>
          <div style={{ height: 10, background: PANEL.field, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#69FF47", transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: "0.75rem", marginTop: 6 }}>
            <span style={{ color: "#69FF47" }}>✓ {job?.okCount || 0} ok</span>
            <span style={{ color: "#FF4757" }}>✕ {job?.errorCount || 0} erro</span>
            <span style={{ color: PANEL.muted }}>⏳ {job?.pendenteCount || 0} pendente</span>
          </div>
        </div>

        {/* Lista por empresa */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it) => (
            <div key={it.portalClientId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: 8, background: PANEL.field, borderRadius: 6, fontSize: "0.82rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.razao}</div>
                {it.erroMensagem && <div style={{ fontSize: "0.7rem", color: "#FF4757" }}>{it.erroMensagem}</div>}
                {it.numeroDeclaracao && <div style={{ fontSize: "0.7rem", color: PANEL.muted }}>decl. {it.numeroDeclaracao}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {it.dasValor != null && <div style={{ fontSize: "0.75rem", color: PANEL.muted }}>{fmtMoney(it.dasValor)}</div>}
                <span style={{ color: STATUS_COR[it.status] || PANEL.muted, fontWeight: 600, fontSize: "0.78rem" }}>{it.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
