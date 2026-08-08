// Aba Documentos da empresa: contrato social, cartão CNPJ, inscrições, alvará.
// Seleção múltipla + barra de ações (Baixar / Enviar por e-mail), no mesmo formato da barra única
// da aba Guias (Q57), que já resolveu esse padrão de "selecionei, e agora?".
//
// Houve uma área de arrastar-e-soltar aqui; foi REMOVIDA por não funcionar de forma confiável.
// O que sobreviveu dela — e vale manter — é a ordem: primeiro o arquivo, e só então a pergunta
// "qual documento é este?". Quem sobe um documento está com o arquivo na mão, não com a
// taxonomia na cabeça.

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
  const [subindo, setSubindo] = useState(false);
  // Fila de arquivos aguardando a pergunta "qual documento é este?". O tipo NÃO é escolhido antes:
  // quem arrasta um arquivo está com o arquivo na mão, não com a taxonomia na cabeça. O botão
  // segue o mesmo caminho — os dois caem aqui.
  const [fila, setFila] = useState([]);
  const [tipoAtual, setTipoAtual] = useState("CONTRATO_SOCIAL");
  const [nomeAtual, setNomeAtual] = useState("");

  const totalSelecionado = selecionados.size;
  const emFila = fila[0] || null;

  function enfileirar(arquivos) {
    const lista = [...(arquivos || [])].filter(Boolean);
    if (!lista.length) return;
    setFila(lista);
    setNomeAtual(lista[0].name);
    setTipoAtual("CONTRATO_SOCIAL");
  }

  function aoEscolherArquivo(e) {
    const arquivos = e.target.files;
    enfileirar(arquivos);
    e.target.value = ""; // permite reenviar o mesmo arquivo depois
  }

  async function confirmarDocumento() {
    if (!emFila) return;
    setSubindo(true);
    try {
      await enviarArquivo({ arquivo: emFila, tipo: tipoAtual, nome: nomeAtual || emFila.name });
    } finally {
      setSubindo(false);
    }
    // Vários arquivos de uma vez: pergunta um a um, porque o tipo raramente é o mesmo.
    const resto = fila.slice(1);
    setFila(resto);
    if (resto.length) {
      setNomeAtual(resto[0].name);
      setTipoAtual("CONTRATO_SOCIAL");
    }
  }

  function cancelarFila() {
    setFila([]);
  }


  // Enviar sai do sistema e chega no cliente: confirma antes, dizendo quantos e quais.
  async function aoEnviar() {
    const nomes = documentos.filter((d) => selecionados.has(d.id)).map((d) => d.nome);
    const lista = nomes.map((n) => `• ${n}`).join("\n");
    if (!window.confirm(`Enviar ${nomes.length} documento(s) por e-mail ao cliente?\n\n${lista}`)) return;
    await enviarPorEmail();
  }

  return (
    /* Lista de registros (contrato social, cartão CNPJ, inscrições) — largura de trabalho.
       A FICHA da empresa continua estreita de propósito: lá se LÊ texto, e linha longa cansa. */
    <div style={{ width: "var(--content-wide)", margin: "0 auto", padding: "20px 0", color: PANEL.text }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Documentos</h2>
        <span style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
          {carregando ? "carregando…" : `${documentos.length} documento(s)`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* O botão faz exatamente o que arrastar faz: escolhe o arquivo e cai na mesma pergunta. */}
          <button type="button" style={btn("var(--accent-purple)")} disabled={subindo} onClick={() => inputRef.current?.click()}>
            {subindo ? "Enviando…" : "+ Adicionar documento"}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
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
          <button type="button" style={btn("var(--accent-purple)")} disabled={enviando} onClick={aoEnviar}>
            {enviando ? "Enviando…" : "✉ Enviar por e-mail"}
          </button>
          <button type="button" style={{ ...btn(), marginLeft: "auto" }} onClick={limparSelecao}>Limpar seleção</button>
        </div>
      )}

      {!carregando && !documentos.length ? (
        <p style={{ color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhum documento guardado. Use "Adicionar documento" para subir o contrato social, o
          cartão CNPJ e as inscrições, e tê-los à mão quando o cliente pedir.
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

      {/* A PERGUNTA. Só aparece depois que o arquivo já está na mão — arrastado ou escolhido.
          Com vários arquivos, pergunta um a um: o tipo raramente é o mesmo para todos. */}
      {emFila && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Qual documento é este?"
          onClick={(e) => { if (e.target === e.currentTarget && !subindo) cancelarFila(); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16,
          }}
        >
          <div style={{
            width: "100%", maxWidth: 460, background: PANEL.bg,
            border: `1px solid ${PANEL.border}`, borderRadius: 12, padding: 20,
          }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700 }}>Qual documento é este?</h3>
            <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: PANEL.muted, wordBreak: "break-all" }}>
              {emFila.name}
              {fila.length > 1 && ` · ${fila.length - 1} arquivo(s) na fila`}
            </p>

            <label style={{ display: "block", fontSize: "0.78rem", color: PANEL.muted, marginBottom: 4 }}>
              Tipo
            </label>
            <select
              value={tipoAtual}
              onChange={(e) => setTipoAtual(e.target.value)}
              autoFocus
              style={{ ...btn(), background: PANEL.field, width: "100%", marginBottom: 12 }}
            >
              {(tipos.length ? tipos : ["OUTRO"]).map((t) => (
                <option key={t} value={t}>{tipoLabels[t] || t}</option>
              ))}
            </select>

            <label style={{ display: "block", fontSize: "0.78rem", color: PANEL.muted, marginBottom: 4 }}>
              Nome
            </label>
            <input
              value={nomeAtual}
              onChange={(e) => setNomeAtual(e.target.value)}
              style={{ ...btn(), background: PANEL.field, width: "100%", marginBottom: 16 }}
            />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={btn()} disabled={subindo} onClick={cancelarFila}>Cancelar</button>
              <button type="button" style={btn("var(--accent-purple)")} disabled={subindo} onClick={confirmarDocumento}>
                {subindo ? "Enviando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
