import { useId } from "react";
import { CampoNumero } from "./AjustesPlanejamento";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
export function RealDetalhado({ value = {}, onChange }) {
  const id = useId();
  return <SecaoPlanejamento titulo="Lucro Real por custos, despesas e ajustes">
    <label htmlFor={id} style={{ display: "block", margin: "12px 0" }}><input id={id} type="checkbox" checked={Boolean(value.ativo)} onChange={e => onChange({ ...value, ativo: e.target.checked })} /> Calcular pelas bases detalhadas</label>
    {value.ativo && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
        {Object.entries({ custos: "Custos anuais (R$)", despesas: "Despesas anuais antes de IRPJ/CSLL (R$)", outrasReceitas: "Outras receitas contábeis anuais (R$)", adicoesIrpj: "Adições ao IRPJ (R$)", exclusoesIrpj: "Exclusões do IRPJ (R$)", adicoesCsll: "Adições à CSLL (R$)", exclusoesCsll: "Exclusões da CSLL (R$)" }).map(([k, label]) => <CampoNumero key={k} label={label} value={value[k]} onChange={v => onChange({ ...value, [k]: v })} />)}
      </div>
      <p style={{ fontSize: ".8rem" }}>Informe zero para itens sem valor. Custos e despesas devem incluir folha, encargos e tributos dedutíveis, sem duplicação entre campos. Adições e exclusões são confirmadas pelo contador separadamente para IRPJ e CSLL. Os créditos de PIS/Cofins continuam no campo próprio; a incidência sobre outras receitas precisa ser conferida por operação.</p>
      <p style={{ fontSize: ".8rem" }}>O adicional usa lucro distribuído igualmente em quatro trimestres. Prejuízos anteriores e compensações não são aplicados automaticamente.</p>
    </>}
  </SecaoPlanejamento>;
}
