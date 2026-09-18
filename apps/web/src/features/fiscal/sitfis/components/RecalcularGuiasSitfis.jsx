import { useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { Feedback } from "../../../../components/ui/Feedback";
import { ehGuiaDeParcelamento, rotuloTipoGuia } from "../../../guides/lib/rotuloGuia";

const idGuia = (guia) => guia?.guideId || guia?.id;
const vencida = (guia) => guia.vencida === true || guia.paymentStatus === "OVERDUE";
const moeda = (valor) => valor == null || !Number.isFinite(Number(valor))
  ? "Valor não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function motivoIndisponivel(guia) {
  if (ehGuiaDeParcelamento(guia)) return "use a área de parcelamentos";
  if (guia.tipo === "INSS") return /^\d{4}-\d{2}$/.test(guia.competencia || "") ? "" : "competência não informada";
  if ((guia.tipo === "SIMPLES" || guia.especieRecalculo === "DARF_PRESUMIDO") && guia.canRecalculate) return "";
  return "recálculo indisponível para esta guia";
}

// As linhas do relatório SITFIS não possuem guideId. A seleção usa exclusivamente as guias
// cadastradas da empresa, sem inferir vínculo com um débito pelo valor ou pela competência.
export function RecalcularGuiasSitfis({ guidesPanel = {}, feedback = {} }) {
  const [selecionada, setSelecionada] = useState("");
  const [incluirNaoVencidas, setIncluirNaoVencidas] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erroLocal, setErroLocal] = useState("");
  const bloqueio = useRef(false);
  const { guides = [], loading, recalculatingGuideId, recalcInssBusy } = guidesPanel;
  const emAberto = guides.filter((guia) => guia.paymentStatus !== "PAID");
  const guias = emAberto.filter((guia) => incluirNaoVencidas || vencida(guia));
  const guia = guias.find((item) => idGuia(item) === selecionada);
  const ocupado = processando || Boolean(loading) || Boolean(recalculatingGuideId) || Boolean(recalcInssBusy);
  const handler = (item) => item?.tipo === "INSS" ? guidesPanel.onRecalcularInss : guidesPanel.onRecalculateGuide;
  const rotulo = (item) => `${rotuloTipoGuia(item)} · ${item.competencia || "Competência não informada"} · ${moeda(item.valorRecalculado ?? item.valor)}${vencida(item) ? " · Vencida" : ""}`;

  async function confirmar() {
    if (bloqueio.current || ocupado || !confirmacao) return;
    // Revalida contra a lista atual: uma atualização pode ter marcado a guia como paga.
    const atual = emAberto.find((item) => idGuia(item) === idGuia(confirmacao));
    if (!atual || motivoIndisponivel(atual) || !handler(atual)) {
      setErroLocal("Esta guia não está mais disponível para recálculo. Atualize a lista de guias.");
      setConfirmacao(null);
      return;
    }
    bloqueio.current = true;
    setProcessando(true);
    setErroLocal("");
    try {
      await handler(atual)(atual.tipo === "INSS" ? atual.competencia : idGuia(atual));
      // Os handlers existentes apresentam o desfecho real no feedback; resolver a Promise
      // não significa sucesso, pois eles também tratam erros internamente.
      setConfirmacao(null);
    } catch (erro) {
      setErroLocal(erro?.message || "Não foi possível recalcular a guia.");
      setConfirmacao(null);
    } finally {
      bloqueio.current = false;
      setProcessando(false);
    }
  }

  return (
    <section style={{ marginTop: 20 }} aria-label="Recálculo de guias cadastradas">
      <details style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", background: "var(--bg-surface)" }}>
        <summary style={{ cursor: "pointer", color: "var(--text)", fontWeight: 600 }}>Recalcular guias</summary>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "12px 0" }}>
          Guias cadastradas nesta empresa. Os débitos do relatório não são vinculados automaticamente a elas.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem", marginBottom: 12 }}>
          <input type="checkbox" checked={incluirNaoVencidas} disabled={ocupado} onChange={(event) => { setIncluirNaoVencidas(event.target.checked); setSelecionada(""); }} />
          Mostrar também guias não vencidas
        </label>
        {loading ? <p role="status">Carregando guias…</p> : guias.length ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 6, flex: "1 1 300px", minWidth: 0, fontSize: "0.85rem" }}>
              Guia
              <select aria-label="Guia para recalcular" value={guia ? selecionada : ""} disabled={ocupado} onChange={(event) => setSelecionada(event.target.value)} style={{ width: "100%", minWidth: 0, background: "var(--bg-subtle)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 10px" }}>
                <option value="">Selecione uma guia</option>
                {guias.map((item) => {
                  const motivo = motivoIndisponivel(item);
                  return <option key={idGuia(item)} value={idGuia(item)} disabled={Boolean(motivo)}>{rotulo(item)}{motivo ? ` — ${motivo}` : ""}</option>;
                })}
              </select>
            </label>
            <Button variant="secondary" disabled={ocupado || !guia || Boolean(motivoIndisponivel(guia)) || !handler(guia)} onClick={() => { setErroLocal(""); setConfirmacao(guia); }}>Recalcular</Button>
          </div>
        ) : <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{incluirNaoVencidas ? "Nenhuma guia em aberto cadastrada." : "Nenhuma guia vencida cadastrada. Você pode incluir as guias não vencidas acima."}</p>}
      </details>
      <Feedback message={feedback.message} error={erroLocal || feedback.error} />
      {confirmacao && (
        <Modal titulo="Confirmar recálculo da guia" tamanho="sm" ocupado={ocupado} aoFechar={() => setConfirmacao(null)} rodape={<>
          <Button variant="secondary" disabled={ocupado} onClick={() => setConfirmacao(null)}>Cancelar</Button>
          <Button variant="primary" disabled={ocupado} onClick={confirmar}>{ocupado ? "Recalculando…" : "Confirmar recálculo"}</Button>
        </>}>
          <p style={{ fontWeight: 600 }}>{rotulo(confirmacao)}</p>
          <p>{confirmacao.avisoDeRecalculo?.texto || "O pedido consulta a Receita para gerar a guia novamente. Pode haver juros e multa; confira o documento retornado. A consulta pode ter custo para o escritório."}</p>
          {confirmacao.tipo !== "INSS" && <p>O fluxo de recálculo também pode enviar a nova guia por e-mail ao cliente.</p>}
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>O relatório de situação fiscal salvo permanece como estava na última consulta.</p>
        </Modal>
      )}
    </section>
  );
}
