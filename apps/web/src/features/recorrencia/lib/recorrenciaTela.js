/**
 * A RECORRÊNCIA NA TELA — o que cada série diz, e o que ela oferece.
 *
 * ⚠⚠ ONDE ELA MORA, E POR QUÊ NÃO É UMA ABA. O dono cortou um nível de navegação em 24/08/2026
 * (*"muitas abas"*), e o plano é explícito: a marcação mora **na linha do fluxo de caixa**, e as
 * declarações pendentes do cliente entram na **fila da Conferência**. Como o fluxo (Fase E) ainda
 * não existe, hoje ela vive num PAINEL dentro da Conferência — a mesma fila de *"coisas para o
 * contador confirmar"* para onde o plano já manda as declarações. ⚠ Esta lib fica numa feature
 * PRÓPRIA justamente para a tela do fluxo importá-la depois sem depender da Conferência.
 *
 * ⚠⚠ ESTA REGRA NÃO DECIDE NADA. Quem observa é `application/fluxo/lib/recorrencia.js`, no servidor,
 * e quem grava é o `SerieRecorrenteService`. Aqui mora a LEITURA: rótulo, cor, ordem, e qual botão
 * sequer aparece. Reimplementar a regra faria a tela oferecer o que o servidor recusa.
 */

/** ⚠ O que o detector respondeu. Vocabulário FECHADO — espelha `LEITURA` do servidor. */
export const LEITURA = Object.freeze({
  POUCAS_OBSERVACOES: "poucas_observacoes",
  SUGERE_ENTRADA: "sugere_entrada",
  CONTINUA: "continua",
  SUGERE_SAIDA: "sugere_saida",
  SEM_OBSERVACAO: "sem_observacao",
});

export const ESTADO_DA_SERIE = Object.freeze({
  PENDENTE: "PENDENTE",
  ATIVA: "ATIVA",
  RECUSADA: "RECUSADA",
  SUSPENSA: "SUSPENSA",
});

export const ORIGEM_DA_SERIE = Object.freeze({ DETECTADA: "DETECTADA", DECLARADA: "DECLARADA" });

export const LADO = Object.freeze({ RECEITA: "RECEITA", DESPESA: "DESPESA" });

/**
 * Como cada leitura do detector se lê na tela.
 *
 * ⚠⚠ NENHUMA USA `--state-danger`. Vermelho, nesta casa, **bloqueia o fechamento contábil** — e
 * nenhuma resposta do detector bloqueia coisa alguma. É a mesma disciplina que tirou o vermelho da
 * aba de Auditoria e do `RECUSADO` da Conferência.
 *
 * ⚠⚠ E NENHUMA USA VERDE, tampouco. Verde quer dizer CONCLUÍDO; uma série recorrente é uma
 * PROJEÇÃO — ela não aconteceu. É a lei do plano: *"verde NUNCA em previsão"*.
 */
const LEITURA_NA_TELA = Object.freeze({
  [LEITURA.SUGERE_ENTRADA]: {
    rotulo: "Parece se repetir",
    token: "--state-warn",
    // ⚠ "Parece", nunca "é". O piso é 3 observações (decisão do dono) e um trimestre coincidente
    // alcança isso — o que segura o desenho é a MARCAÇÃO, não o número.
    frase: "Há um padrão nas observações. Ele SUGERE recorrência — quem decide é você.",
    ordem: 0,
  },
  [LEITURA.SUGERE_SAIDA]: {
    rotulo: "Parou de aparecer",
    token: "--state-warn",
    frase: "Esta série está marcada e não aparece há dois ciclos. O sistema NÃO a desmarca — quem decide é você.",
    ordem: 1,
  },
  [LEITURA.SEM_OBSERVACAO]: {
    rotulo: "Sem observação",
    token: "--state-warn",
    // ⚠⚠ É a resposta que impede uma afirmação sem prova de ficar viva no fluxo para sempre.
    frase: "Não há nenhuma observação por trás desta série. Ela continua projetando no fluxo — confira.",
    ordem: 2,
  },
  [LEITURA.CONTINUA]: {
    rotulo: "Continua",
    token: "--state-neutral",
    frase: "Marcada e ainda acontecendo.",
    ordem: 3,
  },
  [LEITURA.POUCAS_OBSERVACOES]: {
    rotulo: "Sem padrão ainda",
    // ⚠ NEUTRO, nunca âmbar: não ter padrão não é pendência nossa nem do contador — é a resposta
    // certa. Âmbar permanente treina o olho a ignorar a cor que significa "falta fazer".
    token: "--state-neutral",
    frase: "Ainda não há observações consecutivas suficientes para sugerir recorrência.",
    ordem: 4,
  },
});

const LEITURA_DESCONHECIDA = Object.freeze({
  rotulo: "Leitura desconhecida",
  token: "--state-neutral",
  // ⚠ Resposta nova no servidor chega aqui como incógnita. Dizer "desconhecida" é honesto; escolher
  // um rótulo bonito faria a tela afirmar algo que ela não sabe.
  frase: "Esta tela não conhece esta resposta do detector. Confira a versão do sistema.",
  ordem: 9,
});

export function leituraNaTela(leitura) {
  return LEITURA_NA_TELA[leitura] || LEITURA_DESCONHECIDA;
}

/**
 * ⚠⚠ DETECTADA E DECLARADA NUNCA SE PARECEM — decisão do plano, e é o ponto desta função.
 *
 * A detectada mostra a EVIDÊNCIA (n, janela, faixa); a declarada mostra QUEM afirmou e QUANDO. **Uma
 * afirmação não pode ter o peso visual de doze observações.**
 */
export function leituraDaOrigem(origem) {
  if (origem === ORIGEM_DA_SERIE.DECLARADA) {
    return {
      rotulo: "Declarada",
      ehObservada: false,
      frase: "Alguém afirmou que isto se repete. Não é uma observação do sistema.",
    };
  }
  if (origem === ORIGEM_DA_SERIE.DETECTADA) {
    return {
      rotulo: "Observada",
      ehObservada: true,
      frase: "O padrão saiu das notas que já estão no sistema.",
    };
  }
  // ⚠ Série ainda não marcada não tem origem — e "candidata" é diferente de "declarada".
  return {
    rotulo: "Candidata",
    ehObservada: true,
    frase: "Ninguém decidiu nada sobre esta série ainda.",
  };
}

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function dinheiro(v) {
  const n = numero(v);
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * ⚠⚠ O VALOR PROJETADO SAI COM A FAIXA — *"≈ R$ 130, entre R$ 120 e R$ 140"*. NUNCA o ponto sozinho.
 *
 * Não é preferência de escrita: **medido em 27/08/2026, o CV mediano das despesas deste banco é
 * 36,1%**. A mediana sozinha erraria por um terço rotineiramente, e o fluxo diria um número que
 * ninguém pode usar. Por isso a faixa é parte da resposta, não um detalhe ao lado.
 *
 * ⚠ O `≈` é deliberado: ele diz, antes de qualquer palavra, que o número é aproximado.
 * ⚠ Sem valor, devolve `null` — a tela mostra a ausência, e não um "R$ 0,00" fabricado.
 */
export function valorComFaixa(serie) {
  const ponto = numero(serie?.valorProjetado);
  if (ponto == null) return null;
  const min = numero(serie?.base?.min);
  const max = numero(serie?.base?.max);
  if (min == null || max == null || min === max) return `≈ ${dinheiro(ponto)}`;
  return `≈ ${dinheiro(ponto)}, entre ${dinheiro(min)} e ${dinheiro(max)}`;
}

/**
 * ⚠⚠ A EVIDÊNCIA VAI NO TEXTO, NUNCA SÓ NUM `title`.
 *
 * `title` não aparece no teclado nem no toque — regra que o `CLAUDE.md` deste app repete duas vezes.
 * *"Baseado em 3 observações"* é o que separa uma projeção conferível de um número mágico.
 */
export function evidenciaDaSerie(serie) {
  const partes = [];
  const n = numero(serie?.base?.n);
  if (n != null && n > 0) partes.push(`${n} ${n === 1 ? "observação" : "observações"}`);
  const cv = numero(serie?.base?.cv);
  // ⚠ O CV é EVIDÊNCIA, NUNCA GATILHO. Não há limiar automático — um seria número inventado.
  if (cv != null) partes.push(`variação de ${(cv * 100).toFixed(0)}%`);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * ⚠⚠ O CONFRONTO — *"você declarou R$ 1.000; as observações dizem outra coisa"*.
 *
 * Decisão do dono: **o observado vence**. E a declaração SEM observação nenhuma é CONFRONTADA, não
 * confiada para sempre — sem isso o fluxo projeta dinheiro saindo que não sai, e ninguém descobre.
 *
 * ⚠ Devolve `null` quando não há o que confrontar: inventar um aviso em toda linha declarada faria
 * o aviso virar paisagem.
 */
export function confrontoDaDeclaracao(serie) {
  if (serie?.origem !== ORIGEM_DA_SERIE.DECLARADA) return null;
  const declarado = numero(serie?.valorDeclarado);
  if (declarado == null) return null;

  const observado = numero(serie?.valorProjetado);
  const n = numero(serie?.base?.n) || 0;

  if (!n || observado == null) {
    return {
      tipo: "sem_observacao",
      frase: `Declarado ${dinheiro(declarado)}. Não localizamos nenhuma observação desta despesa — confira antes de contar com ela no fluxo.`,
    };
  }
  // ⚠ Diferença de centavos não é divergência. O piso existe para o aviso não virar ruído em toda
  // linha; ele é de EXIBIÇÃO, e não muda nada do que o servidor calcula.
  const diferenca = Math.abs(observado - declarado);
  if (declarado > 0 && diferenca / declarado < 0.05) return null;

  return {
    tipo: "diverge",
    frase: `Você declarou ${dinheiro(declarado)}; as observações apontam ${dinheiro(observado)} `
      + `(${n} ${n === 1 ? "observação" : "observações"}). O observado vence.`,
  };
}

/** ⚠ Vocabulário FECHADO do que a tela oferece numa série. */
export const ACAO = Object.freeze({
  CONFIRMAR: "confirmar",
  RECUSAR: "recusar",
  SUSPENDER: "suspender",
});

export const ROTULO_DA_ACAO = Object.freeze({
  [ACAO.CONFIRMAR]: "Usar no fluxo",
  [ACAO.RECUSAR]: "Não é recorrente",
  [ACAO.SUSPENDER]: "Tirar do fluxo",
});

/** O estado que cada ação grava. ⚠ A tela não inventa estado: ela escolhe entre os três da rota. */
export const ESTADO_DA_ACAO = Object.freeze({
  [ACAO.CONFIRMAR]: ESTADO_DA_SERIE.ATIVA,
  [ACAO.RECUSAR]: ESTADO_DA_SERIE.RECUSADA,
  [ACAO.SUSPENDER]: ESTADO_DA_SERIE.SUSPENSA,
});

/**
 * Quais ações a tela OFERECE para uma série.
 *
 * ⚠⚠ ISTO NÃO É A GUARDA. Quem recusa continua sendo a rota, que enxerga o estado do instante do
 * clique. Isto existe para a tela não oferecer um botão que volta recusado.
 *
 * ⚠ Mapa de INCLUSÃO: estado novo nasce **sem ação nenhuma**, não com todas.
 */
export function acoesDaSerie(serie) {
  const estado = serie?.estado || null;
  if (estado === ESTADO_DA_SERIE.ATIVA) return [ACAO.SUSPENDER];
  // ⚠ Candidata (sem estado), PENDENTE, RECUSADA e SUSPENSA compartilham a mesma escolha: entrar no
  // fluxo ou ser recusada. Recusada e suspensa NÃO são becos — reabrir é um clique.
  if (estado === null || Object.values(ESTADO_DA_SERIE).includes(estado)) {
    return [ACAO.CONFIRMAR, ACAO.RECUSAR];
  }
  return [];
}

/**
 * Por que uma ação está desabilitada — ou `null` se ela pode acontecer.
 *
 * ⚠ O motivo é devolvido junto, sempre. Botão desabilitado e mudo é o defeito que a aba de Guias já
 * pagou: ninguém sabe se é falta de permissão, dado faltando ou defeito.
 */
export function motivoDeBloqueio(acao, serie, { podeEscrever = true, indisponivel = false } = {}) {
  if (!podeEscrever) return "Seu perfil não pode marcar recorrências desta empresa.";
  // ⚠⚠ Sem a tabela, marcar volta 503. Dizer isso ANTES do clique é o pré-voo desta casa.
  if (indisponivel) {
    return "A tabela de recorrências ainda não existe neste banco. A migration não foi aplicada.";
  }
  // ⚠⚠ CONFIRMAR SEM VALOR NENHUM PÕE UMA LINHA MUDA NO FLUXO. Uma série sem mediana e sem valor
  // declarado não tem o que projetar — e o fluxo mostraria uma linha sem número.
  if (acao === ACAO.CONFIRMAR) {
    const temValor = numero(serie?.valorProjetado) != null || numero(serie?.valorDeclarado) != null;
    if (!temValor) {
      return "Esta série não tem valor projetado nem declarado — não há o que pôr no fluxo de caixa.";
    }
  }
  return null;
}

/**
 * ⚠⚠ A ORDEM: o que espera decisão primeiro, o que não tem padrão por último.
 *
 * Uma lista ordenada por nome faria as 3 séries que pedem resposta se perderem entre as 94 que não
 * pedem nada — que é o mesmo defeito que a fila da Conferência resolve agrupando por fornecedor.
 */
export function ordenarSeries(series) {
  const peso = (s) => leituraNaTela(s?.leitura).ordem;
  return [...(series || [])].sort((a, b) => {
    const d = peso(a) - peso(b);
    if (d !== 0) return d;
    // ⚠ Desempate por VALOR, do maior para o menor: entre duas que pedem a mesma decisão, a que
    // move mais dinheiro no fluxo é a que merece o olho primeiro.
    return (numero(b?.valorProjetado) || 0) - (numero(a?.valorProjetado) || 0);
  });
}

/**
 * ⚠⚠ QUANTAS PEDEM RESPOSTA — o número que decide se o painel sequer aparece.
 *
 * Um painel permanente dizendo "nada a decidir" seria ruído na maioria das empresas. Mesmo desenho
 * do `PainelDeCasamentos`, que some sozinho quando não há nada a casar.
 */
export function pedemResposta(series) {
  return (series || []).filter((s) => {
    if (s?.estado === ESTADO_DA_SERIE.PENDENTE) return true;
    if (s?.estado === ESTADO_DA_SERIE.ATIVA) {
      // ⚠ A série marcada só volta a pedir resposta quando o detector sugere a saída ou quando ela
      // ficou sem nenhuma observação por trás.
      return s?.leitura === LEITURA.SUGERE_SAIDA || s?.leitura === LEITURA.SEM_OBSERVACAO;
    }
    // ⚠ Candidata sem estado pede resposta se o detector sugeriu entrada. Já RECUSADA/SUSPENSA não
    // pedem nada: alguém já decidiu, e voltar a perguntar todo mês é o oposto de uma decisão.
    return !s?.estado && s?.leitura === LEITURA.SUGERE_ENTRADA;
  });
}

/** ⚠ O rótulo do lado, para a linha dizer se é dinheiro entrando ou saindo. */
export function rotuloDoLado(lado) {
  if (lado === LADO.RECEITA) return "Entrada";
  if (lado === LADO.DESPESA) return "Saída";
  return "—";
}

export const ROTULO_DA_PERIODICIDADE = Object.freeze({
  MENSAL: "todo mês",
  TRIMESTRAL: "a cada trimestre",
  ANUAL: "uma vez por ano",
});

export function rotuloDaPeriodicidade(p) {
  // ⚠ Periodicidade desconhecida NÃO vira "todo mês": afirmaria um ritmo que ninguém escolheu.
  return ROTULO_DA_PERIODICIDADE[p] || "periodicidade desconhecida";
}
