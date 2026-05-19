import React from "react";

/**
 * Captura erros de runtime em componentes filhos e exibe stack trace na tela
 * em vez de deixar a página em branco. Usar quando há suspeita de bug de render.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

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
          onClick={() => this.setState({ error: null, info: null })}
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
