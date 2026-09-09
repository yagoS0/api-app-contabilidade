// Regras de cálculo; preços e condições vêm de recurso privado aprovado no banco.
const centavosValidos = v => Number.isSafeInteger(v) && v >= 0;
export function catalogoValido(c) {
  if (!c || c.moeda !== "BRL" || !Array.isArray(c.faixas) || !c.faixas.length || typeof c.condicoes !== "string" || !c.condicoes.trim()) return false;
  const regimes = ["SIMPLES", "LUCRO_PRESUMIDO"];
  const inteiro = v => Number.isSafeInteger(v) && v >= 0;
  if (!c.faixas.every((f, i) => inteiro(f.ate) && inteiro(f.recebidas) && regimes.every(r => centavosValidos(f[r])) && (!i || f.ate > c.faixas[i - 1].ate))) return false;
  return regimes.every(r => centavosValidos(c.pisoPersonalizado?.[r])) && inteiro(c.blocoRecebidas?.quantidade) && c.blocoRecebidas.quantidade > 0 && centavosValidos(c.blocoRecebidas?.centavos) && ["consultoriaCentavos", "irpfCentavos", "regularizacaoMinimaCentavos"].every(k => centavosValidos(c[k])) && inteiro(c.consultoriaIncluidaAPartir) && ["aberturaCentavos", "baixaCentavos"].every(k => c[k] == null || centavosValidos(c[k]));
}
export function calcularOpcoes({
  ficha,
  catalogo,
  ajustes = {}
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
  if (mensalNecessaria) {
    if (!Number.isInteger(funcionarios) || funcionarios < 0) pendencias.push("Conferir quantidade de funcionários (sem pró-labore).");
    if (!["SIMPLES", "LUCRO_PRESUMIDO"].includes(regime)) pendencias.push("Contador deve confirmar o regime e o preço mensal.");
    const faixa = catalogo.faixas?.find(f => funcionarios <= f.ate);
    if (faixa && centavosValidos(faixa[regime])) {
      mensal = faixa[regime];
      if (!Number.isInteger(recebidas) || recebidas < 0) pendencias.push("Conferir volume de notas recebidas/despesas.");else mensal += Math.ceil(Math.max(0, recebidas - faixa.recebidas) / catalogo.blocoRecebidas.quantidade) * catalogo.blocoRecebidas.centavos;
      if (d.consultoriaMensal === true && funcionarios < catalogo.consultoriaIncluidaAPartir) mensal += catalogo.consultoriaCentavos;
    } else if (funcionarios > limiteFuncionarios) pendencias.push(`Equipe com ${limiteFuncionarios + 1} ou mais funcionários exige orçamento personalizado.`);
    if (centavosValidos(ajustes.mensalCentavos) && ajustes.justificativa?.trim()) {
      mensal = ajustes.mensalCentavos;
      const piso = funcionarios > limiteFuncionarios ? catalogo.pisoPersonalizado?.[regime] : null;
      if (piso && mensal < piso) pendencias.push("Mensalidade abaixo do piso personalizado.");
    }
  }
  const avulso = ficha.origem === "ABERTURA" ? ajustes.aberturaCentavos ?? catalogo.aberturaCentavos : ajustes.servicoCentavos;
  if (ficha.origem === "ABERTURA" || d.modalidadeServico === "AVULSO" || d.modalidadeServico === "COMPARAR") {
    if (!centavosValidos(avulso)) pendencias.push("Definir honorários do serviço avulso.");
    opcoes.push({
      chave: "AVULSO",
      titulo: ficha.origem === "ABERTURA" ? "Somente abertura" : "Serviço avulso",
      unicoCentavos: centavosValidos(avulso) ? avulso : null,
      mensalCentavos: 0,
      recorrente: false,
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
  if (ajustes.regularizacaoCentavos != null && (!centavosValidos(ajustes.regularizacaoCentavos) || ajustes.regularizacaoCentavos < catalogo.regularizacaoMinimaCentavos)) pendencias.push("Regularização abaixo do piso; revisar escopo e orçamento.");
  if (ajustes.taxasCentavos != null && !centavosValidos(ajustes.taxasCentavos)) pendencias.push("Taxas devem ser valores em centavos.");
  if (Object.keys(ajustes).some(k => k.endsWith("Centavos")) && !ajustes.justificativa?.trim()) pendencias.push("Registrar a justificativa e fonte dos valores conferidos.");
  return {
    moeda: "BRL",
    opcoes,
    pendencias,
    regularizacaoCentavos: ajustes.regularizacaoCentavos ?? null,
    taxasCentavos: ajustes.taxasCentavos ?? null,
    taxasConfirmadas: ajustes.taxasConfirmadas === true,
    condicoes: catalogo.condicoes,
    justificativa: ajustes.justificativa || null
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
