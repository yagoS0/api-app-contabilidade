import { custoAnualSimples, anexoPorFatorR } from "./simplesNacional";
import { ATIVIDADES_PRESUMIDO } from "./lucroPresumido";
import { IRPJ } from "./tabelasFiscais";

export const numeroMensal = v => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
const somaCompleta = valores => valores.some(v => v == null) ? null : valores.reduce((a, b) => a + b, 0);
export function distribuirReceitaAnual(receita) {
  const centavos = Math.round((numeroMensal(receita) || 0) * 100);
  return Array.from({ length: 12 }, (_, i) => (Math.floor(centavos / 12) + (i < centavos % 12 ? 1 : 0)) / 100);
}
export function planejarMeses({ meses = [], historico = [], entradas = {}, ano = 2026 } = {}) {
  const serie = Array.from({ length: 12 }, (_, i) => {
    const m = meses[i] || {};
    const realizado = numeroMensal(m.realizado);
    const plano = numeroMensal(m.plano);
    return { ...m, competencia: `${ano}-${String(i + 1).padStart(2, "0")}`, realizado, plano,
      receita: m.mesParcial ? (plano == null ? null : Math.max(realizado ?? 0, plano)) : realizado ?? plano,
      folha: m.folhaPendenteConferencia || m.mesParcial ? null : numeroMensal(m.folha), origem: realizado == null ? "projeção" : (m.origem || "realizado informado"),
      tributoApurado: numeroMensal(m.tributoApurado) };
  });
  const anterior = Array.from({ length: 12 }, (_, i) => ({ receita: numeroMensal(historico[i]?.receita), folha: historico[i]?.folhaPendenteConferencia ? null : numeroMensal(historico[i]?.folha) }));
  const linhas = serie.map((m, i) => {
    // Apenas os 12 meses ANTERIORES: uma alteração de folha no mês não muda o próprio Fator R.
    const janela = [...anterior, ...serie].slice(i, i + 12);
    const rbt12 = somaCompleta(janela.map(x => x.receita));
    const fs12 = somaCompleta(janela.map(x => x.folha));
    const fatorR = rbt12 > 0 && fs12 != null ? fs12 / rbt12 : null;
    const anexo = entradas.sujeitoAoFatorR ? anexoPorFatorR(fs12, rbt12) : entradas.anexoSimples;
    const falta = entradas.receitasPorAtividade ? "Receitas mistas: a projeção do DAS exige segregação mensal por atividade."
      : entradas.mesesDeAtividade ? "Use o cálculo específico de início de atividade."
      : ano !== 2026 ? "Esta projeção usa tabelas de 2026."
      : m.receita == null ? "Informe a receita do mês."
      : rbt12 == null ? "Falta receita na janela dos 12 meses anteriores."
      : rbt12 <= 0 ? "Janela sem receita: conferir regra específica antes de estimar."
      : entradas.sujeitoAoFatorR && fs12 == null ? "Falta folha na janela dos 12 meses anteriores."
      : !anexo ? "Informe o anexo." : null;
    const simples = falta ? null : custoAnualSimples({ anexoChave: anexo, rbt12, receitaAnual: m.receita, folhaAnual: null, aliquotaIss: entradas.aliquotaIss });
    const receitaAcumulada = somaCompleta(serie.slice(0, i + 1).map(x => x.receita));
    // Limite e sublimite são alertas de revisão. Não inferir efeitos de exclusão pela RBT12.
    const alertaLimite = receitaAcumulada > 4_800_000 ? "Receita acumulada ultrapassa R$ 4,8 milhões: revisar permanência no Simples."
      : receitaAcumulada > 3_600_000 ? "Receita acumulada ultrapassa o sublimite: revisar ISS/ICMS por fora e efeitos no período."
      : receitaAcumulada >= 4_800_000 * 0.7 ? "Receita acumulada se aproxima do sublimite de R$ 3,6 milhões." : null;
    return { ...m, rbt12, fs12, fatorR, anexo, faixa: simples?.faixa ?? null,
      dasEstimado: simples?.das ?? null, aliquotaEfetiva: simples?.aliquotaEfetiva ?? null,
      desvio: !m.mesParcial && m.realizado != null && m.plano != null ? m.realizado - m.plano : null,
      pendencia: falta || simples?.motivo || null, alertaLimite };
  });
  const pares = linhas.filter(x => !x.mesParcial && x.realizado != null && x.plano != null);
  const totalProjetado = somaCompleta(linhas.map(x => x.receita));
  const presuncao = ATIVIDADES_PRESUMIDO[entradas.atividadePresumido]?.irpj;
  const trimestral = !entradas.receitasPorAtividade && totalProjetado != null && totalProjetado <= 5_000_000 && presuncao != null
    ? Array.from({ length: 4 }, (_, i) => {
      const receita = somaCompleta(linhas.slice(i * 3, i * 3 + 3).map(x => x.receita));
      const base = receita * (entradas.servicosAte120kConfirmado === true && entradas.atividadePresumido === "servicos" && totalProjetado <= 120_000 ? 0.16 : presuncao);
      return { trimestre: i + 1, receita, baseIrpj: base, irpj: base * IRPJ.aliquota, adicionalIrpj: Math.max(0, base - IRPJ.limiteAdicionalTrimestral) * IRPJ.adicional };
    }) : null;
  return { ano, linhas, totalProjetado, totalPlanejado: somaCompleta(linhas.map(x => x.plano)),
    realizado: linhas.filter(x => x.realizado != null).reduce((a, b) => a + b.realizado, 0),
    mesesRealizados: linhas.filter(x => x.realizado != null).length,
    desvio: pares.length ? pares.reduce((a, b) => a + b.desvio, 0) : null,
    mesesComparados: pares.length, dasEstimado: somaCompleta(linhas.map(x => x.dasEstimado)), trimestral,
    premissa: "Projeção para empresa com pelo menos 12 meses de atividade. O DAS estimado é a parcela do Simples; CPP do Anexo IV e ISS/ICMS por fora não estão nesta coluna. Apurado não significa pago. Retenções e tratamentos especiais exigem a apuração por operação." };
}
