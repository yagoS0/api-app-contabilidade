import { useId } from "react";
import { CampoNumero } from "./AjustesPlanejamento";
import { ATIVIDADES_PRESUMIDO } from "../lib/lucroPresumido";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
function Linha({ value, onChange, indice }) {
  const id = useId();
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
    <CampoNumero label={`Receita anual da atividade ${indice + 1} (R$)`} value={value.receita} onChange={v => onChange({ ...value, receita: v })} />
    <label htmlFor={`${id}-at`}>Categoria da atividade {indice + 1}<select id={`${id}-at`} value={value.atividade || ""} onChange={e => onChange({ ...value, atividade: e.target.value })}><option value="">Selecionar</option>{Object.entries(ATIVIDADES_PRESUMIDO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select></label>
    <label htmlFor={`${id}-an`}>Anexo da atividade {indice + 1}<select id={`${id}-an`} value={value.anexo || ""} onChange={e => onChange({ ...value, anexo: e.target.value })}><option value="">Selecionar</option>{["I", "II", "III", "IV", "V", "FATOR_R"].map(k => <option key={k} value={k}>{k === "FATOR_R" ? "Automático pelo Fator R" : k}</option>)}</select></label>
    {value.atividade === "servicos" && <CampoNumero label={`ISS da atividade ${indice + 1} (%)`} max="5" value={value.issPct} onChange={v => onChange({ ...value, issPct: v })} />}
  </div>;
}
export function ReceitasPorAtividade({ value = {}, onChange }) {
  const id = useId(); const linhas = value.linhas || [];
  return <SecaoPlanejamento titulo="Receitas por atividade">
    <label htmlFor={id} style={{ display: "block", margin: "12px 0" }}><input id={id} type="checkbox" checked={Boolean(value.ativo)} onChange={e => onChange({ ...value, ativo: e.target.checked, linhas: linhas.length ? linhas : [{}, {}] })} /> Separar receitas na comparação</label>
    {value.ativo && <div style={{ display: "grid", gap: 16 }}>
      {linhas.map((l, i) => <div key={i}><Linha value={l} indice={i} onChange={v => onChange({ ...value, linhas: linhas.map((x, j) => j === i ? v : x) })} /><button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, linhas: linhas.filter((_, j) => j !== i) })}>Remover atividade {i + 1}</button></div>)}
      <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, linhas: [...linhas, {}] })}>Adicionar atividade</button>
      <small>Os valores devem somar a receita anual. A segregação é informada pelo contador, sem distribuir receita pela lista de CNAEs. Mercadorias e operações especiais permanecem estimativas parciais até conferir os tributos por operação.</small>
    </div>}
  </SecaoPlanejamento>;
}
