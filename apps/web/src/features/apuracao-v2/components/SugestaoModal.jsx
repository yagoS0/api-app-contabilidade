import "./classificacao-notas.css";
import { useEffect, useState } from "react";
import { TIPOS_CLASSIFICACAO } from "../lib/tiposClassificacao";
import { PANEL, fmtDate } from "../../notas/components/notasStyles";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { CORES_TOM_RELATORIO } from "../lib/relatorioFaturamento";
import { leituraDaPendencia } from "../lib/pendenciaTela";

export function SugestaoModal({
  competencia,
  pendencias,
  classificacao,
  sugerir,
  sugLoading,
  classificar,
  classificando,
  sugErro,
  sugData,
  onClassificarPendencia,
  onClose,
  SugestaoAnexoTabela,
}) {
  const [selecoes, setSelecoes] = useState({});
  const [tipoLote, setTipoLote] = useState("");
  const [erroAplicacao, setErroAplicacao] = useState("");
  useEffect(() => { setSelecoes({}); setTipoLote(""); }, [competencia, sugData]);
  const selecionadas = Object.entries(selecoes).filter(([, tipo]) => tipo);
  async function aplicar() {
    setErroAplicacao("");
    try {
      await classificar({ classificacoes: selecionadas.map(([notaId, tipoReceita]) => ({ notaId, tipoReceita })) });
      setSelecoes({});
    } catch (e) { setErroAplicacao(e?.message || "Não foi possível aplicar a seleção."); }
  }
  return (
    <Modal
      className="classificacao-notas-modal"
      titulo={`Classificação das notas — ${competencia}`}
      aoFechar={onClose}
      tamanho="lg"
      ocupado={classificando}
      rodape={<Button variant="secondary" onClick={onClose} disabled={classificando}>Fechar</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={sugerir} disabled={sugLoading || classificando}>
            {sugLoading ? "Carregando…" : "Sugerir"}
          </Button>
          <Button variant="secondary" onClick={() => Promise.resolve(classificar()).catch(e => setErroAplicacao(e?.message || "Falha ao classificar."))} disabled={classificando}>
            {classificando ? "Classificando…" : "Classificar competência"}
          </Button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>Pendências</div>
          {/* ⚠ "✓ Nenhuma pendência aberta" EM VERDE CONCLUÍA O QUE NÃO FOI FEITO.
              Pendência só nasce quando o classificador roda e não acha regra — e `tipoReceita` é
              nulo em 16.153/16.153 itens em produção. Ou seja: hoje a lista vazia quer dizer
              "ninguém classificou", e o ✓ verde (que neste app significa CONCLUÍDO) afirmava o
              contrário. Quem desempata é o relatório de faturamento da competência, que mede
              exatamente quanta receita está sem tipo; sem ele, a resposta honesta é a terceira —
              não sabemos —, e ela não é verde. A regra vive em `lib/relatorioFaturamento.js`. */}
          {pendencias.length === 0 ? (() => {
            const { cor, fundo } = CORES_TOM_RELATORIO[classificacao.tom];
            return (
              <div style={{ padding: 14, color: cor, background: fundo, border: `1px solid ${cor}`, borderRadius: 8, fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: 4 }}>
                <strong>{classificacao.tom === "ok" ? "✓ " : "⚠ "}{classificacao.rotulo}</strong>
                <span style={{ color: PANEL.muted }}>{classificacao.detalhe}</span>
              </div>
            );
          })() : (
            pendencias.map((p) => {
              // ⚠ A tela imprimia `[{p.tipo}]` — `[ITEM_SEM_REGRA]` cru, entre colchetes, como
              // cabeçalho de cada pendência. Ver `../lib/pendenciaTela.js` (o enum cru não se
              // perdeu: vive no `title`).
              const leitura = leituraDaPendencia(p.tipo);
              // ⚠ Âmbar é "pendência com ação"; o outro ramo era `var(--danger)`, que nem token é
              // (`--state-danger` é `#FF5757`). Vermelho aqui diria que a pendência bloqueia o
              // fechamento — e o que ela bloqueia é o cálculo do motor, não o mês.
              const cor = leitura.conhecida ? "var(--state-warn)" : "var(--state-neutral)";
              return (
                <div key={p.id}
                  style={{
                    padding: 12, background: PANEL.field, border: `1px solid ${cor}`,
                    borderRadius: 8, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, overflowWrap: "anywhere",
                  }}>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <div title={leitura.titulo}
                      style={{ fontSize: "0.875rem", color: cor, fontWeight: 600, marginBottom: 4 }}>
                      {leitura.rotulo}
                    </div>
                    <div style={{ fontSize: "0.9rem" }}>{p.resumo}</div>
                    {(leitura.explicacao || p.competencia) && (
                      <details style={{ fontSize: "0.8125rem", color: PANEL.muted, marginTop: 4 }}>
                        <summary style={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>Detalhes da pendência</summary>
                        {leitura.explicacao && <p style={{ margin: "0 0 8px" }}>{leitura.explicacao}</p>}
                        {p.competencia && <div>{p.competencia} · {fmtDate(p.createdAt)}</div>}
                      </details>
                    )}
                  </div>
                  {p.tipo === "ITEM_SEM_REGRA" && (
                    <Button size="sm" variant="secondary" disabled={classificando} onClick={() => onClassificarPendencia(p)} style={{ flex: "none" }}>
                      Classificar
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {erroAplicacao && <p role="alert">{erroAplicacao}</p>}
        {sugErro && (
          <div role="alert" style={{ padding: 10, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: "var(--radius-sm)", color: "var(--state-danger)", fontSize: "0.85rem" }}>{sugErro}</div>
        )}
        {sugData && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>Sugestão de anexo por nota</div>
            <p style={{ margin: 0, color: PANEL.muted, fontSize: "0.875rem" }}>Aplicar altera somente as notas desta competência. Fator R: anexo III ou V conforme a folha.</p>
            {sugData.notas?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
              <label style={{ display: "grid", gap: 6, flex: "1 1 240px", minWidth: 0 }}>Anexo para as notas da competência
                <select value={tipoLote} onChange={e => setTipoLote(e.target.value)} disabled={classificando} style={{ minHeight: 40, width: "100%", color: PANEL.text, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: 8 }}>
                  <option value="">Escolha um tipo de receita</option>
                  {TIPOS_CLASSIFICACAO.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button variant="secondary" disabled={!tipoLote || classificando} onClick={() => setSelecoes(Object.fromEntries(sugData.notas.filter(n => n.itens > 0).map(n => [n.notaId, tipoLote])))}>Selecionar para todas</Button>
            </div>}
            <SugestaoAnexoTabela data={sugData} selecoes={selecoes} onSelecionar={(id, tipo) => setSelecoes(s => ({ ...s, [id]: tipo }))} disabled={classificando} />
            {selecionadas.length > 0 && <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, fontSize: "0.875rem", color: PANEL.muted }}>{selecionadas.length} nota(s) selecionada(s). Todos os itens dessas notas receberão o tipo escolhido. Recalcule o DAS depois de aplicar.</p>
              <Button disabled={classificando} onClick={aplicar}>Aplicar classificação selecionada</Button>
            </div>}

          </div>
        )}
      </div>
    </Modal>
  );
}
