// Aba "Parcelamento" (grupo Contabilidade) — e, desde a F2.3, a PORTA DE ENTRADA do parcelamento.
//
// ⚠ A CRIAÇÃO INVERTEU. Antes o parcelamento nascia como efeito colateral de subir uma guia; hoje
// ele é um CONTRATO de dívida, criado aqui pelo botão "+ Novo parcelamento", sem documento nenhum.
// A guia é evidência MENSAL e OPCIONAL — não existe em débito automático nem nas prestações de um
// acordo migrado de outra contabilidade — e entra depois, pelo "+ Subir Guia → PARCELAMENTO".
//
// Esta aba também é onde as parcelas são acompanhadas: conferência, baixa, contas e rescisão. O ato
// contábil de cada domínio vive no lugar onde ele é acompanhado — tributos na Circular, parcelas
// aqui.
//
// Dados: hook useParcelamentos (accountingPanel.parcelamentos). Ele carrega sozinho no mount
// e recarrega após cada ação (rescindir/config/conferência/criação).

import { useCallback, useEffect, useRef, useState } from "react";
import { ParcelamentosList, ConferenciaParcelasPanel } from "../components/ParcelamentoModals";
import { ParcelamentoWizard } from "../components/ParcelamentoWizard";
import { Button } from "../../../../components/ui/Button";
import { createApiClient } from "../../../../api/client";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0", border: "#44475A", surface: "#21222C", field: "#282A36" };
const parcelaApi = createApiClient();

function fmtMoney(v) {
  return Number.isFinite(Number(v))
    ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

// Os motivos de RECUSA da baixa, cada um com a saída que o contador precisa.
const MOTIVOS_RECUSA = {
  ja_baixada: "esta parcela já tem lançamento de baixa.",
  provisao_inexistente: "o parcelamento não tem a provisão de abertura — lance a adesão antes.",
  sem_composicao: "a parcela não tem composição por tributo, então não dá para separar principal, juros e multa.",
  comprovante_nao_e_parcela: "o documento arrecadado não é uma parcela deste parcelamento.",
  nao_e_parcela: "esta guia não pertence a um parcelamento.",
  guide_not_found: "guia não encontrada.",
  parcelamento_not_found: "parcelamento não encontrado.",
};

/**
 * ⚠ AUSÊNCIA NUNCA É RESPOSTA. Este painel fazia `if (!carregando && parcelas.length === 0) return
 * null` sobre um `catch { setParcelas([]) }`: uma falha de rede produzia EXATAMENTE o mesmo pixel
 * que "não há nada pendente" — zero. O padrão certo já existia no módulo (`ParcelasDoAcordo`):
 * o motivo em texto VISÍVEL, não só no `title`.
 *
 * Os três estados são distintos agora: carregando · falhou (com o motivo e "Tentar de novo") ·
 * vazio de verdade (dito, não escondido).
 */
function ParcelasPendentesBaixa({ companyId, refreshKey = 0, pedido, onPedidoAtendido }) {
  const [parcelas, setParcelas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [lancando, setLancando] = useState(null);
  const [desfechos, setDesfechos] = useState({}); // guideId → { tom, texto }
  const [foco, setFoco] = useState(null);          // { id, label } destacado pela barra do card
  const secaoRef = useRef(null);

  const carregar = useCallback(async () => {
    if (!companyId) { setCarregando(false); return; }
    if (!parcelaApi?.listParcelasPendentesBaixa) {
      setErro("A fila de parcelas pendentes não está disponível neste modo de API.");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const out = await parcelaApi.listParcelasPendentesBaixa(companyId);
      setParcelas(Array.isArray(out?.parcelas) ? out.parcelas : []);
    } catch (err) {
      // ⚠ O `catch` NÃO zera mais a lista em silêncio: ele guarda o motivo e a tela o mostra.
      setErro(err?.message || "Não foi possível carregar as parcelas pendentes de baixa.");
    } finally { setCarregando(false); }
    // `refreshKey` recarrega quando um "Buscar pagamento" na linha da parcela localiza o
    // comprovante — é exatamente aí que a parcela ENTRA nesta lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, refreshKey]);

  useEffect(() => { carregar(); }, [carregar]);

  // ─── o que a barra de ações do card pede ──────────────────────────────────────────────────────
  // `Dar baixa` traz o contador ATÉ a fila (rolando e destacando); `Baixa em lote` roda todas as
  // pendentes daquele contrato, depois de uma confirmação que LISTA cada uma. Nenhum dos dois
  // inventa rota: os dois usam `POST /parcelamentos/parcelas/:guideId/baixa`, uma por parcela.
  useEffect(() => {
    if (!pedido) return;
    setFoco(pedido.parcelamentoId ? { id: pedido.parcelamentoId, label: pedido.label || null } : null);
    secaoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (pedido.lote) baixarEmLote(pedido.parcelamentoId);
    onPedidoAtendido?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.nonce]);

  function confirmacaoDaBaixa(p) {
    const quando = p.comprovante?.dataArrecadacao
      || (p.confirmadoEm ? new Date(p.confirmadoEm).toLocaleDateString("pt-BR") : "data do comprovante não conhecida");
    return `parcela ${p.numeroParcela ?? "?"} — competência ${p.competencia || "?"}, valor ${fmtMoney(p.valor)}, pagamento em ${quando}`;
  }

  async function executarBaixa(p) {
    setDesfechos((d) => ({ ...d, [p.guideId]: null }));
    try {
      const out = await parcelaApi.lancarBaixaParcela(companyId, p.guideId);
      // ⚠ RECUSA NÃO É SUCESSO, E NÃO SOME. Antes o motivo saía num `window.alert` que desaparece
      // ao clicar OK; agora fica NA LINHA, como o `Desfecho` do `ParcelasDoAcordo` já fazia.
      if (out?.skipped) {
        setDesfechos((d) => ({
          ...d,
          [p.guideId]: { tom: "warn", texto: `Nada foi lançado: ${MOTIVOS_RECUSA[out.motivo] || out.motivo || "o servidor recusou."}` },
        }));
        return;
      }
      if (out?.ok === false) throw new Error(out?.message || out?.error || "Falha ao lançar.");
      setDesfechos((d) => ({ ...d, [p.guideId]: { tom: "ok", texto: "Baixa lançada." } }));
    } catch (err) {
      setDesfechos((d) => ({ ...d, [p.guideId]: { tom: "danger", texto: err?.message || "Falha ao lançar a baixa da parcela." } }));
    }
  }

  async function baixarEmLote(parcelamentoId) {
    const alvo = parcelas.filter((p) => !parcelamentoId || p.parcelamentoId === parcelamentoId);
    if (!alvo.length) {
      // ⚠ Nada a fazer TAMBÉM é resposta — e precisa ser dita, senão "cliquei e não aconteceu nada".
      setDesfechos((d) => ({ ...d, __lote: { tom: "warn", texto: "Nenhuma parcela paga deste contrato está aguardando lançamento." } }));
      return;
    }
    const lista = alvo.map((p) => `· ${confirmacaoDaBaixa(p)}`).join("\n");
    // eslint-disable-next-line no-alert
    if (!window.confirm(
      `Dar baixa em ${alvo.length} parcela(s):\n\n${lista}\n\n`
      + "Cada uma GRAVA lançamentos contábeis (principal, juros e multa separados) e amortiza o "
      + "passivo do parcelamento. Confirmar?",
    )) return;
    setLancando("__lote");
    try {
      for (const p of alvo) {
        // eslint-disable-next-line no-await-in-loop
        await executarBaixa(p);
      }
      await carregar();
    } finally { setLancando(null); }
  }

  async function lancar(p) {
    if (lancando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS. A baixa grava até quatro lançamentos e
    // amortiza passivo; antes saía num clique só, sem nada entre a intenção e o razão.
    const texto = `Dar baixa na ${confirmacaoDaBaixa(p)}.\n\n`
      + "Isto GRAVA lançamentos contábeis (principal, juros e multa em lançamentos separados) e "
      + "amortiza o passivo do parcelamento. Confirmar?";
    // eslint-disable-next-line no-alert
    if (!window.confirm(texto)) return;

    setLancando(p.guideId);
    try {
      await executarBaixa(p);
      await carregar();
    } finally { setLancando(null); }
  }

  const th = { padding: "6px 8px", textAlign: "left", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase" };
  const td = { padding: "6px 8px", fontSize: "0.82rem", color: PANEL.text, verticalAlign: "top" };

  const corpo = () => {
    if (carregando) return <div style={{ color: PANEL.muted, fontSize: "0.8rem" }}>Carregando as parcelas pagas…</div>;
    if (erro) {
      return (
        <div role="status" style={{ padding: "8px 10px", borderRadius: 6, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
          <div style={{ color: "var(--state-danger)", fontWeight: 700, fontSize: "0.74rem" }}>Não foi possível saber se há parcelas pendentes</div>
          <div style={{ color: PANEL.muted, fontSize: "0.7rem", marginTop: 2, lineHeight: 1.4 }}>
            {erro} — isto <strong>não</strong> quer dizer que não há nada pendente.
          </div>
          <button type="button" onClick={carregar} style={{ marginTop: 6, background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
            Tentar de novo
          </button>
        </div>
      );
    }
    if (!parcelas.length) {
      return <div style={{ color: PANEL.muted, fontSize: "0.78rem" }}>Nenhuma parcela paga aguardando lançamento.</div>;
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: PANEL.field }}>
              <th style={th}>Parc.</th>
              <th style={th}>Competência</th>
              <th style={{ ...th, textAlign: "right" }}>Valor</th>
              <th style={th}>Pagamento</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => {
              const desfecho = desfechos[p.guideId];
              const emVoo = lancando === p.guideId || lancando === "__lote";
              const destacada = Boolean(foco) && p.parcelamentoId === foco.id;
              return (
                <tr key={p.guideId} style={{
                  borderTop: `1px solid ${PANEL.border}`,
                  background: destacada ? "var(--accent-purple-surface)" : "transparent",
                }}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{p.numeroParcela ?? "?"}</td>
                  <td style={td}>{p.competencia}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmtMoney(p.valor)}</td>
                  <td style={{ ...td, color: PANEL.muted }}>
                    {p.comprovante?.dataArrecadacao
                      ? `${p.comprovante.dataArrecadacao} (comprovante)`
                      : (p.confirmadoEm ? new Date(p.confirmadoEm).toLocaleDateString("pt-BR") : "—")}
                  </td>
                  <td style={{ ...td, textAlign: "right", minWidth: 200 }}>
                    <button
                      type="button"
                      onClick={() => lancar(p)}
                      disabled={Boolean(lancando)}
                      // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário.
                      title={lancando ? "Aguarde: outra baixa está sendo lançada." : "Grava os lançamentos de baixa desta parcela (pede confirmação)."}
                      style={{
                        padding: "4px 10px", borderRadius: 6, cursor: lancando ? "not-allowed" : "pointer",
                        background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)",
                        fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap",
                      }}
                    >
                      {emVoo ? "Lançando…" : "Dar baixa"}
                    </button>
                    {desfecho && (
                      <div role="status" style={{
                        marginTop: 4, padding: "5px 8px", borderRadius: 6, textAlign: "left", lineHeight: 1.35,
                        fontSize: "0.68rem",
                        color: PANEL.muted,
                        background: desfecho.tom === "ok" ? "var(--state-ok-surface)" : desfecho.tom === "danger" ? "var(--state-danger-surface)" : "var(--state-warn-surface)",
                        border: `1px solid ${desfecho.tom === "ok" ? "var(--state-ok)" : desfecho.tom === "danger" ? "var(--state-danger)" : "var(--state-warn)"}`,
                      }}>
                        {desfecho.texto}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const corBorda = erro ? "var(--state-danger)" : parcelas.length ? "var(--state-warn)" : PANEL.border;
  const desfechoLote = desfechos.__lote;
  // ⚠ "CLIQUEI EM DAR BAIXA E NÃO ACONTECEU NADA" — era literalmente isto.
  // O `Dar baixa` do card não lança: ele TRAZ o contador até esta fila e destaca as parcelas do
  // contrato clicado. Quando o contrato não tem nenhuma parcela aqui, o clique rolava a página e o
  // subtítulo ainda dizia "Destacadas: as do contrato que você clicou" — com zero destacadas. Um
  // botão que promete uma ação e entrega silêncio é indistinguível de um botão quebrado.
  const focadas = foco && !erro && !carregando
    ? parcelas.filter((p) => p.parcelamentoId === foco.id).length
    : null;
  return (
    <section ref={secaoRef} style={{ background: PANEL.surface, border: `1px solid ${corBorda}`, borderRadius: 10, padding: 14, scrollMarginTop: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ color: parcelas.length ? "var(--state-warn)" : PANEL.text, fontSize: "0.9rem" }}>
          Parcelas pagas aguardando lançamento{parcelas.length ? ` (${parcelas.length})` : ""}
        </strong>
        <div style={{ color: PANEL.muted, fontSize: "0.78rem" }}>
          O pagamento já foi confirmado; falta gerar a baixa contábil.
          {focadas > 0 && " Destacadas: as do contrato que você clicou."}
        </div>
      </div>

      {/* ⚠ A RESPOSTA HONESTA DO "DAR BAIXA" QUE NÃO ACHA NADA — e ela nomeia a capacidade que
          FALTA, em vez de fingir que o contrato está em ordem. A fila é alimentada por
          `guia.paymentStatus = PAID` (a rota `parcelas-pendentes-baixa` filtra por `guia`), então
          prestação SEM guia não tem por onde entrar aqui. Isso não é caso de borda: débito
          automático não emite documento nenhum, e é assim que uma classe inteira de clientes paga.
          Dar baixa a partir do extrato, sem guia, é uma funcionalidade que ainda não existe — e
          dizer isso é decisão de produto do dono, não algo que a tela deva esconder atrás de um
          botão desabilitado. */}
      {focadas === 0 && (
        <div role="status" style={{
          marginBottom: 8, padding: "8px 10px", borderRadius: 6, lineHeight: 1.45,
          fontSize: "0.74rem", color: PANEL.muted,
          background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
        }}>
          <div style={{ color: "var(--state-warn)", fontWeight: 700, marginBottom: 2 }}>
            Nenhuma parcela de {foco.label || "deste contrato"} está aguardando lançamento
          </div>
          Uma prestação só entra nesta fila quando o pagamento dela está confirmado <strong>na
          guia</strong> — pela busca do comprovante no SERPRO (botão na linha da parcela) ou pelo
          “Confirmar pagamento” da aba Guias. Prestação <strong>sem guia</strong> — débito
          automático, ou contrato migrado de outra contabilidade — não tem por onde entrar:
          dar baixa a partir do extrato, sem documento, ainda não existe no sistema.
        </div>
      )}
      {desfechoLote && (
        <div role="status" style={{
          marginBottom: 8, padding: "6px 9px", borderRadius: 6, fontSize: "0.72rem", color: PANEL.muted,
          background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
        }}>
          {desfechoLote.texto}
        </div>
      )}
      {corpo()}
    </section>
  );
}

export function ParcelamentoTab({
  companyId, parcelamentos, accounts = [], onSearchHistoricos, onGetHistoricosByCode, onIrParaGuias,
  // R4 — o "＋ Criar novo…" do modal de anexo de guia chega aqui já pedindo o wizard aberto.
  abrirWizardAoMontar = false, onWizardAberto,
}) {
  // Recarga da fila de baixa pendente depois de um pagamento localizado na linha da parcela.
  const [baixaRefreshKey, setBaixaRefreshKey] = useState(0);
  const [wizardAberto, setWizardAberto] = useState(false);

  useEffect(() => {
    if (!abrirWizardAoMontar) return;
    setWizardAberto(true);
    onWizardAberto?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirWizardAoMontar]);
  // O que a barra de ações do card pede à fila de baixa. `nonce` porque o MESMO pedido pode ser
  // repetido (clicar "Dar baixa" duas vezes no mesmo contrato tem de rolar duas vezes).
  const [pedidoBaixa, setPedidoBaixa] = useState(null);
  const pedirBaixa = useCallback((parc, lote) => {
    setPedidoBaixa({
      parcelamentoId: parc?.id || null, label: parc?.label || null,
      lote: Boolean(lote), nonce: Date.now(),
    });
  }, []);

  // ⚠ MESMA ROTA DAS OUTRAS GUIAS. Uma parcela É uma `Guide` com `parcelamentoId`, então
  // `buscarPagamentoGuia(guideId)` é literalmente a chamada que a Circular já faz nos tributos.
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.15rem", color: PANEL.text }}>Parcelamentos</h1>
          <span style={{ fontSize: "0.85rem", color: PANEL.muted }}>
            O contrato entra aqui, sem guia nenhuma. A guia de cada mês é evidência opcional e se
            anexa depois, pelo <strong>+ Subir Guia → PARCELAMENTO</strong> na aba Guias.
          </span>
        </div>
        <Button variant="primary" type="button" onClick={() => setWizardAberto(true)}>+ Novo parcelamento</Button>
      </div>

      {/* ⚠ `error` do hook aparece: `useParcelamentos` já o guardava e a tela o descartava, então
          falha ao listar parcelamentos era indistinguível de "esta empresa não tem parcelamento". */}
      {parcelamentos.error && (
        <div role="status" style={{ padding: "8px 12px", borderRadius: 8, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
          <div style={{ color: "var(--state-danger)", fontWeight: 700, fontSize: "0.78rem" }}>Não foi possível carregar os parcelamentos</div>
          <div style={{ color: PANEL.muted, fontSize: "0.72rem", marginTop: 2 }}>
            {parcelamentos.error} — a lista abaixo pode estar incompleta.
          </div>
        </div>
      )}

      <ParcelasPendentesBaixa
        companyId={companyId}
        refreshKey={baixaRefreshKey}
        pedido={pedidoBaixa}
        onPedidoAtendido={() => setPedidoBaixa(null)}
      />

      <ConferenciaParcelasPanel
        listConferencia={parcelamentos.listConferencia}
        aprovarConferencia={parcelamentos.aprovarConferencia}
      />

      <ParcelamentosList
        parcelamentos={(parcelamentos.parcelamentos || []).filter((p) => p.status !== "RESCINDIDO")}
        loading={parcelamentos.loading}
        onRescindir={(parcId, body) => parcelamentos.rescindir(parcId, body)}
        onOpenCreate={() => setWizardAberto(true)}
        getConfig={parcelamentos.getConfig}
        saveConfig={parcelamentos.saveConfig}
        accounts={accounts}
        onSearchHistoricos={onSearchHistoricos}
        onGetHistoricosByCode={onGetHistoricosByCode}
        onBuscarPagamentoParcela={buscarPagamentoParcela}
        onParcelaAtualizada={aposLocalizarPagamento}
        onDarBaixa={(parc) => pedirBaixa(parc, false)}
        onBaixaEmLote={(parc) => pedirBaixa(parc, true)}
        onSubirGuia={onIrParaGuias ? () => onIrParaGuias() : null}
      />

      {wizardAberto && (
        <ParcelamentoWizard
          onIngest={(body) => parcelamentos.ingest(body)}
          onConsultSerpro={parcelamentos.consultarSerpro}
          getContasProvisao={parcelamentos.getContasProvisao}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
          saving={parcelamentos.saving}
          onClose={() => setWizardAberto(false)}
        />
      )}
    </div>
  );
}
