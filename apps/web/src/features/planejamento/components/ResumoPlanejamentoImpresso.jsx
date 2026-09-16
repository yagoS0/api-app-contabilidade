const brl = v => v == null ? "Não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function ResumoPlanejamentoImpresso({ ajustes, mensal, transicao }) {
  return <div data-print-only style={{ display: "none" }}>
    {ajustes.mensal && <section><h3>Acompanhamento mensal — {mensal.ano}</h3><p>Realizado: {brl(mensal.realizado)} ({mensal.mesesRealizados}/12 meses). Projeção: {brl(mensal.totalProjetado)}. Desvio: {brl(mensal.desvio)}.</p>
      <table><thead><tr>{["Mês", "Plano", "Realizado", "RBT12", "Fator R", "DAS estimado", "DAS apurado"].map(t => <th key={t}>{t}</th>)}</tr></thead>
        <tbody>{mensal.linhas.map(l => <tr key={l.competencia}><td>{l.competencia}{l.mesParcial ? " (parcial)" : ""}<small style={{ display: "block" }}>{l.origem}</small></td><td>{brl(l.plano)}</td><td>{brl(l.realizado)}</td><td>{brl(l.rbt12)}</td><td>{l.fatorR == null ? "—" : `${(l.fatorR * 100).toFixed(2)}%`}</td><td>{brl(l.dasEstimado)}</td><td>{brl(l.tributoApurado)}</td></tr>)}</tbody>
      </table><p>{mensal.premissa}</p></section>}
    {ajustes.transicao && <section><h3>IBS/CBS e ISS — subtotal de consumo</h3><p>Serviços no regime regular. Alíquotas futuras digitadas são premissas; não é DAS nem carga total.</p>{transicao.map(t => <p key={t.ano}>{t.ano}: CBS {brl(t.cbs)} · IBS {brl(t.ibs)} · ISS {brl(t.iss)} · subtotal {brl(t.total)}</p>)}</section>}
    {ajustes.conclusao && <section><h3>Conclusão do contador</h3><p>{ajustes.conclusao.texto}</p><p>Próxima revisão prevista: {ajustes.conclusao.revisarEm || "Não definida"}</p></section>}
  </div>;
}
