// Resumo das notas da janela ativa (NFS-e ou NF-e), no topo da aba Notas Fiscais.
//
// Fonte: GET /notas/summary — agrega com OS MESMOS filtros da tabela e, importante,
// IGNORA a paginação (soma todas as notas que casam, não só a página carregada).
// Por isso nunca somamos a lista da tela: com limit=100 o total sairia errado.
//
// Semântica fiscal: nota CANCELADA fica FORA de "Emitidas"/valores (não é faturamento)
// e aparece só no contador de canceladas — mesma população que a apuração usa.

import { PANEL, fmtMoney } from "./notasStyles";

function Tile({ label, valor, sub, color = PANEL.text, title }) {
  return (
    <div
      title={title}
      style={{
        padding: "10px 14px", borderRadius: 10, background: PANEL.field,
        border: `1px solid ${PANEL.border}`, minWidth: 150, flex: "0 1 auto",
      }}
    >
      <div style={{ color: PANEL.muted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ color, fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.3 }}>{valor}</div>
      {sub && <div style={{ color: PANEL.muted, fontSize: "0.72rem" }}>{sub}</div>}
    </div>
  );
}

export function NotasResumo({ summary, janela, competencia, loading }) {
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
        sub="faturamento do período"
        color="#69FF47"
        title="Soma das notas EMITIDAS (papel EMIT) autorizadas — é a base do faturamento na apuração."
      />
      <Tile
        label="Recebidas"
        valor={loading ? "…" : fmtMoney(recebidas)}
        sub="notas de fornecedores"
        color="#8BE9FD"
        title="Soma das notas RECEBIDAS (papel DEST) autorizadas."
      />
      {canceladas > 0 && (
        <Tile
          label="Canceladas"
          valor={loading ? "…" : canceladas}
          sub="fora do faturamento"
          color="#FF4757"
          title="Notas canceladas no período — não entram nos valores acima nem na apuração."
        />
      )}
    </section>
  );
}
