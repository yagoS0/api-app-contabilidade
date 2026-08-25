// CLASSIFICAÇÃO DAS NOTAS POR ANEXO — pendências + sugestão, num MODAL.
//
// ⚠⚠ ERA UMA SEÇÃO DA ABA APURAÇÃO até 24/08/2026, e virou modal a pedido do dono ("muitas abas").
// Ela era o terceiro item de um terceiro nível de navegação (grupo → sub-aba → seção), sem URL, e
// só respondia a UMA pergunta: *"há nota sem classificar nesta competência?"*. Essa pergunta já
// tinha um botão na barra de ações da Apuração — agora ele é a porta.
//
// ⚠ MODAL, E NÃO PAINEL REVELADO NA PRÓPRIA ABA: a seção Apuração é impressa (`data-print-area`),
// e só pode existir UM por página. Um painel embutido entraria na impressão do relatório de
// faturamento, que não fala de classificação.
//
// ⚠ NADA DE REGRA MUDOU AQUI. `estadoDaClassificacao` e `leituraDaPendencia` continuam sendo as
// mesmas libs testadas; este arquivo só mudou o contêiner.

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
  return (
    <Modal
      titulo={`Classificação das notas — ${competencia}`}
      aoFechar={onClose}
      tamanho="lg"
      rodape={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={sugerir} disabled={sugLoading}>
            {sugLoading ? "Carregando…" : "Sugerir"}
          </Button>
          <Button onClick={classificar} disabled={classificando}>
            {classificando ? "Classificando…" : "Classificar competência"}
          </Button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Pendências</div>
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
              // ⚠ Âmbar é "pendência com ação"; o outro ramo era `#FF4757`, que nem token é
              // (`--state-danger` é `#FF5757`). Vermelho aqui diria que a pendência bloqueia o
              // fechamento — e o que ela bloqueia é o cálculo do motor, não o mês.
              const cor = leitura.conhecida ? "var(--state-warn)" : "var(--state-neutral)";
              return (
                <div key={p.id}
                  style={{
                    padding: 12, background: PANEL.field, border: `1px solid ${cor}`,
                    borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div title={leitura.titulo}
                      style={{ fontSize: "0.72rem", color: cor, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {leitura.rotulo}
                    </div>
                    <div style={{ fontSize: "0.9rem" }}>{p.resumo}</div>
                    {leitura.explicacao && (
                      <div style={{ fontSize: "0.75rem", color: PANEL.muted, marginTop: 4 }}>{leitura.explicacao}</div>
                    )}
                    {p.competencia && (
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 4 }}>
                        {p.competencia} · {fmtDate(p.createdAt)}
                      </div>
                    )}
                  </div>
                  {p.tipo === "ITEM_SEM_REGRA" && (
                    <Button size="sm" onClick={() => onClassificarPendencia(p)} style={{ flex: "none" }}>
                      Classificar
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {sugErro && (
          <div style={{ padding: 10, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: "var(--radius-sm)", color: "var(--state-danger)", fontSize: "0.85rem" }}>{sugErro}</div>
        )}
        {sugData && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Sugestão de anexo por nota</div>
            <SugestaoAnexoTabela data={sugData} />
          </div>
        )}
      </div>
    </Modal>
  );
}
