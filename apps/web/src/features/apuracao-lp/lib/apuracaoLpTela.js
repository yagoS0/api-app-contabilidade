// A LEITURA DA APURAÇÃO DO LUCRO PRESUMIDO — o que a tela mostra, e o que ela é OBRIGADA a dizer.
//
// A conta é do backend (`application/fiscal/lp/lib/apuracaoPresumido.js`, regra pura, 43 testes) e
// **não é refeita aqui**. Este módulo responde a outra pergunta: como o contador lê aquilo sem ser
// induzido a erro.
//
// As três coisas que ele existe para impedir:
//
//   1. ⚠⚠ a alíquota efetiva de um mês que não fecha trimestre (3,65%) ser lida como "a carga do
//      Presumido". Ela é PARCIAL, e a parcialidade sai no TEXTO — não só na cor;
//   2. ⚠⚠ célula vazia. IRPJ e CSLL num mês que não fecha não são "zero" nem branco: são
//      NÃO APURADOS NESTE MÊS, com o motivo;
//   3. ⚠⚠ `sem_dctfweb` se parecer com `ok`. "A declaração não traz este tributo" e "bate com a
//      declaração" são respostas opostas, e a segunda é a única que autoriza seguir em frente.

// ⚠ OS TONS SÃO OS DO `Aviso` (`ok` · `atencao` · `erro` · `neutro`), e não um vocabulário próprio.
// Traduzir tom no componente é onde a divergência entra: a regra diria uma coisa e a caixa pintaria
// outra, e `tomDoAviso` cairia em `neutro` sem ninguém notar.

/** O período a que cada linha se refere. Lista FECHADA. */
export const PERIODO = Object.freeze({
  MES: "MES",
  TRIMESTRE: "TRIMESTRE",
});

/** Por que uma linha não tem número. ⚠ Lista FECHADA, e cada motivo tem conserto diferente. */
export const AUSENCIA = Object.freeze({
  /** O tributo é trimestral e este mês não fecha o trimestre. Não é zero, e não é erro. */
  FECHA_NO_TRIMESTRE: "fecha_no_trimestre",
  /** O tributo existe no regime e é apurado fora deste módulo. */
  FORA_DESTE_MODULO: "fora_deste_modulo",
});

const FRASE_DA_AUSENCIA = Object.freeze({
  [AUSENCIA.FECHA_NO_TRIMESTRE]: "não apurado neste mês",
  [AUSENCIA.FORA_DESTE_MODULO]: "apurado fora deste módulo",
});

export const fraseDaAusencia = (motivo) => FRASE_DA_AUSENCIA[motivo] || null;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * A MEMÓRIA DE CÁLCULO, linha a linha — é o que o dono pediu: *"vai aparecer todo o cálculo da
 * presunção de cada imposto e o valor final"*.
 *
 * Cada linha diz **de onde saiu a base**, não só o valor. Sem isso a tabela é uma lista de números
 * que ninguém consegue conferir contra a DARF.
 *
 * ⚠⚠ O ADICIONAL DE IRPJ É LINHA PRÓPRIA, e não uma soma escondida dentro do IRPJ: ele tem base
 * DIFERENTE (o excedente de R$ 60.000 no trimestre) e alíquota diferente (10%). Somados numa linha
 * só, "IRPJ 18.000 sobre base 96.000" daria uma alíquota aparente de 18,75%, que não existe em
 * norma nenhuma e não confere com nada.
 *
 * ⚠ Linha sem valor NUNCA some e NUNCA vira zero — ela sai com `ausencia` nomeada.
 */
export function linhasDaMemoriaDeCalculo(apuracao) {
  if (!apuracao) return [];
  const a = apuracao;
  const receitaMes = num(a.receita?.total);
  const receitaTri = num(a.trimestre?.receita);

  const linhas = [
    {
      chave: "pis",
      tributo: "PIS",
      periodo: PERIODO.MES,
      base: receitaMes,
      baseDescricao: "receita bruta do mês",
      aliquota: 0.0065,
      valor: num(a.pis),
    },
    {
      chave: "cofins",
      tributo: "COFINS",
      periodo: PERIODO.MES,
      base: receitaMes,
      baseDescricao: "receita bruta do mês",
      aliquota: 0.03,
      valor: num(a.cofins),
    },
  ];

  const presuncaoIrpj = num(a.irpj?.presuncaoAplicadaServicos);
  const presuncaoCsll = num(a.csll?.presuncaoAplicadaServicos);

  linhas.push({
    chave: "irpj",
    tributo: "IRPJ",
    periodo: PERIODO.TRIMESTRE,
    base: num(a.irpj?.base),
    baseDescricao: a.irpj
      ? descricaoDaPresuncao({ receita: receitaTri, presuncao: presuncaoIrpj, servicos: num(a.trimestre?.receitaServicos), mercadorias: num(a.trimestre?.receitaMercadorias) })
      : null,
    aliquota: a.irpj ? 0.15 : null,
    valor: num(a.irpj?.normal),
    ausencia: a.irpj ? null : AUSENCIA.FECHA_NO_TRIMESTRE,
  });

  linhas.push({
    chave: "irpjAdicional",
    tributo: "IRPJ — adicional",
    periodo: PERIODO.TRIMESTRE,
    base: a.irpj ? Math.max(0, num(a.irpj.base) - 60000) : null,
    baseDescricao: a.irpj
      ? "o que excede R$ 60.000,00 de base no trimestre"
      : null,
    aliquota: a.irpj ? 0.10 : null,
    valor: num(a.irpj?.adicional),
    ausencia: a.irpj ? null : AUSENCIA.FECHA_NO_TRIMESTRE,
  });

  linhas.push({
    chave: "csll",
    tributo: "CSLL",
    periodo: PERIODO.TRIMESTRE,
    base: num(a.csll?.base),
    baseDescricao: a.csll
      ? descricaoDaPresuncao({ receita: receitaTri, presuncao: presuncaoCsll, servicos: num(a.trimestre?.receitaServicos), mercadorias: num(a.trimestre?.receitaMercadorias) })
      : null,
    aliquota: a.csll ? 0.09 : null,
    valor: num(a.csll?.total),
    ausencia: a.csll ? null : AUSENCIA.FECHA_NO_TRIMESTRE,
  });

  return linhas;
}

/**
 * ⚠ A descrição da base diz a PRESUNÇÃO aplicada, e diz quando há DUAS.
 *
 * Serviços e mercadorias presumem percentuais diferentes (32%/8% no IRPJ, 32%/12% na CSLL). Uma
 * empresa com as duas receitas tem uma base que não é "X% de nada" — dizer um percentual só ali
 * seria dar ao contador um número que ele não consegue refazer.
 */
function descricaoDaPresuncao({ receita, presuncao, servicos, mercadorias }) {
  const temServicos = (servicos || 0) > 0;
  const temMercadorias = (mercadorias || 0) > 0;
  if (temServicos && temMercadorias) {
    return "presunção sobre a receita do trimestre, com percentuais diferentes para serviços e para mercadorias";
  }
  if (temMercadorias) return "presunção sobre a receita de mercadorias do trimestre";
  if (presuncao == null || receita == null) return "presunção sobre a receita do trimestre";
  return `${pct(presuncao)} da receita de serviços do trimestre`;
}

/**
 * ⚠⚠ A ALÍQUOTA EFETIVA, com a parcialidade DITA EM PALAVRAS.
 *
 * Num mês que não fecha trimestre a carga apurada é 3,65% (PIS + COFINS). Apresentada sem ressalva,
 * ela é lida como *"o Presumido custa 3,65%"* — e o mesmo contador vê 12,5% três meses depois, sem
 * entender por quê. A ressalva não pode ser só cor nem `title`: impressão em preto e branco e
 * navegação por teclado tiram os dois.
 *
 * ⚠ `valor: null` vira traço, NUNCA "0%". Zero afirmaria carga tributária zero.
 */
export function leituraDaCargaEfetiva(cargaEfetiva) {
  const c = cargaEfetiva || {};
  const valor = num(c.valor);
  const completa = c.completa === true;
  return {
    texto: valor == null ? "—" : pct(valor),
    completa,
    // ⚠ O rótulo diz a BASE. "Alíquota efetiva" sozinha não distingue mês de trimestre, e os dois
    // números convivem na mesma tela.
    rotulo: c.base === "TRIMESTRE" ? "Alíquota efetiva do trimestre" : "Alíquota efetiva do mês",
    ressalva: valor == null
      ? (c.motivo || "Sem receita na competência.")
      : (completa ? null : (c.motivo || "Cálculo parcial.")),
    // ⚠⚠ O TÍTULO DA RESSALVA SAI DAQUI, e não do componente — achado no navegador (27/08/2026):
    // escrito lá, ele era `completa ? "Sobre este número" : "Esta alíquota é PARCIAL"`, e com
    // receita ZERO a caixa dizia "ESTA ALÍQUOTA É PARCIAL" sobre um traço. Não há alíquota nenhuma
    // ali; chamá-la de parcial afirma que existe um número incompleto onde não existe número.
    // São TRÊS estados, e o do meio não é o mesmo que o de cima.
    tituloDaRessalva: valor == null
      ? "Não há alíquota efetiva a calcular"
      : (completa ? "Sobre este número" : "Esta alíquota é PARCIAL"),
    // ⚠ NUNCA `--state-ok`. Verde, nesta casa, quer dizer CONCLUÍDO — e uma apuração calculada não é
    // uma apuração paga nem entregue. Carga parcial é âmbar (pendência de leitura); completa é neutra.
    tom: valor == null ? "neutro" : (completa ? "neutro" : "atencao"),
  };
}

/** Os estados da conferência contra a DARF. ⚠ Lista FECHADA, e `sem_dctfweb` NÃO é `ok`. */
export const CONFERENCIA = Object.freeze({
  OK: "ok",
  DIVERGENTE: "divergente",
  SEM_DECLARACAO: "sem_dctfweb",
});

const LEITURA_DA_CONFERENCIA = Object.freeze({
  [CONFERENCIA.OK]: {
    rotulo: "confere com a declaração",
    // ⚠ Aqui verde É o certo: isto é uma conferência CONCLUÍDA, não uma ação a fazer.
    tom: "ok",
  },
  [CONFERENCIA.DIVERGENTE]: {
    rotulo: "diverge da declaração",
    tom: "atencao",
  },
  [CONFERENCIA.SEM_DECLARACAO]: {
    // ⚠⚠ A frase mais importante do módulo. "Sem declaração" NÃO é "está tudo certo": é "não há
    // com o que comparar". Colapsá-la em `ok` faria a tela dar por conferida uma competência em
    // que ninguém buscou os tributos no SERPRO.
    rotulo: "sem declaração capturada para comparar",
    // ⚠ A MESMA linha tem outra frase quando a DARF EXISTE e simplesmente não traz este tributo —
    // ver `linhasDaConferencia`. Dizer "sem declaração capturada" ao lado de um bloco que anuncia a
    // DARF é a contradição que o navegador pegou em 27/08/2026, um nível acima.
    rotuloComDeclaracao: "a declaração desta competência não traz este tributo",
    tom: "neutro",
  },
});

/**
 * A conferência do nosso motor × o que a DCTFWeb declara, por tributo.
 *
 * ⚠ Ela é ALERTA, nunca bloqueio — é o que o próprio serviço registra: "diverge → alerta (nunca
 * bloqueia a provisão automática)". Por isso `--state-danger` não aparece aqui: nesta casa vermelho
 * bloqueia o fechamento, e isto não bloqueia nada.
 */
export function linhasDaConferencia(reconciliacao, { temDeclaracao = false } = {}) {
  if (!reconciliacao) return [];
  return Object.entries(reconciliacao).map(([tributo, r]) => {
    const estado = LEITURA_DA_CONFERENCIA[r?.status] || LEITURA_DA_CONFERENCIA[CONFERENCIA.SEM_DECLARACAO];
    return {
      tributo,
      calculado: num(r?.calculado),
      declarado: num(r?.dctfweb),
      diferenca: num(r?.diferenca),
      status: r?.status || CONFERENCIA.SEM_DECLARACAO,
      rotulo: temDeclaracao && estado.rotuloComDeclaracao ? estado.rotuloComDeclaracao : estado.rotulo,
      tom: estado.tom,
    };
  });
}

/**
 * ⚠ HÁ ALGO A CONFERIR? — e são TRÊS respostas quando não há, não duas.
 *
 * Sem esta distinção o cabeçalho da conferência diria "tudo confere" numa competência em que a
 * declaração nunca foi capturada.
 *
 * ⚠⚠ A TERCEIRA RESPOSTA SAIU DO NAVEGADOR, NÃO DO TESTE (27/08/2026). Num mês que não fecha
 * trimestre e tem DARF de IRPJ/CSLL, a tela mostrava, uma abaixo da outra:
 *
 *     "HÁ DARF DE IRPJ/CSLL NESTA COMPETÊNCIA — R$ 8.880,00"
 *     "não há declaração da DCTFWeb capturada para esta competência"
 *
 * As duas frases eram tecnicamente exatas (existe DARF; ela não traz nenhum tributo que este mês
 * apure) e se liam como CONTRADIÇÃO — que é pior que uma delas estar errada, porque o contador não
 * tem como saber em qual acreditar. `temDeclaracao` separa "ninguém buscou" de "buscou, e nada do
 * que veio entra nesta conferência".
 *
 * @param {Object} reconciliacao
 * @param {{tributosDeclarados?: string[]}} [contexto]  os tributos que a DARF capturada traz
 */
export function resumoDaConferencia(reconciliacao, { tributosDeclarados = [] } = {}) {
  const declaradosCru = Array.isArray(tributosDeclarados) ? tributosDeclarados : [];
  const linhas = linhasDaConferencia(reconciliacao, { temDeclaracao: declaradosCru.length > 0 });
  const comparadas = linhas.filter((l) => l.status !== CONFERENCIA.SEM_DECLARACAO);
  const divergentes = comparadas.filter((l) => l.status === CONFERENCIA.DIVERGENTE);
  const declarados = declaradosCru.filter(Boolean);

  if (!comparadas.length && declarados.length) {
    return {
      comparadas: 0,
      divergentes: 0,
      tom: "neutro",
      frase: `A DARF capturada nesta competência traz ${declarados.join(" e ")}, e nenhum deles está `
        + "entre os tributos apurados neste mês — por isso a conferência fica sem par. Não é "
        + "ausência de declaração; é ausência de sobreposição.",
    };
  }

  if (!comparadas.length) {
    return {
      comparadas: 0,
      divergentes: 0,
      tom: "neutro",
      frase: "Nenhum tributo pôde ser conferido: não há declaração da DCTFWeb capturada para esta "
        + "competência. Isto não quer dizer que o cálculo está certo — quer dizer que não há com o "
        + "que compará-lo.",
    };
  }
  if (divergentes.length) {
    return {
      comparadas: comparadas.length,
      divergentes: divergentes.length,
      tom: "atencao",
      frase: `${divergentes.length} de ${comparadas.length} tributo(s) divergem do que a declaração `
        + "traz. A diferença é um alerta para conferir, não um bloqueio.",
    };
  }
  return {
    comparadas: comparadas.length,
    divergentes: 0,
    tom: "ok",
    frase: `Os ${comparadas.length} tributos conferidos batem com a declaração da DCTFWeb `
      + "(tolerância de 2%).",
  };
}

/**
 * ⚠⚠ O AVISO DA QUOTA — e ele é o único bloco desta tela que fala de uma DARF que o cálculo NÃO
 * explica.
 *
 * Ele vem pronto do backend (`quotaDeTrimestreAnterior.leitura`) e a tela **não escreve a sua**: as
 * duas frases divergiriam na primeira correção, e esta é sobre dado fiscal.
 */
export function avisoDaQuota(quota) {
  if (!quota) return null;
  return {
    titulo: "Há DARF de IRPJ/CSLL nesta competência",
    texto: quota.leitura,
    total: num(quota.total),
    tributos: Array.isArray(quota.tributos) ? quota.tributos : [],
    tom: "atencao",
  };
}

/**
 * ⚠ O AVISO DA REGRA DOS R$ 120.000 — e ele aparece nos QUATRO estados, com frases diferentes.
 *
 * "Não perguntamos" e "o contador disse que não" produzem o mesmo imposto e NÃO são a mesma
 * afirmação; um estado mudo faria o contador achar que a redução foi avaliada quando ninguém a
 * avaliou.
 */
export function avisoDosServicos16(servicos16) {
  if (!servicos16) return null;
  const estado = servicos16.estado;
  return {
    estado,
    presuncao: num(servicos16.presuncao),
    texto: servicos16.motivo || null,
    excecoes: Array.isArray(servicos16.excecoes) ? servicos16.excecoes : [],
    // ⚠ Âmbar SÓ quando há decisão pendente ou confirmação derrubada. "Confirmado" e "recusado" são
    // decisões tomadas — âmbar permanente treina o olho a ignorar a cor.
    tom: estado === "nao_perguntado" || estado === "impossivel_pela_receita" ? "atencao" : "neutro",
  };
}

// ── formatação ────────────────────────────────────────────────────────────────────────────────

/** ⚠ `null` vira traço, NUNCA "R$ 0,00" — zero é uma afirmação, ausência não. */
export function dinheiro(v) {
  const n = num(v);
  return n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** ⚠ Idem: `null` vira traço, nunca "0%". */
export function pct(v) {
  const n = num(v);
  return n == null ? "—" : `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
