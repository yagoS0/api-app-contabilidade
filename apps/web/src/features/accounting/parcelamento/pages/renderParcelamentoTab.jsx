// Aba "Parcelamento" (grupo Contabilidade). Antes esta lista morava no rodapé da Circular;
// foi movida pra cá pra ter espaço próprio. A CRIAÇÃO de parcelamento continua vindo de
// Lançamentos/Guias (fluxo de ingestão da 1ª parcela) — aqui é a visão de gerenciar os que
// já existem: conferência de parcelas pagas, lista, config de contas e rescisão.
//
// A BAIXA da parcela também é feita aqui (antes saía sozinha ao confirmar o pagamento da guia):
// o ato contábil de cada domínio vive no lugar onde ele é acompanhado — tributos na Circular,
// parcelas nesta aba.
//
// Dados: hook useParcelamentos (accountingPanel.parcelamentos). Ele carrega sozinho no mount
// e recarrega após cada ação (rescindir/config/conferência), então não precisa de reload manual.

import { useCallback, useEffect, useState } from "react";
import { ParcelamentosList, ConferenciaParcelasPanel } from "../components/ParcelamentoModals";
import { createApiClient } from "../../../../api/client";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0" };
const parcelaApi = createApiClient();

function fmtMoney(v) {
  return Number.isFinite(Number(v))
    ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

// Parcelas com pagamento marcado e SEM lançamento — o que falta o contador lançar.
function ParcelasPendentesBaixa({ companyId, refreshKey = 0 }) {
  const [parcelas, setParcelas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [lancando, setLancando] = useState(null);

  const carregar = useCallback(async () => {
    if (!companyId || !parcelaApi?.listParcelasPendentesBaixa) return;
    setCarregando(true);
    try {
      const out = await parcelaApi.listParcelasPendentesBaixa(companyId);
      setParcelas(Array.isArray(out?.parcelas) ? out.parcelas : []);
    } catch { setParcelas([]); }
    finally { setCarregando(false); }
    // `refreshKey` é a dependência que faz a fila recarregar quando um "Buscar pagamento" na linha
    // da parcela localiza o comprovante — é exatamente aí que a parcela ENTRA nesta lista, e sem
    // isso ela só apareceria no próximo F5.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, refreshKey]);

  useEffect(() => { carregar(); }, [carregar]);

  async function lancar(guideId) {
    if (lancando) return;
    setLancando(guideId);
    try {
      const out = await parcelaApi.lancarBaixaParcela(companyId, guideId);
      // ⚠ RECUSA NÃO É SUCESSO. O servidor pode responder `skipped` — a parcela já tem lançamento,
      // o parcelamento não tem provisão de abertura, o comprovante não é de parcela. Antes tudo
      // isso voltava como 201 `ok:true`: o contador clicava, a linha sumia da lista e ele ficava
      // achando que lançou. Agora a recusa aparece com o motivo.
      if (out?.skipped) {
        const MOTIVOS = {
          ja_baixada: "esta parcela já tem lançamento de baixa.",
          provisao_inexistente: "o parcelamento não tem a provisão de abertura — lance a adesão antes.",
          sem_composicao: "a parcela não tem composição por tributo, então não dá para separar principal, juros e multa.",
          comprovante_nao_e_parcela: "o documento arrecadado não é uma parcela deste parcelamento.",
          nao_e_parcela: "esta guia não pertence a um parcelamento.",
          guide_not_found: "guia não encontrada.",
          parcelamento_not_found: "parcelamento não encontrado.",
        };
        window.alert(`Nada foi lançado: ${MOTIVOS[out.motivo] || out.motivo || "o servidor recusou."}`);
        await carregar();
        return;
      }
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao lançar.");
      await carregar();
    } catch (err) {
      window.alert(err?.message || "Falha ao lançar a baixa da parcela.");
    } finally { setLancando(null); }
  }

  if (!carregando && parcelas.length === 0) return null;

  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase" };
  const td = { padding: "6px 8px", fontSize: "0.82rem", color: PANEL.text };

  return (
    <section style={{ background: "#21222C", border: "1px solid #FFB347", borderRadius: 10, padding: 14 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: "#FFB347", fontSize: "0.9rem" }}>
          Parcelas pagas aguardando lançamento ({parcelas.length})
        </strong>
        <div style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
          O pagamento já foi confirmado; falta gerar a baixa contábil.
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#282A36" }}>
              <th style={th}>Competência</th>
              <th style={{ ...th, textAlign: "right" }}>Valor</th>
              <th style={th}>Pagamento</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => (
              <tr key={p.guideId} style={{ borderTop: "1px solid #2b2d45" }}>
                <td style={td}>{p.competencia}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(p.valor)}</td>
                <td style={{ ...td, color: PANEL.muted }}>
                  {p.comprovante?.dataArrecadacao
                    ? `${p.comprovante.dataArrecadacao} (comprovante)`
                    : (p.confirmadoEm ? new Date(p.confirmadoEm).toLocaleDateString("pt-BR") : "—")}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => lancar(p.guideId)}
                    disabled={Boolean(lancando)}
                    style={{
                      padding: "4px 10px", borderRadius: 6, cursor: lancando ? "default" : "pointer",
                      background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)",
                      fontSize: "0.78rem", fontWeight: 700,
                    }}
                  >
                    {lancando === p.guideId ? "Lançando…" : "Dar baixa"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ParcelamentoTab({ companyId, parcelamentos, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  // Recarga da fila de baixa pendente depois de um pagamento localizado na linha da parcela.
  const [baixaRefreshKey, setBaixaRefreshKey] = useState(0);

  // ⚠ MESMA ROTA DAS OUTRAS GUIAS. Uma parcela É uma `Guide` com `parcelamentoId`, então
  // `buscarPagamentoGuia(guideId)` é literalmente a chamada que a Circular já faz nos tributos —
  // não existe caminho novo de backend aqui.
  const buscarPagamentoParcela = useCallback(async (guideId) => {
    if (!parcelaApi?.buscarPagamentoGuia) {
      const err = new Error("A busca de pagamento não está disponível neste modo de API.");
      err.code = "BUSCA_INDISPONIVEL";
      throw err;
    }
    return parcelaApi.buscarPagamentoGuia(guideId);
  }, []);

  const aposLocalizarPagamento = useCallback(async () => {
    setBaixaRefreshKey((k) => k + 1);
    await parcelamentos?.load?.();
  }, [parcelamentos]);

  if (!parcelamentos) {
    return <div style={{ padding: 24, color: PANEL.muted }}>Carregando…</div>;
  }

  return (
    /* Largura de trabalho (~90%): a lista de parcelamentos tem parcela, valor, vencimento, status
       e ações por linha, e em 1100px as colunas truncavam com a tela sobrando. */
    <div style={{ padding: "24px 0", width: "var(--content-wide)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.15rem", color: PANEL.text }}>Parcelamentos</h1>
        <span style={{ fontSize: "0.85rem", color: PANEL.muted }}>
          Conferência de parcelas, baixa das parcelas pagas, contas de lançamento e rescisão.
          Novos parcelamentos entram pela guia (Lançamentos / Guias).
        </span>
      </div>

      <ParcelasPendentesBaixa companyId={companyId} refreshKey={baixaRefreshKey} />

      <ConferenciaParcelasPanel
        listConferencia={parcelamentos.listConferencia}
        aprovarConferencia={parcelamentos.aprovarConferencia}
      />

      <ParcelamentosList
        parcelamentos={(parcelamentos.parcelamentos || []).filter((p) => p.status !== "RESCINDIDO")}
        loading={parcelamentos.loading}
        onRescindir={(parcId, body) => parcelamentos.rescindir(parcId, body)}
        getConfig={parcelamentos.getConfig}
        saveConfig={parcelamentos.saveConfig}
        accounts={accounts}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
        onBuscarPagamentoParcela={buscarPagamentoParcela}
        onParcelaAtualizada={aposLocalizarPagamento}
      />
    </div>
  );
}
