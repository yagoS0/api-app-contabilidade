import { CampoNumero } from "./AjustesPlanejamento";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
const brl = v => v == null ? "Não calculado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function TransicaoReforma({ value = {}, onChange, resultado }) {
  return <SecaoPlanejamento titulo="Transição de IBS/CBS e ISS · 2027 a 2033">
    <p>Simulação de consumo para serviços no regime regular de IBS/CBS, com receitas sem esses tributos na base. Informe alíquotas efetivas já ajustadas às reduções e ao ano. Esta conta não é o DAS nem a carga total da empresa.</p>
    {resultado.map(t => <details key={t.ano} style={{ marginTop: 10 }}><summary>{t.ano} · {t.incompleta ? "Preencher premissas" : brl(t.total)}</summary>
      <p style={{ fontSize: ".8rem" }}>ISS remanescente: {(t.legado * 100).toFixed(0)}% do valor sob as regras de 2028. {t.ibsLegalPct != null ? `IBS de ${t.ibsLegalPct}% previsto na LC 214, art. 344, para operações sem redução específica.` : "Informe o IBS efetivo estimado para este ano."} CBS e demais taxas digitadas são premissas, não alíquotas legais confirmadas.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
        {Object.entries({ receita: "Receita/base sem IBS e CBS (R$)", cbsPct: "CBS efetiva estimada (%)", ...(t.ibsLegalPct == null ? { ibsPct: "IBS efetivo estimado (%)" } : {}), creditosCbs: "Créditos admissíveis de CBS (R$)", creditosIbs: "Créditos admissíveis de IBS (R$)", ...(t.legado ? { issAtual: "ISS anual pelas regras de 2028 (R$)" } : {}) }).map(([k, label]) => <CampoNumero key={k} label={`${label} — ${t.ano}`} max={k.endsWith("Pct") ? "100" : undefined} value={value[t.ano]?.[k]} onChange={v => onChange({ ...value, [t.ano]: { ...value[t.ano], [k]: v } })} />)}
      </div>
      {!t.incompleta && <p>CBS: {brl(t.cbs)} · IBS: {brl(t.ibs)} · ISS: {brl(t.iss)} · Créditos excedentes: CBS {brl(t.creditoExcedenteCbs)} / IBS {brl(t.creditoExcedenteIbs)}.</p>}
    </details>)}
    <p style={{ fontSize: ".8rem" }}>Créditos são informados separadamente, sem cruzar IBS e CBS e sem presumir saldo anterior. Regimes especiais, reduções por operação, ICMS, Imposto Seletivo e demais tributos não entram neste subtotal. <a href="https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda" target="_blank" rel="noreferrer">Cronograma oficial da Receita Federal</a>.</p>
  </SecaoPlanejamento>;
}
