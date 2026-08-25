// ⚠⚠ ÓRFÃO — NENHUM ARQUIVO DESTE APP IMPORTA `CompetenciaDetailPanel`. Medido em 24/08/2026 por
// varredura do nome exportado em todo o `src`, testes inclusive: **zero consumidores**.
// Último commit que o tocou: 8f35c197 (09/08/2026).
//
// O detalhe de uma competência de notas. A aba Notas Fiscais foi ENXUGADA em 23/08/2026 (duas janelas, sem stats nem legendas) e este painel ficou de fora do desenho novo.
//
// ⚠⚠ **ELE NÃO FOI APAGADO, E ISSO É DELIBERADO.** A decisão está escrita neste projeto, a
// propósito do `DefisNaoDevida.jsx`, que ficou no mesmo estado quando o dono mandou tirar a legenda
// da DEFIS: *"não foi apagado — apagar componente é decisão à parte"*. Apagar é irreversível na
// leitura de quem vier depois (some da árvore, some da busca), e "ninguém importa" não é o mesmo que
// "ninguém quer": pode ser tela adiada, pode ser desenho recusado.
//
// ⚠ O que ESTE aviso resolve é o silêncio. Sem ele o arquivo parece vivo — aparece na busca, entra
// nas varreduras, e alguém o "conserta" achando que está consertando uma tela.
//
// **Para o dono:** apagar ou reconectar é decisão sua. Os cinco órfãos estão listados juntos em
// `apps/web/CLAUDE.md`, seção "OS CINCO ÓRFÃOS".

import { Button } from "../../../components/ui/Button";
import { PANEL, StateBadge, fmtMoney, fmtDate } from "./notasStyles";

function Field({ label, value, mono }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: "0.9rem", color: PANEL.text, fontFamily: mono ? "monospace" : undefined }}>{value}</span>
    </div>
  );
}

export function CompetenciaDetailPanel({ comp, saving, onFechar, onReabrir, onClose }) {
  if (!comp) return null;
  return (
    <section style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", color: PANEL.text }}>
          Competência {comp.competencia} <StateBadge estado={comp.estado} />
        </h3>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Field label="Notas capturadas" value={comp.notasCount ?? 0} />
        <Field label="RB12 (móvel)" value={fmtMoney(comp.rb12)} />
        <Field label="FS12" value={fmtMoney(comp.fs12Manual)} />
        <Field label="FS12 origem" value={comp.fs12Origem || "—"} />
        <Field label="Fator R" value={comp.fatorR != null ? `${(Number(comp.fatorR) * 100).toFixed(2)}%` : "—"} />
        <Field label="Pendências" value={comp.pendenciasAbertas ?? 0} />
        <Field label="Fechada em" value={fmtDate(comp.lockedAt)} />
        <Field label="Reaberta em" value={fmtDate(comp.reopenedAt)} />
      </div>

      {comp.reopenedReason && (
        <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", color: "#FFB347" }}>
          <strong>Motivo da última reabertura:</strong> {comp.reopenedReason}
        </div>
      )}

      <div style={{ padding: 12, background: PANEL.field, borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", color: PANEL.muted }}>
        📄 <strong style={{ color: PANEL.text }}>Notas ({comp.notasCount ?? 0})</strong> —
        a listagem detalhada das notas captadas entra na Q12.B (worker DFe + ADN).
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {/* Mesmo motivo do `CompetenciasTable`: ciano/âmbar aqui eram estado usado como cor de ação. */}
        {(comp.estado === "aberto" || comp.estado === "em_conferencia") && (
          <Button onClick={() => onFechar(comp.competencia)} disabled={saving}>
            🔒 Fechar competência
          </Button>
        )}
        {["fechado","calculado","revisado","transmitido","confirmado","erro"].includes(comp.estado) && (
          <Button onClick={() => onReabrir(comp.competencia)} disabled={saving}>
            🔓 Reabrir competência
          </Button>
        )}
      </div>
    </section>
  );
}
