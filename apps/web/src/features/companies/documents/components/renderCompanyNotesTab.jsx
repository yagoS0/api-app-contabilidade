// Aba Anotações da empresa — o que hoje mora só na cabeça de quem atende.
//
// A anotação FIXADA fica destacada acima da lista e não se mistura com as demais, em qualquer
// ordenação. Fixar é exclusivo: fixar uma nova desafixa a anterior (o backend garante).

import { useState } from "react";

const PANEL = {
  border: "#44475A", text: "#F8F8F2", muted: "var(--text-muted)", field: "#1F2029",
};

const CORES_IMPORTANCIA = { ALTA: "var(--danger)", MEDIA: "#FFB347", BAIXA: "#8BE9FD" };
const ROTULO_IMPORTANCIA = { ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" };

const btn = (cor = PANEL.border) => ({
  padding: "6px 10px", borderRadius: 8, border: `1px solid ${cor}`,
  background: "transparent", color: PANEL.text, fontSize: "0.78rem", cursor: "pointer",
});

function fmtData(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

function Cartao({ nota, destaque, onFixar, onDesfixar, onExcluir, onMudarImportancia }) {
  const cor = CORES_IMPORTANCIA[nota.importancia] || PANEL.border;
  return (
    <article style={{
      padding: "12px 14px", borderRadius: 10, marginBottom: 10,
      background: destaque ? "rgba(255,255,255,0.06)" : PANEL.field,
      border: `1px solid ${destaque ? "#FFB347" : PANEL.border}`,
      borderLeft: `3px solid ${cor}`,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        {destaque && <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#FFB347" }}>📌 FIXADA</span>}
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: cor }}>
          {ROTULO_IMPORTANCIA[nota.importancia] || nota.importancia}
        </span>
        <span style={{ fontSize: "0.72rem", color: PANEL.muted }}>{fmtData(nota.createdAt)}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <select
            value={nota.importancia}
            onChange={(e) => onMudarImportancia(e.target.value)}
            style={{ ...btn(), background: PANEL.field }}
            aria-label="Importância"
          >
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </select>
          {destaque
            ? <button type="button" style={btn()} onClick={onDesfixar}>Desafixar</button>
            : <button type="button" style={btn("#FFB347")} onClick={onFixar}>Fixar</button>}
          <button type="button" style={btn("var(--danger)")} onClick={onExcluir}>Excluir</button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: "0.86rem", whiteSpace: "pre-wrap" }}>{nota.texto}</p>
    </article>
  );
}

export function CompanyNotesTab({ notes }) {
  const { fixada, demais, ordenarPor, setOrdenarPor, carregando, criar, atualizar, excluir } = notes;
  const [texto, setTexto] = useState("");
  const [importancia, setImportancia] = useState("MEDIA");
  const [salvando, setSalvando] = useState(false);

  async function aoCriar() {
    if (!texto.trim()) return;
    setSalvando(true);
    try {
      if (await criar({ texto, importancia })) {
        setTexto("");
        setImportancia("MEDIA");
      }
    } finally {
      setSalvando(false);
    }
  }

  const acoes = (n, destaque) => ({
    destaque,
    onFixar: () => atualizar(n.id, { fixada: true }),
    onDesfixar: () => atualizar(n.id, { fixada: false }),
    onExcluir: () => { if (window.confirm("Excluir esta anotação?")) excluir(n.id); },
    onMudarImportancia: (v) => atualizar(n.id, { importancia: v }),
  });

  return (
    /* ⚠ A LARGURA SAIU DAQUI (era `maxWidth: 900` + padding próprio). Quem decide é o
       `CompanyTabLayout` (`largura="leitura"`), como nas outras três abas do grupo Empresa.
       ⚠ Isto ficou de fora da primeira leva e o defeito era o PIOR possível: Anotações é a aba
       DEFAULT da empresa, então abrir qualquer empresa caía em 900px e o primeiro clique em
       Documentos saltava para 1200 — exatamente o salto que este redesign existe para eliminar. */
    <div style={{ color: PANEL.text }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>Anotações</h2>
        <span style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
          {carregando ? "carregando…" : `${(fixada ? 1 : 0) + demais.length} anotação(ões)`}
        </span>
        <label style={{ marginLeft: "auto", fontSize: "0.78rem", color: PANEL.muted, display: "flex", gap: 6, alignItems: "center" }}>
          Ordenar por
          <select
            value={ordenarPor}
            onChange={(e) => setOrdenarPor(e.target.value)}
            style={{ ...btn(), background: PANEL.field }}
          >
            <option value="data">Data</option>
            <option value="importancia">Importância</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 20, padding: "12px 14px", borderRadius: 10, border: `1px solid ${PANEL.border}`, background: PANEL.field }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nova anotação sobre esta empresa…"
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            background: "transparent", border: `1px solid ${PANEL.border}`, borderRadius: 8,
            color: PANEL.text, padding: "8px 10px", fontSize: "0.86rem", fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <select
            value={importancia}
            onChange={(e) => setImportancia(e.target.value)}
            style={{ ...btn(), background: PANEL.field }}
            aria-label="Importância da nova anotação"
          >
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Média</option>
            <option value="BAIXA">Baixa</option>
          </select>
          <button
            type="button"
            style={{ ...btn("var(--accent-purple)"), marginLeft: "auto" }}
            disabled={salvando || !texto.trim()}
            onClick={aoCriar}
          >
            {salvando ? "Salvando…" : "Adicionar"}
          </button>
        </div>
      </div>

      {/* A fixada sai FORA da lista: ela sobrepõe as demais, não concorre com elas. */}
      {fixada && <Cartao nota={fixada} {...acoes(fixada, true)} />}

      {demais.map((n) => <Cartao key={n.id} nota={n} {...acoes(n, false)} />)}

      {!carregando && !fixada && !demais.length && (
        <p style={{ color: PANEL.muted, fontSize: "0.85rem" }}>
          Nenhuma anotação ainda. Registre aqui o que costuma ficar só na memória de quem atende
          esta empresa.
        </p>
      )}
    </div>
  );
}
