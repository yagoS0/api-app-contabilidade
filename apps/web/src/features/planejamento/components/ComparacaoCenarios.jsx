import { useState } from "react";
import { nomeCenario, dataCenario, moedaCenario, percentualCenario, totalDoRegime, coberturaSalva } from "../lib/cenariosSalvos";
import { ROTULO_DO_TRIBUTO } from "../lib/comparativoDeRegimes";
import "./planejamentoAvancado.css";

export function ComparacaoCenarios({ cenarios, onAbrir, disabled = false, onExportar = null }) {
  const [ids, setIds] = useState([]);
  const selecionados = cenarios.filter(c => ids.includes(c.id));
  const regimes = [...new Set(selecionados.flatMap(c => (c.resultado?.regimes || []).map(r => r.regime)))];
  const linha = (rotulo, obter) => <tr key={rotulo}><th scope="row">{rotulo}</th>{selecionados.map(c => <td key={c.id}>{obter(c)}</td>)}</tr>;
  if (!cenarios.length) return <p>Nenhum cenário salvo para esta empresa.</p>;
  return <div className="planejamento-avancado planejamento-cenarios" data-print-hide>
    <p>Selecione de dois a três cenários para comparar os valores salvos. Abrir um cenário carrega as premissas para recalcular com as tabelas atuais.</p>
    <div className="planejamento-lista-cenarios">{cenarios.map(c => <div key={c.id}>
      <label><input type="checkbox" checked={ids.includes(c.id)} disabled={disabled || (!ids.includes(c.id) && selecionados.length >= 3)}
        onChange={e => setIds(e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} /> {nomeCenario(c)} · {dataCenario(c)}</label>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onAbrir(c)}>Abrir {c.competencia || "simulação"} · {dataCenario(c)}</button>
    </div>)}</div>
    {selecionados.length >= 2 && onExportar && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onExportar(selecionados)}>Baixar comparação em PDF</button>}
    {selecionados.length >= 2 && <div className="planejamento-tabela-scroll"><table>
      <caption>Comparação dos resultados salvos — diferenças de premissas não representam economia realizada.</caption>
      <thead><tr><th scope="col">Informação</th>{selecionados.map(c => <th scope="col" key={c.id}>{nomeCenario(c)}<small>{dataCenario(c)}</small></th>)}</tr></thead>
      <tbody>
        {linha("Competência / ano-base", c => `${c.competencia || "Não informada"} / ${c.resultado?.anoBase || "Não informado"}`)}
        {linha("Fontes verificadas em", c => c.resultado?.fontesVerificadasEm || "Não registrado")}
        {linha("Receita anual", c => moedaCenario(c.entradas?.receitaAnual))}
        {linha("RBT12", c => moedaCenario(c.entradas?.rbt12))}
        {linha("Folha anual para Fator R", c => moedaCenario(c.entradas?.folhaAnual))}
        {linha("Remunerações para CPP", c => moedaCenario(c.entradas?.folhaRemuneracoesAnual))}
        {linha("RAT/FAP e terceiros", c => moedaCenario(c.entradas?.encargosAdicionaisAnuais))}
        {linha("Anexo do Simples", c => c.resultado?.anexoResolvido || c.entradas?.anexoSimples || "Não registrado")}
        {linha("ISS", c => percentualCenario(c.entradas?.aliquotaIss))}
        {linha("Margem do Lucro Real", c => percentualCenario(c.entradas?.margemLucro))}
        {linha("Créditos de PIS/Cofins", c => moedaCenario(c.entradas?.creditosPisCofins))}
        {linha("Regime atual informado", c => c.resultado?.regimeAtual || "Não registrado")}
        {regimes.map(regime => linha(regime, c => {
          const r = c.resultado?.regimes?.find(x => x.regime === regime);
          return <><strong>{totalDoRegime(r) == null ? "Não calculado" : moedaCenario(r.total)}</strong><small>{coberturaSalva(r)} · carga efetiva {percentualCenario(r?.cargaEfetiva)}</small>
            {r?.motivo && <small>{r.motivo}</small>}
            {r?.cobertura?.pendencias?.map(p => <small key={p}>{p}</small>)}
            {r?.porTributo && <details><summary>Tributos salvos</summary>{Object.entries(r.porTributo).map(([chave, valor]) => <small key={chave}>{ROTULO_DO_TRIBUTO[chave] || chave}: {moedaCenario(valor)}
              {r.memoriaPorTributo?.[chave] && <> · alíquota {percentualCenario(r.memoriaPorTributo[chave].aliquota)} · base {moedaCenario(r.memoriaPorTributo[chave].baseCalculo)}</>}
            </small>)}</details>}
          </>;
        }))}
        {linha("Conclusão do contador", c => c.resultado?.conclusao?.texto || "Não registrada")}
        {linha("Próxima revisão", c => c.resultado?.conclusao?.revisarEm || "Não registrada")}
      </tbody>
    </table></div>}
  </div>;
}
