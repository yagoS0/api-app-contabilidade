// Resumo das notas da janela ativa (NFS-e ou NF-e), no topo da aba Notas Fiscais.
//
// Fonte: GET /notas/summary — agrega com OS MESMOS filtros da tabela e, importante,
// IGNORA a paginação (soma todas as notas que casam, não só a página carregada).
// Por isso nunca somamos a lista da tela: com limit=100 o total sairia errado.
//
// Semântica fiscal: nota CANCELADA fica FORA de "Emitidas"/valores (não é faturamento)
// e aparece só no contador de canceladas — mesma população que a apuração usa.

import { PANEL, fmtMoney } from "./notasStyles";

// `onClick` transforma a caixa em seletor: Emitidas/Recebidas filtram a tabela por papel.
// A caixa ativa fica com a borda na cor do próprio indicador, pra ficar claro o que a tabela mostra.
function Tile({ label, valor, sub, color = PANEL.text, title, onClick, ativo }) {
  const clicavel = typeof onClick === "function";
  const style = {
    padding: "10px 14px", borderRadius: 10, minWidth: 150, flex: "0 1 auto", textAlign: "left",
    background: ativo ? "rgba(255,255,255,0.06)" : PANEL.field,
    border: `1px solid ${ativo ? color : PANEL.border}`,
    cursor: clicavel ? "pointer" : "default",
    font: "inherit",
  };
  const conteudo = (
    <>
      <div style={{ color: PANEL.muted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ color, fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.3 }}>{valor}</div>
      {sub && <div style={{ color: PANEL.muted, fontSize: "0.72rem" }}>{sub}</div>}
    </>
  );
  if (!clicavel) return <div title={title} style={style}>{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={Boolean(ativo)} style={style}>
      {conteudo}
    </button>
  );
}

export function NotasResumo({ summary, janela, competencia, loading, papel, onSelectPapel, verCanceladas, onToggleCanceladas }) {
  const t = summary?.totals || null;
  if (!t && !loading) return null;

  const emitidas = Number(t?.totalEmitido || 0);
  const recebidas = Number(t?.totalRecebido || 0);
  const canceladas = Number(t?.countCanceladas || 0);
  // countNfe/countNfse já vêm sem as canceladas (o backend as descarta antes de contar).
  const qtd = janela === "NFE" ? Number(t?.countNfe || 0) : Number(t?.countNfse || 0);
  const rotuloJanela = janela === "NFE" ? "NF-e" : "NFS-e";
  const periodo = competencia
    ? `competência ${competencia}`
    : summary?.ano ? `ano ${summary.ano}` : "período filtrado";

  return (
    <section
      aria-label={`Resumo de notas (${rotuloJanela})`}
      style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "stretch" }}
    >
      <Tile
        label={`Notas ${rotuloJanela}`}
        valor={loading ? "…" : qtd}
        sub={periodo}
        title={`Quantidade de notas ${rotuloJanela} autorizadas no filtro atual (canceladas não contam).`}
      />
      <Tile
        label="Emitidas"
        valor={loading ? "…" : fmtMoney(emitidas)}
        sub={papel === "EMIT" ? "▸ na tabela" : "faturamento do período"}
        color="#69FF47"
        ativo={papel === "EMIT"}
        onClick={onSelectPapel ? () => onSelectPapel("EMIT") : undefined}
        title="Soma das notas EMITIDAS (papel EMIT) autorizadas — é a base do faturamento na apuração. Clique para ver só elas na tabela."
      />
      <Tile
        label="Recebidas"
        valor={loading ? "…" : fmtMoney(recebidas)}
        sub={papel === "DEST" ? "▸ na tabela" : "notas de fornecedores"}
        color="#8BE9FD"
        ativo={papel === "DEST"}
        onClick={onSelectPapel ? () => onSelectPapel("DEST") : undefined}
        title="Soma das notas RECEBIDAS (papel DEST) autorizadas. Clique para ver só elas na tabela."
      />
      {canceladas > 0 && (
        <Tile
          label="Canceladas"
          valor={loading ? "…" : canceladas}
          // A tabela esconde canceladas por padrão (elas não são faturamento). Sem esta caixa
          // clicável não havia NENHUM jeito de vê-las: o contador dizia "2 canceladas" e as notas
          // ficavam invisíveis — não dava pra conferir se o cancelamento estava certo.
          sub={verCanceladas ? "▸ na tabela" : "clique para ver"}
          color="#FF4757"
          ativo={Boolean(verCanceladas)}
          onClick={onToggleCanceladas}
          title="Notas canceladas no período — não entram nos valores acima nem na apuração. Clique para mostrá-las na tabela."
        />
      )}
    </section>
  );
}
