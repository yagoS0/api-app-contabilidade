// Passo 1 — de onde o cliente vem. É a ÚNICA variável que muda o funil inteiro (perguntas, trilha
// do escritório e o que a conversão vai exigir).
//
// ⚠ NADA DE `${cor}22` para o fundo do cartão selecionado. Concatenar hex dentro de uma `var()`
// produz cor inválida que o browser descarta em SILÊNCIO — a proibição está escrita no
// `tokens.css`. Por isso a seleção é feita com BORDA no acento + régua de 3px à esquerda +
// `--bg-subtle`, em vez de exigir um token `-surface` novo por origem.

import { ONBOARDING_ORIGENS } from "../lib/onboardingSpec";

export function PassoOrigem({ origem, onEscolher }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <p style={{ color: "var(--text-muted)", margin: 0 }}>
        De onde vem este cliente? A resposta define o que perguntamos a seguir e a trilha do
        escritório.
      </p>

      {ONBOARDING_ORIGENS.map((op) => {
        const selecionada = origem === op.chave;
        const acento = `var(${op.acento})`;
        return (
          <button
            key={op.chave}
            type="button"
            onClick={() => onEscolher(op.chave)}
            aria-pressed={selecionada}
            style={{
              textAlign: "left",
              padding: "var(--space-4)",
              paddingLeft: "calc(var(--space-4) + 3px)",
              borderRadius: "var(--radius)",
              border: `1px solid ${selecionada ? acento : "var(--border)"}`,
              borderLeft: `3px solid ${selecionada ? acento : "var(--border)"}`,
              background: selecionada ? "var(--bg-subtle)" : "var(--bg-surface)",
              color: "var(--text)",
              cursor: "pointer",
              display: "grid",
              gap: 4,
            }}
          >
            <strong style={{ color: selecionada ? acento : "var(--text)", fontSize: 15 }}>
              {op.titulo}
            </strong>
            <span style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
              {op.subtitulo}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default PassoOrigem;
