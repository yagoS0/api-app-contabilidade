// R4 — "+ Subir Guia → PARCELAMENTO": a guia como ANEXO de um contrato que já existe.
//
// ⚠ O PARCELAMENTO VEM PRIMEIRO. É a inversão inteira desta fase num só arranjo de tela: o modal
// antigo perguntava "esta guia é de parcelamento?" DEPOIS de já ter subido o documento, e podia
// CRIAR um contrato a partir dele. Aqui o contrato é o assunto — ele é escolhido no primeiro campo
// (ou criado ali mesmo, pelo wizard) — e a guia é evidência de UMA prestação dele.
//
// ⚠ ANEXAR É SÓ ANEXAR. O caminho antigo, ao anexar uma parcela a um parcelamento existente, também
// chamava `onConfirmGuidePayment` — com `catch {}` engolindo a falha e NADA na UI anunciando que um
// pagamento tinha sido confirmado. Anexar um documento e afirmar que ele foi pago são dois fatos
// diferentes; a confirmação de pagamento continua sendo o botão "Confirmar pagamento" da barra de
// ações, e a baixa contábil continua sendo ato deliberado na aba Parcelamento.
//
// ⚠ O PDF É OBRIGATÓRIO AQUI, e não por escolha de tela: `POST /firm/companies/:id/guides/upload` é
// a ÚNICA porta de criação de guia e recusa sem arquivo (`file_required`). O que é opcional é a
// GUIA — o contrato vive sem ela (débito automático não emite nenhuma, contrato migrado não tem as
// antigas), e é por isso que este modal não é caminho obrigatório de nada.

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import {
  tipoGuiaSugerido, parcelaSugerida, opcoesDeParcela, dataParaInput,
  avisosDeDuplicidade, parcelamentosSelecionaveis, rotuloDoParcelamento, normalizarCompetencia,
} from "../../lib/anexoParcelamento";

const PANEL = { surface: "#24253A", field: "#1A1B26", border: "#44475A", text: "#F8F8F2", muted: "#aeb6d3" };
const FIELD = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "8px 10px", fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
};
const LBL = { display: "block", fontSize: "0.72rem", color: PANEL.muted, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" };

const TIPOS_GUIA = ["SIMPLES", "INSS", "DARF", "ISS", "PIS", "COFINS", "IRPJ", "CSLL", "FGTS", "OUTRA"];

function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

export function GuiaDeParcelamentoModal({
  parcelamentosAtivos = [],
  guias = [],
  arquivo,               // File | null — escolhido pelo botão abaixo
  onEscolherArquivo,     // () => void  — abre o file picker do pai
  onCriarNovoParcelamento, // () => void — abre o wizard; o pai devolve o novo em `parcelamentoIdInicial`
  parcelamentoIdInicial = "",
  onSalvar,              // ({ metadata, parcelamentoId, numeroParcela, header }) => Promise<{ok, message?}>
  onClose,
  saving = false,
}) {
  const ativos = useMemo(() => parcelamentosSelecionaveis(parcelamentosAtivos), [parcelamentosAtivos]);
  const [parcId, setParcId] = useState(parcelamentoIdInicial || (ativos.length === 1 ? ativos[0].id : ""));
  const [numeroParcela, setNumeroParcela] = useState("");
  const [alterandoParcela, setAlterandoParcela] = useState(false);
  const [competencia, setCompetencia] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("");
  const [erro, setErro] = useState("");
  const [confirmandoDuplicidade, setConfirmandoDuplicidade] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const parc = ativos.find((p) => p.id === parcId) || null;

  // O pai avisa qual parcelamento acabou de ser criado pelo wizard — e o modal volta com ele
  // selecionado, que é o pedido: "＋ Criar novo… abre o wizard e volta com ele selecionado".
  useEffect(() => {
    if (parcelamentoIdInicial) setParcId(parcelamentoIdInicial);
  }, [parcelamentoIdInicial]);

  // ⚠ TUDO É PRÉ-PREENCHIDO PELO CONTRATO. Competência, vencimento e valor da prestação já estão no
  // cronograma; redigitá-los é onde se erra dígito, e é o cronograma que decide atraso.
  useEffect(() => {
    if (!parc) return;
    const sug = parcelaSugerida(parc);
    setTipo((t) => t || tipoGuiaSugerido(parc.tipo));
    if (sug) {
      setNumeroParcela(String(sug.numeroParcela ?? ""));
      setCompetencia(normalizarCompetencia(sug.competencia));
      setVencimento(dataParaInput(sug.vencimento));
    }
    const v = parc.valorParcelaReferencia ?? parc.principalPerParcela;
    if (v != null) setValor(String(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcId]);

  // Trocar a parcela à mão re-deriva competência e vencimento DAQUELA prestação.
  function escolherParcela(n) {
    setNumeroParcela(String(n));
    const opcao = opcoesDeParcela(parc).find((o) => String(o.numeroParcela) === String(n));
    if (opcao) {
      setCompetencia(normalizarCompetencia(opcao.competencia));
      setVencimento(dataParaInput(opcao.vencimento));
    }
  }

  useEffect(() => {
    if (!arquivo) { setPdfUrl(null); return undefined; }
    const url = URL.createObjectURL(arquivo);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  const opcoes = parc ? opcoesDeParcela(parc) : [];
  const opcaoAtual = opcoes.find((o) => String(o.numeroParcela) === String(numeroParcela)) || null;
  const avisos = parc
    ? avisosDeDuplicidade({ guias, parcelamentoId: parc.id, numeroParcela: Number(numeroParcela) || null, competencia })
    : [];

  function validar() {
    if (!parc) return "Escolha o parcelamento a que esta guia pertence.";
    if (!numeroParcela) return "Escolha a prestação a que a guia será vinculada.";
    if (!/^\d{4}-\d{2}$/.test(competencia)) return "Competência deve estar no formato AAAA-MM.";
    if (!tipo) return "Escolha o tipo da guia.";
    if (!arquivo) {
      return "Selecione o PDF da guia. A guia É o documento — sem arquivo não há o que anexar "
        + "(a prestação já existe no cronograma do contrato).";
    }
    return "";
  }

  async function enviar(confirmadaDuplicidade = false) {
    const motivo = validar();
    if (motivo) { setErro(motivo); return; }
    if (avisos.length && !confirmadaDuplicidade) { setConfirmandoDuplicidade(true); return; }
    setErro("");
    setConfirmandoDuplicidade(false);
    try {
      const res = await onSalvar({
        metadata: {
          tipo,
          competencia,
          valor: valor !== "" ? Number(String(valor).replace(",", ".")) : null,
          vencimento: vencimento || null,
        },
        parcelamentoId: parc.id,
        numeroParcela: Number(numeroParcela),
        // O cabeçalho que o `POST /parcelamentos/ingestao` precisa para VINCULAR a guia ao contrato
        // existente. Nada aqui recria a provisão: `aberturaEntryId` já está setado.
        header: {
          tipo: parc.tipo,
          numeroParcelamento: parc.numeroParcelamento,
          numeroParcela: Number(numeroParcela),
          quantidadeParcelas: parc.numParcelas || parc.parcelasTotal || null,
          anoMesParcela: competencia.replace("-", ""),
          vencimento: vencimento || null,
        },
      });
      if (res?.ok === false) setErro(res?.message || res?.error || "Falha ao anexar a guia.");
    } catch (err) {
      setErro(err?.message || "Falha ao anexar a guia.");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: "4vh 4vw" }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, color: PANEL.text,
        width: "100%", maxWidth: 1100, maxHeight: "92vh", display: "grid",
        gridTemplateColumns: pdfUrl ? "55% 45%" : "1fr", overflow: "hidden",
      }}>
        {pdfUrl && (
          <div style={{ background: "#000", borderRight: `1px solid ${PANEL.border}` }}>
            <iframe src={pdfUrl} title="PDF da guia do parcelamento" style={{ width: "100%", height: "100%", border: 0 }} />
          </div>
        )}

        <div style={{ padding: "18px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Anexar guia a um parcelamento</h3>
              <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: PANEL.muted, lineHeight: 1.45 }}>
                O contrato já existe. Esta guia é a <strong>evidência de uma prestação</strong> dele —
                anexar <strong>não</strong> confirma pagamento nem lança baixa.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>

          {erro && (
            <div role="status" style={{ padding: 10, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: 6, color: "var(--state-danger)", fontSize: "0.8rem", lineHeight: 1.4 }}>
              {erro}
            </div>
          )}

          {/* 1 — O PARCELAMENTO, primeiro. */}
          <div>
            <label style={LBL} htmlFor="anexo-parcelamento">Parcelamento *</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select id="anexo-parcelamento" value={parcId} onChange={(e) => setParcId(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
                <option value="">— selecione o parcelamento —</option>
                {ativos.map((p) => <option key={p.id} value={p.id}>{rotuloDoParcelamento(p)}</option>)}
              </select>
              {onCriarNovoParcelamento && (
                <Button size="sm" variant="secondary" type="button" onClick={onCriarNovoParcelamento} style={{ whiteSpace: "nowrap" }}>
                  ＋ Criar novo…
                </Button>
              )}
            </div>
            {ativos.length === 0 && (
              <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "var(--state-warn)", lineHeight: 1.4 }}>
                Esta empresa não tem parcelamento ativo. Crie o contrato primeiro — ele existe sem
                guia nenhuma.
              </p>
            )}
          </div>

          {/* 2 — A LINHA DO VÍNCULO AUTOMÁTICO. */}
          {parc && (
            <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "9px 11px" }}>
              {!alterandoParcela ? (
                <div style={{ fontSize: "0.8rem", lineHeight: 1.5 }}>
                  {/* ⚠ O DENOMINADOR É `parcelasTotal`, o MESMO do card — não `numParcelas`.
                      `parcelasTotal` conta as prestações MATERIALIZADAS (`parcelasContratadas`), que
                      é de onde sai a lista do "alterar"; `numParcelas` é o cabeçalho do contrato. Os
                      dois coincidem em produção (`sincronizarParcelas` materializa `numParcelas`
                      linhas), e quando não coincidirem é o card que estaria certo — duas respostas
                      para "de quantas?" no mesmo fluxo é pior que uma resposta conservadora. */}
                  Será vinculada à <strong>parcela {numeroParcela || "?"} de {parc.parcelasTotal || parc.numParcelas || "?"}</strong>
                  {" "}
                  <button type="button" onClick={() => setAlterandoParcela(true)}
                    style={{ background: "none", border: "none", color: "var(--accent-purple)", cursor: "pointer", fontWeight: 700, textDecoration: "underline", fontSize: "0.78rem", padding: 0 }}>
                    alterar
                  </button>
                  {!numeroParcela && (
                    <div style={{ fontSize: "0.72rem", color: "var(--state-warn)", marginTop: 3 }}>
                      Nenhuma prestação em aberto e sem guia neste contrato — escolha a prestação em “alterar”.
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label style={LBL} htmlFor="anexo-parcela">Prestação</label>
                  <select id="anexo-parcela" value={numeroParcela} onChange={(e) => escolherParcela(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
                    <option value="">— escolha a prestação —</option>
                    {opcoes.map((o) => (
                      <option key={o.numeroParcela} value={o.numeroParcela}>
                        {o.numeroParcela}
                        {o.competencia ? ` · ${o.competencia}` : ""}
                        {o.historica ? " · quitada (histórica)" : o.quitada ? " · quitada" : ""}
                        {o.jaTemGuia ? " · já tem guia" : ""}
                      </option>
                    ))}
                  </select>
                  {opcaoAtual?.historica && (
                    <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "var(--state-warn)", lineHeight: 1.4 }}>
                      Esta prestação foi declarada como quitada antes deste sistema (histórica). Anexar
                      a guia não desfaz isso nem gera lançamento.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3 — Dados da guia, PRÉ-PREENCHIDOS PELO CONTRATO. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={LBL} htmlFor="anexo-tipo">Tipo da guia *</label>
              {/* ⚠ ERA FORÇADO A "SIMPLES" nos dois caminhos do modal antigo, inclusive numa parcela
                  de INSS. Agora é sugerido pela modalidade e fica editável. */}
              <select id="anexo-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }}>
                <option value="">— selecione —</option>
                {TIPOS_GUIA.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {parc && (
                <p style={{ margin: "4px 0 0", fontSize: "0.68rem", color: PANEL.muted }}>
                  Sugerido pela modalidade {parc.tipo}: {tipoGuiaSugerido(parc.tipo)}.
                </p>
              )}
            </div>
            <div>
              <label style={LBL} htmlFor="anexo-competencia">Competência * (AAAA-MM)</label>
              <input id="anexo-competencia" value={competencia} onChange={(e) => setCompetencia(e.target.value)} placeholder="2026-08" style={FIELD} autoComplete="off" />
            </div>
            <div>
              <label style={LBL} htmlFor="anexo-vencimento">Vencimento</label>
              <input id="anexo-vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} style={{ ...FIELD, colorScheme: "dark" }} />
            </div>
            <div>
              <label style={LBL} htmlFor="anexo-valor">Valor (R$)</label>
              <input id="anexo-valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" style={{ ...FIELD, textAlign: "right" }} />
              {parc && (
                <p style={{ margin: "4px 0 0", fontSize: "0.68rem", color: PANEL.muted }}>
                  Do contrato: R$ {fmtMoney(parc.valorParcelaReferencia ?? parc.principalPerParcela)}.
                </p>
              )}
            </div>
          </div>

          {/* 4 — O PDF. */}
          <div>
            <label style={LBL}>PDF da guia *</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button size="sm" variant="secondary" type="button" onClick={onEscolherArquivo}>
                {arquivo ? "Trocar PDF…" : "Escolher PDF…"}
              </Button>
              <span style={{ fontSize: "0.76rem", color: arquivo ? PANEL.text : PANEL.muted }}>
                {arquivo ? arquivo.name : "nenhum arquivo escolhido"}
              </span>
            </div>
            {/* ⚠ O motivo de o PDF ser exigido fica NA TELA, não escondido numa validação. */}
            {!arquivo && (
              <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: PANEL.muted, lineHeight: 1.45 }}>
                A guia <strong>é</strong> o documento: a única rota de criação de guia
                (<code>POST /guides/upload</code>) exige o arquivo. Anexar guia é que é opcional — em
                débito automático não existe nenhuma, e o contrato segue sendo acompanhado pelo
                cronograma.
              </p>
            )}
          </div>

          {avisos.length > 0 && (
            <div role="status" style={{ padding: "8px 10px", background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)", borderRadius: 6 }}>
              <div style={{ color: "var(--state-warn)", fontWeight: 700, fontSize: "0.74rem" }}>Possível duplicidade</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: PANEL.muted, fontSize: "0.72rem", lineHeight: 1.45 }}>
                {avisos.map((a) => <li key={a.slice(0, 40)}>{a}</li>)}
              </ul>
            </div>
          )}

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 10, borderTop: `1px solid ${PANEL.border}` }}>
            <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button variant="primary" type="button" onClick={() => enviar(false)} disabled={saving}>
              {saving ? "Anexando…" : "Anexar guia"}
            </Button>
          </div>
        </div>
      </div>

      {/* ⚠ REEMISSÃO É LEGÍTIMA — o aviso de duplicidade pede CONFIRMAÇÃO EXPLÍCITA, não recusa. */}
      {confirmandoDuplicidade && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1750, padding: 16 }}>
          <div style={{ background: PANEL.surface, border: "1px solid var(--state-warn)", borderRadius: 10, padding: 18, width: "min(94vw, 520px)", color: PANEL.text, display: "flex", flexDirection: "column", gap: 10 }}>
            <strong style={{ fontSize: "0.95rem", color: "var(--state-warn)" }}>Anexar mesmo assim?</strong>
            <ul style={{ margin: 0, paddingLeft: 18, color: PANEL.muted, fontSize: "0.78rem", lineHeight: 1.5 }}>
              {avisos.map((a) => <li key={a.slice(0, 40)}>{a}</li>)}
            </ul>
            <div style={{ fontSize: "0.76rem", color: PANEL.muted, lineHeight: 1.5 }}>
              Reemissão de guia é normal (vencida, recalculada com juros novos). Confirme se é este o caso.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" type="button" onClick={() => setConfirmandoDuplicidade(false)}>Voltar</Button>
              <Button variant="primary" type="button" onClick={() => enviar(true)}>Anexar assim mesmo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GuiaDeParcelamentoModal;
