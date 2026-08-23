// AS NOTAS QUE A EMPRESA RECEBEU — as duas espécies contadas, SEPARADAS, e a soma dita como soma.
//
// > Dono, 23/08/2026: *"vou corrigir algo que disse: as notas de compra devem ser separadas das
// > notas recebidas de serviço"* — corrigindo o pedido anterior, que era juntá-las numa aba só.
//
// ⚠ ELE MUDOU A LISTA, NÃO A PERGUNTA. O que ele quer saber continua sendo *"quantas notas
// recebidas temos?"*, e isso NÃO exige lista única: exige que os dois números apareçam e que dê
// para somá-los. Este bloco é essa resposta — e a lista de cada espécie continua na janela dela,
// com as colunas que só ela tem.
//
// ⚠⚠ **AS DUAS ESPÉCIES NÃO SÃO A MESMA COISA, e é por isso que a soma vem ROTULADA.** NF-e tem
// item, NCM, CFOP e quantidade; NFS-e tem código de serviço e ISS. Um "1.943" solto seria um
// número que ninguém sabe interpretar — some nota de compra de mercadoria com nota de serviço
// tomado, que vão para contas diferentes. A soma existe porque foi pedida; o rótulo existe para
// ela não ser lida como se fosse uma coisa só.
//
// ⚠ **O NÚMERO TEM DE FECHAR COM AS LINHAS**, e é por isso que cada caixa é um BOTÃO que leva à
// janela daquela espécie já filtrada em "Recebidas": o contador confere o número clicando nele.
// A fonte é `GET /notas/summary` com `papel: "DEST"` e **sem `type`**, com os MESMOS filtros de
// competência/busca/atividade da tabela — ver `useNotasFiscais.js`. Total que não fecha com a
// lista é pior que total nenhum (regra escrita em `resumoDaEmissao`).
//
// ⚠ **CANCELADA NÃO ENTRA NA CONTAGEM** — mesma semântica do `NotasResumo` ao lado (o backend as
// descarta antes de contar e as devolve em `countCanceladas`). A tela DIZ isso quando há alguma,
// em vez de deixar a diferença aparecer como número que não bate.

import { PANEL, fmtMoney } from "./notasStyles";

function Caixa({ rotulo, valor, sub, cor, title, onClick, ativo }) {
  const style = {
    padding: "10px 14px", borderRadius: 10, minWidth: 150, flex: "0 1 auto", textAlign: "left",
    background: ativo ? "var(--state-neutral-surface)" : PANEL.field,
    border: `1px solid ${ativo ? cor : PANEL.border}`,
    cursor: onClick ? "pointer" : "default",
    font: "inherit",
  };
  const conteudo = (
    <>
      <div style={{ color: PANEL.muted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {rotulo}
      </div>
      <div style={{ color: cor, fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.3 }}>{valor}</div>
      {sub && <div style={{ color: PANEL.muted, fontSize: "0.72rem" }}>{sub}</div>}
    </>
  );
  if (!onClick) return <div title={title} style={style}>{conteudo}</div>;
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={Boolean(ativo)} style={style}>
      {conteudo}
    </button>
  );
}

export function RecebidasResumo({ resumo, competencia, loading, janelaAtiva, papel, onVerRecebidas }) {
  const t = resumo?.totals || null;
  if (!t && !loading) return null;

  // ⚠ `countNfse`/`countNfe` deste resumo já são SÓ de nota recebida: a chamada manda
  // `papel: "DEST"`. Reusar o resumo da janela aqui contaria as EMITIDAS junto.
  const servico = Number(t?.countNfse || 0);
  const compra = Number(t?.countNfe || 0);
  const total = servico + compra;
  const valor = Number(t?.totalRecebido || 0);
  const canceladas = Number(t?.countCanceladas || 0);

  // "na tabela" só quando a janela E o papel batem — a janela sozinha não basta, porque a mesma
  // janela mostra as emitidas quando o papel é EMIT.
  const vendoServico = janelaAtiva === "NFSE" && papel === "DEST";
  const vendoCompra = janelaAtiva === "NFE" && papel === "DEST";
  const periodo = competencia ? `competência ${competencia}` : resumo?.ano ? `ano ${resumo.ano}` : "período filtrado";

  return (
    <section
      aria-label="Notas recebidas pela empresa"
      style={{
        display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch", marginBottom: 16,
        padding: 12, borderRadius: 10, border: `1px solid ${PANEL.border}`, background: PANEL.surface,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 150 }}>
        <strong style={{ color: PANEL.text, fontSize: "0.9rem" }}>Notas recebidas</strong>
        <span style={{ color: PANEL.muted, fontSize: "0.72rem" }}>{periodo}</span>
      </div>

      <Caixa
        rotulo="Serviço (NFS-e)"
        valor={loading ? "…" : servico}
        sub={vendoServico ? "▸ na tabela" : "tomadas de prestadores"}
        cor="var(--accent-cyan)"
        ativo={vendoServico}
        onClick={onVerRecebidas ? () => onVerRecebidas("NFSE") : undefined}
        title="Notas de SERVIÇO que a empresa recebeu (NFS-e, papel DEST). Clique para abrir a janela de NFS-e já filtrada em Recebidas."
      />

      <Caixa
        rotulo="Compra (NF-e)"
        valor={loading ? "…" : compra}
        sub={vendoCompra ? "▸ na tabela" : "mercadoria de fornecedores"}
        cor="var(--accent-cyan)"
        ativo={vendoCompra}
        onClick={onVerRecebidas ? () => onVerRecebidas("NFE") : undefined}
        title="Notas de COMPRA que a empresa recebeu (NF-e, papel DEST). Clique para abrir a janela de NF-e já filtrada em Recebidas."
      />

      <Caixa
        rotulo="Total recebido"
        valor={loading ? "…" : total}
        /* ⚠ A SOMA DIZ QUE É SOMA DE ESPÉCIES DIFERENTES. Sem esta linha o número vira um total
           que ninguém sabe interpretar — nota de mercadoria e nota de serviço não vão para a
           mesma conta, nem respondem à mesma pergunta fiscal. */
        sub="NFS-e + NF-e (espécies somadas)"
        cor={PANEL.text}
        title="Quantidade de notas recebidas no filtro atual, somando as DUAS espécies. Elas continuam separadas nas janelas porque os dados de cada uma são diferentes: a NF-e tem item/NCM/CFOP, a NFS-e tem código de serviço e ISS."
      />

      <Caixa
        rotulo="Valor recebido"
        valor={loading ? "…" : fmtMoney(valor)}
        sub="soma das duas espécies"
        cor={PANEL.text}
        title="Soma do valor das notas recebidas (NFS-e + NF-e) no filtro atual. Não é faturamento — faturamento sai das notas EMITIDAS."
      />

      {canceladas > 0 && (
        /* ⚠ Não é caixa clicável como a do `NotasResumo`: aqui ela existe para EXPLICAR a
           diferença entre este total e uma lista com "ver canceladas" ligado, não para filtrar. */
        <Caixa
          rotulo="Canceladas"
          valor={loading ? "…" : canceladas}
          sub="fora das contagens acima"
          cor="var(--state-danger)"
          title="Notas recebidas que estão canceladas. Elas NÃO entram nos números acima — é a mesma regra do resumo da janela."
        />
      )}
    </section>
  );
}
