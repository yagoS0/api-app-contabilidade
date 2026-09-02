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
// ⚠⚠ REUSADOS, nunca reescritos: a MEDIANA e o PISO DE 3 são a autoridade desta casa sobre "o que
// se repete", e o dono já fixou os dois lá (*"contra a MEDIANA observada"*, e o piso do detector).
// Uma segunda mediana aqui divergiria da primeira na correção seguinte.
import { PISO_DE_OBSERVACOES, mediana } from "./recorrencia.js";

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
  /**
   * ⚠⚠ O QUE O PRÓPRIO CLIENTE ACRESCENTOU — decisão do dono, 29/08/2026: *"o cliente pode
   * modificar as saídas, podendo colocar novas saídas, apenas para visualização deles."*
   *
   * ⚠ Ela **NÃO é contabilidade**: nada aqui vira `AccountingEntry`. É um plano de caixa que o
   * cliente escreve para si e que o contador vê na Conferência — o mesmo caminho de confirmação
   * que a série declarada segue.
   *
   * ⚠⚠ SEMPRE `PROCEDENCIA.PREVISAO`. Uma saída planejada para o mês que vem não saiu de lugar
   * nenhum, e chamá-la de fato faria o dono da empresa somá-la ao que já aconteceu.
   *
   * ⚠ Na tabela do cliente ela cai no balde **`saida`** — nem impostos, nem folha. `baldeDaLinha`
   * já faz isso pelo `else`, mas há teste afirmando: fonte nova caindo no balde certo por acidente
   * é exatamente o que a lista fechada existe para impedir.
   *
   * ⚠⚠ **ELA É SÓ A SAÍDA AVULSA** — a que tem DATA (*"dia 10/09 pago 3.000 de reforma"*). A saída
   * que o cliente diz se REPETIR vira uma `SerieRecorrente` com `origem: DECLARADA` e continua
   * saindo como `SERIE_DESPESA`: lá quem a distingue do que o sistema detectou é `base.origem`, que
   * a tela já lê. Uma fonte própria para ela faria a evidência da recorrência (n, faixa, confronto)
   * parar de ser renderizada.
   */
  SAIDA_DO_CLIENTE: "SAIDA_DO_CLIENTE",
  /**
   * ⚠⚠ A RECEITA QUE O HISTÓRICO PROJETA PARA A FRENTE (30/08/2026) — decisão do dono:
   *
   * > *"o último mês é base para todos os meses à frente, e depois vão se ajustando. A receita
   * > prevista é baseada em quantas vezes se repete: se em 3 meses seguidos aparece a mesma
   * > receita, pode colocar ela para frente até o final da amostra, e ir ajustando se aparecer
   * > faturamento diferente. **Sempre a mediana.**"*
   *
   * ⚠ Ela **não é** `NOTA_EMITIDA`: aquela é previsão DOCUMENTAL (existe uma nota, com número e
   * data). Esta é previsão APRENDIDA — não há documento nenhum atrás dela, e chamá-la de nota faria
   * o cliente procurar uma nota que não existe.
   * ⚠ Ela também **não é** `SERIE_RECEITA`: aquela é uma série que o CONTADOR marcou, e a `base`
   * dela carrega a evidência da série (n, faixa, confronto com o declarado). Esta sai do
   * faturamento medido, sem ninguém ter marcado nada.
   *
   * ⚠⚠ Ela cai no balde **`entrada`** por `direcao`, e não pela fonte — `baldeDaLinha` pergunta a
   * direção primeiro. Uma fonte nova de SAÍDA cairia no `else` e viraria "saída" em silêncio; esta
   * não corre esse risco, mas o rótulo dela **precisa** existir no espelho da tela, senão ela
   * aparece como *"Origem desconhecida"*.
   */
  RECEITA_PROJETADA: "RECEITA_PROJETADA",
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

/**
 * ⚠⚠ DE ONDE VEIO O DIA de uma linha de recorrência — vocabulário FECHADO (31/08/2026).
 *
 * > Dono: *"eu quero que entre em algum dia, pode ser no dia em que a nota foi emitida"* e
 * > *"pode ser excluído uma saída pelo usuário. ou alterado a data."*
 *
 * ⚠⚠ **AS DUAS TELAS PRECISAM DIZER QUAL É QUAL.** Sem isto, o contador abre o fluxo, lê "dia 10" e
 * não tem como saber se foi o sistema que estimou ou se foi o cliente que afirmou — e essas duas
 * coisas merecem confiança diferente. Estimado é palpite sobre o passado; definido é alguém dizendo
 * quando vai pagar.
 */
export const ORIGEM_DO_DIA = Object.freeze({
  /** Mediana dos dias em que as notas da série foram EMITIDAS. É estimativa, não vencimento. */
  EMISSAO: "emissao",
  /** O cliente abriu a linha e disse o dia. ⚠ Ele vence a estimativa, sempre. */
  CLIENTE: "cliente",
});

export const FRASE_DA_ORIGEM_DO_DIA = Object.freeze({
  [ORIGEM_DO_DIA.EMISSAO]: "Dia estimado pelas datas em que as notas foram emitidas.",
  [ORIGEM_DO_DIA.CLIENTE]: "Dia informado pelo cliente.",
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
  /**
   * ⚠⚠ GUIA DE R$ 0,00 — ela é MARCADOR, não compromisso (30/08/2026). Medido na ERISANGELA:
   * 4 guias `SIMPLES` de zero, competências 01 a 04. Não há dinheiro a sair, e uma linha de zero na
   * tabela AFIRMARIA que há um imposto de zero reais naquele mês.
   */
  GUIA_SEM_VALOR: "guia_sem_valor",
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
  [SEM_MES.GUIA_SEM_VALOR]:
    "Esta guia está gravada com valor zero. Ela registra que a competência foi tratada, e não há "
    + "dinheiro a sair — por isso não entra em mês nenhum.",
});

/**
 * ⚠⚠ A RECEITA DA NOTA ENTRA UM MÊS DEPOIS, NO DIA 1 — decisão do dono, 29/08/2026.
 *
 * > *"é apenas uma visualização do fluxo; as notas emitidas do mês anterior se tornam a receita do
 * > mês seguinte, comprovada quando há a apuração, por isso entram no dia 1."*
 *
 * ⚠⚠ **ISTO SUBSTITUIU O PRAZO CONFIGURÁVEL** de 25/08/2026 (*"no caso pode ser alterado pelo
 * contador"*). O prazo por empresa deixou de ser lido: é sempre +1 mês, sempre dia 1. ⚠ O efeito
 * prático foi zero — medido, **nenhuma empresa havia configurado o prazo**, e o padrão já era 1.
 * O que mudou é que ele deixou de ser configurável em silêncio.
 *
 * ⚠ Ela **não é o prazo real de recebimento** e não afirma que o dinheiro entrou: a linha continua
 * `PREVISAO` no mês corrente (Lei 1 — *"dinheiro só confirma com pagamento"*).
 */
export const MESES_ATE_A_RECEITA = 1;

/**
 * ⚠⚠ O PRAZO DE RECEBIMENTO PADRÃO — decisão do dono, 25/08/2026, **SUPERADA em 29/08/2026**.
 *
 * ⚠ `prazoDeRecebimento` e esta constante ficaram **SEM CHAMADOR** quando a receita passou a cair
 * no dia 1 do mês seguinte (ver `MESES_ATE_A_RECEITA`). Não foram apagadas porque a coluna
 * `PortalClient.prazoRecebimentoMeses` continua no banco — dropar coluna é migration destrutiva e
 * decisão do dono.
 *
 * ⚠⚠ **NÃO AS RELIGUE SEM DECISÃO DELE.** Voltar a ler o prazo faria a nota de uma empresa
 * configurada cair num mês diferente do que a tela mostra hoje, sem nada dizendo que mudou.
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
 * ⚠⚠ SEM CHAMADOR DESDE 29/08/2026 — ver `PRAZO_RECEBIMENTO_PADRAO_MESES` acima.
 *
 * QUANTOS MESES O CONTADOR CONFIGUROU — e se foi ele ou o padrão. A distinção era o ponto:
 * `configurado: false` fazia a tela dizer *"usando o padrão de 1 mês"* em vez de afirmar que alguém
 * escolheu isso.
 *
 * ⚠ Ela fica porque a coluna do banco fica, e porque a distinção `null` × `0` que ela guarda é uma
 * lição própria: `Number(null)` é 0, 0 é finito, e **zero meses é configuração legítima** ("recebo
 * à vista"). Quem religar o prazo um dia precisa dela inteira.
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

/**
 * Um dia do mês legível (1–31), ou `null`.
 *
 * ⚠ Guarda por TIPO, nunca por truthy: `Number(null) === 0` e 0 é finito, então `!dia` deixaria o
 * nulo passar como zero e `Number.isFinite` aceitaria `4.7`. É a mesma regra do `numero()` daqui.
 */
export function diaDoMesValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/**
 * ⚠⚠ ENCAIXA um dia do mês na competência — dia 31 em fevereiro vira 28 (ou 29).
 *
 * Sem isto, uma recorrência de dia 31 **sumiria** de fevereiro, abril, junho, setembro e novembro:
 * cinco meses por ano em que o dinheiro desapareceria da projeção, sem erro nenhum na tela.
 * ⚠ `Date.UTC(ano, mes, 0)` é o último dia do mês ANTERIOR ao índice — com `mes` já 1-based, ele é
 * o último dia da própria competência. Acessador UTC, como todo o resto deste módulo.
 */
export function encaixarNoMes(competencia, dia) {
  const alvo = diaDoMesValido(dia);
  if (alvo == null) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia ?? "").trim());
  if (!m) return null;
  const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return Math.min(alvo, ultimo);
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
/**
 * ⚠⚠ O TIPO DE GUIA QUE **É** O IMPOSTO SOBRE A RECEITA — e por isso substitui a projeção.
 *
 * A projeção é `receita × alíquota efetiva do Simples`, ou seja **o DAS**. Só o DAS a substitui.
 */
const TIPO_DA_GUIA_QUE_SUBSTITUI = "SIMPLES";

/**
 * ⚠⚠ **A PARCELA DE PARCELAMENTO NÃO APAGA A PROJEÇÃO — nem o INSS** (conserto de 30/08/2026).
 *
 * O que estava acontecendo, medido na ERISANGELA: qualquer guia do mês zerava a projeção. Em agosto
 * havia uma **Parcela 1 de parcelamento** (tipo `SIMPLES`, R$ 327,50) e um **INSS**; os dois
 * apagaram o DAS projetado, e a coluna Impostos passou a mostrar R$ 651,33 de parcelas **sem o
 * imposto do mês**. O contador via R$ 1.437,15 de DAS; o cliente via parcelamento.
 *
 * ⚠⚠ **PARCELA É DÍVIDA PASSADA SENDO PAGA, e o `apps/api/CLAUDE.md` já escrevia isto para o
 * dashboard:** *"a parcela é gravada como `tipo:'SIMPLES'`, igual ao DAS, e o que separa as duas é
 * o `parcelamentoId`"* — `guideCompliance` a exclui da query principal e a resolve num nó próprio.
 * O fluxo não fazia essa distinção; agora faz, **lendo a mesma marca**.
 *
 * ⚠ **O INSS TAMBÉM NÃO SUBSTITUI**: ele não é imposto sobre a receita, e a projeção que ele apagava
 * não era dele. As duas linhas convivem porque são dois pagamentos diferentes.
 *
 * ⚠ A parcela e o INSS **continuam no fluxo** — eles são dinheiro que sai. O que eles deixaram de
 * fazer é esconder o DAS.
 */
export function projecaoSubstituidaPelaGuia(linhas) {
  const mesesComDas = new Set(
    linhas
      .filter((l) => (
        l.fonte === FONTE.GUIA
        && l.competencia
        // ⚠ Igualdade EXATA com o tipo, nunca "qualquer guia": ver o cabeçalho.
        && texto(l.base?.tipoDaGuia) === TIPO_DA_GUIA_QUE_SUBSTITUI
        && l.base?.ehParcelamento !== true
      ))
      .map((l) => l.competencia),
  );
  return linhas.filter((l) => !(l.fonte === FONTE.IMPOSTO_PROJETADO && mesesComDas.has(l.competencia)));
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

/**
 * ⚠⚠ A RECEITA PROJETADA PELO HISTÓRICO — a regra, PURA (30/08/2026).
 *
 * > Dono: *"o último mês é base para todos os meses à frente, e depois vão se ajustando. A receita
 * > prevista é baseada em quantas vezes se repete: se em 3 meses seguidos aparece a mesma receita,
 * > pode colocar ela para frente até o final da amostra, e ir ajustando se aparecer faturamento
 * > diferente. **Sempre a mediana.**"*
 *
 * ⚠⚠ **A MEDIANA, NUNCA A MÉDIA, E O PISO É 3 — E OS DOIS SÃO REUSADOS**, de
 * `fluxo/lib/recorrencia.js` (`mediana`, `PISO_DE_OBSERVACOES`). Aquele módulo já é a autoridade
 * sobre "o que se repete" nesta casa, e o dono já fixou os dois números lá (*"contra a MEDIANA
 * observada"*, e o piso de 3 do detector). Uma segunda mediana escrita aqui divergiria da primeira
 * na correção seguinte — e as duas falam do mesmo dinheiro.
 *
 * ⚠ **A MEDIANA RESISTE AO MÊS ATÍPICO; a média não.** Um mês de faturamento dobrado puxaria a
 * média e a projeção inteira iria junto — que é exatamente o "ajustando" que o dono não quer.
 *
 * ⚠⚠ **OBSERVAÇÕES CONSECUTIVAS, e é isso que a palavra "seguidos" quer dizer.** Três meses
 * espalhados no ano não são um padrão: são três eventos. O corte é no FIM da série (os últimos
 * meses), porque é para a frente que se projeta — uma empresa que faturou por três meses e parou há
 * seis não tem receita a projetar.
 *
 * ⚠ **Ela NÃO substitui mês que já tem receita real.** A projeção começa depois do último mês com
 * nota, e é isso que faz o "ir ajustando" acontecer sozinho: chegando nota nova, aquele mês deixa
 * de ser projetado na leitura seguinte.
 *
 * @param {object} p
 * @param {Map<string, number>|Array<[string, number]>} p.faturamentoPorMes competência → valor
 * @param {string} p.primeiroMesAProjetar competência "AAAA-MM"
 * @param {number} p.quantosMeses quantos meses projetar
 * @param {number} [p.piso] observações consecutivas mínimas
 * @returns {{ linhas: Array, base: object|null, motivo: string|null }}
 */
export function receitaProjetadaPeloHistorico({
  faturamentoPorMes,
  primeiroMesAProjetar,
  quantosMeses,
  piso = PISO_DE_OBSERVACOES,
}) {
  const mapa = faturamentoPorMes instanceof Map ? faturamentoPorMes : new Map(faturamentoPorMes || []);
  // ⚠ Só mês com faturamento > 0 é observação. Mês com zero não é "receita de zero": é mês sem nota,
  // e contá-lo puxaria a mediana para baixo afirmando um faturamento que ninguém emitiu.
  const meses = [...mapa.entries()]
    .filter(([c, v]) => /^\d{4}-\d{2}$/.test(String(c)) && numero(v) > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  if (!meses.length) {
    return { linhas: [], base: null, motivo: SEM_PROJECAO.SEM_FATURAMENTO };
  }

  // ⚠⚠ CONSECUTIVOS A PARTIR DO FIM — o padrão tem de estar VIVO. Um buraco no meio da série corta
  // a contagem, e é o que separa "fatura todo mês" de "faturou três vezes no ano".
  const consecutivos = [meses[meses.length - 1]];
  for (let i = meses.length - 2; i >= 0; i -= 1) {
    const [c] = meses[i];
    const [seguinte] = consecutivos[0];
    if (mesesDaCompetencia(c) !== mesesDaCompetencia(seguinte) - 1) break;
    consecutivos.unshift(meses[i]);
  }

  if (consecutivos.length < piso) {
    return { linhas: [], base: null, motivo: SEM_PROJECAO.POUCAS_OBSERVACOES };
  }

  const valores = consecutivos.map(([, v]) => numero(v));
  const valor = mediana(valores);
  if (!(valor > 0)) return { linhas: [], base: null, motivo: SEM_PROJECAO.SEM_FATURAMENTO };

  const base = {
    n: consecutivos.length,
    mediana: valor,
    primeiraObservacao: consecutivos[0][0],
    ultimaObservacao: consecutivos[consecutivos.length - 1][0],
    // ⚠ A frase viaja PRONTA: é ela que impede o número de ser lido como faturamento contratado.
    frase: `Receita prevista pela mediana dos últimos ${consecutivos.length} meses faturados `
      + `(${consecutivos[0][0]} a ${consecutivos[consecutivos.length - 1][0]}). `
      + "Ela se ajusta sozinha quando chegar nota nova.",
  };

  const linhas = [];
  for (let i = 0; i < Math.max(0, quantosMeses); i += 1) {
    const competencia = somarMeses(primeiroMesAProjetar, i);
    if (!competencia) break;
    linhas.push(montarLinha({
      fonte: FONTE.RECEITA_PROJETADA,
      direcao: DIRECAO.ENTRADA,
      // ⚠⚠ SEMPRE PREVISÃO. Não há nota, não há documento, não há promessa de ninguém.
      procedencia: PROCEDENCIA.PREVISAO,
      competencia,
      // ⚠ O DIA 1 é a MESMA convenção da receita da nota emitida (decisão do dono, 29/08). Duas
      // convenções para "quando a receita entra" fariam a coluna Entrada ter dois significados.
      dia: 1,
      valor,
      rotulo: "Receita prevista pelo histórico",
      base,
      referencia: null,
    }));
  }
  return { linhas, base, motivo: null };
}

/** ⚠ Por que não há receita projetada. A ausência é NOMEADA — nunca uma linha que some. */
export const SEM_PROJECAO = Object.freeze({
  SEM_FATURAMENTO: "sem_faturamento",
  POUCAS_OBSERVACOES: "poucas_observacoes",
});

export const FRASE_DO_SEM_PROJECAO = Object.freeze({
  [SEM_PROJECAO.SEM_FATURAMENTO]:
    "Esta empresa não tem faturamento medido, então não há receita a projetar para os próximos meses.",
  [SEM_PROJECAO.POUCAS_OBSERVACOES]:
    "O faturamento ainda não se repetiu em meses seguidos o bastante para virar previsão. "
    + "Três meses seguidos é o mínimo — abaixo disso seriam eventos, não um padrão.",
});
