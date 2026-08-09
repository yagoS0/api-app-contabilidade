// Trilha de passos do wizard — molde do `EmitirNfseWizard`.
//
// Cores (regra de ouro do `tokens.css`):
//  - vencido  → `✓` em `--state-ok` (uso canônico do verde: concluído)
//  - atual    → `--accent-purple` (a cor de foco/seleção do sistema)
//  - futuro   → `--text-faint`
//  - pendência no passo → ponto em `--state-warn`, NUNCA `--state-danger`: nada aqui bloqueia
//    fechamento contábil, e o token diz que vermelho é só para isso.

export function TrilhaPassos({ passos, passoAtual, pendenciasPorPasso = {}, onIr }) {
  const indiceAtual = passos.findIndex((p) => p.chave === passoAtual);

  return (
    <nav
      aria-label="Etapas do cadastro"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-2)",
        marginBottom: "var(--space-5)",
      }}
    >
      {passos.map((passo, indice) => {
        const vencido = indice < indiceAtual;
        const atual = passo.chave === passoAtual;
        const temPendencia = (pendenciasPorPasso[passo.chave] || 0) > 0;

        const cor = vencido ? "var(--state-ok)" : atual ? "var(--accent-purple)" : "var(--text-faint)";
        const podeIr = typeof onIr === "function" && (vencido || atual);

        return (
          <div key={passo.chave} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <button
              type="button"
              onClick={podeIr ? () => onIr(passo.chave) : undefined}
              disabled={!podeIr}
              aria-current={atual ? "step" : undefined}
              title={temPendencia ? `${passo.titulo} — há campo obrigatório em branco` : passo.titulo}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${cor}`,
                background: atual ? "var(--bg-subtle)" : "transparent",
                color: cor,
                fontSize: 13,
                fontWeight: atual ? 700 : 500,
                cursor: podeIr ? "pointer" : "default",
              }}
            >
              <span aria-hidden="true">{vencido ? "✓" : indice + 1}</span>
              {passo.titulo}
              {temPendencia && (
                <span
                  aria-hidden="true"
                  title="há campo obrigatório em branco"
                  style={{
                    width: 6, height: 6, borderRadius: 999,
                    background: "var(--state-warn)", display: "inline-block",
                  }}
                />
              )}
              {temPendencia && (
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  há campo obrigatório em branco
                </span>
              )}
            </button>
            {indice < passos.length - 1 && (
              <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>›</span>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default TrilhaPassos;
