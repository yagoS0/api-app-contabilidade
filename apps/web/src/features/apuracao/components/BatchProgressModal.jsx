// Q15.7 — Modal de progresso da fila de transmissão em lote.
// Faz polling em GET /firm/apuracao/batch/:jobId até concluir.
import { recusaDeAcesso } from "../../accounting/parcelamento/lib/recusaDeAcesso";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { PANEL, fmtMoney } from "../../notas/components/notasStyles";

const STATUS_COR = { ok: "var(--success)", erro: "var(--danger)", pendente: PANEL.muted, processando: "var(--accent-cyan)" };

export function BatchProgressModal({ api, jobId, onClose, onDone }) {
  const [erroLeitura, setErroLeitura] = useState(null);
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const out = await api.getApuracaoBatch(jobId);
        if (!alive) return;
        setErroLeitura(null);
        setJob(out?.job || null);
        setItems(out?.items || []);
        if (out?.job?.status === "completed") {
          clearInterval(timer.current);
          onDone?.();
        }
      } catch (e) { if (alive) setErroLeitura(recusaDeAcesso(e?.message) || e?.message || recusaDeAcesso(e?.code) || "Não foi possível atualizar o acompanhamento."); }
    }
    poll();
    timer.current = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(timer.current); };
  }, [api, jobId, onDone]);

  // O processamento pertence ao servidor. Abrir o acompanhamento só lê o resultado.

  const total = job?.totalEmpresas || items.length || 0;
  const feito = (job?.okCount || 0) + (job?.errorCount || 0);
  const pct = total > 0 ? Math.round((feito / total) * 100) : 0;

  return (
    <Modal titulo="Transmissão em lote" aoFechar={onClose} tamanho="md" rodape={<Button variant="secondary" onClick={onClose}>{job?.status === "completed" ? "Fechar" : "Continuar em segundo plano"}</Button>}>
      <div style={{ display: "grid", gap: 16, overflowWrap: "anywhere" }}>
        {erroLeitura && <div role="alert" style={{ color: "var(--state-danger)", fontSize: ".875rem" }}>{erroLeitura} O resultado da transmissão ainda precisa ser conferido.</div>}
        {/* Progress bar: sem leitura válida, zero não é resultado. */}
        {!job && !erroLeitura && <div role="status">Carregando acompanhamento…</div>}
        {job && <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: PANEL.muted, marginBottom: 4 }}>
            <span>{feito}/{total} processadas</span>
            <span>{job?.status === "completed" ? "✓ concluído" : erroLeitura ? "atualização indisponível" : "processando…"}</span>
          </div>
          <div role="progressbar" aria-label="Empresas processadas" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={feito} style={{ height: 10, background: PANEL.field, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--success)", transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: "0.8125rem", marginTop: 6 }}>
            <span style={{ color: "var(--success)" }}>✓ {job?.okCount || 0} ok</span>
            <span style={{ color: "var(--danger)" }}>✕ {job?.errorCount || 0} erro</span>
            <span style={{ color: PANEL.muted }}>⏳ {job?.pendenteCount || 0} pendente</span>
          </div>
        </div>}

        {/* Lista por empresa */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it) => (
            <div key={it.portalClientId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: 8, background: PANEL.field, borderRadius: 6, fontSize: "0.82rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflowWrap: "anywhere", fontWeight: 500 }}>{it.razao}</div>
                {it.erroMensagem && <div style={{ fontSize: "0.8125rem", color: "var(--danger)" }}>{it.erroMensagem}</div>}
                {it.numeroDeclaracao && <div style={{ fontSize: "0.8125rem", color: PANEL.muted }}>decl. {it.numeroDeclaracao}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {it.dasValor != null && <div style={{ fontSize: "0.8125rem", color: PANEL.muted }}>{fmtMoney(it.dasValor)}</div>}
                <span style={{ color: STATUS_COR[it.status] || PANEL.muted, fontWeight: 600, fontSize: "0.78rem" }}>{it.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
