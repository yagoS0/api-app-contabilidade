/**
 * CONTABILIZAR VÁRIAS LINHAS DE UMA VEZ — quais entram, e o que a aplicação em massa pode tocar.
 *
 * > Dono, 25/08/2026: *"ai clicamos em importar e abre o modal para trabalharmos nele."*
 *
 * ⚠⚠ O MODAL FICA **SOBRE** A FILA, NUNCA NO LUGAR DELA. A fila é o objeto durável — paginação,
 * recorte por competência, `porEstado`, pré-voo de mês fechado. O modal é um instrumento de
 * trabalho em cima dela, e o precedente está na própria aba (`ModalDaVarredura`, `ModalDaAcao`).
 *
 * ⚠ Este módulo é PURO. Ele decide o que entra e o que a massa toca; quem envia é a tela, e quem
 * decide se a transição pode acontecer continua sendo `aplicarTransicao`, no servidor.
 */

import { acaoPedeData, contaQueSeraUsada, motivoDeBloqueio } from "./conferenciaTela";
import { completoDoReduzido, reduzidoDoCompleto } from "./contaDaConferencia";

/** ⚠ Vocabulário FECHADO: por que uma linha da fila NÃO entra no modal. */
export const FORA_DO_LOTE = Object.freeze({
  /**
   * ⚠⚠ O DÉBITO DE EXTRATO QUE JÁ CASA COM UMA NOTA DA FILA.
   *
   * Contabilizá-lo à parte DUPLICA A DESPESA: a nota vira um lançamento e o débito vira outro, para
   * o mesmo dinheiro que saiu uma vez. O caminho dele é o `PainelDeCasamentos` — lá ele é FUNDIDO à
   * nota, preenchendo o bloco de pagamento dela.
   *
   * ⚠ E `fundir` NÃO contabiliza: depois de fundido, a NOTA aparece aqui, uma vez só.
   */
  CASA_COM_NOTA: "casa_com_nota",
  /** A linha está bloqueada por mês fechado, competência ausente ou papel — o pré-voo já sabe. */
  BLOQUEADA: "bloqueada",
  /** A ação de confirmar não se aplica a este estado (já contabilizado, recusado, fundido). */
  ESTADO_NAO_CONFIRMA: "estado_nao_confirma",
  /**
   * ⚠⚠ NINGUÉM PROVOU QUANDO ESTA DESPESA FOI PAGA.
   *
   * `confirmar` a partir de `AGUARDANDO_PAGAMENTO` exige a data no MESMO ato — é a invariante do
   * caixa (`D despesa / C caixa` afirma que o dinheiro saiu). Sem ela o POST volta
   * `sem_data_de_pagamento`, e a tela descobriria a regra pelo erro.
   *
   * ⚠⚠ E O CONSERTO NÃO É UMA COLUNA DE DATA NO LOTE. A data que a pessoa digita é **declaração,
   * não prova** — o modal da linha diz isso, em texto, uma vez por linha. Declarar em massa a data
   * de pagamento de vinte notas é exatamente o ato que essa frase existe para tornar consciente.
   */
  PRECISA_DE_DATA: "precisa_de_data",
});

export const FRASE_DO_FORA_DO_LOTE = Object.freeze({
  [FORA_DO_LOTE.CASA_COM_NOTA]:
    "Este débito do extrato parece ser o pagamento de uma nota que já está na fila. Contabilizá-lo "
    + "aqui lançaria a mesma despesa duas vezes — case-o com a nota no painel acima.",
  [FORA_DO_LOTE.BLOQUEADA]: "Esta linha está bloqueada — o motivo aparece na fila.",
  [FORA_DO_LOTE.ESTADO_NAO_CONFIRMA]: "Esta linha não está esperando confirmação.",
  [FORA_DO_LOTE.PRECISA_DE_DATA]:
    "Ninguém provou quando esta despesa foi paga. Informar a data é uma declaração sua, e ela se faz "
    + "uma linha de cada vez — use o botão da fila.",
});

const texto = (v) => String(v ?? "").trim();

/**
 * ⚠⚠ OS DÉBITOS QUE NÃO PODEM ENTRAR — porque já têm uma nota candidata.
 *
 * Lê a resposta de `getConferenciaCasamentos`. ⚠ A chave é **`linhas`**, não `casamentos` — o mock
 * já divergiu nisso uma vez, e a tela teria funcionado offline e quebrado em produção.
 *
 * ⚠ Entra na lista quem tem `sugestao` **ou** `candidatos` — inclusive o AMBÍGUO. Ambiguidade não
 * autoriza contabilizar à parte: ela quer dizer que existe nota para casar e que o sistema não sabe
 * qual, e lançar o débito sozinho resolveria a dúvida da pior forma possível.
 */
export function debitosQueCasamComNota(casamentos) {
  const ids = new Set();
  for (const linha of casamentos?.linhas || []) {
    const id = texto(linha?.debito?.id);
    if (!id) continue;
    const temSugestao = Boolean(linha?.sugestao?.nota?.id);
    const temCandidatos = Array.isArray(linha?.candidatos) && linha.candidatos.length > 0;
    if (temSugestao || temCandidatos) ids.add(id);
  }
  return ids;
}

/**
 * As linhas da fila prontas para o modal, e as que ficaram de fora COM O MOTIVO.
 *
 * ⚠ O que fica de fora não some: a tela o conta e nomeia. Uma fila de 40 linhas virando um modal de
 * 31 sem explicação faz o contador procurar as 9 que "sumiram".
 *
 * @param {Array<object>} itens as linhas da fila
 * @param {object} opcoes
 * @param {Set<string>} opcoes.idsQueCasam de `debitosQueCasamComNota`
 * @param {boolean} opcoes.podeEscrever
 * @param {boolean} opcoes.podeEscolherConta
 */
export function separarParaOLote(itens, { idsQueCasam = new Set(), podeEscrever = true, podeEscolherConta = false } = {}) {
  const dentro = [];
  const fora = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    // ⚠ A ORDEM importa: o motivo mais específico primeiro. Um débito que casa com nota E está em
    // mês fechado é, antes de tudo, um débito que casa com nota — é isso que o contador precisa
    // saber para não procurar o conserto no lugar errado.
    if (idsQueCasam.has(texto(item?.id))) {
      fora.push({ item, motivo: FORA_DO_LOTE.CASA_COM_NOTA });
      continue;
    }
    // ⚠ Reusa `motivoDeBloqueio` — a MESMA leitura da fila. Uma segunda regra aqui faria o modal
    // aceitar o que a linha recusa, e o servidor decidiria a divergência com um 409.
    const bloqueio = motivoDeBloqueio("confirmar", item, { podeEscrever, podeEscolherConta });
    if (bloqueio) {
      fora.push({ item, motivo: FORA_DO_LOTE.BLOQUEADA, frase: bloqueio });
      continue;
    }
    // ⚠⚠ DEPOIS do pré-voo, e não antes: mês fechado e papel insuficiente são impedimentos mais
    // gerais — dizer "informe a data" a quem nem pode escrever manda consertar a coisa errada.
    if (acaoPedeData("confirmar", item)) {
      fora.push({ item, motivo: FORA_DO_LOTE.PRECISA_DE_DATA });
      continue;
    }
    dentro.push(item);
  }
  return { dentro, fora };
}

/**
 * O estado inicial do modal: uma conta por linha, pré-preenchida com a sugestão.
 *
 * ⚠ REDUZIDO, que é o que o contador lê. A tradução para `codigoCompleto` acontece no envio, pela
 * MESMA função que o modal da linha usa — a tela não pode validar por um caminho e enviar por outro.
 * ⚠ Sem sugestão traduzível, o campo nasce VAZIO — nunca "a primeira conta do plano".
 */
export function contasIniciais(itens, contas) {
  const mapa = {};
  for (const item of Array.isArray(itens) ? itens : []) {
    const id = texto(item?.id);
    if (!id) continue;
    mapa[id] = reduzidoDoCompleto(contaQueSeraUsada(item), contas).valor || "";
  }
  return mapa;
}

/**
 * ⚠⚠ A APLICAÇÃO EM MASSA SÓ TOCA AS PENDENTES.
 *
 * Sobrescrever uma conta que o contador escolheu à mão é o estrago silencioso deste modal: ele
 * digita a conta certa em três linhas, aplica "todas as outras" na quarta, e as três voltam para a
 * conta em massa sem nada dizer. É a mesma disciplina do modal de folha do escritório.
 *
 * ⚠ "Pendente" é campo VAZIO. Uma linha com a sugestão pré-preenchida NÃO é pendente — ela já tem
 * uma conta, e o contador a viu.
 */
export function aplicarEmMassa(contasPorLinha, reduzido) {
  const alvo = texto(reduzido);
  const saida = { ...(contasPorLinha || {}) };
  let tocadas = 0;
  for (const id of Object.keys(saida)) {
    if (texto(saida[id])) continue;
    saida[id] = alvo;
    tocadas += 1;
  }
  return { contas: saida, tocadas };
}

/** Quantas linhas ainda não têm conta — o número que o botão de enviar precisa. */
export function pendentes(itens, contasPorLinha) {
  return (Array.isArray(itens) ? itens : []).filter((i) => !texto(contasPorLinha?.[texto(i?.id)])).length;
}

/**
 * ⚠⚠ AS LINHAS QUE SERÃO ENVIADAS, com a conta já traduzida — e o motivo de cada recusa local.
 *
 * ⚠ A tradução é a MESMA de `completoDoReduzido`: uma conta que a tela aceitou tem de ser a mesma
 * que o POST leva. Uma linha cuja conta não traduz NÃO É ENVIADA — mandar `contaAplicada: ""` faria
 * o servidor recusar com `sem_conta`, e a tela descobriria a regra pelo erro.
 */
export function planoDoEnvio(itens, contasPorLinha, contas) {
  const enviar = [];
  const recusadas = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const id = texto(item?.id);
    const reduzido = texto(contasPorLinha?.[id]);
    if (!reduzido) {
      recusadas.push({ item, motivo: "sem_conta" });
      continue;
    }
    const traducao = completoDoReduzido(reduzido, contas);
    if (!traducao.valor) {
      recusadas.push({ item, motivo: traducao.motivo });
      continue;
    }
    enviar.push({ item, contaCompleta: traducao.valor });
  }
  return { enviar, recusadas };
}
