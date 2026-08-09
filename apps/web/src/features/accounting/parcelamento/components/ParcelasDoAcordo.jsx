// As PRESTAÇÕES do acordo, com o botão de busca do pagamento na LINHA de cada uma.
//
// ⚠ POR QUE NA LINHA, E NÃO NUM BOTÃO GLOBAL DO ACORDO. Pedido do dono, textual: *"posso confirmar
// clicando em um botão de busca, disponível na parcela daquele mês"*. Um botão único no card teria
// de escolher sozinho QUAL prestação consultar — e escolher errado é uma chamada paga gasta no
// documento errado. Na linha, quem escolhe é quem está olhando o vencimento.
//
// ⚠ NÃO HÁ CAMINHO NOVO DE BACKEND. Uma parcela É uma `Guide` com `parcelamentoId`, então isto
// chama exatamente a mesma `POST /firm/guides/:guideId/buscar-pagamento` que a Circular já usa nas
// outras guias (`renderCircularTab.handleBuscarPagamento`). O que muda é onde o botão vive e o
// quanto a recusa aparece: lá o desfecho sai num `window.alert` que some; aqui ele fica na linha.
//
// ⚠ A BUSCA NÃO LANÇA NADA. Ela marca a guia como paga e guarda data/valores do comprovante; a
// baixa contábil continua sendo ato deliberado do contador, no painel "Parcelas pagas aguardando
// lançamento" logo acima — que é para onde a linha migra depois de um pagamento localizado.

import { useState } from "react";
import {
  montarParcelasDoAcordo, estadoBuscaParcela, textoDaConfirmacao,
  resumoDoResultado, motivoDaFalha,
} from "../lib/parcelaBusca";

const PANEL = { field: "#282A36", border: "#44475A", text: "#F8F8F2", muted: "#aeb6d3" };

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVenc(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Cada tom tem par `-surface` — nunca derivar fundo concatenando hex (`${cor}22` quebra em silêncio
// assim que a cor vira `var(--…)`).
const TONS = {
  ok: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  neutro: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  erro: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
};

function Desfecho({ resumo }) {
  const tom = TONS[resumo.tom] || TONS.neutro;
  return (
    <div
      role="status"
      style={{
        marginTop: 4, padding: "6px 9px", borderRadius: 6,
        background: tom.fundo, border: `1px solid ${tom.cor}`,
      }}
    >
      <div style={{ color: tom.cor, fontWeight: 700, fontSize: "0.72rem" }}>{resumo.titulo}</div>
      <div style={{ color: PANEL.muted, fontSize: "0.68rem", marginTop: 2, lineHeight: 1.35 }}>
        {resumo.detalhe}
      </div>
    </div>
  );
}

function situacaoDaLinha(linha) {
  if (linha.baixada) return { texto: "baixada", cor: "var(--state-ok)" };
  if (linha.paymentStatus === "PAID") return { texto: "paga · falta lançar", cor: "var(--state-warn)" };
  if (!linha.guideId) return { texto: "sem guia", cor: "var(--state-neutral)" };
  return { texto: "em aberto", cor: "var(--state-neutral)" };
}

/**
 * @param {object}   parcelamento  o acordo decorado (`listParcelamentos`)
 * @param {function} onBuscar      `(guideId) => Promise<resposta>` — o par mock/real
 *                                 `buscarPagamentoGuia`. A tela NUNCA chama fetch direto.
 * @param {function} onBuscou      recarrega o que mudou (parcelamentos + fila de baixa pendente)
 * @param {boolean}  [aberto]      controlado pelo card (o item "Histórico" do menu ⋯ abre o MESMO
 *                                 bloco); ausente ⇒ o componente controla sozinho, como antes.
 * @param {function} [onAlternar]
 */
export function ParcelasDoAcordo({ parcelamento, onBuscar, onBuscou, aberto, onAlternar }) {
  const [abertoLocal, setAbertoLocal] = useState(false);
  const controlado = typeof aberto === "boolean";
  const estaAberto = controlado ? aberto : abertoLocal;
  const alternar = () => (controlado ? onAlternar?.() : setAbertoLocal((a) => !a));
  const [buscando, setBuscando] = useState(null);   // guideId em voo
  const [desfechos, setDesfechos] = useState({});   // guideId → resumo

  const linhas = montarParcelasDoAcordo(parcelamento);

  // ⚠ AUSÊNCIA NUNCA É RESPOSTA. Isto era `if (!linhas.length) return null` — e o bloco inteiro
  // sumia sem dizer por quê. Zero prestações materializadas não é o mesmo que "este acordo não tem
  // parcelas": é sinal de que o cronograma não foi materializado (competência-sentinela `1970-01`,
  // por exemplo), e some justamente no contrato que precisa ser olhado.
  if (!linhas.length) {
    return (
      <div style={{ borderTop: `1px solid ${PANEL.border}`, paddingTop: 8, fontSize: "0.68rem", color: PANEL.muted, lineHeight: 1.4 }}>
        Este acordo não tem nenhuma prestação materializada — não há cronograma para acompanhar nem
        pagamento para buscar. Costuma acontecer quando a competência da 1ª parcela não foi informada
        na adesão.
      </div>
    );
  }

  async function buscar(linha) {
    if (buscando || !onBuscar) return;
    // ⚠ O CLIQUE NÃO É GRATUITO. A confirmação repete o documento, o valor e a competência sobre os
    // quais a chamada paga vai sair — e avisa se esta guia já foi consultada antes.
    // eslint-disable-next-line no-alert
    if (!window.confirm(textoDaConfirmacao(linha, parcelamento?.label))) return;

    setBuscando(linha.guideId);
    setDesfechos((d) => ({ ...d, [linha.guideId]: null }));
    try {
      const r = await onBuscar(linha.guideId);
      setDesfechos((d) => ({ ...d, [linha.guideId]: resumoDoResultado(r) }));
      // Recarrega só depois de mostrar o desfecho: o `onBuscou` remonta a lista, e um desfecho
      // gravado antes dele seria descartado no mesmo instante em que aparecesse.
      if (r?.encontrado && onBuscou) await onBuscou();
    } catch (err) {
      setDesfechos((d) => ({ ...d, [linha.guideId]: motivoDaFalha(err) }));
    } finally {
      setBuscando(null);
    }
  }

  const th = {
    padding: "5px 8px", textAlign: "left", fontSize: "0.62rem", color: PANEL.muted,
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
  };
  const td = { padding: "5px 8px", fontSize: "0.74rem", color: PANEL.text, verticalAlign: "top" };

  return (
    <div style={{ borderTop: `1px solid ${PANEL.border}`, paddingTop: 8 }}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={estaAberto}
        style={{
          background: "transparent", border: "none", color: "var(--accent-purple)",
          cursor: "pointer", fontWeight: 700, fontSize: "0.72rem", padding: 0,
        }}
      >
        {estaAberto ? "▾" : "▸"} Parcelas ({linhas.length}) — buscar pagamento
      </button>

      {estaAberto && (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: PANEL.field }}>
                <th style={th}>Parc.</th>
                <th style={th}>Vencimento</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th>
                <th style={th}>Situação</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const estado = estadoBuscaParcela(linha);
                const sit = situacaoDaLinha(linha);
                const emVoo = buscando === linha.guideId;
                const desfecho = linha.guideId ? desfechos[linha.guideId] : null;
                return (
                  <tr key={linha.key} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ ...td, fontFamily: "monospace" }}>
                      {linha.numeroParcela ?? "?"}
                      {linha.totalParcelas ? `/${linha.totalParcelas}` : ""}
                    </td>
                    <td style={{ ...td, color: PANEL.muted }}>{fmtVenc(linha.vencimento)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>
                      {linha.valor != null ? `R$ ${fmtMoney(linha.valor)}` : "—"}
                    </td>
                    <td style={{ ...td, color: sit.cor, fontWeight: 600 }}>{sit.texto}</td>
                    <td style={{ ...td, textAlign: "right", minWidth: 190 }}>
                      {/* ⚠ Desabilitado SEMPRE com o motivo no `title` — o projeto proíbe o
                          contrário, e aqui o motivo mais comum (guia sem número de documento) é
                          impossível de adivinhar olhando a linha. Ação primária é o ACCENT: verde
                          significa concluído, e um verde de "faça isto" ensinaria o oposto do que
                          a coluna Situação usa para dizer "baixada". */}
                      <button
                        type="button"
                        title={estado.motivo}
                        disabled={!estado.podeBuscar || Boolean(buscando)}
                        onClick={() => buscar(linha)}
                        style={{
                          fontSize: "0.7rem", padding: "4px 10px", borderRadius: 4,
                          background: "transparent",
                          border: `1px solid ${estado.podeBuscar ? "var(--accent-purple)" : PANEL.border}`,
                          color: estado.podeBuscar ? "var(--accent-purple)" : PANEL.muted,
                          cursor: estado.podeBuscar && !buscando ? "pointer" : "not-allowed",
                          fontWeight: 700, whiteSpace: "nowrap",
                        }}
                      >
                        {emVoo ? "Buscando…" : "🔎 Buscar pagamento"}
                      </button>
                      {/* O motivo do bloqueio também fica VISÍVEL, não só no hover: `title` não
                          existe em toque, e esta tela vai ser usada com o SERPRO real do outro
                          lado. */}
                      {!estado.podeBuscar && !desfecho && (
                        <div style={{ fontSize: "0.64rem", color: PANEL.muted, marginTop: 3, textAlign: "left", lineHeight: 1.35 }}>
                          {estado.motivo}
                        </div>
                      )}
                      {desfecho && <Desfecho resumo={desfecho} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: "0.64rem", color: PANEL.muted, marginTop: 6, lineHeight: 1.4 }}>
            A busca consulta o comprovante no SERPRO (PAGTOWEB) e só REGISTRA o que encontrou — ela
            não lança nada. Pagamento localizado vira linha no painel “Parcelas pagas aguardando
            lançamento”, onde a baixa é feita. <strong>Cada consulta é paga.</strong>
          </div>
        </div>
      )}
    </div>
  );
}
