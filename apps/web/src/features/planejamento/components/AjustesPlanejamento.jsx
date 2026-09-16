import { useId } from "react";
import { SecaoPlanejamento } from "./SecaoPlanejamento";

export const numeroInformado = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
export function CampoNumero({ label, value, onChange, ...props }) {
  const id = useId();
  const invalido = value != null && value !== "" && numeroInformado(value) == null;
  return <label htmlFor={id} style={{ display: "grid", gap: 4, fontSize: ".8rem" }}>{label}
    <input {...props} id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value ?? ""} onChange={e => onChange(e.target.value)} aria-invalid={invalido}
      style={{ width: "100%", boxSizing: "border-box", padding: 8, background: "var(--surface-input, #1A1B26)", color: "inherit", border: "1px solid #44475A", borderRadius: 6 }} />
    {invalido && <span role="alert">Informe um valor válido, igual ou maior que zero.</span>}
  </label>;
}

export function AjustesPlanejamento({ value, onChange, fatorR }) {
  const regimeId = useId();
  const set = (chave, valor) => onChange({ ...value, [chave]: valor });
  const socios = value.socios || [];
  return <SecaoPlanejamento titulo="Folha, sócios e comparação com o regime atual">
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <label htmlFor={regimeId}>Regime atual para comparação
        <select id={regimeId} value={value.regimeAtual || ""} onChange={e => set("regimeAtual", e.target.value)}>
          <option value="">Usar cadastro da empresa</option><option value="SIMPLES_NACIONAL">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option><option value="LUCRO_REAL">Lucro Real</option>
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
        <CampoNumero label="Base anual da CPP — remunerações sem encargos (R$)" value={value.folhaRemuneracoesAnual} onChange={v => set("folhaRemuneracoesAnual", v)} />
        <CampoNumero label="RAT/FAP e terceiros no ano (R$)" value={value.encargosAdicionaisAnuais} onChange={v => set("encargosAdicionaisAnuais", v)} />
      </div>
      <small>A folha usada no Fator R permanece no campo principal. Informe aqui a base própria da CPP e os encargos adicionais dos regimes com recolhimento por fora; zero confirma ausência.</small>
      {fatorR && <>
        <strong>Pró-labore dos sócios</strong>
        <small>Informe a remuneração de cada sócio, sem salários de empregados. Nesta simulação, o aumento é dividido igualmente entre os sócios informados.</small>
        {socios.map((s, i) => <div key={i} style={{ display: "flex", gap: 12, alignItems: "end" }}>
          <CampoNumero label={`Pró-labore mensal do sócio ${i + 1} (R$)`} value={s.proLaboreMensal} onChange={v => set("socios", socios.map((x, j) => j === i ? { ...x, proLaboreMensal: v } : x))} />
          <button type="button" className="btn btn-secondary" onClick={() => set("socios", socios.filter((_, j) => j !== i))}>Remover sócio {i + 1}</button>
        </div>)}
        <button type="button" className="btn btn-secondary" onClick={() => set("socios", [...socios, { nome: `Sócio ${socios.length + 1}`, proLaboreMensal: "" }])}>Adicionar sócio à simulação</button>
      </>}
    </div>
  </SecaoPlanejamento>;
}
