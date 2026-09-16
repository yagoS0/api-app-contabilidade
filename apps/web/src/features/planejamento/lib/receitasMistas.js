import { adicionalIrpjAnual, ATIVIDADES_PRESUMIDO } from "./lucroPresumido";
import { avaliarComparacao } from "./coberturaComparacao";
import { IRPJ, CSLL_ALIQUOTA, FONTES_VERIFICADAS_EM } from "./tabelasFiscais";
const numero = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
const somarTributos = lista => lista.reduce((a, r) => {
  for (const [k, v] of Object.entries(r.porTributo || {})) a[k] = (a[k] || 0) + v;
  return a;
}, {});
export function compararReceitasMistas(e, calcular) {
  const linhas = e.receitasPorAtividade.map(l => ({ ...l, receita: numero(l.receita), aliquotaIss: numero(l.issPct) == null ? null : numero(l.issPct) / 100 }));
  const total = linhas.reduce((s, l) => s + (l.receita || 0), 0);
  const erro = linhas.some(l => l.receita == null || !ATIVIDADES_PRESUMIDO[l.atividade] || !["I", "II", "III", "IV", "V", "FATOR_R"].includes(l.anexo)) ? "Preencha receita, categoria e anexo de cada atividade."
    : Math.abs(total - e.receitaAnual) > 0.01 ? "A soma por atividade deve fechar com a receita anual."
    : e.mesesDeAtividade ? "A segregação de início de atividade exige análise específica."
    : total > 3_750_000 ? "Acima de R$ 3,75 milhões, a segregação exige conferir majoração e sublimites por período." : null;
  if (erro) return { anoBase: e.anoBase, fontesVerificadasEm: FONTES_VERIFICADAS_EM, aviso: "Simulação de apoio à decisão; confira a segregação antes de comparar.", receitasPorAtividade: linhas,
    ...avaliarComparacao(["Simples Nacional", "Lucro Presumido", "Lucro Real"].map(regime => ({ regime, indisponivel: true, motivo: erro, faltam: [erro] })), e) };
  const rbt = e.rbt12 ?? total;
  const partes = linhas.map(l => calcular({ ...e, receitasPorAtividade: null, receitaAnual: l.receita, rbt12: rbt,
    atividadePresumido: l.atividade, anexoSimples: l.anexo === "FATOR_R" ? null : l.anexo,
    sujeitoAoFatorR: l.anexo === "FATOR_R", aliquotaIss: l.aliquotaIss,
    folhaRemuneracoesAnual: 0, encargosAdicionaisAnuais: 0,
    servicosAte120kConfirmado: false }));
  const pendencias = linhas.some(l => l.atividade !== "servicos") ? ["Mercadorias, indústria, combustíveis ou transporte: conferir ICMS/ST, IPI, monofásicos e tratamentos por operação."] : [];
  if (linhas.some(l => l.atividade === "servicos" && (l.aliquotaIss == null || l.aliquotaIss > 0.05))) pendencias.push("Confira o ISS de cada atividade de serviço.");
  const iss = linhas.reduce((s, l) => s + (l.atividade === "servicos" ? l.receita * (l.aliquotaIss || 0) : 0), 0);
  const receitaServicos = linhas.filter(l => l.atividade === "servicos").reduce((s, l) => s + l.receita, 0);
  const memoriaIss = receitaServicos ? { iss: { aliquota: iss / receitaServicos, aliquotaRotulo: "Alíquota média ponderada", baseCalculo: receitaServicos, baseRotulo: "Receita de serviços" } } : {};
  const base = calcular({ ...e, receitasPorAtividade: null, atividadePresumido: "servicos", anexoSimples: "III", sujeitoAoFatorR: false, aliquotaIss: total ? iss / total : 0, servicosAte120kConfirmado: false });
  const sn = partes.map(r => r.regimes.find(x => x.regime === "Simples Nacional"));
  const snIncompleto = sn.some(x => !x || x.indisponivel || x.elegivel === false) || linhas.some(l => l.anexo === "IV");
  const tribSn = somarTributos(sn.filter(Boolean));
  const simples = snIncompleto ? { regime: "Simples Nacional", indisponivel: true, motivo: "Confira o histórico/Fator R e, se houver Anexo IV, a segregação da CPP antes de comparar receitas mistas.", faltam: ["Anexos e bases próprias de cada atividade"] }
    : { regime: "Simples Nacional", porTributo: tribSn, total: sn.reduce((s, r) => s + r.total, 0), das: sn.reduce((s, r) => s + r.das, 0),
      pendenciasMistas: pendencias, premissas: ["Cada atividade usa a receita própria e o mesmo RBT12 da empresa. Valores agregados; confira a memória por atividade."], naoConsiderado: [],
      atividades: linhas.map((l, i) => ({ ...l, anexoResolvido: partes[i].anexoResolvido, total: sn[i].total, porTributo: sn[i].porTributo, memoriaPorTributo: sn[i].memoriaPorTributo })) };
  const lp = partes.map(r => r.regimes.find(x => x.regime === "Lucro Presumido"));
  const tribLp = somarTributos(lp);
  const baseIrpj = lp.reduce((s, r) => s + r.memoriaPorTributo.irpj.baseCalculo, 0);
  const baseCsll = lp.reduce((s, r) => s + r.memoriaPorTributo.csll.baseCalculo, 0);
  const patronal = base.regimes.find(r => r.regime === "Lucro Presumido");
  tribLp.adicionalIrpj = adicionalIrpjAnual(baseIrpj); // Um limite por empresa, não um por atividade.
  if (patronal.porTributo.cpp != null) tribLp.cpp = patronal.porTributo.cpp; else delete tribLp.cpp;
  if (patronal.porTributo.encargos != null) tribLp.encargos = patronal.porTributo.encargos; else delete tribLp.encargos;
  const presumido = { ...patronal, atividade: "Receitas segregadas por atividade", porTributo: tribLp, total: Object.values(tribLp).reduce((a, b) => a + b, 0), pendenciasMistas: pendencias,
    memoriaPorTributo: { ...patronal.memoriaPorTributo,
      irpj: { aliquota: IRPJ.aliquota, baseCalculo: baseIrpj, baseRotulo: "Soma das bases presumidas por atividade" },
      csll: { aliquota: CSLL_ALIQUOTA, baseCalculo: baseCsll, baseRotulo: "Soma das bases de CSLL por atividade" },
      adicionalIrpj: { aliquota: IRPJ.adicional, baseCalculo: tribLp.adicionalIrpj / IRPJ.adicional, baseRotulo: "Excesso da empresa em quatro trimestres uniformes" }, ...memoriaIss },
    premissas: ["Presunções aplicadas separadamente por atividade. Adicional sobre a base total da empresa em quatro trimestres uniformes. Redução de serviços a 16% não aplicada a receitas mistas."] };
  const real = { ...base.regimes.find(r => r.regime === "Lucro Real"), pendenciasMistas: pendencias };
  if (real.memoriaPorTributo) real.memoriaPorTributo = { ...real.memoriaPorTributo, ...memoriaIss };
  const regimes = [simples, presumido, real].map(r => ({ ...r, cargaEfetiva: r.total == null || !total ? null : r.total / total }));
  return { anoBase: e.anoBase, fontesVerificadasEm: base.fontesVerificadasEm, aviso: base.aviso, receitasPorAtividade: linhas,
    ...avaliarComparacao(regimes, { ...e, anexoSimples: "III", aliquotaIss: total ? iss / total : 0 }) };
}
