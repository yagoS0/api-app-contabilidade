// CLASSIFICAÇÃO DO DOCUMENTO ARRECADADO, e a separação contábil que sai dela.
//
// Um comprovante de arrecadação pode ser três coisas, e elas se contabilizam de formas diferentes:
//
//   PARCELA_PARCELAMENTO    tem código de TJLP-Parcelamentos na composição
//   RECOLHIMENTO_EM_ATRASO  sem TJLP, mas com multa e/ou juros em algum item
//   RECOLHIMENTO_NORMAL     sem TJLP, multa e juros zerados em todos
//
// ⚠ A CLASSIFICAÇÃO SAI DO CÓDIGO DE RECEITA, NUNCA DO TEXTO. O texto entra só como conferência,
// e divergência entre os dois vira revisão humana — não decisão automática.
//
// ⚠ ACRÉSCIMO NÃO É PARCELAMENTO. Um DARF pago em atraso tem multa e juros exatamente como uma
// parcela tem, e classificar por "tem juros" jogaria recolhimento comum dentro de parcelamento —
// debitando um passivo que não existe. O comprovante R5 (PIS + IRRF + COFINS com multa e juros,
// sem nenhum TJLP) é o caso real que fixa isso, e está nos testes.
//
// ⚠ UM DOCUMENTO MISTURA CÓDIGOS SEM RELAÇÃO ENTRE SI. O R5 traz IRRF de aluguéis junto de
// PIS/COFINS. Por isso tudo aqui trabalha item a item; tratar o documento como bloco único jogaria
// o IRRF na conta do PIS.

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Códigos de TJLP sobre parcelamentos, como impressos pela RFB.
 *
 * ⚠ ISTO É SEMENTE, NÃO A TABELA. Foi extraída de comprovantes reais e cobre parcelamento de DARF
 * (IRPJ/PIS/CSLL/COFINS). Outras modalidades — previdenciário, PERT, transação — usam códigos
 * próprios que ninguém aqui conhece. Código novo se ACRESCENTA com evidência; nunca se deduz do
 * texto (é exatamente o que `codigo_desconhecido_com_texto_de_parcelamento` recusa a fazer).
 */
export const CODIGOS_TJLP_PARCELAMENTO = Object.freeze({
  "380": "TJLP IRPJ - Parcelamento",
  "389": "TJLP PIS - Parcelamento",
  "391": "TJLP CSLL - Parcelamento",
  "387": "TJLP Cofins - Parcelamento",
  // Acrescentado em 2026-08-09 com evidência: aparece no PAGAMENTOS71 da SINTROPIA, nos documentos
  // 7032614056493560 e 7032617226440598, sempre ao lado do IRRF 3208.
  "16": "TJLP IRRF - Parcelamento",
});

/**
 * ⚠ AS DUAS FONTES ESCREVEM O MESMO CÓDIGO DE FORMAS DIFERENTES, e isso já era uma bomba armada.
 *
 * O PDF do comprovante imprime **com zero à esquerda** (`"0380"`), e é de lá que
 * `parseComposicaoComprovante` extrai. O `PAGAMENTOS71` devolve **sem** (`"380"`, e `"16"` para o
 * TJLP do IRRF). Comparar cru faria `Object.hasOwn(tabela, "380")` dar **false**: todo item de
 * parcelamento vindo da consulta escaparia da classificação e o documento cairia em
 * `RECOLHIMENTO_EM_ATRASO` — amortização de parcelamento virando despesa de acréscimo, sem um
 * aviso. A falha seria silenciosa porque "tem juros" é verdade nos dois casos.
 *
 * A forma canônica aqui é **sem zero à esquerda**, que é a que a API devolve. Quem comparar código
 * de receita neste projeto passa por aqui.
 */
export function normalizarCodigoReceita(codigo) {
  const so = String(codigo ?? "").replace(/\D/g, "");
  if (!so) return "";
  return so.replace(/^0+/, "") || "0";
}

export const TIPO_DOCUMENTO = Object.freeze({
  PARCELA_PARCELAMENTO: "PARCELA_PARCELAMENTO",
  RECOLHIMENTO_EM_ATRASO: "RECOLHIMENTO_EM_ATRASO",
  RECOLHIMENTO_NORMAL: "RECOLHIMENTO_NORMAL",
});

const TEM_PARCELAMENTO_NO_TEXTO = /parcelament/i;

/**
 * Classifica a composição de um comprovante e devolve a separação contábil por natureza.
 *
 * @param {object} composicao saída de `parseComposicaoComprovante`
 * @param {object} [opts]
 * @param {object} [opts.codigosTjlp] mapa código → descrição. Injetável de propósito: quando a
 *   tabela virar dado versionado no banco, ela entra por aqui sem que esta função mude.
 */
export function classificarDocumentoArrecadado(composicao, { codigosTjlp = CODIGOS_TJLP_PARCELAMENTO } = {}) {
  // Composição não confiável não classifica. O parser já devolve `itens: []` nesse caso, e
  // classificar sobre lista vazia diria "RECOLHIMENTO_NORMAL" — afirmação falsa e tranquilizadora
  // justamente quando não se conseguiu ler o documento.
  if (!composicao?.confiavel || !composicao.itens?.length) {
    return {
      classificavel: false,
      tipo: null,
      motivo: composicao?.motivo || "composicao_ausente",
      itensTributo: [], itensTjlp: [], alertas: [],
      amortizacao: null, encargoCorrente: 0,
    };
  }

  const itens = composicao.itens;
  // ⚠ SEMPRE normalizado dos DOIS lados: a tabela injetada pode vir do PDF (com zero à esquerda) e
  // o item pode vir do PAGAMENTOS71 (sem). Comparar cru é o defeito descrito em
  // `normalizarCodigoReceita`.
  const tabelaNormalizada = new Set(Object.keys(codigosTjlp).map(normalizarCodigoReceita));
  const eTjlp = (i) => tabelaNormalizada.has(normalizarCodigoReceita(i.codigo));
  const itensTjlp = itens.filter(eTjlp);
  const itensTributo = itens.filter((i) => !eTjlp(i));

  // ─── CONFERÊNCIA CÓDIGO × TEXTO ──────────────────────────────────────────────────────────────
  // O texto nunca classifica; ele só denuncia quando discorda do código.
  const alertas = [];
  for (const i of itensTjlp) {
    if (!TEM_PARCELAMENTO_NO_TEXTO.test(i.denominacao || "")) {
      alertas.push({ tipo: "divergencia_codigo_texto", codigo: i.codigo, denominacao: i.denominacao });
    }
  }
  for (const i of itensTributo) {
    if (TEM_PARCELAMENTO_NO_TEXTO.test(i.denominacao || "")) {
      // ⚠ Isto NÃO classifica como parcelamento. Um código desconhecido pode ser TJLP de uma
      // modalidade que não mapeamos — e pode não ser. Adivinhar aqui debitaria um passivo pelo
      // palpite; avisar deixa a decisão com quem sabe, e o código entra na tabela com evidência.
      alertas.push({ tipo: "codigo_desconhecido_com_texto_de_parcelamento", codigo: i.codigo, denominacao: i.denominacao });
    }
  }

  // ─── O TIPO ──────────────────────────────────────────────────────────────────────────────────
  const temAcrescimo = itens.some((i) => i.multa > 0 || i.juros > 0);
  const tipo = itensTjlp.length
    ? TIPO_DOCUMENTO.PARCELA_PARCELAMENTO
    : temAcrescimo
      ? TIPO_DOCUMENTO.RECOLHIMENTO_EM_ATRASO
      : TIPO_DOCUMENTO.RECOLHIMENTO_NORMAL;

  // ─── A SEPARAÇÃO CONTÁBIL ────────────────────────────────────────────────────────────────────
  // ⚠ AS DUAS NATUREZAS DENTRO DA MESMA PARCELA:
  //   · principal + multa + juros dos CÓDIGOS-TRIBUTO = dívida consolidada sendo AMORTIZADA
  //     (debita o passivo do parcelamento, que nasceu pelo valor consolidado);
  //   · o TOTAL das linhas TJLP = ENCARGO CORRENTE do mês (despesa financeira da competência).
  // Somar tudo como "juros do mês" superestima a despesa E deixa o passivo sem baixar.
  // Conferido no comprovante real: 57,52 = 29,54 (amortização) + 27,98 (encargo).
  //
  // ⚠ O encargo soma `total`, não `juros`, ainda que hoje sejam idênticos (a linha de TJLP vem com
  // principal e multa vazios). É `total` que mantém a identidade que faz o lançamento fechar —
  // `amortizacao.total + encargoCorrente == total do documento`. Somar `juros` quebraria o
  // balanço em silêncio no dia em que uma linha de TJLP vier com multa.
  const amortizacao = itensTributo.reduce(
    (acc, i) => ({
      principal: r2(acc.principal + i.principal),
      multa: r2(acc.multa + i.multa),
      juros: r2(acc.juros + i.juros),
      total: r2(acc.total + i.total),
    }),
    { principal: 0, multa: 0, juros: 0, total: 0 },
  );
  const encargoCorrente = r2(itensTjlp.reduce((acc, i) => acc + i.total, 0));

  return { classificavel: true, tipo, motivo: null, itensTributo, itensTjlp, alertas, amortizacao, encargoCorrente };
}
