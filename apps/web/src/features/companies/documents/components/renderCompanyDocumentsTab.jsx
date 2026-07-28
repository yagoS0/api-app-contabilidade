// Aba Documentos da empresa: contrato social, cartão CNPJ, inscrições, alvará.
// Seleção múltipla + barra de ações (Baixar / Enviar por e-mail), no mesmo formato da barra única
// da aba Guias (Q57), que já resolveu esse padrão de "selecionei, e agora?".

import { useRef, useState } from "react";

const PANEL = {
  bg: "#282A36", border: "#44475A", text: "#F8F8F2", muted: "#8A8FA3", field: "#1F2029",
};

const btn = (cor = PANEL.border) => ({
  padding: "7px 12px", borderRadius: 8, border: `1px solid ${cor}`,
  background: "transparent", color: PANEL.text, fontSize: "0.8rem", cursor: "pointer",
});

function fmtBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function CompanyDocumentsTab({ docs }) {
  const {
    documentos, tipos, tipoLabels, carregando, enviando,
    selecionados, alternarSelecao, limparSelecao,
    enviarArquivo, baixar, baixarSelecionados, excluir, enviarPorEmail,
  } = docs;

  const inputRef = useRef(null);
  const [tipoNovo, setTipoNovo] = useState("CONTRATO_SOCIAL");
  const [subindo, setSubindo] = useState(false);

  const totalSelecionado = selecionados.size;

  async function aoEscolherArquivo(e) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo depois
    if (!arquivo) return;
    setSubindo(true);
    try {
      await enviarArquivo({ arquivo, tipo: tipoNovo, nome: arquivo.name });
    } finally {
      setSubindo(false);
    }
  }

  // Enviar sai do sistema e chega no cliente: confirma antes, dizendo quantos e quais.
  async function aoEnviar() {
    const nomes = documentos.filter((d) => selecionados.has(d.id)).map((d) => d.nome);
    const lista = nomes.map((n) => `• ${n}`).join("\n");
    if (!window.confirm(`Enviar ${nomes.length} documento(s) por e-mail ao cliente?\n\n${lista}`)) return;
    await enviarPorEmail();
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px", color: PANEL.text }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Documentos</h2>
        <span style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
          {carregando ? "carregando…" : `${documentos.length} documento(s)`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={tipoNovo}
            onChange={(e) => setTipoNovo(e.target.value)}
            style={{ ...btn(), background: PANEL.field }}
            aria-label="Tipo do documento a enviar"
          >
            {(tipos.length ? tipos : ["OUTRO"]).map((t) => (
              <option key={t} value={t}>{tipoLabels[t] || t}</option>
            ))}
          </select>
          <button type="button" style={btn("#69FF47")} disabled={subindo} onClick={() => inputRef.current?.click()}>
            {subindo ? "Enviando…" : "+ Adicionar documento"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={aoEscolherArquivo}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* Barra de ações: só aparece com algo selecionado — sem seleção não há ação possível. */}
      {totalSelecionado > 0 && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          padding: "10px 12px", marginBottom: 12, borderRadius: 8,
          background: "rgba(255,255,255,0.04)", border: `1px solid ${PANEL.border}`,
        }}>
          <strong style={{ fontSize: "0.82rem" }}>{totalSelecionado} selecionado(s)</strong>
          <button type="button" style={btn("#8BE9FD")} onClick={baixarSelecionados}>⬇ Baixar</button>
          <button type="button" style={btn("#69FF47")} disabled={enviando} onClick={aoEnviar}>
            {enviando ? "Enviando…" : "✉ Enviar por e-mail"}
          </button>
          <button type="button" style={{ ...btn(), marginLeft: "auto" }} onClick={limparSelecao}>Limpar seleção</button>
        </div>
      )}

      {!carregando && !documentos.length ? (
        <p style={{ color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhum documento guardado. Adicione o contrato social, o cartão CNPJ e as inscrições para
          tê-los à mão quando o cliente pedir.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: PANEL.muted, textAlign: "left" }}>
                <th style={{ padding: "8px 6px", width: 32 }} />
                <th style={{ padding: "8px 6px" }}>TIPO</th>
                <th style={{ padding: "8px 6px" }}>NOME</th>
                <th style={{ padding: "8px 6px" }}>TAMANHO</th>
                <th style={{ padding: "8px 6px" }}>VALIDADE</th>
                <th style={{ padding: "8px 6px" }}>ENVIADO EM</th>
                <th style={{ padding: "8px 6px" }} />
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                  <td style={{ padding: "8px 6px" }}>
                    <input
                      type="checkbox"
                      checked={selecionados.has(d.id)}
                      onChange={() => alternarSelecao(d.id)}
                      aria-label={`Selecionar ${d.nome}`}
                    />
                  </td>
                  <td style={{ padding: "8px 6px", color: PANEL.muted }}>{tipoLabels[d.tipo] || d.tipo}</td>
                  <td style={{ padding: "8px 6px" }}>{d.nome}</td>
                  <td style={{ padding: "8px 6px", color: PANEL.muted }}>{fmtBytes(d.bytes)}</td>
                  <td style={{ padding: "8px 6px", color: d.validade ? "#FFB347" : PANEL.muted }}>
                    {fmtData(d.validade)}
                  </td>
                  <td style={{ padding: "8px 6px", color: PANEL.muted }}>{fmtData(d.createdAt)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" style={btn("#8BE9FD")} onClick={() => baixar(d)}>Baixar</button>{" "}
                    <button
                      type="button"
                      style={btn("#FF4757")}
                      onClick={() => { if (window.confirm(`Excluir "${d.nome}"?`)) excluir(d); }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
