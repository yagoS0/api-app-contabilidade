import { useState } from "react";
import { SecaoPlanejamento } from "./SecaoPlanejamento";
import { CampoNumero } from "./AjustesPlanejamento";
import { TRIBUTOS_OPERACAO } from "../lib/operacoesPlanejamento";
import { REGIMES_ESTUDO, IMPOSTOS_MENSAIS, prepararMesesTributos } from "../lib/tributosMensais";
import { moedaCenario as brl } from "../lib/cenariosSalvos";

function Texto({ label, value, onChange, type = "text" }) {
  return <label className="estudo-campo">{label}<input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} /></label>;
}
function Seletor({ label, value, onChange, options }) {
  return <label className="estudo-campo">{label}<select value={value ?? ""} onChange={e => onChange(e.target.value)}>{options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>;
}
function Valores({ linha, set, campos }) {
  return campos.map(([k, label]) => <CampoNumero key={k} label={label} value={linha[k]} onChange={v => set(k, v)} />);
}
const listaRegimes = Object.entries(REGIMES_ESTUDO);
const tratamentos = [["normal", "Tributação normal"], ["mono", "Revenda monofásica"], ["st", "Revenda com ICMS-ST já retido"], ["mono_st", "Revenda monofásica e ICMS-ST retido"]];

export function EstudosAvancados({ value = {}, onChange, resultado, mensal, entradas, onExportar }) {
  const [mes, setMes] = useState(0), [regime, setRegime] = useState("SIMPLES_NACIONAL");
  const set = (k, v) => onChange({ ...value, [k]: v, ...(k === "operacoes" ? { tributos: { ...value.tributos, operacoesConferidas: false } } : {}) });
  const operacoes = value.operacoes || [], reforma = value.reforma || {}, trib = value.tributos || {};
  const operacao = (i, l) => set("operacoes", operacoes.map((x, j) => i === j ? l : x));
  const setTrib = (k, v) => set("tributos", { ...trib, [k]: v });
  const preparados = prepararMesesTributos({ value: trib, mensal, entradas });
  const m = preparados.linhas[mes], editado = trib.meses?.[mes] || {};
  const editarMes = (k, v) => setTrib("meses", { ...trib.meses, [mes]: { ...editado, [k]: v } });
  const r = resultado.mensal.resultados.find(r => r.regime === regime);
  const setRef = (k, v) => set("reforma", { ...reforma, [k]: v });
  const refLinha = (tipo, i, l) => setRef(tipo, (reforma[tipo] || []).map((x, j) => i === j ? l : x));
  return <div className="estudos-planejamento" data-print-hide>
    <div className="estudo-cabecalho"><div><h3>Estudos adicionais</h3><small>Prévia em desenvolvimento · simulações para sua revisão</small></div>
      <button type="button" className="btn btn-secondary" onClick={onExportar}>Baixar relatório dos estudos (PDF)</button></div>
    <SecaoPlanejamento titulo="Operações especiais e benefícios">
      <p>Informe a base final por operação e regime. ICMS, ST, DIFAL e IPI conferidos entram na projeção mensal da mesma competência. PIS/Cofins abaixo têm memória própria.</p>
      {operacoes.map((l, i) => <fieldset className="estudo-linha" key={i}><legend>Operação {i + 1}</legend>
        <div className="estudo-grid">
          <Texto label={`Descrição da operação ${i + 1}`} value={l.descricao} onChange={v => operacao(i, { ...l, descricao: v })} />
          <Seletor label={`Regime da operação ${i + 1}`} value={l.regime} options={[["", "Selecionar"], ...listaRegimes]} onChange={v => operacao(i, { ...l, regime: v, conferida: false })} />
          <Texto label={`Competência da operação ${i + 1}`} type="month" value={l.competencia} onChange={v => operacao(i, { ...l, competencia: v, conferida: false })} />
          <Seletor label={`Tributo da operação ${i + 1}`} value={l.tributo} options={[["", "Selecionar"], ...TRIBUTOS_OPERACAO.map(k => [k, k])]} onChange={v => operacao(i, { ...l, tributo: v, conferida: false })} />
          <Texto label="NCM / código do serviço" value={l.codigo} onChange={v => operacao(i, { ...l, codigo: v, conferida: false })} />
          <Texto label="UF de origem / destino" value={l.uf} onChange={v => operacao(i, { ...l, uf: v, conferida: false })} />
          <Valores linha={l} set={(k, v) => operacao(i, { ...l, [k]: v, conferida: false })} campos={[["base", "Base final (R$)"], ["aliquota", "Alíquota interna / do tributo (%)"], ["reducao", "Redução da base (%)"], ["credito", "Crédito elegível (R$)"]]} />
          {l.tributo === "ICMS-ST" && <Valores linha={l} set={(k, v) => operacao(i, { ...l, [k]: v, conferida: false })} campos={[["icmsProprio", "ICMS próprio a deduzir (R$)"]]} />}
          {l.tributo === "DIFAL" && <Valores linha={l} set={(k, v) => operacao(i, { ...l, [k]: v, conferida: false })} campos={[["interestadualPct", "Alíquota interestadual (%)"]]} />}
          {["ICMS-ST", "DIFAL"].includes(l.tributo) && <Valores linha={l} set={(k, v) => operacao(i, { ...l, [k]: v, conferida: false })} campos={[["fcpPct", "FCP (%)"]]} />}
          <Texto label="Fundamento / origem dos parâmetros" value={l.fundamento} onChange={v => operacao(i, { ...l, fundamento: v, conferida: false })} />
        </div>
        <label><input type="checkbox" checked={Boolean(l.conferida)} onChange={e => operacao(i, { ...l, conferida: e.target.checked })} /> Incidência, base final, benefício e crédito conferidos</label>
        <p>{resultado.operacoes.operacoes[i]?.pendencia || `Imposto: ${brl(resultado.operacoes.operacoes[i]?.imposto)} · FCP: ${brl(resultado.operacoes.operacoes[i]?.fcp)} · total: ${brl(resultado.operacoes.operacoes[i]?.total)}`}</p>
        <button type="button" className="btn btn-secondary" onClick={() => set("operacoes", operacoes.filter((_, j) => i !== j))}>Remover operação {i + 1}</button>
      </fieldset>)}
      <button type="button" className="btn btn-secondary" onClick={() => set("operacoes", [...operacoes, { competencia: m.competencia, regime, reducao: 0, credito: 0, fcpPct: 0 }])}>Adicionar operação</button>
      <details><summary>Como a memória é calculada</summary><p>{resultado.operacoes.premissa}</p></details>
    </SecaoPlanejamento>

    <SecaoPlanejamento titulo="Tributos mensais, atividades mistas e início de atividade">
      <div className="estudo-grid">
        <Texto label="Abertura em 2026 (opcional)" type="month" value={trib.inicio} onChange={v => setTrib("inicio", v)} />
        <Seletor label="Regime para detalhar" value={regime} onChange={setRegime} options={listaRegimes} />
        <Seletor label="Mês para editar" value={String(mes)} onChange={v => setMes(Number(v))} options={preparados.linhas.map((m, i) => [String(i), m.competencia])} />
      </div>
      <p>{m.origem}. Receitas por atividade seguem a proporção anual até edição.</p>
      <div className="estudo-grid"><Valores linha={m} set={editarMes} campos={[["receita", "Receita do mês (R$)"], ["folha", "Folha do mês para Fator R (R$)"], ["remuneracoes", "Remunerações do mês sem encargos (R$)"], ["encargos", "Encargos patronais do mês (R$)"]]} /></div>
      {regime !== "SIMPLES_NACIONAL" && <CampoNumero label="Base de PIS/Cofins após exclusões legais (R$)" value={m.basePisCofins} onChange={v => editarMes("basePisCofins", v)} />}
      {m.atividades.map((a, i) => <div className="estudo-grid" key={i}>
        <CampoNumero label={`Receita mensal da atividade ${i + 1} (R$)`} value={a.receita} onChange={v => editarMes("atividades", { ...editado.atividades, [i]: { receita: v } })} />
        <Seletor label={`Tratamento da atividade ${i + 1} (ano)`} value={a.tratamento} options={tratamentos} onChange={v => setTrib("tratamentos", { ...trib.tratamentos, [i]: v })} />
      </div>)}
      <small>Use monofásico/ST somente após conferir a revenda e a tributação anterior. Os anexos e categorias vêm de Receitas por atividade.</small>
      {m.atividades.some(a => a.anexo === "IV") && <div className="estudo-grid"><Valores linha={m} set={editarMes} campos={[["exclusivaIV", "Remuneração exclusiva do Anexo IV (R$)"], ["compartilhada", "Remuneração compartilhada entre anexos (R$)"], ["ratIV", "RAT/FAP do Anexo IV no mês (R$)"]]} /></div>}
      {regime === "LUCRO_REAL" && <>
        <div className="estudo-grid">
          {["baseRealIrpj", "baseRealCsll"].map((k, i) => <Texto key={k} label={`Base ajustada de ${i ? "CSLL" : "IRPJ"} no mês (R$; admite prejuízo)`} type="number" value={m[k]} onChange={v => editarMes(k, v)} />)}
          <Valores linha={m} set={editarMes} campos={[["creditoPis", "Crédito de PIS do mês (R$)"], ["creditoCofins", "Crédito de Cofins do mês (R$)"]]} />
          <Valores linha={{ prejuizoIrpj: trib.prejuizoIrpj ?? 0, baseNegativaCsll: trib.baseNegativaCsll ?? 0 }} set={setTrib} campos={[["prejuizoIrpj", "Prejuízo fiscal inicial de IRPJ (R$)"], ["baseNegativaCsll", "Base negativa inicial de CSLL (R$)"]]} />
        </div><small>Bases após adições/exclusões, antes da compensação. Margem do cenário é apenas projeção; saldos iniciais começam em zero e podem ser alterados.</small>
      </>}
      <label className="estudo-confirmacao"><input type="checkbox" checked={Boolean(trib.operacoesConferidas)} onChange={e => setTrib("operacoesConferidas", e.target.checked)} /> Lista de ICMS/ST/DIFAL/IPI conferida para os regimes e meses, inclusive ausência</label>
      <div className="planejamento-tabela-scroll"><table><caption>Projeção por regime — totais completos somente com todas as premissas conferidas</caption><thead><tr><th>Regime</th><th>Total do estudo</th><th>Parcelas conhecidas</th></tr></thead><tbody>{resultado.mensal.resultados.map(r => <tr key={r.regime}><th>{REGIMES_ESTUDO[r.regime]}</th><td>{r.total == null ? "Pendente de dados / revisão" : brl(r.total)}</td><td>{brl(r.subtotalConhecido)}</td></tr>)}</tbody></table></div>
      <div className="planejamento-tabela-scroll"><table><caption>{REGIMES_ESTUDO[regime]} · apropriação por competência, com IRPJ/CSLL no encerramento do trimestre</caption><thead><tr><th>Mês</th><th>Receita</th><th>Tributos e bases</th><th>Total</th></tr></thead><tbody>{r.meses.map(l => <tr key={l.competencia}><th>{l.competencia}{!l.ativo && <small>Anterior à abertura</small>}</th><td>{brl(l.receita)}</td><td><details><summary>Ver impostos separados</summary>{Object.entries(l.tributos).map(([k, v]) => <small key={k}>{IMPOSTOS_MENSAIS[k]}: {brl(v)}{l.memoria.tributos?.[k] && <> · base {brl(l.memoria.tributos[k].base)} · alíquota {l.memoria.tributos[k].aliquota == null ? "Não informada" : `${(l.memoria.tributos[k].aliquota * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`}{l.memoria.tributos[k].credito != null && <> · crédito {brl(l.memoria.tributos[k].credito)} · saldo anterior {brl(l.memoria.tributos[k].saldoAnterior)}</>}</>}</small>)}{l.memoria.baseIrpj != null && <small>Base IRPJ: {brl(l.memoria.baseIrpj)} · 15% + adicional 10% sobre o excesso; base CSLL: {brl(l.memoria.baseCsll)} · 9%</small>}{l.memoria.rbt12 != null && <small>RBT12: {brl(l.memoria.rbt12)} · Fator R: {l.memoria.fatorR == null ? "Não informado" : `${(l.memoria.fatorR * 100).toFixed(2)}%`}</small>}{l.memoria.atividades?.map((a, i) => <small key={i}>Atividade {i + 1} · Anexo {a.anexo} · faixa {a.faixa ?? "—"} · DAS {brl(a.total)}</small>)}</details>{l.pendencias.map(p => <small key={p}>{p}</small>)}</td><td>{l.total == null ? "Parcial" : brl(l.total)}</td></tr>)}</tbody></table></div>
      <details><summary>Premissas da projeção mensal</summary><p>{resultado.mensal.premissa}</p></details>
    </SecaoPlanejamento>

    <SecaoPlanejamento titulo="Reforma por operação e créditos por fornecedor">
      <Seletor label="Ano da reforma" value={String(reforma.ano || 2027)} onChange={v => set("reforma", { ...reforma, ano: Number(v), creditosConferidos: false, operacoes: (reforma.operacoes || []).map(l => ({ ...l, conferida: false })), creditos: (reforma.creditos || []).map(l => ({ ...l, conferido: false })) })} options={Array.from({ length: 7 }, (_, i) => [String(2027 + i), String(2027 + i)])} />
      {(reforma.operacoes || []).map((l, i) => <fieldset className="estudo-linha" key={i}><legend>Operação de consumo {i + 1}</legend><div className="estudo-grid">
        <Texto label={`Descrição / enquadramento ${i + 1}`} value={l.descricao} onChange={v => refLinha("operacoes", i, { ...l, descricao: v, conferida: false })} />
        <Valores linha={l} set={(k, v) => refLinha("operacoes", i, { ...l, [k]: v, conferida: false })} campos={[["base", "Base final de consumo (R$)"], ["cbsPct", "CBS efetiva do ano, antes da redução (%)"], ["reducao", "Redução aplicável (%)"], ["legado", "ICMS/ISS atual da operação (R$)"]]} />
        {Number(reforma.ano || 2027) >= 2029 ? <CampoNumero label="IBS efetivo do ano, antes da redução (%)" value={l.ibsPct} onChange={v => refLinha("operacoes", i, { ...l, ibsPct: v, conferida: false })} /> : <p>IBS geral de 2027–2028: 0,1% antes da redução aplicável.</p>}
        <Texto label="Fundamento / regime específico" value={l.fundamento} onChange={v => refLinha("operacoes", i, { ...l, fundamento: v, conferida: false })} />
      </div><label><input type="checkbox" checked={Boolean(l.conferida)} onChange={e => refLinha("operacoes", i, { ...l, conferida: e.target.checked })} /> Base, enquadramento e taxas efetivas conferidos</label>
        <button type="button" className="btn btn-secondary" onClick={() => setRef("operacoes", reforma.operacoes.filter((_, j) => i !== j))}>Remover consumo {i + 1}</button>
      </fieldset>)}
      <button type="button" className="btn btn-secondary" onClick={() => setRef("operacoes", [...(reforma.operacoes || []), { reducao: 0 }])}>Adicionar operação de consumo</button>
      <h4>Créditos identificados</h4>
      {(reforma.creditos || []).map((l, i) => <fieldset className="estudo-linha" key={i}><legend>Crédito {i + 1}</legend><div className="estudo-grid">
        <Texto label={`Fornecedor do crédito ${i + 1}`} value={l.fornecedor} onChange={v => refLinha("creditos", i, { ...l, fornecedor: v, conferido: false })} />
        <Texto label={`Documento do crédito ${i + 1}`} value={l.documento} onChange={v => refLinha("creditos", i, { ...l, documento: v, conferido: false })} />
        <Valores linha={l} set={(k, v) => refLinha("creditos", i, { ...l, [k]: v, conferido: false })} campos={[["cbs", "CBS elegível (R$)"], ["ibs", "IBS elegível (R$)"]]} />
      </div><label><input type="checkbox" checked={Boolean(l.conferido)} onChange={e => refLinha("creditos", i, { ...l, conferido: e.target.checked })} /> Crédito elegível e disponível neste ano</label>
        <button type="button" className="btn btn-secondary" onClick={() => setRef("creditos", reforma.creditos.filter((_, j) => i !== j))}>Remover crédito {i + 1}</button>
      </fieldset>)}
      <button type="button" className="btn btn-secondary" onClick={() => setRef("creditos", [...(reforma.creditos || []), {}])}>Adicionar crédito por fornecedor</button>
      <label className="estudo-confirmacao"><input type="checkbox" checked={Boolean(reforma.creditosConferidos)} onChange={e => setRef("creditosConferidos", e.target.checked)} /> Lista completa de créditos conferida, inclusive quando vazia</label>
      <p>CBS líquida: {brl(resultado.reforma.cbs)} · IBS líquido: {brl(resultado.reforma.ibs)} · ICMS/ISS remanescente: {brl(resultado.reforma.legado)} · <strong>Subtotal: {brl(resultado.reforma.total)}</strong></p>
      <p>Crédito excedente de CBS: {brl(resultado.reforma.excedenteCbs)} · de IBS: {brl(resultado.reforma.excedenteIbs)}</p>
      {resultado.reforma.pendencias.map(p => <p key={p} role="status">{p}</p>)}
      <details><summary>Premissas da reforma por operação</summary><p>{resultado.reforma.premissa}</p></details>
    </SecaoPlanejamento>
  </div>;
}
