// O FLUXO DE CAIXA — o que entra e o que sai nos próximos meses.
//
// ⚠⚠ ESTE MÓDULO É PURO: sem prisma, sem relógio, sem I/O. O "hoje" é INJETADO. Um relógio aqui
// faria o mesmo dado dar respostas diferentes em dias diferentes, e a evidência de cada linha
// deixaria de ser reproduzível.
//
// ─── ⚠⚠ AS TRÊS COISAS QUE ESTE FLUXO SE RECUSA A FAZER ──────────────────────────────────────
//
// **1 · NÃO EXISTE UM `total`.** `totais` traz `fato`, `previsao` e `desconhecido` SEPARADOS, e a
// ausência da soma é deliberada: `docs/dre-fluxo-caixa.md` a proíbe. Um número único somando o que
// aconteceu com o que talvez aconteça é exatamente o que alguém imprime e leva ao banco. **A API
// nunca entrega a soma** — no instante em que ela existir, alguma tela a imprime.
//
// **2 · NÃO EXISTE TOTAL DE 12 MESES.** Mesmo princípio, e há um segundo motivo: **sem saldo
// inicial não há saldo acumulado** (o dono tirou o saldo inicial do escopo em 25/08/2026). Totaliza-
// se por MÊS e por PROCEDÊNCIA, e nada mais. A ausência é coerente, não uma falta.
//
// **3 · `DESCONHECIDO` NÃO VIRA ZERO E NÃO VIRA PREVISÃO.** Ele carrega **contagem, nunca valor** —
// somar uma guia sem vencimento a um mês qualquer seria escolher o mês por ela. É a mesma
// disciplina de `disponibilidades.js`: *"o desconhecido segue NOMEADO, e nunca vira saldo em
// silêncio"*.

/**
 * ⚠⚠ DE ONDE VEM CADA LINHA — vocabulário FECHADO, e é ele que a lei de cor lê.
 *
 * ⚠ `PREVISAO` **nunca recebe verde**: verde, nesta casa, quer dizer *pago/concluído* — o pior
 * desfecho possível para uma linha que ainda não aconteceu. E a palavra *"previsto"* vai no TEXTO,
 * não só na cor (impressão, daltonismo).
 */
export const PROCEDENCIA = Object.freeze({
  /**
   * ⚠⚠ **ACONTECEU E TEM PROVA DE PAGAMENTO.** Guia paga, baixa de despesa.
   *
   * ⚠⚠ **O SIGNIFICADO DESTA CHAVE MUDOU EM 28/08/2026, E ISSO É O CORAÇÃO DA ENTREGA.** Até aqui
   * `FATO` queria dizer *"existe, com data própria"* — e a guia GERADA e em aberto entrava nele. A
   * **Lei 1** da `CONSTITUICAO-do-produto.md` desfaz isso: *"Contabilizado, emitido, gerado,
   * vencido: nada disso é fato de caixa."* O que era `FATO` sem pagamento virou `COMPROMISSO`.
   *
   * ⚠ Quem depender do sentido antigo (guia em aberto contando como fato) passa a contar menos —
   * e é o comportamento certo: a tela nunca deve mostrar menos dinheiro do que há no banco.
   */
  FATO: "FATO",
  /**
   * ⚠⚠ NÃO ACONTECEU, MAS VALOR E DATA SÃO CONHECIDOS. Guia gerada e não paga; provisão de folha.
   *
   * ⚠ Ele NÃO é uma previsão enfraquecida: ninguém está estimando nada. É um compromisso assumido,
   * com número exato — o que falta é o dinheiro sair. Colapsá-lo em `PREVISAO` apagaria a diferença
   * entre *"o contador calculou isto"* e *"o sistema chutou pelo histórico"*.
   */
  COMPROMISSO: "COMPROMISSO",
  /** O sistema calculou a partir do histórico. ⚠ Nunca verde, e a prova viaja junto. */
  PREVISAO: "PREVISAO",
  /** ⚠⚠ Falta um dado para saber o MÊS. Não vira zero, não vira previsão, não some. */
  DESCONHECIDO: "DESCONHECIDO",
});

/**
 * ⚠⚠ AS DUAS CORES QUE O USUÁRIO VÊ — e os TRÊS níveis que o dado guarda.
 *
 * `CONSTITUICAO-do-produto.md` §1: *"Por dentro, os três níveis são sempre distintos. Por fora, o
 * usuário vê duas cores: preto = fato, âmbar = compromisso ou presunção."*
 *
 * ⚠ A derivação mora AQUI, ao lado do vocabulário, e não na tela: duas telas leem este payload
 * (cliente e escritório), e cada uma derivando por conta própria é como elas divergem.
 * ⚠ `DESCONHECIDO` não recebe status: ele não tem valor, logo não pinta célula nenhuma.
 */
export const STATUS_DA_CELULA = Object.freeze({ CONFIRMADO: "confirmed", PREVISTO: "forecast" });

export function statusDaProcedencia(procedencia) {
  if (procedencia === PROCEDENCIA.FATO) return STATUS_DA_CELULA.CONFIRMADO;
  if (procedencia === PROCEDENCIA.COMPROMISSO || procedencia === PROCEDENCIA.PREVISAO) {
    return STATUS_DA_CELULA.PREVISTO;
  }
  return null;
}

/**
 * ⚠⚠ O STATUS DE UMA CÉLULA (que soma VÁRIAS linhas) — e a regra é a do elo mais fraco.
 *
 * `SPEC-fluxo-de-caixa-v3.md` §3.3: *"Resultado herda `previsto` se qualquer parcela for prevista."*
 * Vale para toda célula, não só o Resultado: uma célula que soma uma guia paga com uma guia em
 * aberto **não é um fato**. Marcá-la de preto afirmaria que o dinheiro já saiu.
 */
export function statusDoConjunto(linhas) {
  const comValor = (linhas || []).filter((l) => l && l.procedencia !== PROCEDENCIA.DESCONHECIDO);
  if (comValor.length === 0) return null;
  return comValor.every((l) => l.procedencia === PROCEDENCIA.FATO)
    ? STATUS_DA_CELULA.CONFIRMADO
    : STATUS_DA_CELULA.PREVISTO;
}

/** ⚠ Entrada ou saída de dinheiro. A mesma forma dos dois lados. */
export const DIRECAO = Object.freeze({ ENTRADA: "ENTRADA", SAIDA: "SAIDA" });

/** De qual contribuinte a linha nasceu. ⚠ Vocabulário FECHADO — a tela agrupa por ele. */
export const FONTE = Object.freeze({
  GUIA: "GUIA",
  NOTA_EMITIDA: "NOTA_EMITIDA",
  SERIE_RECEITA: "SERIE_RECEITA",
  SERIE_DESPESA: "SERIE_DESPESA",
  IMPOSTO_PROJETADO: "IMPOSTO_PROJETADO",
  /**
   * ⚠⚠ A FOLHA — coluna própria no v3 (§3.2), e por isso fonte própria.
   *
   * ⚠ Ela **não** é uma `SERIE_DESPESA`: a série é detectada por repetição de nota; a folha vem de
   * `AccountingEntry tipo:"FOLHA"`, que é lançamento contábil do escritório. Misturá-las faria a
   * coluna Folha somar despesa recorrente qualquer.
   */
  FOLHA: "FOLHA",
});

/** Por que o DIA não é conhecido. ⚠ `dia: null` nunca vira "dia 20" — ele vem com o motivo. */
export const DIA_DESCONHECIDO = Object.freeze({
  /** A projeção é por MÊS: o prazo de recebimento é em meses, e inventar um dia seria fabricar precisão. */
  PROJECAO_POR_MES: "projecao_por_mes",
  /** A série diz o ciclo, não o dia. */
  SERIE_SEM_DIA: "serie_sem_dia",
  /** O imposto projetado herda o mês da receita que o gerou. */
  IMPOSTO_SEGUE_A_RECEITA: "imposto_segue_a_receita",
  /**
   * ⚠⚠ A GUIA EM ABERTO CUJO VENCIMENTO É DE OUTRO MÊS. Pela Lei 1 ela sai do mês corrente, e o dia
   * do vencimento **não vale como dia dela** — ele é de um mês que já passou. Apontar para aquele
   * dia diria que o dinheiro sai numa data que ficou para trás.
   */
  COMPROMISSO_EM_ATRASO: "compromisso_em_atraso",
  /** ⚠ O lançamento de folha tem competência, não dia — a data do pagamento não está nele. */
  FOLHA_SEM_DIA: "folha_sem_dia",
});

export const FRASE_DO_DIA_DESCONHECIDO = Object.freeze({
  [DIA_DESCONHECIDO.PROJECAO_POR_MES]:
    "O prazo de recebimento é contado em meses, então esta linha cai no mês — não num dia.",
  [DIA_DESCONHECIDO.SERIE_SEM_DIA]:
    "A recorrência diz de quanto em quanto tempo, não em que dia do mês.",
  [DIA_DESCONHECIDO.IMPOSTO_SEGUE_A_RECEITA]:
    "O imposto projetado acompanha o mês da receita que o gerou.",
  [DIA_DESCONHECIDO.COMPROMISSO_EM_ATRASO]:
    "Esta guia venceu em outro mês e continua em aberto — o dinheiro sai do mês corrente.",
  [DIA_DESCONHECIDO.FOLHA_SEM_DIA]:
    "A folha é lançada por competência, e a data do pagamento não está no lançamento.",
});

/** Por que uma linha não pôde ser posta em mês nenhum. ⚠ Vocabulário FECHADO. */
export const SEM_MES = Object.freeze({
  /** ⚠⚠ Guia liberada e em aberto, SEM vencimento. Medido: 51 guias de DAS assim. */
  GUIA_SEM_VENCIMENTO: "guia_sem_vencimento",
  /** ⚠⚠ Nota sem competência. Ela NÃO é atribuída a um mês — seria inventar em qual apuração entra. */
  NOTA_SEM_COMPETENCIA: "nota_sem_competencia",
  /** A série está marcada e não tem valor projetado nem declarado. */
  SERIE_SEM_VALOR: "serie_sem_valor",
  /**
   * ⚠⚠ PAGA, MAS SEM DATA DE PAGAMENTO. Ela aconteceu — logo não é compromisso —, e não se sabe em
   * que mês. Pôr no mês do vencimento seria afirmar quando o dinheiro saiu.
   */
  GUIA_PAGA_SEM_DATA: "guia_paga_sem_data",
});

export const FRASE_DO_SEM_MES = Object.freeze({
  [SEM_MES.GUIA_SEM_VENCIMENTO]:
    "Esta guia está em aberto e não tem data de vencimento gravada, então não dá para dizer em que "
    + "mês o dinheiro sai. Recapture a guia para trazer o vencimento.",
  [SEM_MES.NOTA_SEM_COMPETENCIA]:
    "Esta nota chegou sem competência. Sem ela não há de onde projetar o recebimento — e escolher um "
    + "mês seria o sistema decidindo em qual apuração a receita entra.",
  [SEM_MES.SERIE_SEM_VALOR]:
    "Esta recorrência está marcada e não tem valor projetado nem declarado — não há o que somar.",
  [SEM_MES.GUIA_PAGA_SEM_DATA]:
    "Esta guia consta como paga e não tem a data do pagamento gravada. Ela não entra em mês nenhum: "
    + "escolher um seria afirmar quando o dinheiro saiu.",
});

/**
 * ⚠⚠ O PRAZO DE RECEBIMENTO PADRÃO — decisão do dono, 25/08/2026.
 *
 * > *"como vamos trabalhar com o ciclo de competência na receita, notas emitidas em junho vão entrar
 * > de receita em julho (…) no caso pode ser alterado pelo contador."*
 *
 * ⚠ `null` na empresa é **"ninguém configurou"**, e não "configurado como 1": a tela precisa
 * distinguir os dois, senão o padrão passa por decisão. Ver `prazoDeRecebimento`.
 */
export const PRAZO_RECEBIMENTO_PADRAO_MESES = 1;

/** ⚠ O horizonte é 12 meses — decisão do dono, com a ressalva registrada no plano. */
export const HORIZONTE_MESES = 12;

/**
 * ⚠⚠ QUANTOS DOS 12 MESES OLHAM PARA TRÁS — `SPEC-fluxo-de-caixa-v3.md` §3.1.
 *
 * *"Sempre 12 meses. Posição padrão: 4 meses passados + mês corrente + 7 futuros."* O total não
 * muda; o que muda é onde a janela começa. ⚠ O passado só é legível por causa da Lei 1: sem a guia
 * PAGA no payload, esses quatro meses viriam vazios.
 */
export const MESES_PASSADOS_NA_JANELA = 4;

/**
 * ⚠ QUANTOS DIAS ANTES O AVISO ACENDE — `SPEC-fluxo-de-caixa-v3.md` §1: *"vencimento em até 5 dias"*.
 * Número do dono, não estimativa: por isso ele é constante nomeada e não um `5` solto no meio de um
 * `if`, que é como um número de produto vira folclore.
 */
export const DIAS_DE_ANTECEDENCIA = 5;

/**
 * "A data `iso` cai entre hoje e hoje+`dias`?" — inclusive nas duas pontas.
 *
 * ⚠⚠ ARITMÉTICA DE DATA SEM `Date`, e é o mesmo motivo de sempre: `new Date("2026-08-31")` mais um
 * fuso devolve outro dia. Aqui a conta é feita em DIAS JULIANOS a partir das partes da string, e a
 * volta é comparação numérica — nenhum objeto de data no meio.
 * ⚠ Data ausente responde `false`, nunca `true`: sem vencimento não há prazo a vencer, e um `true`
 * por omissão acenderia o aviso para toda guia sem data.
 */
export function venceEmAte(iso, hoje, dias) {
  const a = diasDoIso(hoje);
  const b = diasDoIso(iso);
  if (a == null || b == null || !Number.isFinite(dias)) return false;
  return b >= a && b - a <= dias;
}

/** "AAAA-MM-DD" → número de dias. ⚠ Algoritmo civil, sem `Date`: só serve para SUBTRAIR duas datas. */
function diasDoIso(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  let [, y, mes, d] = m.map(Number);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  y -= mes <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const anoDaEra = y - era * 400;
  const diaDoAno = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const diaDaEra = anoDaEra * 365 + Math.floor(anoDaEra / 4) - Math.floor(anoDaEra / 100) + diaDoAno;
  return era * 146097 + diaDaEra - 719468;
}

/**
 * Onde a janela começa, e até onde as setas podem andar.
 *
 * ⚠ `companyStart` é o limite para TRÁS (v3 §3.1: *"até o primeiro mês com dados da empresa"*), e
 * ele **encurta** a janela em vez de inventar meses anteriores ao começo da empresa — mostrar
 * janeiro de uma empresa aberta em março afirmaria que ela faturou zero naquele mês.
 * ⚠ Para a FRENTE a janela trava na posição padrão: não existe futuro além de corrente+7.
 */
export function janelaDoFluxo({ cicloAtual, janelaInicio = null, companyStart = null, horizonte = HORIZONTE_MESES, passados = MESES_PASSADOS_NA_JANELA }) {
  const hoje = mesesDaCompetencia(cicloAtual);
  if (hoje == null) return null;

  const padrao = hoje - passados;
  const minimo = mesesDaCompetencia(companyStart);
  const pedido = mesesDaCompetencia(janelaInicio);

  // ⚠ O teto é o padrão: andar para a frente além dele mostraria meses que o horizonte não cobre.
  let inicio = pedido == null ? padrao : Math.min(pedido, padrao);
  if (minimo != null) inicio = Math.max(inicio, minimo);

  return {
    inicio: competenciaDeMeses(inicio),
    // ⚠ Os dois limites viajam para a tela DESABILITAR as setas em vez de as fazer não responder.
    podeVoltar: minimo == null ? true : inicio > minimo,
    podeAvancar: inicio < padrao,
    padrao: competenciaDeMeses(padrao),
    horizonte,
  };
}

/**
 * ⚠⚠ QUANTOS MESES O CONTADOR CONFIGUROU — e se foi ele ou o padrão.
 *
 * A distinção é o ponto: `configurado: false` faz a tela dizer *"usando o padrão de 1 mês"* em vez
 * de afirmar que alguém escolheu isso. Sem ela, o padrão vira uma decisão que ninguém tomou.
 */
export function prazoDeRecebimento(prazoDaEmpresa) {
  const n = Number(prazoDaEmpresa);
  // ⚠ `Number(null)` é 0 e 0 é FINITO — e zero MESES é uma configuração legítima ("recebo à vista").
  // Por isso a guarda é `== null`, e não `!n`: colapsar os dois faria "recebo à vista" virar padrão.
  if (prazoDaEmpresa == null || !Number.isFinite(n) || n < 0) {
    return { meses: PRAZO_RECEBIMENTO_PADRAO_MESES, configurado: false };
  }
  return { meses: Math.trunc(n), configurado: true };
}

const texto = (v) => String(v ?? "").trim();

/**
 * ⚠⚠ `Number(null)` É `0`, E `0` É FINITO — a guarda é por TIPO.
 *
 * É a mesma lição do detector de recorrência (27/08/2026): guarda por VALOR sempre perde um caso
 * (`[]`, `false`, `" "` viram 0). Aqui um zero fabricado entra como dinheiro que não existe.
 */
export function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = typeof v === "string" ? v : (ehDecimal(v) ? v.toString() : null);
  if (t == null || t.trim() === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** ⚠ `Decimal` do Prisma sem importar o Prisma: objeto com `toString` PRÓPRIO. Array não passa. */
function ehDecimal(v) {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  return typeof v.toString === "function" && v.toString !== Object.prototype.toString;
}

/** "AAAA-MM" → meses desde o ano 0. ⚠ Aritmética de STRING, nunca `Date`: às 22h de Brasília um
 * `toISOString` devolveria o mês seguinte. */
export function mesesDaCompetencia(competencia) {
  if (typeof competencia !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return Number(m[1]) * 12 + (mes - 1);
}

/** O inverso. */
export function competenciaDeMeses(meses) {
  if (!Number.isFinite(meses)) return null;
  const ano = Math.floor(meses / 12);
  const mes = (meses % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/** Soma meses a uma competência. ⚠ Vira ano sozinho — dezembro + 1 é janeiro do ano seguinte. */
export function somarMeses(competencia, n) {
  const base = mesesDaCompetencia(competencia);
  if (base == null || !Number.isFinite(n)) return null;
  return competenciaDeMeses(base + Math.trunc(n));
}

/** `Date` → competência "AAAA-MM". ⚠ Acessadores UTC: é como as colunas de data são escritas. */
export function competenciaDaData(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * `Date` → "AAAA-MM-DD". ⚠ Acessadores UTC e montagem por STRING, nunca `toISOString()`: às 22h de
 * Brasília o ISO devolveria o dia seguinte. É a mesma disciplina de `competenciaDaData`.
 *
 * ⚠ Existe para comparar vencimento com HOJE — e a comparação é de string, que em "AAAA-MM-DD" é
 * cronológica por construção.
 */
export function isoDaData(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mes}-${dia}`;
}

/** `Date` → dia do mês (1–31). ⚠ Só para quem TEM data própria: a guia tem, a projeção não. */
export function diaDaData(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.getUTCDate();
}

/**
 * Uma linha do fluxo.
 *
 * ⚠⚠ A PROVA VIAJA JUNTO, SEMPRE (`base`). *"Por que esta linha está aqui?"* é a pergunta que o
 * contador faz olhando uma projeção, e uma linha sem resposta a ela é um número mágico. Na previsão
 * a base carrega o `n`, a janela e o CV; no fato, ela nomeia a origem ("DAS gerado, vence 20/08").
 */
export function montarLinha({
  fonte, direcao, procedencia, competencia = null, dia = null,
  diaDesconhecido = null, valor = null, rotulo, base = null, referencia = null,
}) {
  return {
    fonte,
    direcao,
    procedencia,
    competencia,
    // ⚠⚠ `dia: null` NUNCA vira "dia 20" — ele vem com o motivo, e a tela mostra o mês.
    dia,
    diaDesconhecido: dia == null && diaDesconhecido
      ? { motivo: diaDesconhecido, frase: FRASE_DO_DIA_DESCONHECIDO[diaDesconhecido] }
      : null,
    // ⚠⚠ `DESCONHECIDO` não carrega valor: ele é CONTAGEM. Um valor aqui seria somado por alguém.
    valor: procedencia === PROCEDENCIA.DESCONHECIDO ? null : numero(valor),
    rotulo: texto(rotulo),
    base,
    // ⚠ O id da origem, para a tela poder levar o contador até ela. Nunca a linha inteira.
    referencia: referencia || null,
  };
}

/**
 * ⚠⚠ A GUIA REAL SUBSTITUI A LINHA PROJETADA DO MESMO MÊS — e as duas NUNCA coexistem.
 *
 * Sem isto, o mesmo imposto aparece duas vezes no mesmo mês: uma como FATO (a guia que a Receita
 * emitiu) e outra como PREVISAO (o que projetamos antes de ela existir). O contador somaria os dois
 * e provisionaria o dobro.
 *
 * ⚠ Quem sai é a PROJEÇÃO, nunca a guia: a guia é o fato.
 */
export function projecaoSubstituidaPelaGuia(linhas) {
  const mesesComGuia = new Set(
    linhas
      .filter((l) => l.fonte === FONTE.GUIA && l.competencia)
      .map((l) => l.competencia),
  );
  return linhas.filter((l) => !(l.fonte === FONTE.IMPOSTO_PROJETADO && mesesComGuia.has(l.competencia)));
}

/**
 * ⚠⚠ OS TOTAIS — e a ausência da chave `total` é a parte que importa.
 *
 * `fato`, `previsao` e `desconhecido` não se somam: o primeiro aconteceu, o segundo talvez, e o
 * terceiro **não tem valor nenhum** (é contagem). Entregar a soma seria entregar o número que
 * `docs/dre-fluxo-caixa.md` proíbe.
 */
export function totaisDoMes(linhas) {
  const somar = (procedencia, direcao) => (linhas || [])
    .filter((l) => l.procedencia === procedencia && l.direcao === direcao)
    .reduce((s, l) => s + (numero(l.valor) || 0), 0);

  return {
    fato: {
      entrada: somar(PROCEDENCIA.FATO, DIRECAO.ENTRADA),
      saida: somar(PROCEDENCIA.FATO, DIRECAO.SAIDA),
    },
    // ⚠⚠ CHAVE NOVA (28/08/2026), e ela é ADITIVA de propósito: `fato` e `previsao` continuam
    // existindo com os mesmos nomes, então quem já lia o payload não quebra — só passa a ver
    // números MENORES em `fato`, porque a guia em aberto saiu de lá. Ver a Lei 1.
    compromisso: {
      entrada: somar(PROCEDENCIA.COMPROMISSO, DIRECAO.ENTRADA),
      saida: somar(PROCEDENCIA.COMPROMISSO, DIRECAO.SAIDA),
    },
    previsao: {
      entrada: somar(PROCEDENCIA.PREVISAO, DIRECAO.ENTRADA),
      saida: somar(PROCEDENCIA.PREVISAO, DIRECAO.SAIDA),
    },
    // ⚠⚠ CONTAGEM, NUNCA VALOR. Uma guia sem vencimento tem valor conhecido e MÊS desconhecido —
    // publicar o valor aqui convidaria a somá-lo a um mês que ninguém sabe qual é.
    desconhecido: {
      quantas: (linhas || []).filter((l) => l.procedencia === PROCEDENCIA.DESCONHECIDO).length,
    },
  };
}

/**
 * ⚠⚠ OS MESES DO HORIZONTE — todos, inclusive os VAZIOS.
 *
 * Mês sem linha nenhuma entra com zero e lista vazia. Sumir com ele faria a série de 12 meses ter
 * buracos, e um buraco se lê como "não sei" quando na verdade é "nada previsto" — é a mesma
 * distinção que o relatório de faturamento já resolve incluindo o mês sem lançamento.
 */
export function montarMeses({ linhas, cicloAtual, janelaInicio = null, horizonte = HORIZONTE_MESES }) {
  // ⚠⚠ A JANELA E O "HOJE" VIRARAM DUAS COISAS (28/08/2026). Eram uma só, e por isso pedir um mês
  // passado movia os dois juntos — o mês pintado de ciano deixava de ser o mês corrente. Agora
  // `cicloAtual` responde *"que dia é hoje?"* e `janelaInicio` responde *"onde a tabela começa?"*.
  // ⚠ Ausente, `janelaInicio` cai no `cicloAtual`: o comportamento de antes, intacto.
  const base = mesesDaCompetencia(janelaInicio || cicloAtual);
  if (base == null) return [];

  const porMes = new Map();
  for (let i = 0; i < horizonte; i += 1) {
    const c = competenciaDeMeses(base + i);
    porMes.set(c, []);
  }

  const foraDoHorizonte = [];
  for (const l of linhas || []) {
    if (l.procedencia === PROCEDENCIA.DESCONHECIDO) continue;
    if (!porMes.has(l.competencia)) { foraDoHorizonte.push(l); continue; }
    porMes.get(l.competencia).push(l);
  }

  return {
    meses: [...porMes.entries()].map(([competencia, doMes]) => ({
      competencia,
      linhas: ordenarLinhas(doMes),
      totais: totaisDoMes(doMes),
    })),
    // ⚠⚠ O QUE FICOU FORA DO HORIZONTE NÃO SOME — ele é contado. Uma guia vencida no mês passado, ou
    // uma projeção 14 meses à frente, precisa aparecer como número em vez de evaporar.
    foraDoHorizonte,
  };
}

/** ⚠ FATO primeiro, e dentro de cada procedência o maior valor primeiro: é o que move mais dinheiro. */
export function ordenarLinhas(linhas) {
  // ⚠ FATO → COMPROMISSO → PREVISAO → DESCONHECIDO: da maior certeza para a menor, que é a ordem
  // em que um contador lê uma coluna de dinheiro.
  const ORDEM = { [PROCEDENCIA.FATO]: 0, [PROCEDENCIA.COMPROMISSO]: 1, [PROCEDENCIA.PREVISAO]: 2 };
  const peso = (l) => (ORDEM[l.procedencia] ?? 3);
  return [...(linhas || [])].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    // ⚠ Dia conhecido antes de dia desconhecido: o que tem data marcada é mais urgente.
    const da = a.dia == null ? 99 : a.dia;
    const db = b.dia == null ? 99 : b.dia;
    if (da !== db) return da - db;
    return (numero(b.valor) || 0) - (numero(a.valor) || 0);
  });
}

/**
 * ⚠⚠ A FRASE DA ALÍQUOTA — e ela é OBRIGATÓRIA.
 *
 * > Plano: *"O rótulo é obrigatório: 'com base na alíquota de <mês>'. **Nunca 'imposto
 * > calculado'**"*.
 *
 * O número não é uma apuração: é a receita projetada multiplicada pela alíquota de um mês que já
 * passou. Chamá-lo de "imposto calculado" faria uma projeção sobre projeção passar por ato fiscal.
 */
export function fraseDaAliquota({ competencia, procedencia }) {
  if (!competencia) return null;
  const origem = procedencia === "TRANSMITIDA"
    ? "declaração transmitida"
    : procedencia === "SIMULADA"
      ? "simulação oficial"
      : "apuração";
  return `com base na alíquota de ${competencia} (${origem})`;
}

/**
 * ⚠⚠ A ALÍQUOTA EFETIVA DO ÚLTIMO MÊS APURADO — e sem ela NÃO HÁ imposto projetado.
 *
 * ⚠ Ela é DERIVADA (DAS ÷ receita), nunca inventada. Sem receita ou sem DAS, devolve `null` e a
 * linha do imposto simplesmente não existe — com o motivo nomeado. Um imposto projetado sobre uma
 * alíquota que ninguém mediu seria um número com cara de apuração.
 *
 * ⚠ A ordem das fontes é a força da evidência: a declaração TRANSMITIDA existe na Receita; a
 * SIMULADA é a RFB tendo calculado sem transmitir. O motor local não entra — ele é conferência
 * nossa, e o plano proíbe projeção sobre a nossa própria conta.
 */
export function aliquotaEfetiva(snapshot) {
  if (!snapshot) return null;
  const receita = (numero(snapshot.receitaInterna) || 0) + (numero(snapshot.receitaExterna) || 0);
  if (!(receita > 0)) return null;

  const transmitida = numero(snapshot.dasRetornadoSerpro);
  const simulada = numero(snapshot.dasSimuladoSerpro);
  const das = transmitida != null && transmitida > 0 ? transmitida : (simulada != null && simulada > 0 ? simulada : null);
  if (das == null) return null;

  return {
    valor: das / receita,
    competencia: texto(snapshot.competencia) || null,
    procedencia: transmitida != null && transmitida > 0 ? "TRANSMITIDA" : "SIMULADA",
  };
}

/** Por que não há imposto projetado. ⚠ A ausência é NOMEADA — nunca uma linha que some. */
export const SEM_IMPOSTO = Object.freeze({
  SEM_APURACAO: "sem_apuracao",
  SEM_RECEITA_PROJETADA: "sem_receita_projetada",
});

export const FRASE_DO_SEM_IMPOSTO = Object.freeze({
  [SEM_IMPOSTO.SEM_APURACAO]:
    "Não há apuração com receita e DAS para medir a alíquota efetiva, então o imposto sobre a receita "
    + "prevista não é projetado. Um número aqui sairia de uma alíquota que ninguém mediu.",
  [SEM_IMPOSTO.SEM_RECEITA_PROJETADA]:
    "Não há receita prevista nos próximos meses, então não há imposto a projetar sobre ela.",
});
