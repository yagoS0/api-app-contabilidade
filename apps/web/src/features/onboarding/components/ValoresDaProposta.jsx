import { useId, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

const emReais = valor => Number.isSafeInteger(valor) && valor >= 0 ? (valor / 100).toFixed(2).replace(".", ",") : "";

export function ValoresDaProposta({ onboarding, anterior, escopo, onGerar, correcao = false }) {
  const snapshot = anterior?.snapshot;
  const abertura = onboarding.origem === "ABERTURA";
  const mensal = onboarding.dados?.modalidadeServico !== "AVULSO";
  const avulso = abertura || ["AVULSO", "COMPARAR"].includes(onboarding.dados?.modalidadeServico);
  const campos = [
    ...(avulso ? [[abertura ? "aberturaCentavos" : "servicoCentavos", abertura ? "Abertura" : "Outro serviço avulso"]] : []),
    ...(mensal ? [["mensalCentavos", "Mensalidade personalizada"]] : []),
    ["regularizacaoCentavos", "Regularização"], ["taxasCentavos", "Taxas públicas"],
  ];
  const [ajustes, setAjustes] = useState(() => ({
    [abertura ? "aberturaCentavos" : "servicoCentavos"]: emReais(snapshot?.opcoes?.find(o => !o.recorrente)?.unicoCentavos ?? (abertura ? snapshot?.opcoes?.find(o => o.recorrente)?.unicoCentavos : null)),
    mensalCentavos: emReais(snapshot?.opcoes?.find(o => o.recorrente)?.mensalCentavos),
    regularizacaoCentavos: emReais(snapshot?.regularizacaoCentavos), taxasCentavos: emReais(snapshot?.taxasCentavos),
  }));
  const [justificativa, setJustificativa] = useState(snapshot?.justificativa || "");
  const [erro, setErro] = useState("");
  const justificativaRef = useRef(null), erroId = useId();
  const temAjustes = campos.some(([k]) => ajustes[k]?.trim());
  async function gerar() {
    setErro("");
    const valores = {};
    for (const [k] of campos) {
      const valor = ajustes[k]?.trim();
      if (!valor) continue;
      if (!/^\d+(,\d{1,2})?$/.test(valor)) { setErro("Informe valores sem milhar, usando vírgula para centavos."); return; }
      valores[k] = Math.round(Number(valor.replace(",", ".")) * 100);
      if (!Number.isSafeInteger(valores[k])) { setErro("Confira os valores informados."); return; }
    }
    if (Object.keys(valores).length && !justificativa.trim()) {
      setErro("Explique a fonte e o motivo dos valores informados antes de gerar a proposta.");
      justificativaRef.current?.focus();
      return;
    }
    await onGerar({ ...valores, justificativa: justificativa.trim(), escopoAvulso: escopo || snapshot?.servicosConferidos || "",
      ...(snapshot?.taxasConfirmadas && valores.taxasCentavos === snapshot.taxasCentavos ? { taxasConfirmadas: true } : {}) });
  }
  return <section aria-label={correcao ? "Corrigir proposta pendente" : "Valores da proposta"}>
    {correcao && <h4>Corrigir e gerar uma nova versão</h4>}
    <p>{anterior ? `Valores recuperados da proposta ${anterior.versao}. Confira os campos e registre a justificativa; a versão anterior será preservada.` : "A mensalidade vem do catálogo aprovado. Preencha somente os valores que deseja personalizar e os serviços ou taxas aplicáveis."}</p>
    {campos.map(([k, nome]) => <label key={k}>{nome} (R$)<input inputMode="decimal" value={ajustes[k] || ""} onChange={e => { setAjustes({ ...ajustes, [k]: e.target.value }); setErro(""); }} /></label>)}
    <label>Fonte, escopo e justificativa dos ajustes<textarea ref={justificativaRef} aria-required={temAjustes} aria-invalid={Boolean(erro && !justificativa.trim())} aria-describedby={erro ? erroId : undefined} rows={3} value={justificativa} onChange={e => { setJustificativa(e.target.value); setErro(""); }} /></label>
    <p className="lead-preview-caption">{temAjustes ? "Obrigatório: explique de onde vêm os valores e o motivo dos ajustes. Este texto é interno e não aparece no PDF do cliente." : "Se usar apenas os valores do catálogo, não é necessário justificar ajustes."}</p>
    {erro && <p id={erroId} role="alert">{erro}</p>}
    <Button type="button" onClick={gerar}>{correcao ? "Gerar versão corrigida para revisão" : "Gerar proposta para revisão"}</Button>
  </section>;
}
