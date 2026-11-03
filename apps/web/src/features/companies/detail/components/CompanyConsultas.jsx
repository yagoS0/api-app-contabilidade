import { useEffect, useRef, useState } from "react";
import { CONSULTA_OPERATIONS } from "../../../fiscal/serpro/lib/consultaOperations";
import { Button } from "../../../../components/ui/Button";
import { Feedback } from "../../../../components/ui/Feedback";
import { useConfirmacao } from "../../../../components/ui/useConfirmacao";
import "../../../fiscal/serpro/pages/consultas.css";

export function CompanyConsultas({ companyId, competencia, onRunOp }) {
  const [op, setOp] = useState("extrato");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);
  const { pedir, dialogo } = useConfirmacao();
  const scope = `${companyId}:${competencia}`;
  const current = useRef(scope);
  current.current = scope;
  const lock = useRef(false);
  useEffect(() => { current.current = scope; setResultado(null); return () => { current.current = null; }; }, [scope]);
  const operacao = CONSULTA_OPERATIONS.find(i => i.key === op);
  async function executar() {
    if (lock.current || !companyId || !onRunOp) return;
    lock.current = true;
    try {
      const confirmou = await pedir({ titulo: "Executar consulta", acao: "Executar consulta", texto: `${operacao.label}. ${operacao.useRange ? `Competência ${competencia}.` : "Consulta sem recorte mensal."} Pode consumir consulta paga. O extrato salvo é reaproveitado quando disponível. Consulta de pagamento não substitui a conferência da baixa contábil.` });
      if (!confirmou || current.current !== scope) return;
      setBusy(true);
      setResultado(null);
      const r = await onRunOp(op, companyId, operacao.useRange ? competencia : undefined);
      if (current.current !== scope) return;
      setResultado(typeof r?.ok === "boolean" ? { ...r, message: r.message || (r.ok ? "Consulta concluída." : "Consulta não concluída. Confira os dados antes de repetir.") } : { ok: false, message: "Resposta sem confirmação. Confira o resultado antes de repetir a consulta paga." });
    } catch (e) {
      if (current.current === scope) setResultado({ ok: false, message: e?.message || "Resultado não confirmado. Confira antes de repetir." });
    } finally {
      lock.current = false;
      if (current.current === scope) setBusy(false);
    }
  }
  return <section className="consultas-content" aria-label="Consultas da empresa">
    <h2>Consultas</h2>
    <p>Empresa fixa neste atendimento · Competência {competencia || "não informada"}</p>
    <label htmlFor="consulta-empresa-operacao">Consulta</label>
    <select id="consulta-empresa-operacao" value={op} disabled={busy} onChange={e => { setOp(e.target.value); setResultado(null); }} style={{ display: "block", width: "100%", margin: "var(--space-3) 0" }}>
      {CONSULTA_OPERATIONS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
    </select>
    {!operacao.useRange && <p>Esta consulta não usa competência.</p>}
    <Button onClick={executar} disabled={busy || !onRunOp || !companyId || (operacao.useRange && !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || ""))}>{busy ? "Consultando…" : "Executar consulta"}</Button>
    {busy && <p role="status">Consulta em andamento. Não repita a operação.</p>}
    <Feedback message={resultado?.ok ? resultado.message : ""} error={resultado && !resultado.ok ? resultado.message : ""} />
    {dialogo}
  </section>;
}
