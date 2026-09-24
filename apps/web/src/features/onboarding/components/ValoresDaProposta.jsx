import { useId, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

const emReais = valor => Number.isSafeInteger(valor) && valor >= 0 ? (valor / 100).toFixed(2).replace(".", ",") : "";

export function ValoresDaProposta({ onboarding, anterior, escopo, regularizacao, onGerar, correcao = false }) {
  const snapshot = anterior?.snapshot;
  const abertura = onboarding.origem === "ABERTURA";
  const encerramento = onboarding.origem === "INATIVA" && onboarding.dados?.pretendeReativar === "BAIXAR";
  const mensal = !encerramento && onboarding.dados?.modalidadeServico !== "AVULSO";
  const avulso = encerramento || abertura || ["AVULSO", "COMPARAR"].includes(onboarding.dados?.modalidadeServico);
  const decisao = regularizacao || snapshot?.decisaoRegularizacao;
  const [tipoServicoAvulso, setTipoServicoAvulso] = useState(snapshot?.tipoServicoAvulso || "");
  const propriaRegularizacao = !abertura && avulso && tipoServicoAvulso === "REGULARIZACAO";
  const campos = [
    ...(avulso && !propriaRegularizacao ? [[abertura ? "aberturaCentavos" : "servicoCentavos", abertura ? "Abertura" : tipoServicoAvulso === "BAIXA" ? "Encerramento da empresa" : "Serviço avulso"]] : []),
    ...(mensal ? [["mensalCentavos", "Mensalidade personalizada"]] : []),
    ...(decisao?.necessaria || propriaRegularizacao ? [["regularizacaoCentavos", propriaRegularizacao ? "Regularização — valor total do serviço avulso" : encerramento ? "Regularização necessária antes do encerramento" : "Regularização anterior à mensalidade"]] : []), ["taxasCentavos", "Taxas públicas"],
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
    if (encerramento && onboarding.dados?.modalidadeServico !== "AVULSO") { setErro("O cliente escolheu encerrar a empresa. Em Dados para o orçamento, altere a modalidade para serviço avulso e confira o serviço de encerramento."); return; }
    if (encerramento && tipoServicoAvulso !== "BAIXA") { setErro("Selecione Encerramento da empresa para o serviço avulso deste atendimento."); return; }
    if (!abertura && !decisao) { setErro("Volte ao diagnóstico e confira se há regularização necessária antes de gerar valores."); return; }
    if (!abertura && avulso && !tipoServicoAvulso) { setErro("Escolha o tipo de serviço avulso."); return; }
    if (propriaRegularizacao && decisao?.necessaria === false) { setErro("O diagnóstico dispensa regularização. Confira o serviço escolhido ou revise o diagnóstico."); return; }
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
    await onGerar({ ...valores, ...(!abertura && avulso ? { tipoServicoAvulso } : {}), justificativa: justificativa.trim(), escopoAvulso: escopo || snapshot?.servicosConferidos || "",
      ...(snapshot?.taxasConfirmadas && valores.taxasCentavos === snapshot.taxasCentavos ? { taxasConfirmadas: true } : {}) });
  }
  return <section aria-label={correcao ? "Corrigir proposta pendente" : "Valores da proposta"}>
    {correcao && <h4>Corrigir e gerar uma nova versão</h4>}
    <p>{anterior ? `Valores recuperados da proposta ${anterior.versao}. Confira os campos e registre a justificativa; a versão anterior será preservada.` : encerramento ? "Confira os honorários do encerramento e as taxas públicas conforme o escopo analisado." : "A mensalidade vem do catálogo aprovado. Personalizações respeitam o mínimo da faixa e dos adicionais contratados."}</p>
    {!abertura && <p>{decisao ? decisao.necessaria ? encerramento ? "Diagnóstico: há regularização a orçar antes do encerramento da empresa." : "Diagnóstico: há regularização a orçar antes do início da contabilidade mensal." : "Diagnóstico: não há regularização anterior necessária." : "Falta conferir no diagnóstico se há regularização necessária."}</p>}
    {encerramento && <p>O pedido é encerrar esta empresa. A proposta deve ser avulsa, com o serviço de encerramento e a regularização necessária discriminados.</p>}
    {!abertura && avulso && <label>Tipo de serviço avulso<select value={tipoServicoAvulso} onChange={e => { setTipoServicoAvulso(e.target.value); setErro(""); }}><option value="">Selecione o serviço conferido</option>{!encerramento && <option value="REGULARIZACAO">Regularização de pendências</option>}<option value="BAIXA">Encerramento da empresa</option>{!encerramento && <option value="OUTRO">Outro serviço pontual</option>}</select></label>}
    {propriaRegularizacao && <p>A regularização será cobrada uma única vez na opção avulsa. Na opção mensal, aparece separada dos honorários recorrentes.</p>}
    {campos.map(([k, nome]) => <label key={k}>{nome} (R$)<input inputMode="decimal" value={ajustes[k] || ""} onChange={e => { setAjustes({ ...ajustes, [k]: e.target.value }); setErro(""); }} /></label>)}
    <label>Fonte, escopo e justificativa dos ajustes<textarea ref={justificativaRef} aria-required={temAjustes} aria-invalid={Boolean(erro && !justificativa.trim())} aria-describedby={erro ? erroId : undefined} rows={3} value={justificativa} onChange={e => { setJustificativa(e.target.value); setErro(""); }} /></label>
    <p className="lead-preview-caption">{temAjustes ? "Obrigatório: explique de onde vêm os valores e o motivo dos ajustes. Este texto é interno e não aparece no PDF do cliente." : "Se usar apenas os valores do catálogo, não é necessário justificar ajustes."}</p>
    {erro && <p id={erroId} role="alert">{erro}</p>}
    <Button type="button" onClick={gerar}>{correcao ? "Gerar versão corrigida para revisão" : "Gerar proposta para revisão"}</Button>
  </section>;
}
