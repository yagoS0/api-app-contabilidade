import React from "react";

/**
 * Captura erros de runtime em componentes filhos e exibe stack trace na tela
 * em vez de deixar a página em branco. Usar quando há suspeita de bug de render.
 */

// ─── CHUNK VELHO DEPOIS DE DEPLOY ─────────────────────────────────────────────────────────────
// As abas pesadas entram por `lazy(() => import(...))`, e o Vite carimba um HASH no nome do
// arquivo. Quem estava com o app ABERTO durante um deploy tem em memória um `index.js` que aponta
// para `renderSitfisTab-a3fa3298.js`; o build novo gerou outro hash e o antigo não existe mais →
// 404 → "Failed to fetch dynamically imported module".
//
// Não é bug de componente: é a versão da página que envelheceu. Antes isso caía aqui como erro de
// runtime, com stack trace vermelho e um "Tentar novamente" que **não resolvia** — ele só limpava o
// estado e o mesmo `lazy` falhava de novo. A única saída era o usuário adivinhar o Ctrl+Shift+R.
//
// Acontece em TODO deploy, para todo mundo que estiver com o app aberto.
const PADROES_CHUNK_VELHO = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,   // Safari
  /chunkloaderror/i,
];
const CHAVE_RECARGA = "app:recarga-por-chunk-velho";
// Janela curta: se recarregar e o erro voltar em seguida, o problema NÃO é versão velha (deploy
// quebrado, arquivo faltando, rede caindo). Recarregar de novo viraria laço infinito.
const JANELA_ANTI_LOOP_MS = 15000;

function ehChunkVelho(error) {
  const msg = String(error?.message || error || "");
  return PADROES_CHUNK_VELHO.some((re) => re.test(msg));
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, chunkVelho: false };
  }

  static getDerivedStateFromError(error) {
    return { error, chunkVelho: ehChunkVelho(error) };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);

    if (!ehChunkVelho(error)) return;
    let ultima = 0;
    try { ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) || 0); } catch { /* modo privado */ }
    if (Date.now() - ultima < JANELA_ANTI_LOOP_MS) return; // já tentou agora há pouco: mostra o aviso
    try { sessionStorage.setItem(CHAVE_RECARGA, String(Date.now())); } catch { /* idem */ }
    // `reload(true)` não existe mais nos browsers modernos; o navegador revalida o index.html e
    // pega o manifesto novo, que é o que basta.
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;

    // Versão velha da página: assunto do usuário, não do desenvolvedor. Nada de stack trace.
    if (this.state.chunkVelho) {
      return (
        <div style={{
          padding: "24px", margin: "24px auto", maxWidth: 560, textAlign: "center",
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10,
          color: "var(--text)", fontFamily: "system-ui, sans-serif",
        }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "1.05rem" }}>O aplicativo foi atualizado</h2>
          <p style={{ margin: "0 0 16px", fontSize: "0.9rem", color: "var(--text-muted)" }}>
            Esta aba estava aberta durante uma atualização e ficou com a versão anterior. Recarregue
            para continuar — nenhum dado foi perdido.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px", background: "var(--success-cta)", color: "var(--success-cta-text)",
              border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700,
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }

    const message = this.state.error?.message || String(this.state.error);
    const stack = this.state.error?.stack || "";
    const componentStack = this.state.info?.componentStack || "";

    return (
      <div style={{
        padding: "24px", margin: "24px auto", maxWidth: 900,
        background: "#3d1515", border: "2px solid #7f1d1d", borderRadius: 8,
        color: "#fee2e2", fontFamily: "system-ui, sans-serif",
      }}>
        <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem", color: "#fca5a5" }}>
          ⚠ Erro de runtime no componente
        </h2>
        <div style={{ marginBottom: 12 }}>
          <strong>Mensagem:</strong>
          <pre style={{
            margin: "4px 0 0", padding: "8px 10px", background: "#1f0a0a",
            borderRadius: 4, color: "#fecaca", fontSize: "0.85rem",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{message}</pre>
        </div>
        {stack && (
          <details open style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Stack trace</summary>
            <pre style={{
              margin: "8px 0 0", padding: "8px 10px", background: "#1f0a0a",
              borderRadius: 4, color: "#fecaca", fontSize: "0.75rem",
              whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 300,
            }}>{stack}</pre>
          </details>
        )}
        {componentStack && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Component stack</summary>
            <pre style={{
              margin: "8px 0 0", padding: "8px 10px", background: "#1f0a0a",
              borderRadius: 4, color: "#fecaca", fontSize: "0.75rem",
              whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 300,
            }}>{componentStack}</pre>
          </details>
        )}
        <button
          onClick={() => this.setState({ error: null, info: null, chunkVelho: false })}
          style={{
            marginTop: 12, padding: "6px 12px", background: "#7f1d1d", color: "white",
            border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600,
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
