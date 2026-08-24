// Resumo das notas da janela ativa (NFS-e ou NF-e), no topo da aba Notas Fiscais.
//
// Fonte: GET /notas/summary — agrega com OS MESMOS filtros da tabela e, importante,
// IGNORA a paginação (soma todas as notas que casam, não só a página carregada).
// Por isso nunca somamos a lista da tela: com limit=100 o total sairia errado.
//
// Semântica fiscal: nota CANCELADA fica FORA de "Emitidas"/valores (não é faturamento)
// e aparece só no contador de canceladas — mesma população que a apuração usa.
//
// ⚠⚠ ESTA FAIXA ABSORVEU O BLOCO "Notas recebidas" (23/08/2026). Dono, com a tela na frente:
// *"isso aqui tá horrível, esse notas recebidas em cima tem que ser absorvido para junto das outras
// caixas; pode aparecer recebidas, ao lado recebidas NF-e e recebidas NFS-e"*. Eram DUAS faixas de
// caixas empilhadas, e duas delas diziam o MESMO número com nomes diferentes ("Valor recebido" em
// cima, "Recebidas" embaixo) — a redundância era o que se lia como bagunça.
//
// ⚠⚠ E AS DUAS FAIXAS NÃO FALAVAM DA MESMA POPULAÇÃO, que é a parte que se perde se alguém juntar
// isto no olho. São duas chamadas diferentes a `/notas/summary` (ver `useNotasFiscais.js`):
//
//   `summary`  → com `type` da janela ativa, sem `papel`  ⇒ fala SÓ da espécie que a tabela mostra
//   `recebidas`→ com `papel: "DEST"`, SEM `type`          ⇒ fala das DUAS espécies
//
// Hoje elas coincidem porque a empresa do print tem ZERO NF-e recebida. No dia em que tiver, um
// "Recebidas" alimentado pelo `summary` mostraria só metade. Por isso as três caixas de recebidas
// abaixo saem TODAS do `resumoRecebidas`, e nunca do `summary`.
//
// ⚠ O "Recebidas" antigo desta faixa era o VALOR da janela e servia de filtro (`papel: DEST`).
// Ele saiu, e a ação NÃO se perdeu: clicar em "Recebidas NFS-e" estando na janela de NFS-e faz
// exatamente o mesmo (`irParaJanela("NFSE", "DEST")`). Uma caixa a menos, a mesma porta.
//
// ⚠ O que SUMIU de verdade foi o contador de canceladas SÓ DAS RECEBIDAS (das duas espécies). O
// desta faixa é o da JANELA — população diferente — e é clicável, então dá para inspecioná-las. Duas
// caixas "Canceladas" lado a lado, de populações diferentes, seriam pior que uma.

import { PANEL, fmtMoney } from "./notasStyles";

// `onClick` transforma a caixa em seletor: Emitidas/Recebidas filtram a tabela por papel.
// A caixa ativa fica com a borda na cor do próprio indicador, pra ficar claro o que a tabela mostra.
function Tile({ label, valor, sub, color = PANEL.text, title, onClick, ativo }) {
  const clicavel = typeof onClick === "function";
  const style = {
    padding: "10px 14px", borderRadius: 10, minWidth: 150, flex: "0 1 auto", textAlign: "left",
    background: ativo ? "var(--state-neutral-surface)" : PANEL.field,
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

export function NotasResumo({
  summary,
  // ⚠ O resumo das DUAS espécies (`papel: DEST`, sem `type`). Ver o cabeçalho: ele NÃO é o
  // `summary`, e trocar um pelo outro faz a caixa mostrar metade sem avisar.
  resumoRecebidas,
  janela,
  competencia,
  loading,
  papel,
  onSelectPapel,
  onVerRecebidas,
  verCanceladas,
  onToggleCanceladas,
}) {
  const t = summary?.totals || null;
  if (!t && !loading) return null;

  const emitidas = Number(t?.totalEmitido || 0);

  // As três caixas de recebidas saem do resumo CRUZADO, nunca do `summary` da janela.
  const r = resumoRecebidas?.totals || null;
  const recebidoServico = Number(r?.countNfse || 0);
  const recebidoCompra = Number(r?.countNfe || 0);
  const recebidoValor = Number(r?.totalRecebido || 0);
  const recebidoTotal = recebidoServico + recebidoCompra;
  // "na tabela" exige janela E papel: a mesma janela mostra as emitidas quando o papel é EMIT.
  const vendoServico = janela === "NFSE" && papel === "DEST";
  const vendoCompra = janela === "NFE" && papel === "DEST";
  const canceladas = Number(t?.countCanceladas || 0);
  // countNfe/countNfse já vêm sem as canceladas (o backend as descarta antes de contar).
  const qtd = janela === "NFE" ? Number(t?.countNfe || 0) : Number(t?.countNfse || 0);
  const rotuloJanela = janela === "NFE" ? "NF-e" : "NFS-e";
  const periodo = competencia
    ? `competência ${competencia}`
    : summary?.ano ? `ano ${summary.ano}` : "período filtrado";

  return (
    <section
      aria-label={`Resumo de notas (${rotuloJanela}) e notas recebidas`}
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
        color="var(--state-ok)"
        ativo={papel === "EMIT"}
        onClick={onSelectPapel ? () => onSelectPapel("EMIT") : undefined}
        title="Soma das notas EMITIDAS (papel EMIT) autorizadas — é a base do faturamento na apuração. Clique para ver só elas na tabela."
      />
      {/* ⚠ NÃO É CLICÁVEL, e a ausência é o que a mantém honesta: este valor é das DUAS espécies,
          e a tabela mostra UMA. Um clique só poderia filtrar metade do que a caixa afirma — e
          "total que não fecha com a lista é pior que total nenhum" é regra escrita nesta casa.
          Quem quer a lista clica na espécie, ao lado.
          ⚠ A CONTAGEM SOMADA VIVE NO SUBTÍTULO, e não numa sexta caixa: ela foi pedida pelo dono
          antes ("o total de notas recebidas") e continua na tela, com o rótulo que impede o número
          de ser lido como uma coisa só — nota de mercadoria e nota de serviço não vão para a mesma
          conta nem respondem à mesma pergunta fiscal. */}
      <Tile
        label="Recebidas"
        valor={loading ? "…" : fmtMoney(recebidoValor)}
        sub={loading ? "NFS-e + NF-e" : `${recebidoTotal} nota(s) · NFS-e + NF-e`}
        color="var(--accent-cyan)"
        title="Soma do valor das notas RECEBIDAS no filtro atual, somando as DUAS espécies (NFS-e + NF-e). Não é faturamento — faturamento sai das notas EMITIDAS. Para ver a lista, clique na espécie ao lado."
      />

      <Tile
        label="Recebidas NFS-e"
        valor={loading ? "…" : recebidoServico}
        sub={vendoServico ? "▸ na tabela" : "tomadas de prestadores"}
        color="var(--accent-cyan)"
        ativo={vendoServico}
        onClick={onVerRecebidas ? () => onVerRecebidas("NFSE") : undefined}
        title="Notas de SERVIÇO que a empresa recebeu (NFS-e, papel DEST). Clique para abrir a janela de NFS-e já filtrada em Recebidas."
      />

      <Tile
        label="Recebidas NF-e"
        valor={loading ? "…" : recebidoCompra}
        sub={vendoCompra ? "▸ na tabela" : "mercadoria de fornecedores"}
        color="var(--accent-cyan)"
        ativo={vendoCompra}
        onClick={onVerRecebidas ? () => onVerRecebidas("NFE") : undefined}
        title="Notas de COMPRA que a empresa recebeu (NF-e, papel DEST). Clique para abrir a janela de NF-e já filtrada em Recebidas."
      />
      {canceladas > 0 && (
        <Tile
          label="Canceladas"
          valor={loading ? "…" : canceladas}
          // A tabela esconde canceladas por padrão (elas não são faturamento). Sem esta caixa
          // clicável não havia NENHUM jeito de vê-las: o contador dizia "2 canceladas" e as notas
          // ficavam invisíveis — não dava pra conferir se o cancelamento estava certo.
          sub={verCanceladas ? "▸ na tabela" : "clique para ver"}
          color="var(--state-danger)"
          ativo={Boolean(verCanceladas)}
          onClick={onToggleCanceladas}
          title="Notas canceladas no período — não entram nos valores acima nem na apuração. Clique para mostrá-las na tabela."
        />
      )}
    </section>
  );
}
