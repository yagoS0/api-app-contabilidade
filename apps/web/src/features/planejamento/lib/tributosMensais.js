import { ANEXOS, IRPJ, CSLL_ALIQUOTA, PIS_COFINS_CUMULATIVO as PC, PIS_COFINS_NAO_CUMULATIVO as PNC } from "./tabelasFiscais";
import { repartirPorTributo } from "./simplesNacional";
import { ATIVIDADES_PRESUMIDO } from "./lucroPresumido";
import { distribuirReceitaAnual } from "./planejamentoMensal";
import { numero, somar, dinheiro, calcularOperacoes } from "./operacoesPlanejamento";

export const REGIMES_ESTUDO = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real trimestral" };
export const IMPOSTOS_MENSAIS = { das: "DAS", irpj: "IRPJ", adicionalIrpj: "Adicional IRPJ", csll: "CSLL", pis: "PIS", cofins: "Cofins", iss: "ISS", cpp: "CPP fora do DAS", encargos: "RAT/FAP e terceiros", operacoes: "ICMS/ST/DIFAL/IPI por operação" };
const assinado = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const campo = (obj, key, padrao, signed = false) => Object.hasOwn(obj, key) ? (signed ? assinado(obj[key]) : numero(obj[key])) : padrao;
const fator = (f, r) => f == null || r == null ? null : r > 0 ? (f > 0 ? f / r : 0.01) : f > 0 ? 0.28 : 0.01;
const taxa = v => numero(v) != null && numero(v) <= 100 ? Number(v) / 100 : null;

export function prepararMesesTributos({ value = {}, mensal, entradas = {} }) {
  const anual = numero(entradas.receitaAnual), planos = anual == null ? [] : distribuirReceitaAnual(anual);
  const atividades = entradas.receitasPorAtividade || [{ receita: anual, atividade: entradas.atividadePresumido, anexo: entradas.sujeitoAoFatorR ? "FATOR_R" : entradas.anexoSimples, issPct: entradas.aliquotaIss == null ? null : entradas.aliquotaIss * 100 }];
  const somaAtividades = somar(atividades.map(l => numero(l.receita)));
  const linhas = Array.from({ length: 12 }, (_, i) => {
    const m = mensal?.linhas?.[i], ed = value.meses?.[i] || {};
    const receitaPadrao = m?.receita ?? (m?.realizado == null && m?.plano == null ? planos[i] ?? null : null);
    const receita = campo(ed, "receita", receitaPadrao);
    const baseRem = numero(entradas.folhaRemuneracoesAnual);
    return { competencia: `2026-${String(i + 1).padStart(2, "0")}`, receita,
      origem: Object.hasOwn(ed, "receita") ? "Receita editada no estudo" : m?.receita != null ? `${m.origem}${m.mesParcial ? "; projeção do mês em andamento" : ""}` : "Plano: distribuição da receita anual",
      remuneracoes: campo(ed, "remuneracoes", baseRem == null ? null : baseRem / 12),
      encargos: campo(ed, "encargos", numero(entradas.encargosAdicionaisAnuais) == null ? null : Number(entradas.encargosAdicionaisAnuais) / 12),
      folha: campo(ed, "folha", m?.folha ?? null),
      exclusivaIV: campo(ed, "exclusivaIV", null), compartilhada: campo(ed, "compartilhada", null), ratIV: campo(ed, "ratIV", null),
      creditoPis: campo(ed, "creditoPis", entradas.creditosPisCofins === 0 ? 0 : null),
      creditoCofins: campo(ed, "creditoCofins", entradas.creditosPisCofins === 0 ? 0 : null),
      basePisCofins: campo(ed, "basePisCofins", atividades.some(a => a.atividade !== "servicos") ? null : receita),
      baseRealIrpj: campo(ed, "baseRealIrpj", receita != null && entradas.margemLucro != null && !entradas.lucroRealDetalhado?.ativo ? receita * entradas.margemLucro : null, true),
      baseRealCsll: campo(ed, "baseRealCsll", receita != null && entradas.margemLucro != null && !entradas.lucroRealDetalhado?.ativo ? receita * entradas.margemLucro : null, true),
      atividades: atividades.map((a, j) => ({ ...a,
        receita: campo(ed.atividades?.[j] || {}, "receita", receita == null || somaAtividades == null || somaAtividades <= 0 ? null : receita * Number(a.receita) / somaAtividades),
        tratamento: value.tratamentos?.[j] || "normal" })),
    };
  });
  return { linhas, atividades, somaAtividades };
}

// Apropriação no fechamento do trimestre; não representa calendário de vencimento.
export function projetarTributos({ value = {}, mensal, entradas = {}, operacoes = [] }) {
  const preparado = prepararMesesTributos({ value, mensal, entradas });
  const linhas = preparado.linhas;
  const inicio = value.inicio || null;
  const inicioValido = !inicio || /^2026-(0[1-9]|1[0-2])$/.test(inicio);
  const primeiro = inicio ? Number(inicio.slice(-2)) - 1 : 0;
  const anoReceita = somar(linhas.filter((_, i) => !inicio || i >= primeiro).map(m => m.receita));
  const op = calcularOperacoes(operacoes);
  const resultados = Object.keys(REGIMES_ESTUDO).map(regime => {
    let saldoPis = 0, saldoCofins = 0;
    let prejuizo = campo(value, "prejuizoIrpj", 0), negativa = campo(value, "baseNegativaCsll", 0);
    const meses = linhas.map((m, i) => {
      const pendencias = [], tributos = {}, memoria = { tributos: {} };
      const ativo = !inicio || i >= primeiro;
      if (!ativo && inicioValido) return { ...m, ativo: false, tributos, total: 0, pendencias: m.receita > 0 ? ["Receita anterior à abertura: não incluída neste estudo."] : [], memoria };
      if (!inicioValido) pendencias.push("A abertura deve estar em 2026; para anos anteriores, utilize o histórico de 12 meses.");
      if (Number(entradas.anoBase || 2026) !== 2026) pendencias.push("O estudo mensal usa as regras de 2026.");
      if (m.receita == null || m.atividades.some(a => a.receita == null || !ATIVIDADES_PRESUMIDO[a.atividade])) pendencias.push("Confira a receita e a categoria de cada atividade.");
      if (preparado.somaAtividades == null || Math.abs(preparado.somaAtividades - entradas.receitaAnual) > 0.01) pendencias.push("As receitas anuais por atividade precisam fechar com a receita anual.");
      if (somar(m.atividades.map(a => a.receita)) == null || Math.abs(somar(m.atividades.map(a => a.receita)) - m.receita) > 0.01) pendencias.push("A segregação mensal precisa fechar com a receita do mês.");
      if (m.atividades.some(a => a.tratamento !== "normal" && (a.atividade !== "comercio" || a.anexo !== "I"))) pendencias.push("Monofásico/ST neste estudo exige revenda de mercadorias no Anexo I; indústria e combustíveis precisam de regra específica.");
      const receitaServico = somar(m.atividades.filter(a => a.atividade === "servicos").map(a => a.receita));
      const mercadoria = m.atividades.some(a => a.atividade !== "servicos");
      if (m.atividades.some(a => /transporte|combustiveis/.test(a.atividade))) pendencias.push("Transporte e combustíveis exigem tratamento específico não abrangido pelo subtotal.");
      if (regime === "SIMPLES_NACIONAL") {
        const janela = inicio ? linhas.slice(primeiro, i === primeiro ? i + 1 : i) : null;
        const atualizarJanela = (chave, base) => {
          if (base == null) return null;
          let saldo = base;
          for (let j = 0; j < i; j++) {
            const antes = mensal?.linhas?.[j]?.[chave], depois = linhas[j][chave];
            if (antes == null || depois == null) return null;
            saldo += depois - antes;
          }
          return saldo;
        };
        const receitaJanela = janela ? somar(janela.map(x => x.receita)) : atualizarJanela("receita", mensal?.linhas?.[i]?.rbt12);
        const folhaJanela = janela ? somar(janela.map(x => x.folha)) : atualizarJanela("folha", mensal?.linhas?.[i]?.fs12);
        const rbt12 = janela ? receitaJanela == null ? null : receitaJanela * 12 / janela.length : receitaJanela;
        const fatorR = fator(folhaJanela, receitaJanela);
        const acumulada = somar(linhas.slice(inicio ? primeiro : 0, i + 1).map(x => x.receita));
        const limiteAno = inicio ? 400000 * (12 - primeiro) : 4800000;
        const sublimiteAno = inicio ? 300000 * (12 - primeiro) : 3600000;
        if (rbt12 == null) pendencias.push("Falta a receita da janela anterior para calcular RBT12.");
        if (rbt12 > 3600000 || acumulada > sublimiteAno) pendencias.push("Sublimite ultrapassado: efeitos de ISS/ICMS e exclusão precisam ser conferidos por período.");
        if (acumulada > limiteAno) pendencias.push("Limite do Simples ultrapassado no ano; confira a data de exclusão.");
        const partes = m.atividades.map(a => {
          const anexo = a.anexo === "FATOR_R" ? fatorR == null ? null : fatorR >= 0.28 ? "III" : "V" : a.anexo;
          const rep = ANEXOS[anexo] && rbt12 != null ? repartirPorTributo(ANEXOS[anexo], Math.max(1, rbt12)) : null;
          if (!rep || a.receita == null) return { ...a, anexo, total: null };
          const impostos = Object.fromEntries(Object.entries(rep.porTributo).map(([k, t]) => [k,
            (a.tratamento.includes("mono") && ["pis", "cofins"].includes(k) || a.tratamento.includes("st") && k === "icms") ? 0 : dinheiro(a.receita * t)]));
          return { ...a, anexo, faixa: rep.faixa, porTributo: impostos, total: somar(Object.values(impostos)), aliquotas: rep.porTributo };
        });
        tributos.das = somar(partes.map(a => a.total));
        memoria.tributos.das = { base: m.receita, aliquota: tributos.das == null ? null : m.receita > 0 ? tributos.das / m.receita : 0 };
        if (tributos.das == null) pendencias.push("Confira anexos, receitas e folha para Fator R.");
        const receitaIV = somar(partes.filter(a => a.anexo === "IV").map(a => a.receita));
        if (partes.some(a => a.anexo === "IV")) {
          tributos.cpp = m.exclusivaIV == null || m.compartilhada == null || m.receita == null ? null : dinheiro((m.exclusivaIV + m.compartilhada * (m.receita > 0 ? receitaIV / m.receita : 0)) * 0.2);
          tributos.encargos = m.ratIV;
          memoria.tributos.cpp = { base: tributos.cpp == null ? null : tributos.cpp / 0.2, aliquota: 0.2 };
          if (tributos.cpp == null || m.ratIV == null) pendencias.push("Informe remuneração exclusiva do IV, compartilhada e RAT/FAP devido fora do DAS; terceiros não são presumidos.");
        }
        Object.assign(memoria, { rbt12, fatorR, atividades: partes, receitaIV });
      } else {
        tributos.cpp = m.remuneracoes == null ? null : dinheiro(m.remuneracoes * 0.2);
        memoria.tributos.cpp = { base: m.remuneracoes, aliquota: 0.2 };
        tributos.encargos = m.encargos;
        if (tributos.cpp == null || m.encargos == null) pendencias.push("Informe base própria da CPP e encargos patronais.");
        tributos.iss = somar(m.atividades.filter(a => a.atividade === "servicos").map(a => a.receita == null || taxa(a.issPct) == null || taxa(a.issPct) > 0.05 ? null : dinheiro(a.receita * taxa(a.issPct))));
        memoria.tributos.iss = { base: receitaServico, aliquota: tributos.iss == null ? null : receitaServico > 0 ? tributos.iss / receitaServico : 0 };
        if (receitaServico > 0 && tributos.iss == null) pendencias.push("Confira o ISS de cada serviço.");
        // Nas mercadorias, a base deve ser líquida das exclusões conferidas (inclusive ICMS).
        // Não substituir automaticamente receita bruta por base legal de PIS/Cofins.
        const receitaPis = m.basePisCofins;
        if (receitaPis == null) pendencias.push("Informe a base de PIS/Cofins após segregação monofásica e exclusões legais, inclusive ICMS quando cabível.");
        if (regime === "LUCRO_PRESUMIDO") {
          tributos.pis = receitaPis == null ? null : dinheiro(receitaPis * PC.pis);
          tributos.cofins = receitaPis == null ? null : dinheiro(receitaPis * PC.cofins);
          memoria.tributos.pis = { base: receitaPis, aliquota: PC.pis };
          memoria.tributos.cofins = { base: receitaPis, aliquota: PC.cofins };
          if (!entradas.receitasPorAtividade && entradas.atividadePresumido === "servicos" && anoReceita > 0 && anoReceita <= 120000 && entradas.servicosAte120kConfirmado == null) pendencias.push("Confirme o enquadramento na presunção reduzida de serviços; esta parcela usa 32%.");
        } else {
          for (const [k, campoCredito, aliquota] of [["pis", "creditoPis", PNC.pis], ["cofins", "creditoCofins", PNC.cofins]]) {
            const saldo = k === "pis" ? saldoPis : saldoCofins;
            const debito = receitaPis == null ? null : receitaPis * aliquota;
            tributos[k] = debito == null || m[campoCredito] == null || saldo == null ? null : dinheiro(Math.max(0, debito - m[campoCredito] - saldo));
            memoria.tributos[k] = { base: receitaPis, aliquota, credito: m[campoCredito], saldoAnterior: saldo };
            const seguinte = tributos[k] == null ? null : Math.max(0, m[campoCredito] + saldo - debito);
            if (k === "pis") saldoPis = seguinte; else saldoCofins = seguinte;
          }
          if (tributos.pis == null || tributos.cofins == null) pendencias.push("Informe os créditos mensais de PIS e Cofins separados, inclusive zero; saldo anterior desconhecido impede total completo.");
          memoria.saldoPis = saldoPis; memoria.saldoCofins = saldoCofins;
        }
      }
      const ops = op.operacoes.filter(o => o.regime === regime && o.competencia === m.competencia && ["ICMS", "ICMS-ST", "DIFAL", "IPI"].includes(o.tributo));
      if (op.operacoes.some(o => o.pendencia && (!o.regime || o.regime === regime) && (!/^2026-(0[1-9]|1[0-2])$/.test(o.competencia || "") || !o.tributo))) pendencias.push("Há operação sem competência ou tributo válido; complete a lista antes de fechar o total.");
      tributos.operacoes = somar(ops.map(o => o.total));
      if (mercadoria && !value.operacoesConferidas) pendencias.push("Confira a lista completa de ICMS/ST/DIFAL/IPI por operação, inclusive quando não houver recolhimento externo.");
      if (ops.some(o => o.pendencia)) pendencias.push("Há operação com parâmetros pendentes nesta competência.");
      return { ...m, ativo: true, tributos, memoria, pendencias, total: null };
    });
    if (regime !== "SIMPLES_NACIONAL") for (let q = 0; q < 4; q++) {
      const grupo = meses.slice(q * 3, q * 3 + 3).filter(m => m.ativo);
      if (!grupo.length) continue;
      const fim = meses[q * 3 + 2];
      const receita = somar(grupo.map(m => m.receita));
      let baseIrpj = null, baseCsll = null;
      if (regime === "LUCRO_PRESUMIDO") {
        const limite = 1250000 * grupo.length / 3;
        const majoracao = receita != null && receita > limite ? 1 + (receita - limite) / receita * 0.1 : 1;
        const partes = grupo.flatMap(m => m.atividades);
        const usa16 = !entradas.receitasPorAtividade && entradas.atividadePresumido === "servicos" && entradas.servicosAte120kConfirmado === true && anoReceita != null && anoReceita <= 120000;
        baseIrpj = somar(partes.map(a => a.receita == null || !ATIVIDADES_PRESUMIDO[a.atividade] ? null : a.receita * (usa16 ? 0.16 : ATIVIDADES_PRESUMIDO[a.atividade].irpj) * majoracao));
        baseCsll = somar(partes.map(a => a.receita == null || !ATIVIDADES_PRESUMIDO[a.atividade] ? null : a.receita * ATIVIDADES_PRESUMIDO[a.atividade].csll * (q === 0 ? 1 : majoracao)));
        if (majoracao > 1) fim.pendencias.push("Majoração calculada pelo limite trimestral; confira ajuste anual do limite e eventual compensação.");
        if (anoReceita == null) fim.pendencias.push("Falta receita anual para verificar limite de enquadramento e presunção reduzida.");
        if (anoReceita > 78000000) fim.pendencias.push("Receita acima do limite do Presumido; conferir elegibilidade.");
      } else {
        const lucro = somar(grupo.map(m => m.baseRealIrpj)), csll = somar(grupo.map(m => m.baseRealCsll));
        if (lucro != null && prejuizo != null) {
          const compensacao = Math.min(prejuizo, Math.max(0, lucro) * 0.3);
          baseIrpj = Math.max(0, lucro) - compensacao;
          prejuizo = prejuizo - compensacao + Math.max(0, -lucro);
          fim.memoria.compensacaoIrpj = compensacao; fim.memoria.saldoPrejuizo = prejuizo;
        } else prejuizo = null;
        if (csll != null && negativa != null) {
          const compensacao = Math.min(negativa, Math.max(0, csll) * 0.3);
          baseCsll = Math.max(0, csll) - compensacao;
          negativa = negativa - compensacao + Math.max(0, -csll);
          fim.memoria.compensacaoCsll = compensacao; fim.memoria.saldoBaseNegativa = negativa;
        } else negativa = null;
        if (baseIrpj == null || baseCsll == null) fim.pendencias.push("Confira bases mensais ajustadas e saldos fiscais de IRPJ/CSLL. Ausência em trimestre anterior interrompe o saldo.");
      }
      fim.tributos.irpj = baseIrpj == null ? null : dinheiro(baseIrpj * IRPJ.aliquota);
      fim.tributos.adicionalIrpj = baseIrpj == null ? null : dinheiro(Math.max(0, baseIrpj - 20000 * grupo.length) * IRPJ.adicional);
      fim.tributos.csll = baseCsll == null ? null : dinheiro(baseCsll * CSLL_ALIQUOTA);
      fim.memoria.tributos.irpj = { base: baseIrpj, aliquota: IRPJ.aliquota };
      fim.memoria.tributos.adicionalIrpj = { base: baseIrpj == null ? null : Math.max(0, baseIrpj - 20000 * grupo.length), aliquota: IRPJ.adicional };
      fim.memoria.tributos.csll = { base: baseCsll, aliquota: CSLL_ALIQUOTA };
      Object.assign(fim.memoria, { trimestre: q + 1, receitaTrimestre: receita, baseIrpj, baseCsll });
    }
    for (const m of meses) {
      m.subtotal = somar(Object.values(m.tributos));
      m.total = m.pendencias.length ? null : dinheiro(m.subtotal);
    }
    return { regime, meses, total: somar(meses.map(m => m.total)), subtotalConhecido: dinheiro(meses.reduce((s, m) => s + Object.values(m.tributos).reduce((t, v) => t + (v ?? 0), 0), 0)),
      porTributo: Object.fromEntries(Object.keys(IMPOSTOS_MENSAIS).map(k => [k, somar(meses.map(m => Object.hasOwn(m.tributos, k) ? m.tributos[k] : 0))])) };
  });
  return { ano: 2026, resultados, premissa: "Estudo mensal independente dos cards anuais. Receitas vêm do acompanhamento; segregação segue proporções anuais até edição. Remunerações e encargos anuais informados são distribuídos em 12 meses como plano. Lucro Real usa margem ou bases ajustadas digitadas, compensação limitada a 30% e saldos iniciais informados (padrão zero). IRPJ/CSLL aparecem no fechamento trimestral, não no vencimento. Não inclui retenções, outras receitas fora das bases ou regras setoriais. Créditos de PIS e Cofins não se compensam entre si. Monofásico/ST só para revenda confirmada; CPP do IV usa remuneração exclusiva mais compartilhada proporcional à receita IV do mês." };
}
