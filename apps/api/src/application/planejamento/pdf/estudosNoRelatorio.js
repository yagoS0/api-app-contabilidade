const moeda = v => v == null || v === "" || !Number.isFinite(Number(v)) ? "não informado" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = v => v == null || !Number.isFinite(Number(v)) ? "não informada" : `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const tributos = { das: "DAS", irpj: "IRPJ", adicionalIrpj: "Adicional IRPJ", csll: "CSLL", pis: "PIS", cofins: "Cofins", iss: "ISS", cpp: "CPP fora do DAS", encargos: "RAT/FAP e terceiros", operacoes: "ICMS/ST/DIFAL/IPI por operação" };
const regimes = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real trimestral" };

// Apresenta exclusivamente a foto gravada; não importa nem executa motores fiscais.
export function secoesDosEstudos(estudos) {
  if (!estudos) return [];
  const secoes = [];
  if (estudos.operacoes?.operacoes?.length) {
    const linhas = [estudos.operacoes.premissa || "Parâmetros conferidos no cenário."];
    for (const o of estudos.operacoes.operacoes) {
      linhas.push(`${o.competencia || "Sem competência"} | ${regimes[o.regime] || "Sem regime"} | ${o.descricao || "Operação"} | ${o.tributo || "Sem tributo"}. Código ${o.codigo || "não informado"}; UF ${o.uf || "não informada"}.`);
      linhas.push(`Base final ${moeda(o.base)}; redução ${pct(o.reducao == null ? 0 : Number(o.reducao) / 100)}; base efetiva ${moeda(o.baseEfetiva)}; alíquota ${pct(o.aliquota == null ? null : Number(o.aliquota) / 100)}; débito ${moeda(o.debito)}; deduções ${moeda(o.deducao)}; FCP ${moeda(o.fcp)}; total ${moeda(o.total)}.`);
      linhas.push(`Fundamento/origem: ${o.fundamento || "não informado"}. ${o.pendencia || "Conferido no cenário."}`);
    }
    secoes.push({ titulo: "Operações especiais e benefícios", linhas });
  }
  if (estudos.mensal) {
    secoes.push({ titulo: "Estudos mensais de tributos", linhas: [estudos.mensal.premissa || "Projeção por competência; IRPJ/CSLL no fechamento do trimestre."] });
    for (const r of estudos.mensal.resultados || []) {
      const linhas = [`Total: ${r.total == null ? "parcial" : moeda(r.total)}. Parcelas conhecidas: ${moeda(r.subtotalConhecido)}.`];
      for (const m of r.meses || []) {
        linhas.push(`${m.competencia}: receita ${moeda(m.receita)}; ${m.origem || "origem não informada"}. ${m.ativo === false ? "Anterior à abertura." : `Total ${moeda(m.total)}.`}`);
        if (m.ativo !== false) for (const [k, valor] of Object.entries(m.tributos || {})) {
          const mem = m.memoria?.tributos?.[k];
          linhas.push(`${tributos[k] || k}: ${moeda(valor)}${mem ? `; base ${moeda(mem.base)}, alíquota ${pct(mem.aliquota)}${mem.credito == null ? "" : `, crédito ${moeda(mem.credito)}, saldo anterior ${moeda(mem.saldoAnterior)}`}` : ""}.`);
        }
        if (m.memoria?.rbt12 != null) linhas.push(`RBT12 ${moeda(m.memoria.rbt12)}; Fator R ${pct(m.memoria.fatorR)}.`);
        for (const a of m.memoria?.atividades || []) linhas.push(`Atividade ${a.atividade}: receita ${moeda(a.receita)}, anexo ${a.anexo || "pendente"}, faixa ${a.faixa ?? "pendente"}, tratamento ${a.tratamento || "não informado"}, DAS ${moeda(a.total)}.`);
        if (m.memoria?.compensacaoIrpj != null) linhas.push(`Compensação de prejuízo IRPJ ${moeda(m.memoria.compensacaoIrpj)}; saldo ${moeda(m.memoria.saldoPrejuizo)}. Compensação CSLL ${moeda(m.memoria.compensacaoCsll)}; saldo ${moeda(m.memoria.saldoBaseNegativa)}.`);
        for (const p of m.pendencias || []) linhas.push(`Revisar: ${p}`);
      }
      secoes.push({ titulo: regimes[r.regime] || r.regime, linhas });
    }
  }
  const r = estudos.reforma;
  if (r && (r.operacoes?.length || r.creditos?.length)) {
    const linhas = [r.premissa || "Subtotal de consumo parametrizado."];
    for (const o of r.operacoes || []) linhas.push(`${o.descricao || "Operação"}: base ${moeda(o.base)}; CBS ${pct(o.cbsPct == null ? null : o.cbsPct / 100)} = ${moeda(o.cbs)}; IBS ${pct(o.ibsPct == null ? null : o.ibsPct / 100)} = ${moeda(o.ibs)}; redução ${pct(o.reducao == null ? 0 : o.reducao / 100)}; ICMS/ISS ${moeda(o.legado)}. Fundamento ${o.fundamento || "não informado"}. ${o.pendencia || "Conferida no cenário."}`);
    for (const c of r.creditos || []) linhas.push(`Fornecedor ${c.fornecedor || "não informado"}; documento ${c.documento || "não informado"}: CBS ${moeda(c.cbs)}; IBS ${moeda(c.ibs)}. ${c.pendencia || "Crédito conferido no cenário."}`);
    linhas.push(`CBS líquida ${moeda(r.cbs)}; IBS líquido ${moeda(r.ibs)}; ICMS/ISS ${moeda(r.legado)}; subtotal ${moeda(r.total)}. Créditos excedentes: CBS ${moeda(r.excedenteCbs)}, IBS ${moeda(r.excedenteIbs)}.`);
    for (const p of r.pendencias || []) linhas.push(`Revisar: ${p}`);
    secoes.push({ titulo: `Reforma por operação - ${r.ano}`, linhas });
  }
  return secoes;
}
