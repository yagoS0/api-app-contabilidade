/**
 * ⚠⚠ ESPELHO de `apps/web/src/features/fluxo/lib/leituraDoFluxo.js` (portal do CONTADOR).
 *
 * As duas telas leem o MESMO payload (`GET .../fluxo-de-caixa`, corpo compartilhado em
 * `routes/fluxoDeCaixaHttp.js`). A REGRA de leitura é uma por app de propósito — o plano pede
 * *"lei de cor, uma lib por app com teste próprio"* —, porque as paletas são diferentes: lá o
 * verde proibido é `--state-ok`, aqui é `--success`.
 *
 * ⚠ O QUE DIVERGE NA CÓPIA, e é deliberado:
 *   1. o token proibido (`--success` × `--state-ok`) e os nomes das classes de estado;
 *   2. o dinheiro sai por `lib/format.brl` — este app já tem a sua regra de "ausência é traço",
 *      e uma segunda formatação faria o mesmo valor sair diferente em duas telas do MESMO portal;
 *   3. o TEXTO é do cliente, não do contador: aqui não se escreve "procedência", "competência" nem
 *      "mediana". O que a frase precisa dizer é a mesma coisa; o vocabulário é o de quem lê.
 *
 * ⚠⚠ ESTA REGRA NÃO CALCULA NADA e NÃO SOMA FATO COM PREVISÃO. Não existe `total` no payload, e a
 * tela não inventa um — é a mesma proibição dos dois lados (`docs/dre-fluxo-caixa.md`).
 */

import { brl } from "../../../lib/format";

/** ⚠ Vocabulário FECHADO — espelha `PROCEDENCIA` do servidor. */
/**
 * ⚠⚠ `COMPROMISSO` ENTROU EM 28/08/2026, E O SIGNIFICADO DE `FATO` MUDOU JUNTO.
 *
 * A **Lei 1** da `CONSTITUICAO-do-produto.md` diz: *"Dinheiro só confirma com pagamento.
 * Contabilizado, emitido, gerado, vencido: nada disso é fato de caixa."* Até aqui `FATO` queria
 * dizer *"existe, com data própria"*, e a guia GERADA e em aberto entrava nele — hoje ela é
 * `COMPROMISSO`, e `FATO` é só o que foi pago.
 *
 * ⚠⚠ **ESTE ARQUIVO É ESPELHO, e não atualizá-lo era o defeito silencioso.** O valor novo cairia no
 * fallback *"Esta tela não conhece esta procedência"* — em TODA guia em aberto, nas duas telas, sem
 * erro nenhum. É a mesma classe do `select` explícito: a tela "só não mostra".
 */
export const PROCEDENCIA = Object.freeze({
  FATO: "FATO",
  COMPROMISSO: "COMPROMISSO",
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
  FOLHA: "FOLHA",
});

/**
 * ⚠⚠ A LEI DE COR — e neste portal ela importa MAIS que no do contador.
 *
 * ⚠⚠ **A PREVISÃO NUNCA RECEBE VERDE.** Verde, nesta casa, quer dizer *pago/concluído* — o pior
 * desfecho possível para uma linha que ainda não aconteceu. E quem lê aqui é o dono da empresa, que
 * pode tomar decisão de caixa em cima do número.
 *
 * ⚠ O FATO também não é verde: ele é NEUTRO. Uma guia gerada e em aberto não está paga.
 *
 * ⚠⚠ E a palavra vai no TEXTO, não só na cor: impressão em preto e branco e daltonismo tiram a cor.
 */
const LEITURA_DA_PROCEDENCIA = Object.freeze({
  [PROCEDENCIA.FATO]: {
    rotulo: "Já existe",
    classe: "neutro",
    frase: "Este valor já existe, com data própria.",
  },
  [PROCEDENCIA.COMPROMISSO]: {
    // ⚠ "A pagar", não "Previsto": o valor e a data são CONHECIDOS — o que falta é o dinheiro sair.
    // Chamá-lo de previsão diria que alguém estimou o número, e ninguém estimou.
    rotulo: "A pagar",
    classe: "aviso",
    frase: "Este valor já foi gerado e ainda não foi pago.",
  },
  [PROCEDENCIA.PREVISAO]: {
    rotulo: "Previsto",
    classe: "aviso",
    frase: "Este valor é uma PREVISÃO — ele ainda não aconteceu.",
  },
  [PROCEDENCIA.DESCONHECIDO]: {
    rotulo: "Sem mês",
    classe: "aviso",
    frase: "Falta um dado para saber em que mês isto entra ou sai.",
  },
});

const PROCEDENCIA_DESCONHECIDA = Object.freeze({
  rotulo: "Não sabemos",
  classe: "neutro",
  // ⚠ Valor novo no servidor chega aqui como incógnita. Escolher um rótulo bonito faria a tela
  // afirmar algo que ela não sabe.
  frase: "Esta tela não conhece esta origem. Fale com o seu contador.",
});

export function leituraDaProcedencia(p) {
  return LEITURA_DA_PROCEDENCIA[p] || PROCEDENCIA_DESCONHECIDA;
}

/** ⚠⚠ Verde NUNCA aparece neste fluxo. Travado por teste sobre as três procedências. */
export const TOKEN_PROIBIDO = "--success";

/** ⚠ As classes que a folha de estilo pinta. `ok` é a que NÃO pode aparecer aqui. */
export const CLASSES_DA_PROCEDENCIA = Object.freeze(["neutro", "aviso"]);

/** ⚠ O nome de cada origem, no vocabulário de quem RECEBE — nunca no do razão. */
export const ROTULO_DA_FONTE = Object.freeze({
  [FONTE.GUIA]: "Guia de imposto",
  [FONTE.NOTA_EMITIDA]: "Recebimento de nota emitida",
  [FONTE.SERIE_RECEITA]: "Receita que se repete",
  [FONTE.SERIE_DESPESA]: "Despesa que se repete",
  [FONTE.FOLHA]: "Folha de pagamento",
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

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** `"2026-08"` → `"agosto de 2026"`. ⚠ Competência torta não vira mês nenhum. */
export function rotuloDoMes(competencia) {
  if (typeof competencia !== "string") return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return "—";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "—";
  return `${MESES[mes - 1]} de ${m[1]}`;
}

/** `"2026-08"` → `"ago/26"`, para caber na coluna estreita do celular. */
export function mesCurto(competencia) {
  if (typeof competencia !== "string") return "—";
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return "—";
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "—";
  return `${MESES[mes - 1].slice(0, 3)}/${m[1].slice(2)}`;
}

/**
 * ⚠⚠ QUANDO A LINHA ACONTECE — e o dia ausente NUNCA vira um dia inventado.
 *
 * A guia tem dia próprio; a projeção não tem, e a tela diz POR QUÊ em vez de escolher um. Inventar
 * "dia 10" seria fabricar precisão que ninguém informou — e aqui o número vira decisão de caixa.
 */
export function quandoDaLinha(linha) {
  const dia = numero(linha?.dia);
  if (dia != null) return { texto: `dia ${dia}`, exato: true, motivo: null };
  return {
    texto: "ao longo do mês",
    exato: false,
    // ⚠ O motivo vem do SERVIDOR, com a frase pronta — a tela não escreve a sua, senão as duas
    // divergem na primeira correção.
    motivo: linha?.diaDesconhecido?.frase || null,
  };
}

/**
 * ⚠⚠ OS TOTAIS DO MÊS — e a SOMA não existe.
 *
 * ⚠ Quem tentar somar `fato` com `previsao` aqui recria o número que o contrato inteiro existe
 * para não entregar.
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

/** ⚠ O mês tem alguma coisa? Decide se ele aparece com linhas ou com a frase de vazio. */
export function mesTemAlgo(mes) {
  return (mes?.linhas?.length || 0) > 0;
}

/**
 * ⚠⚠ A TELA ABRE COM 3 MESES — o contrato entrega os 12, a leitura começa onde a evidência está.
 *
 * ⚠ Aqui isso pesa mais que no portal do contador: a tela do cliente é lida no celular, e doze
 * meses abertos empurrariam tudo o mais para fora da dobra.
 */
export const MESES_ABERTOS_POR_PADRAO = 3;

export function separarMeses(meses, abertos = MESES_ABERTOS_POR_PADRAO) {
  const lista = Array.isArray(meses) ? meses : [];
  return { proximos: lista.slice(0, abertos), distantes: lista.slice(abertos) };
}

/**
 * ⚠⚠ O TOTAL DO BLOCO RECOLHIDO — por PROCEDÊNCIA, e nunca somado.
 *
 * Sem ele os meses recolhidos sumiriam de vista; com uma soma única, eles virariam o número de doze
 * meses que o contrato recusa.
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
 * ⚠⚠ POR QUE ESTA LINHA ESTÁ AQUI — no TEXTO, nunca num `title`.
 *
 * `title` não aparece no teclado nem no toque, e este portal é lido no celular.
 *
 * ⚠ A FAIXA VIAJA JUNTO. A mediana sozinha erraria por um terço rotineiramente (o CV mediano das
 * despesas, medido em 27/08/2026, é 36,1%) — e aqui quem lê pode planejar o caixa em cima dela.
 */
export function evidenciaDaLinha(linha) {
  const partes = [];
  const frase = String(linha?.base?.frase ?? "").trim();
  if (frase) partes.push(frase);

  const n = numero(linha?.base?.n);
  if (n != null && n > 0) partes.push(`visto ${n} ${n === 1 ? "vez" : "vezes"}`);

  const min = numero(linha?.base?.min);
  const max = numero(linha?.base?.max);
  if (min != null && max != null && min !== max) partes.push(`entre ${brl(min)} e ${brl(max)}`);

  return partes.length ? partes.join(" · ") : null;
}

/**
 * ⚠⚠ O CONFRONTO da recorrência que o CLIENTE declarou — *"o observado vence"* (decisão do dono).
 *
 * ⚠ A frase é escrita para ele, não para o contador: quem declarou aquele valor foi ele, e a tela
 * precisa dizer que o extrato apontou outra coisa **sem** parecer acusação.
 *
 * ⚠ Devolve `null` quando não há o que confrontar: um aviso em toda linha vira paisagem.
 */
export function confrontoDaLinha(linha) {
  const declarado = numero(linha?.base?.valorDeclarado);
  const observado = numero(linha?.base?.valorObservado);
  if (declarado == null || observado == null) return null;
  const diferenca = Math.abs(observado - declarado);
  if (declarado > 0 && diferenca / declarado < 0.05) return null;
  return `Você informou ${brl(declarado)}; o que apareceu de fato foi ${brl(observado)}. `
    + "A previsão usa o valor que apareceu.";
}

/**
 * ⚠⚠ AS RESSALVAS — cada uma responde a uma pergunta que ficaria sem resposta olhando o número.
 *
 * ⚠ CADA UMA TEM TÍTULO PRÓPRIO. Sem isso viram caixas de aviso idênticas empilhadas, e o leitor
 * deixa de ler todas — foi exatamente o defeito achado no navegador do portal do contador.
 *
 * ⚠ Lista vazia quando não há ressalva: inventar avisos faria os de verdade virarem paisagem.
 */
export function ressalvasDoFluxo(fluxo) {
  const r = [];

  // ⚠⚠ A GUIA VENCIDA é a linha mais urgente, e ela não mora em mês nenhum.
  const vencidas = numero(fluxo?.vencidas?.quantas) || 0;
  if (vencidas > 0) {
    r.push({
      tom: "aviso",
      titulo: "Guias já vencidas",
      texto: `${vencidas} guia(s) já venceram e continuam em aberto, somando `
        + `${brl(fluxo?.vencidas?.valor)}. Elas não aparecem nos meses abaixo porque a data delas já `
        + "passou — mas o dinheiro ainda tem de sair. Fale com o seu contador.",
    });
  }

  // ⚠⚠ O que não pôde ser posto em mês nenhum. Cada motivo já vem com o conserto, do servidor.
  for (const s of fluxo?.semMes || []) {
    r.push({
      tom: "aviso",
      // ⚠ O rótulo da linha entra no título: duas guias sem vencimento viram duas caixas iguais.
      titulo: s?.rotulo ? `Sem mês — ${s.rotulo}` : "Sem mês definido",
      texto: s?.frase,
    });
  }

  // ⚠⚠ "ninguém configurou o prazo" ≠ "o prazo é 1 mês", e quem configura é o CONTADOR.
  if (fluxo?.prazoRecebimento && fluxo.prazoRecebimento.configurado === false) {
    r.push({
      tom: "neutro",
      titulo: "Prazo de recebimento: o padrão",
      texto: `As entradas das notas emitidas estão sendo previstas para `
        + `${fluxo.prazoRecebimento.meses} mês(es) depois da emissão — este é o PADRÃO do sistema, `
        + "ninguém configurou o prazo da sua empresa. Se o seu prazo é outro, fale com o seu contador.",
    });
  }

  // ⚠⚠ A ausência do imposto previsto é DITA — nunca uma linha que simplesmente não aparece.
  if (fluxo?.semImposto?.frase) {
    r.push({ tom: "neutro", titulo: "Sem imposto previsto", texto: fluxo.semImposto.frase });
  }

  // ⚠ "a tabela não existe neste ambiente" ≠ "você não tem nada que se repete".
  if (fluxo?.recorrenciaIndisponivel) {
    r.push({
      tom: "aviso",
      titulo: "Repetições não lidas",
      texto: "As despesas e receitas que se repetem não puderam ser lidas agora, então elas não "
        + "entram neste fluxo. Isto é uma limitação do sistema, não uma afirmação sobre a sua empresa.",
    });
  }

  const fora = numero(fluxo?.foraDoHorizonte) || 0;
  if (fora > 0) {
    r.push({
      tom: "neutro",
      titulo: "Fora dos meses mostrados",
      texto: `${fora} linha(s) caem fora dos ${fluxo?.horizonte || 12} meses mostrados aqui.`,
    });
  }

  return r;
}

/**
 * ⚠⚠ O AVISO QUE ACOMPANHA A PREVISÃO — e ele é OBRIGATÓRIO.
 *
 * Sem esta frase, a coluna "previsto" se lê como compromisso — e quem lê esta tela é quem paga as
 * contas.
 */
export const FRASE_DA_PREVISAO =
  "O que está marcado como PREVISTO ainda não aconteceu: é uma estimativa a partir do que já se "
  + "repetiu. Ele não é somado ao que já existe — cada um tem o seu total, de propósito.";

/** ⚠ E a que explica por que não há um número único de 12 meses. */
export const FRASE_SEM_TOTAL =
  "Não há um total dos 12 meses: este painel mostra MOVIMENTOS, não saldo — ele não sabe quanto "
  + "você tem em conta hoje, então não teria como somar um saldo futuro.";
