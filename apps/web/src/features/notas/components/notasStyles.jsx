import { PANEL, ESTADO_COLORS, syncStaleness } from "./notasStyles.shared.js";
// Q12.A.4: paleta + util pra badges de estado.
//
// ⚠ ESTE ARQUIVO É A ALAVANCA DA PALETA: 20 arquivos o importam (notas, apuração, apuracao-v2).
// Repontar os valores para `var(--…)` de `styles/tokens.css` propaga o visual por todos eles sem
// tocar em nenhum consumidor. Não voltar a escrever hex aqui — foi assim que o app acumulou dois
// vermelhos e quatro cinzas de texto concorrentes.





export function StateBadge({ estado }) {
  const c = ESTADO_COLORS[estado] || ESTADO_COLORS.aberto;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 12,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      fontSize: "0.75rem", fontWeight: 500,
    }}>
      <span>{c.icon}</span> {c.label}
    </span>
  );
}





// Q12.B+++.7: detecta staleness do cursor (último sync).
// Importante porque ADN/SEFAZ tem 2 regras:
// - CNPJ inativo 60+ dias perde geração de NSU (NT 2014.002 v1.10)
// - Janela de 90 dias na SEFAZ — notas mais antigas que isso são irrecuperáveis
// Por isso alertamos:
//   30-60 dias = warn (preventivo)
//   60+ dias = danger (já perdendo histórico)


export function StalenessBadge({ lastSyncAt, label = "Última sync" }) {
  const s = syncStaleness(lastSyncAt);
  let bg = "transparent", color = PANEL.muted, text = "—";
  if (s.level === "ok" && s.days != null) {
    color = PANEL.text;
    text = s.days === 0 ? "hoje" : s.days === 1 ? "ontem" : `${s.days} dias atrás`;
  } else if (s.level === "warn") {
    bg = "rgba(255,179,71,0.15)"; color = "#FFB347";
    text = `⚠ há ${s.days} dias`;
  } else if (s.level === "danger") {
    bg = "rgba(255,71,87,0.15)"; color = "var(--danger)";
    text = `🔴 há ${s.days} dias (risco perder NSU)`;
  } else {
    text = "nunca";
  }
  return (
    <span title={label} style={{
      padding: bg !== "transparent" ? "2px 6px" : 0, borderRadius: 4,
      background: bg, color, fontWeight: (s.level === "danger" || s.level === "warn") ? 600 : 400,
    }}>
      {text}
    </span>
  );
}
