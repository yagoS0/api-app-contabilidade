import { CampoNumero } from "./AjustesPlanejamento";
import { distribuirReceitaAnual } from "../lib/planejamentoMensal";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
const brl = v => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = v => v == null ? "—" : `${(v * 100).toFixed(2).replace(".", ",")}%`;
const NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export function AcompanhamentoMensal({ value = {}, onChange, resultado, receitaAnual, dados = [], onAplicar }) {
  const meses = value.meses || [];
  const editar = (i, chave, valor) => onChange({ ...value, meses: Array.from({ length: 12 }, (_, j) => j === i ? { ...meses[j], [chave]: valor, ...(chave === "realizado" ? { origem: "realizado informado", tributoApurado: null } : {}) } : meses[j] || {}) });
  const importar = () => {
    const novo = meses.map(m => ({ ...m }));
    const hist = Array.from({ length: 12 }, (_, i) => ({ ...value.historico?.[i] }));
    for (const d of dados) {
      const [ano, mes] = d.competencia.split("-").map(Number);
      if (ano === resultado.ano) {
        const m = novo[mes - 1] || {};
        if (m.realizado == null || m.realizado === "") novo[mes - 1] = { ...m, realizado: d.receita, origem: d.origem, tributoApurado: d.tributoApurado, origemTributo: d.origemTributo };
        if ((m.folha == null || m.folha === "") && d.folha != null) novo[mes - 1] = { ...novo[mes - 1], folha: d.folha };
      }
      if (ano === resultado.ano - 1) {
        if (hist[mes - 1].receita == null || hist[mes - 1].receita === "") hist[mes - 1].receita = d.receita;
        if (hist[mes - 1].folha == null || hist[mes - 1].folha === "") hist[mes - 1].folha = d.folha;
      }
    }
    onChange({ ...value, meses: Array.from({ length: 12 }, (_, i) => novo[i] || {}), historico: hist });
  };
  return <SecaoPlanejamento titulo={`Acompanhamento mensal · ${resultado.ano}`}>
    <p>Realizado: <strong>{brl(resultado.realizado)}</strong> ({resultado.mesesRealizados}/12 meses) · Projeção do ano: <strong>{brl(resultado.totalProjetado)}</strong> · Desvio do plano: <strong>{brl(resultado.desvio)}</strong> ({resultado.mesesComparados} meses comparáveis).</p>
    <div data-print-hide style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, meses: distribuirReceitaAnual(receitaAnual).map((plano, i) => ({ ...meses[i], plano })) })}>Distribuir receita anual no plano</button>
      {dados.length > 0 && <button type="button" className="btn btn-secondary" onClick={importar}>Importar apurações salvas nos campos vazios</button>}
      <button type="button" className="btn btn-secondary" disabled={resultado.totalProjetado == null} onClick={() => onAplicar(resultado.totalProjetado)}>Usar projeção na comparação anual</button>
    </div>
    <p style={{ fontSize: ".8rem" }}>O realizado substitui o plano daquele mês na projeção. Vazio significa não informado; zero confirma ausência de movimento. Os cards anuais usam as premissas do formulário; a série abaixo mostra a sazonalidade separadamente.</p>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderSpacing: 8 }}>
      <caption>Receita, folha e Simples mês a mês — valores em reais</caption>
      <thead><tr>{["Mês", "Plano", "Realizado", "Folha paga + encargos", "RBT12", "Fator R", "Anexo / faixa", "DAS estimado", "DAS apurado"].map(t => <th key={t}>{t}</th>)}</tr></thead>
      <tbody>{resultado.linhas.map((m, i) => <tr key={m.competencia}>
        <th scope="row">{NOMES[i]}<small style={{ display: "block", fontWeight: 400 }}>{m.origem}</small></th>
        {["plano", "realizado", "folha"].map(k => <td key={k} style={{ minWidth: 130 }}><CampoNumero label={`${k === "plano" ? "Plano" : k === "realizado" ? "Realizado" : "Folha"} ${NOMES[i]}`} value={meses[i]?.[k]} onChange={v => editar(i, k, v)} /></td>)}
        <td>{brl(m.rbt12)}</td><td>{pct(m.fatorR)}</td><td>{m.anexo || "—"} / {m.faixa || "—"}</td><td>{brl(m.dasEstimado)}</td><td>{brl(m.tributoApurado)}{m.tributoApurado != null && <small style={{ display: "block" }}>{m.origemTributo || "origem não informada"}</small>}</td>
      </tr>)}</tbody>
    </table></div>
    {[...new Set(resultado.linhas.flatMap(m => [m.pendencia, m.alertaLimite]).filter(Boolean))].map(p => <p key={p} style={{ fontSize: ".8rem", color: "#FFB347" }}>{p}</p>)}
    <details><summary>Histórico mensal de {resultado.ano - 1} para a janela móvel</summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginTop: 12 }}>
        {NOMES.map((nome, i) => <div key={nome}><strong>{nome}</strong>{["receita", "folha"].map(k => <CampoNumero key={k} label={`${k === "receita" ? "Receita" : "Folha paga + encargos"} ${nome}/${resultado.ano - 1}`} value={value.historico?.[i]?.[k]} onChange={v => onChange({ ...value, historico: Array.from({ length: 12 }, (_, j) => j === i ? { ...value.historico?.[j], [k]: v } : value.historico?.[j] || {}) })} />)}</div>)}
      </div>
    </details>
    {resultado.trimestral && <details><summary>IRPJ do Presumido por trimestre</summary><p>Parcelas de IRPJ; os demais tributos continuam no comparativo anual.</p>
      {resultado.trimestral.map(t => <p key={t.trimestre}>{t.trimestre}º trimestre · receita {brl(t.receita)} · base presumida {brl(t.baseIrpj)} · IRPJ {brl(t.irpj)} · adicional {brl(t.adicionalIrpj)}</p>)}
    </details>}
    <p style={{ fontSize: ".8rem" }}>{resultado.premissa}</p>
  </SecaoPlanejamento>;
}
