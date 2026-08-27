/**
 * O FLUXO DE CAIXA NA TELA — o que cada linha diz, e a lei de cor que a governa.
 *
 * ⚠⚠ ESTA REGRA NÃO CALCULA NADA. Quem monta o fluxo é `application/fluxo/`, no servidor, e as duas
 * telas (contador e cliente) leem o MESMO payload. Aqui mora a LEITURA: rótulo, cor, ordem, e o que
 * a tela pode ou não afirmar. Recalcular aqui daria dois números para o mesmo dinheiro.
 *
 * ⚠⚠ E ELA NÃO SOMA NADA ALÉM DO QUE O SERVIDOR JÁ SOMOU. Não existe `total` no payload, e a tela
 * não pode inventar um: um número único somando o que aconteceu com o que talvez aconteça é
 * exatamente o que alguém imprime e leva ao banco (`docs/dre-fluxo-caixa.md`).
 */

/** ⚠ De onde vem cada linha. Vocabulário FECHADO — espelha `PROCEDENCIA` do servidor. */
export const PROCEDENCIA = Object.freeze({
  FATO: "FATO",
  PREVISAO: "PREVISAO",
  DESCONHECIDO: "DESCONHECIDO",
});

export const DIRECAO = Object.freeze({ ENTRADA: "ENTRADA", SAIDA: "SAIDA" });

export const FONTE = Object.freeze({
  GUIA: "GUIA",
  NOTA_EMITIDA: "NOTA_EMITIDA",
  SERIE_RECEITA: "SERIE_RECEITA",
  SERIE_DESPESA: "SERIE_DESPESA",
  IMPOSTO_PROJETADO: "IMPOSTO_PROJETADO",
});

/**
 * ⚠⚠ A LEI DE COR — e ela é o que impede uma PROJEÇÃO de se parecer com um FATO.
 *
 * ⚠⚠ **`PREVISAO` NUNCA RECEBE VERDE.** Verde, nesta casa, quer dizer *pago/concluído* — o pior
 * desfecho possível para uma linha que ainda não aconteceu. E **a palavra "previsto" vai no TEXTO**,
 * não só na cor: impressão em preto e branco e daltonismo tiram a cor, e o texto fica.
 *
 * ⚠ `FATO` também não é verde: ele é NEUTRO. Uma guia gerada e em aberto não está paga — verde ali
 * diria "concluído" sobre dinheiro que ainda vai sair. Verde só existiria para o que já saiu, e
 * este fluxo não mostra isso.
 */
const LEITURA_DA_PROCEDENCIA = Object.freeze({
  [PROCEDENCIA.FATO]: {
    rotulo: "Fato",
    token: "--state-neutral",
    // ⚠ A frase diz o que a linha É, não o que falta.
    frase: "Este valor já existe, com data própria.",
  },
  [PROCEDENCIA.PREVISAO]: {
    rotulo: "Previsto",
    token: "--state-warn",
    frase: "Este valor é uma PREVISÃO — ele ainda não aconteceu.",
  },
  [PROCEDENCIA.DESCONHECIDO]: {
    rotulo: "Sem mês",
    token: "--state-warn",
    frase: "Falta um dado para saber em que mês isto entra ou sai.",
  },
});

const PROCEDENCIA_DESCONHECIDA = Object.freeze({
  rotulo: "Procedência desconhecida",
  token: "--state-neutral",
  // ⚠ Valor novo no servidor chega aqui como incógnita. Dizer "desconhecida" é honesto; escolher um
  // rótulo bonito faria a tela afirmar algo que ela não sabe.
  frase: "Esta tela não conhece esta procedência. Confira a versão do sistema.",
});

export function leituraDaProcedencia(p) {
  return LEITURA_DA_PROCEDENCIA[p] || PROCEDENCIA_DESCONHECIDA;
}

/** ⚠⚠ Verde NUNCA aparece neste fluxo. Travado por teste sobre as três procedências. */
export const TOKEN_PROIBIDO = "--state-ok";

export const ROTULO_DA_FONTE = Object.freeze({
  [FONTE.GUIA]: "Guia",
  [FONTE.NOTA_EMITIDA]: "Recebimento de nota",
  [FONTE.SERIE_RECEITA]: "Receita recorrente",
  [FONTE.SERIE_DESPESA]: "Despesa recorrente",
  [FONTE.IMPOSTO_PROJETADO]: "Imposto previsto",
});

export function rotuloDaFonte(f) {
  return ROTULO_DA_FONTE[f] || "Origem desconhecida";
}

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function dinheiro(v) {
  const n = numero(v);
  // ⚠⚠ Ausência NÃO vira "R$ 0,00". Zero fabricado é a armadilha que já custou um "0%" na tela do
  // cliente — e aqui ele viraria dinheiro que não existe.
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-08" → "agosto de 2026". ⚠ Competência torta não vira mês nenhum. */
export function rotuloDoMes(competencia) {
  if (typeof competencia !== "string") return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return "—";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "—";
  return `${MESES[mes - 1]} de ${m[1]}`;
}

/**
 * ⚠⚠ QUANDO A LINHA ACONTECE — e o dia ausente NUNCA vira um dia inventado.
 *
 * A guia tem dia próprio; a projeção não tem, e a tela diz POR QUÊ em vez de escolher um. Inventar
 * "dia 10" seria fabricar precisão que ninguém informou.
 */
export function quandoDaLinha(linha) {
  const dia = numero(linha?.dia);
  if (dia != null) return { texto: `dia ${dia}`, exato: true, motivo: null };
  return {
    texto: "no mês",
    exato: false,
    // ⚠ O motivo vem do SERVIDOR, com a frase pronta — a tela não escreve a sua, senão as duas
    // divergem na primeira correção.
    motivo: linha?.diaDesconhecido?.frase || null,
  };
}

/**
 * ⚠⚠ OS TOTAIS DO MÊS, PRONTOS PARA A TELA — e a soma NÃO existe.
 *
 * Devolve os três compartimentos separados. ⚠ Quem tentar somar `fato` com `previsao` aqui recria o
 * número que o contrato inteiro existe para não entregar.
 */
export function totaisParaTela(totais) {
  return {
    fato: {
      entrada: numero(totais?.fato?.entrada) || 0,
      saida: numero(totais?.fato?.saida) || 0,
    },
    previsao: {
      entrada: numero(totais?.previsao?.entrada) || 0,
      saida: numero(totais?.previsao?.saida) || 0,
    },
    // ⚠⚠ CONTAGEM, nunca valor.
    desconhecido: { quantas: numero(totais?.desconhecido?.quantas) || 0 },
  };
}

/** ⚠ O mês tem alguma coisa? É a pergunta que decide se ele aparece recolhido ou vazio. */
export function mesTemAlgo(mes) {
  return (mes?.linhas?.length || 0) > 0;
}

/**
 * ⚠⚠ A TELA ABRE COM 3 MESES — meio-termo aceito na revisão externa (25/08/2026).
 *
 * O dono escolheu o horizonte de 12 e a ressalva ficou escrita: com piso de 3 observações, o 12º mês
 * é extrapolação quase pura. O contrato entrega os 12; **a leitura começa onde a evidência está**, e
 * os outros nove ficam recolhidos — com o total do bloco à vista, para não sumirem.
 */
export const MESES_ABERTOS_POR_PADRAO = 3;

export function separarMeses(meses, abertos = MESES_ABERTOS_POR_PADRAO) {
  const lista = Array.isArray(meses) ? meses : [];
  return { proximos: lista.slice(0, abertos), distantes: lista.slice(abertos) };
}

/**
 * ⚠⚠ O TOTAL DO BLOCO RECOLHIDO — por PROCEDÊNCIA, e nunca somado.
 *
 * Sem ele os nove meses recolhidos sumiriam de vista; com uma soma única, eles virariam o número de
 * doze meses que o contrato recusa. Os dois compartimentos ficam separados aqui também.
 */
export function totalDoBloco(meses) {
  const zero = { entrada: 0, saida: 0 };
  const acc = { fato: { ...zero }, previsao: { ...zero }, desconhecido: { quantas: 0 } };
  for (const m of meses || []) {
    const t = totaisParaTela(m?.totais);
    acc.fato.entrada += t.fato.entrada;
    acc.fato.saida += t.fato.saida;
    acc.previsao.entrada += t.previsao.entrada;
    acc.previsao.saida += t.previsao.saida;
    acc.desconhecido.quantas += t.desconhecido.quantas;
  }
  return acc;
}

/**
 * ⚠⚠ A EVIDÊNCIA DA LINHA, NO TEXTO — nunca só num `title`.
 *
 * *"Por que esta linha está aqui?"* é a pergunta que o contador faz olhando uma projeção. `title`
 * não aparece no teclado nem no toque (regra que o `CLAUDE.md` deste app repete duas vezes).
 */
export function evidenciaDaLinha(linha) {
  const partes = [];
  const frase = String(linha?.base?.frase ?? "").trim();
  if (frase) partes.push(frase);

  const n = numero(linha?.base?.n);
  if (n != null && n > 0) partes.push(`${n} ${n === 1 ? "observação" : "observações"}`);

  // ⚠⚠ A FAIXA VIAJA JUNTO — medido em 27/08/2026, o CV mediano das despesas é 36,1%. A mediana
  // sozinha erraria por um terço rotineiramente.
  const min = numero(linha?.base?.min);
  const max = numero(linha?.base?.max);
  if (min != null && max != null && min !== max) partes.push(`entre ${dinheiro(min)} e ${dinheiro(max)}`);

  return partes.length ? partes.join(" · ") : null;
}

/**
 * ⚠⚠ O CONFRONTO da série declarada — *"o observado vence"* (decisão do dono).
 *
 * Devolve `null` quando não há o que confrontar: um aviso em toda linha vira paisagem.
 */
export function confrontoDaLinha(linha) {
  const declarado = numero(linha?.base?.valorDeclarado);
  const observado = numero(linha?.base?.valorObservado);
  if (declarado == null || observado == null) return null;
  const diferenca = Math.abs(observado - declarado);
  if (declarado > 0 && diferenca / declarado < 0.05) return null;
  return `Declarado ${dinheiro(declarado)}; as observações apontam ${dinheiro(observado)}. O observado vence.`;
}

/**
 * ⚠⚠ AS RESSALVAS QUE A TELA TEM DE MOSTRAR — e nenhuma delas pode ficar num `title`.
 *
 * Cada uma responde a uma pergunta que o contador faria olhando o número e não achando resposta.
 * ⚠ Lista vazia quando não há ressalva: inventar avisos faria os de verdade virarem paisagem.
 */
export function ressalvasDoFluxo(fluxo) {
  const r = [];

  // ⚠⚠ A guia VENCIDA é a linha mais urgente do fluxo, e ela não mora em mês nenhum.
  const vencidas = numero(fluxo?.vencidas?.quantas) || 0;
  if (vencidas > 0) {
    r.push({
      tom: "atencao",
      titulo: "Guias já vencidas",
      texto: `${vencidas} guia(s) já venceram e continuam em aberto, somando `
        + `${dinheiro(fluxo?.vencidas?.valor)}. Elas não aparecem nos meses abaixo porque a data `
        + "delas já passou — mas o dinheiro ainda tem de sair.",
    });
  }

  // ⚠⚠ O que não pôde ser posto em mês nenhum. Cada motivo já vem com o conserto, do servidor.
  for (const s of fluxo?.semMes || []) {
    // ⚠ O rótulo da linha ENTRA no título: sem ele, duas guias sem vencimento viram duas caixas
    // âmbar idênticas e o contador não sabe de qual delas cada uma fala.
    r.push({
      tom: "atencao",
      titulo: s.rotulo ? `Sem mês — ${s.rotulo}` : "Sem mês definido",
      texto: s.frase,
      rotulo: s.rotulo,
    });
  }

  // ⚠⚠ "ninguém configurou o prazo" ≠ "o prazo é 1 mês".
  if (fluxo?.prazoRecebimento && fluxo.prazoRecebimento.configurado === false) {
    r.push({
      tom: "neutro",
      titulo: "Prazo de recebimento: o padrão",
      texto: `Os recebimentos estão sendo projetados com o prazo PADRÃO de `
        + `${fluxo.prazoRecebimento.meses} mês(es) — ninguém configurou o prazo desta empresa.`,
    });
  }

  // ⚠⚠ A ausência do imposto projetado é NOMEADA — nunca uma linha que simplesmente não aparece.
  if (fluxo?.semImposto?.frase) {
    r.push({ tom: "neutro", titulo: "Sem imposto projetado", texto: fluxo.semImposto.frase });
  }

  // ⚠ Sem a tabela de séries, a previsão por recorrência não existe — e isso é diferente de "esta
  // empresa não tem recorrência nenhuma".
  if (fluxo?.recorrenciaIndisponivel) {
    r.push({
      tom: "atencao",
      titulo: "Recorrências não lidas",
      texto: "As recorrências não podem ser lidas neste ambiente (a tabela não existe no banco), "
        + "então nenhuma despesa ou receita recorrente entra neste fluxo.",
    });
  }

  const fora = numero(fluxo?.foraDoHorizonte) || 0;
  if (fora > 0) {
    r.push({
      tom: "neutro",
      titulo: "Fora dos meses mostrados",
      texto: `${fora} linha(s) caem fora dos ${fluxo?.horizonte || 12} meses mostrados.`,
    });
  }

  return r;
}

/**
 * ⚠⚠ O AVISO QUE ACOMPANHA A PREVISÃO — e ele é OBRIGATÓRIO.
 *
 * Sem esta frase, um contador olhando a coluna "previsto" pode lê-la como compromisso. Ela diz as
 * DUAS coisas que o plano exige: que é previsão, e que não existe soma de fato com previsão.
 */
export const FRASE_DA_PREVISAO =
  "Os valores previstos ainda não aconteceram. Eles não são somados aos valores de fato — cada um "
  + "tem o seu total, de propósito.";

/** ⚠ E a que explica por que não há um número único de 12 meses. */
export const FRASE_SEM_TOTAL =
  "Não há total dos 12 meses: sem saldo inicial não existe saldo acumulado, e um número único a "
  + "doze meses de distância diria mais do que este fluxo sabe.";
