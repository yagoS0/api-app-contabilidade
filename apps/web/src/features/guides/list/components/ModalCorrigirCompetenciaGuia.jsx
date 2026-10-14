import { mensagemCorrecaoGuia } from "./mensagemCorrecaoGuia";
import { useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";

const formatar = valor => /^\d{4}-\d{2}$/.test(valor || "") ? `${valor.slice(5)}/${valor.slice(0, 4)}` : valor;
export function ModalCorrigirCompetenciaGuia({ api, companyId, guia, aoFechar, aoCorrigir }) {
  const [competencia, setCompetencia] = useState(guia.competencia || "");
  const [previa, setPrevia] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [concluida, setConcluida] = useState(false);
  const guideId = guia.guideId || guia.id;
  async function salvar() {
    if (ocupado || concluida) return;
    setOcupado(true); setErro(null);
    try {
      if (!previa) {
        const r = await api.preverCorrecaoCompetenciaGuia(companyId, guideId, competencia);
        if (!r?.revisao || r.guideId !== guideId || r.companyId !== companyId || r.novaCompetencia !== competencia) throw new Error("Não foi possível conferir a alteração desta guia.");
        setPrevia(r);
      } else {
        const r = await api.corrigirCompetenciaGuia(companyId, guideId, { competencia, revisao: previa.revisao });
        if (r?.ok !== true || r.guideId !== guideId || r.competencia !== competencia) throw new Error("A correção não foi confirmada. Atualize a lista para conferir.");
        setConcluida(true);
        try { await aoCorrigir?.(); } catch { setErro("Competência corrigida. Atualize a página para recarregar a lista."); }
      }
    } catch (e) { setErro(mensagemCorrecaoGuia(e, "Não foi possível corrigir a competência.")); setPrevia(null); }
    finally { setOcupado(false); }
  }
  return <Modal titulo="Corrigir competência" tamanho="sm" ocupado={ocupado} aoFechar={aoFechar} rodape={<>
    <Button variant="secondary" disabled={ocupado} onClick={aoFechar}>Fechar</Button>
    {!concluida && <Button disabled={ocupado || !competencia || competencia === guia.competencia} onClick={salvar}>{ocupado ? (previa ? "Corrigindo…" : "Conferindo…") : previa ? "Confirmar correção" : "Conferir alteração"}</Button>}
  </>}>
    <p>{guia.tipo} · Competência cadastrada: <strong>{formatar(guia.competencia)}</strong></p>
    {concluida ? <p role="status">Competência corrigida para {formatar(competencia)}.</p> : <>
      <label htmlFor="guia-nova-competencia">Competência correta</label>
      <input id="guia-nova-competencia" type="month" value={competencia} disabled={ocupado} onChange={e => { setCompetencia(e.target.value); setPrevia(null); setErro(null); }} style={{ display: "block", width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 40, marginTop: 8, padding: 8, color: "var(--text)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }} />
      <p>Informe a competência que consta no PDF. O documento, o valor e o vencimento serão mantidos.</p>
      {previa && <p role="status">Alterar de <strong>{formatar(previa.competenciaAtual)}</strong> para <strong>{formatar(previa.novaCompetencia)}</strong>?</p>}
    </>}
    {erro && <p role="alert">{erro}</p>}
  </Modal>;
}

