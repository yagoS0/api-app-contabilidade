// Q14.2.e — Modal pra resolver uma pendência (ITEM_SEM_REGRA por enquanto).
import { useState } from "react";
import { PANEL } from "../../notas/components/notasStyles";

const TIPOS_RECEITA = [
  { value: "REVENDA_MERCADORIA",  label: "Revenda de mercadoria (Anexo I)" },
  { value: "INDUSTRIALIZACAO",     label: "Industrialização (Anexo II)" },
  { value: "SERVICO_ANEXO_III",    label: "Serviço — Anexo III (sem Fator R)" },
  { value: "SERVICO_ANEXO_IV",     label: "Serviço — Anexo IV (construção/advocacia/etc)" },
  { value: "SERVICO_ANEXO_V",      label: "Serviço — Anexo V puro (raro)" },
  { value: "SERVICO_FATOR_R",      label: "Serviço — Fator R (III↔V mensal) ★" },
];

const CONF_COLOR = { alta: "var(--success)", media: "#FFB347", baixa: "#8BE9FD" };
const CONF_LABEL = { alta: "alta", media: "média", baixa: "baixa" };

export function ResolverPendenciaModal({ pendencia, onResolver, onClose, saving }) {
  const detalhes = pendencia.detalhes || {};
  const codigo = detalhes.codigo || "?";
  const tipoCodigo = detalhes.tipoCodigo || "?";
  const ocorrencias = detalhes.ocorrencias || 0;
  // Q20: recomendação ancorada no CNAE → atividade SERPRO (sugestão, não chuta).
  const rec = detalhes.recomendacao || null;

  // Pré-seleciona o tipoReceita sugerido (se houver) — o contador confirma.
  const [tipoReceita, setTipoReceita] = useState(rec?.tipoReceitaSugerido || "");
  const [criarRegra, setCriarRegra] = useState(true);
  const [nomeProduto, setNomeProduto] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!tipoReceita) return;
    await onResolver({
      tipoReceita,
      criarRegra,
      nomeProduto: nomeProduto.trim() || undefined,
    });
  }

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}
        style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 22, width: "min(92vw, 560px)", display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
          📋 Classificar pendência
        </div>
        <div style={{ background: PANEL.field, padding: 12, borderRadius: 6, fontSize: "0.85rem" }}>
          <div><strong>Código:</strong> <code style={{ color: "#8BE9FD" }}>{tipoCodigo}:{codigo}</code></div>
          <div><strong>Ocorrências:</strong> {ocorrencias} nota(s) com esse código</div>
          {pendencia.competencia && <div><strong>Competência:</strong> {pendencia.competencia}</div>}
        </div>

        {/* Q20: recomendação (atividade SERPRO via CNAE) + confiança */}
        {rec && (
          <div style={{ background: "rgba(139,233,253,0.08)", border: `1px solid ${CONF_COLOR[rec.confianca] || PANEL.border}`, padding: 12, borderRadius: 6, fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong>Recomendação</strong>
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: CONF_COLOR[rec.confianca] || PANEL.muted, border: `1px solid ${CONF_COLOR[rec.confianca] || PANEL.border}`, borderRadius: 999, padding: "1px 8px" }}>
                confiança {CONF_LABEL[rec.confianca] || rec.confianca}
              </span>
            </div>
            {rec.atividade ? (
              <div>Atividade SERPRO: <strong>{rec.atividade.descricao}</strong> <span style={{ color: PANEL.muted }}>(#{rec.atividade.idAtividade} · Anexo {rec.atividade.anexoImplicito}{rec.atividade.sujeitoFatorR ? " ★FR" : ""})</span></div>
            ) : rec.ambiguo ? (
              <div style={{ color: PANEL.muted }}>Candidatos: {(rec.candidatos || []).join(", ") || "—"}</div>
            ) : null}
            <div style={{ color: PANEL.muted, fontSize: "0.72rem" }}>{rec.motivo}</div>
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Tipo de Receita:
          <select value={tipoReceita} onChange={(e) => setTipoReceita(e.target.value)} required
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }}>
            <option value="">— Escolha —</option>
            {TIPOS_RECEITA.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <span style={{ fontSize: "0.7rem", color: PANEL.muted }}>
            ★ Fator R = serviços intelectuais; sistema decide III ou V mensalmente conforme folha/RBT12
          </span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
          <input type="checkbox" checked={criarRegra} onChange={(e) => setCriarRegra(e.target.checked)} />
          Salvar como regra desta empresa (próximas notas com mesmo código classificam sozinhas)
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Nome do produto/serviço (opcional, cria entrada nomeada no catálogo):
          <input type="text" value={nomeProduto} onChange={(e) => setNomeProduto(e.target.value)}
            placeholder="ex: Confecção de páginas web"
            style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px" }} />
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer", fontSize: "0.85rem" }}>
            Cancelar
          </button>
          <button type="submit" disabled={saving || !tipoReceita}
            style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: tipoReceita ? "#BD93F9" : PANEL.border, color: "#000", cursor: tipoReceita ? "pointer" : "not-allowed", fontSize: "0.85rem", fontWeight: 600 }}>
            {saving ? "Resolvendo…" : "✓ Resolver pendência"}
          </button>
        </div>
      </form>
    </div>
  );
}
