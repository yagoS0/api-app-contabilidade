// Regras de cálculo; preços e condições vêm de recurso privado aprovado no banco.
const centavosValidos = v => Number.isSafeInteger(v) && v >= 0;
export function catalogoValido(c) {
  if (!c || c.moeda !== "BRL" || !Array.isArray(c.faixas) || !c.faixas.length || typeof c.condicoes !== "string" || !c.condicoes.trim()) return false;
  if (c.apresentacao != null && (typeof c.apresentacao !== "object" || Array.isArray(c.apresentacao) || ["incluidos", "gestao", "beneficios", "limites"].some(k => c.apresentacao[k] != null && (typeof c.apresentacao[k] !== "string" || c.apresentacao[k].length > 6000)))) return false;
  const regimes = ["SIMPLES", "LUCRO_PRESUMIDO"];
  const inteiro = v => Number.isSafeInteger(v) && v >= 0;
  if (!c.faixas.every((f, i) => inteiro(f.ate) && inteiro(f.recebidas) && regimes.every(r => centavosValidos(f[r])) && (!i || f.ate > c.faixas[i - 1].ate))) return false;
  return regimes.every(r => centavosValidos(c.pisoPersonalizado?.[r])) && inteiro(c.blocoRecebidas?.quantidade) && c.blocoRecebidas.quantidade > 0 && centavosValidos(c.blocoRecebidas?.centavos) && ["consultoriaCentavos", "irpfCentavos", "regularizacaoMinimaCentavos"].every(k => centavosValidos(c[k])) && inteiro(c.consultoriaIncluidaAPartir) && ["aberturaCentavos", "baixaCentavos"].every(k => c[k] == null || centavosValidos(c[k]));
}
export function calcularOpcoes({
  ficha,
  catalogo,
  ajustes = {},
  diagnostico = null
}) {
  if (!catalogoValido(catalogo)) throw Object.assign(new Error("Confira as faixas, valores e condições do catálogo."), {
    code: "catalogo_invalido",
    status: 409
  });
  const d = ficha.dados || {},
    pendencias = [],
    opcoes = [];
  const regime = d.regimeAtual || d.regimePretendido;
  const quantidade = v => typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  const funcionarios = quantidade(d.qtdFuncionarios);
  const recebidas = quantidade(d.notasRecebidasMes);
  const mensalNecessaria = d.modalidadeServico !== "AVULSO";
  const limiteFuncionarios = catalogo.faixas.at(-1).ate;
  let mensal = null;
  let mensalMinimoCentavos = null;
  if (mensalNecessaria) {
    if (!Number.isInteger(funcionarios) || funcionarios < 0) pendencias.push("Conferir quantidade de funcionários (sem pró-labore).");
    if (!["SIMPLES", "LUCRO_PRESUMIDO"].includes(regime)) pendencias.push("Contador deve confirmar o regime e o preço mensal.");
    const faixa = catalogo.faixas?.find(f => funcionarios <= f.ate);
    if (faixa && centavosValidos(faixa[regime])) {
      mensal = faixa[regime];
      if (!Number.isInteger(recebidas) || recebidas < 0) pendencias.push("Conferir volume de notas recebidas/despesas.");else mensal += Math.ceil(Math.max(0, recebidas - faixa.recebidas) / catalogo.blocoRecebidas.quantidade) * catalogo.blocoRecebidas.centavos;
      if (d.consultoriaMensal === true && funcionarios < catalogo.consultoriaIncluidaAPartir) mensal += catalogo.consultoriaCentavos;
    } else if (funcionarios > limiteFuncionarios && !(centavosValidos(ajustes.mensalCentavos) && ajustes.justificativa?.trim())) pendencias.push(`Equipe com ${limiteFuncionarios + 1} ou mais funcionários exige orçamento personalizado.`);
    mensalMinimoCentavos = funcionarios > limiteFuncionarios ? catalogo.pisoPersonalizado?.[regime] ?? null : mensal;
    if (centavosValidos(ajustes.mensalCentavos) && ajustes.justificativa?.trim()) {
      mensal = ajustes.mensalCentavos;
      if (centavosValidos(mensalMinimoCentavos) && mensal < mensalMinimoCentavos) pendencias.push(funcionarios > limiteFuncionarios ? "Mensalidade abaixo do piso personalizado." : "Mensalidade abaixo do mínimo do catálogo para a faixa e os adicionais contratados.");
    }
  }
  const decisaoRegularizacao = normalizarDecisaoRegularizacao(diagnostico?.regularizacao);
  if (ficha.origem !== "ABERTURA" && !decisaoRegularizacao) pendencias.push("Confira no diagnóstico se há regularização necessária e registre a justificativa antes de propor valores.");
  const temAvulso = ficha.origem === "ABERTURA" || ["AVULSO", "COMPARAR"].includes(d.modalidadeServico);
  const tipoServicoAvulso = ficha.origem === "ABERTURA" ? "ABERTURA" : temAvulso ? ajustes.tipoServicoAvulso : null;
  const encerramentoEmpresa = ficha.origem === "INATIVA" && d.pretendeReativar === "BAIXAR";
  if (encerramentoEmpresa && (d.modalidadeServico !== "AVULSO" || tipoServicoAvulso !== "BAIXA")) pendencias.push("O cliente escolheu encerrar a empresa. Confira a modalidade avulsa e o serviço de encerramento antes de gerar a proposta.");
  if (temAvulso && ficha.origem !== "ABERTURA" && !["REGULARIZACAO", "BAIXA", "OUTRO"].includes(tipoServicoAvulso)) pendencias.push("Identifique o serviço avulso: regularização, baixa ou outro serviço.");
  const regularizacaoNoAvulso = tipoServicoAvulso === "REGULARIZACAO";
  const regularizacaoCentavos = regularizacaoNoAvulso ? ajustes.regularizacaoCentavos ?? ajustes.servicoCentavos ?? null : ajustes.regularizacaoCentavos ?? null;
  if (regularizacaoNoAvulso && ajustes.regularizacaoCentavos != null && ajustes.servicoCentavos != null && ajustes.regularizacaoCentavos !== ajustes.servicoCentavos) pendencias.push("O valor do serviço de regularização deve ser o mesmo do orçamento de regularização, sem cobrança duplicada.");
  if (regularizacaoNoAvulso && decisaoRegularizacao?.necessaria === false) pendencias.push("O diagnóstico informa que não há regularização necessária. Confira o tipo do serviço ou revise o diagnóstico.");
  if (decisaoRegularizacao?.necessaria && !centavosValidos(regularizacaoCentavos)) pendencias.push("Defina o orçamento da regularização necessária antes da mensalidade.");
  if (decisaoRegularizacao?.necessaria === false && regularizacaoCentavos != null) pendencias.push("O diagnóstico dispensa regularização. Retire esse valor ou revise a decisão e sua justificativa.");
  const avulso = ficha.origem === "ABERTURA" ? ajustes.aberturaCentavos ?? catalogo.aberturaCentavos : regularizacaoNoAvulso ? regularizacaoCentavos : ajustes.servicoCentavos;
  if (ficha.origem === "ABERTURA" || d.modalidadeServico === "AVULSO" || d.modalidadeServico === "COMPARAR") {
    if (!centavosValidos(avulso)) pendencias.push("Definir honorários do serviço avulso.");
    opcoes.push({
      chave: "AVULSO",
      titulo: ficha.origem === "ABERTURA" ? "Somente abertura" : regularizacaoNoAvulso ? "Regularização" : tipoServicoAvulso === "BAIXA" ? "Encerramento da empresa" : "Serviço avulso",
      unicoCentavos: centavosValidos(avulso) ? avulso : null,
      mensalCentavos: 0,
      recorrente: false,
      ...(regularizacaoNoAvulso ? { regularizacaoIncluida: true } : {}),
      escopo: ajustes.escopoAvulso || (ficha.origem === "ABERTURA" ? catalogo.escopoAbertura : "Serviço avulso com escopo a conferir pelo contador.")
    });
  }
  if (mensalNecessaria || ficha.origem === "ABERTURA") {
    if (mensal === null && ficha.origem === "ABERTURA" && d.modalidadeServico === "AVULSO") {
      // A escolha já foi explícita: comparação não obriga contratar contabilidade.
    } else opcoes.push({
      chave: "RECORRENTE",
      titulo: ficha.origem === "ABERTURA" ? "Abertura e contabilidade mensal" : "Contabilidade mensal",
      unicoCentavos: ficha.origem === "ABERTURA" ? centavosValidos(avulso) ? avulso : null : 0,
      mensalCentavos: mensal,
      recorrente: true,
      escopo: catalogo.escopoMensal
    });
  }
  if (regularizacaoCentavos != null && (!centavosValidos(regularizacaoCentavos) || regularizacaoCentavos < catalogo.regularizacaoMinimaCentavos)) pendencias.push("Regularização abaixo do piso; revisar escopo e orçamento.");
  if (ajustes.taxasCentavos != null && !centavosValidos(ajustes.taxasCentavos)) pendencias.push("Taxas devem ser valores em centavos.");
  if (Object.keys(ajustes).some(k => k.endsWith("Centavos")) && !ajustes.justificativa?.trim()) pendencias.push("Registrar a justificativa e fonte dos valores conferidos.");
  return {
    moeda: "BRL",
    opcoes,
    ...apresentacaoDaProposta({ catalogo, funcionarios, recebidas, consultoria: d.consultoriaMensal === true || funcionarios >= catalogo.consultoriaIncluidaAPartir, recorrente: opcoes.some(o => o.recorrente) }),
    pendencias,
    regularizacaoCentavos,
    tipoServicoAvulso,
    decisaoRegularizacao,
    politicaComercial: { versao: 1, mensalMinimoCentavos, regularizacaoMinimaCentavos: catalogo.regularizacaoMinimaCentavos,
      origem: ficha.origem, modalidadeServico: d.modalidadeServico || "RECORRENTE", tipoServicoAvulso: tipoServicoAvulso || null,
      decisaoRegularizacao, regularizacaoNoAvulso, encerramentoEmpresa },
    taxasCentavos: ajustes.taxasCentavos ?? null,
    taxasConfirmadas: ajustes.taxasConfirmadas === true,
    condicoes: catalogo.condicoes,
    justificativa: ajustes.justificativa || null
  };
}

export function normalizarDecisaoRegularizacao(r) {
  if (!r || typeof r.necessaria !== "boolean" || typeof r.justificativa !== "string" || r.justificativa.trim().length < 10 || r.justificativa.length > 1200) return null;
  const condicaoInicioMensal = r.necessaria ? "APOS_REGULARIZACAO" : "SEM_REGULARIZACAO";
  if (r.condicaoInicioMensal !== condicaoInicioMensal) return null;
  return { necessaria: r.necessaria, justificativa: r.justificativa.trim(), condicaoInicioMensal };
}

// Revalida somente a política congelada na proposta. Nunca aplica preços de um
// catálogo mais recente a uma negociação anterior nem libera legado sem prova.
export function pendenciasPoliticaComercial(s) {
  const p = s?.politicaComercial;
  if (p?.versao !== 1 || !["ABERTURA", "TRANSFERENCIA", "INATIVA"].includes(p.origem)
    || typeof p.encerramentoEmpresa !== "boolean" || !centavosValidos(p.regularizacaoMinimaCentavos) || !Array.isArray(s.opcoes) || !s.opcoes.length) return ["Gere uma nova versão para conferir a política comercial desta proposta."];
  const pendencias = [...(s.pendencias || [])];
  if (p.origem !== "ABERTURA" && !normalizarDecisaoRegularizacao(p.decisaoRegularizacao)) pendencias.push("Confira a decisão de regularização no diagnóstico e gere outra versão.");
  if (JSON.stringify(s.decisaoRegularizacao) !== JSON.stringify(p.decisaoRegularizacao) || s.tipoServicoAvulso !== p.tipoServicoAvulso) pendencias.push("O escopo financeiro mudou. Gere uma nova versão da proposta.");
  const recorrentes = s.opcoes.filter(o => o.recorrente);
  if (p.encerramentoEmpresa && (p.origem !== "INATIVA" || p.modalidadeServico !== "AVULSO" || p.tipoServicoAvulso !== "BAIXA" || recorrentes.length)) pendencias.push("Encerramento exige somente serviço avulso de baixa, sem contabilidade mensal.");
  if (recorrentes.some(o => !centavosValidos(p.mensalMinimoCentavos) || !centavosValidos(o.mensalCentavos) || o.mensalCentavos < p.mensalMinimoCentavos)) pendencias.push("Mensalidade abaixo do mínimo da faixa e dos adicionais conferidos.");
  if (s.opcoes.some(o => !centavosValidos(o.unicoCentavos) || !centavosValidos(o.mensalCentavos))) pendencias.push("Confira os valores das opções da proposta.");
  if (p.decisaoRegularizacao?.necessaria || p.regularizacaoNoAvulso || s.regularizacaoCentavos != null) {
    if (!centavosValidos(s.regularizacaoCentavos) || s.regularizacaoCentavos < p.regularizacaoMinimaCentavos) pendencias.push("Confira o orçamento mínimo de regularização.");
  }
  if (p.decisaoRegularizacao?.necessaria === false && (p.regularizacaoNoAvulso || s.regularizacaoCentavos != null)) pendencias.push("O orçamento de regularização não corresponde ao diagnóstico.");
  if (p.regularizacaoNoAvulso && s.opcoes.filter(o => !o.recorrente).some(o => o.regularizacaoIncluida !== true || o.unicoCentavos !== s.regularizacaoCentavos)) pendencias.push("Confira a regularização incluída na opção avulsa, sem duplicar a cobrança.");
  if (s.opcoes.filter(o => !o.recorrente).some(o => p.origem !== "ABERTURA" && !["REGULARIZACAO", "BAIXA", "OUTRO"].includes(p.tipoServicoAvulso))) pendencias.push("Confira o tipo do serviço avulso.");
  return [...new Set(pendencias)];
}

// Congela o conteúdo comercial aprovado junto ao preço. Mudanças no catálogo
// nunca acrescentam benefícios retroativamente a uma proposta já emitida.
function apresentacaoDaProposta({ catalogo, funcionarios, recebidas, consultoria, recorrente }) {
  const a = catalogo.apresentacao || {};
  const faixa = recorrente && Number.isInteger(funcionarios) && funcionarios >= 0 ? catalogo.faixas.find(f => funcionarios <= f.ate) : null;
  const blocos = faixa && Number.isInteger(recebidas) && recebidas >= 0 ? Math.ceil(Math.max(0, recebidas - faixa.recebidas) / catalogo.blocoRecebidas.quantidade) : null;
  return {
    apresentacao: recorrente ? {
      incluidos: String(a.incluidos || ""), gestao: consultoria ? String(a.gestao || "") : "",
      beneficios: String(a.beneficios || ""), limites: String(a.limites || "")
    } : null,
    limitesPlano: faixa && blocos !== null ? {
      funcionarios: faixa.ate, documentosEntradaMes: faixa.recebidas + blocos * catalogo.blocoRecebidas.quantidade,
      blocoAdicionalQuantidade: catalogo.blocoRecebidas.quantidade, blocoAdicionalCentavos: catalogo.blocoRecebidas.centavos
    } : null
  };
}
export function preencherTexto(texto, variaveis) {
  const faltantes = new Set();
  const preenchido = String(texto).replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, k) => {
    if (!Object.hasOwn(variaveis, k) || variaveis[k] === null || String(variaveis[k]).trim() === "") {
      faltantes.add(k);
      return "";
    }
    return String(variaveis[k]);
  });
  if (faltantes.size) throw Object.assign(new Error(`Preencha: ${[...faltantes].join(", ")}.`), {
    status: 409,
    code: "variaveis_ausentes"
  });
  if (/\{\{|\}\}/.test(preenchido)) throw Object.assign(new Error("Há marcadores inválidos no texto."), {
    status: 400,
    code: "marcadores_invalidos"
  });
  return preenchido;
}
