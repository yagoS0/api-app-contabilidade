// Q28 Fase 3 — máquina de estados da PARCELA (guia de parcelamento).
// PREVISTA → EM_ATRASO → PAGA_A_CONFERIR → CONFIRMADA  (DIVERGENTE como desvio; CANCELADA encerra).
//
// ⚠ A máquina tem DUAS TABELAS, e a distinção entre elas é o que resolve o conflito antigo.
//
// `TRANSICOES` é o **fluxo de ida**: para onde a parcela pode AVANÇAR sozinha, empurrada pela
// ingestão, pelo relógio ou pelo pagamento. Nele `CONFIRMADA` é terminal — e continua sendo, ao pé
// da letra (`TRANSICOES.CONFIRMADA === []`).
//
// `TRANSICOES_ADMINISTRATIVAS` é o **desfazer**: um ato humano, deliberado, com motivo registrado,
// que reconhece que o fato que levou a parcela até ali deixou de existir. Ele NÃO é um avanço, e
// por isso não cabia na primeira tabela; mas também não podia continuar sendo o que era —
// **exceção de código**, uma função que pulava `podeTransicionar` com um comentário explicando por
// quê. Regra que vive num comentário é regra que o próximo caminho de escrita não consulta.
//
// Hoje o estorno é uma transição NOMEADA e DECLARADA (`podeEstornar` / `estadoAposEstorno`), com
// destino próprio — `ESTORNADA` — em vez de saltar direto para o estado do calendário.

export const PARCELA_ESTADOS = {
  PREVISTA: "PREVISTA",
  EM_ATRASO: "EM_ATRASO",
  PAGA_A_CONFERIR: "PAGA_A_CONFERIR",
  DIVERGENTE: "DIVERGENTE",
  CONFIRMADA: "CONFIRMADA",
  CANCELADA: "CANCELADA",
  /**
   * A baixa desta parcela foi DESFEITA. Estado intermediário: a parcela voltou à fila (a guia
   * volta a `baixada:false`) e segue esperando um novo lançamento de pagamento.
   *
   * ⚠ POR QUE ELE EXISTE, E POR QUE ELE PERSISTE. O estorno antes devolvia a parcela direto ao
   * estado do CALENDÁRIO (`PREVISTA`/`EM_ATRASO`), e o resultado era indistinguível de uma parcela
   * que nunca foi paga. Meses depois, ninguém olhando a linha conseguia responder "esta parcela já
   * teve uma baixa que alguém desfez?" — e essa é exatamente a pergunta que se faz quando o número
   * não bate. `ESTORNADA` responde na própria coluna; o motivo, o autor e a data ficam em
   * `estornos_baixa`.
   *
   * ⚠ ELE NÃO TIRA A PARCELA DA FILA. A fila de pendentes de baixa é `baixada:false` (não
   * `parcelaEstado`), e o estorno restaura isso. A conferência (`PAGA_A_CONFERIR`/`DIVERGENTE`)
   * também não o inclui — correto: não há mais pagamento a conferir.
   */
  ESTORNADA: "ESTORNADA",
};

// Fluxo de IDA — para onde a parcela avança sozinha.
const TRANSICOES = {
  PREVISTA: ["EM_ATRASO", "PAGA_A_CONFERIR", "DIVERGENTE", "CANCELADA"],
  EM_ATRASO: ["PAGA_A_CONFERIR", "DIVERGENTE", "CANCELADA", "PREVISTA"],
  PAGA_A_CONFERIR: ["CONFIRMADA", "DIVERGENTE"],
  DIVERGENTE: ["PAGA_A_CONFERIR", "CONFIRMADA", "CANCELADA"],
  CONFIRMADA: [],
  CANCELADA: [],
  // ⚠ `ESTORNADA` é INTERMEDIÁRIO, não terminal: a parcela volta a ser pagável. O que ela NÃO faz é
  // regredir sozinha para PREVISTA/EM_ATRASO — isso apagaria o rastro do estorno, que é a única
  // razão de o estado existir. Quem a tira de lá é um novo pagamento (ou o cancelamento do acordo).
  ESTORNADA: ["PAGA_A_CONFERIR", "DIVERGENTE", "CANCELADA"],
};

/**
 * Transições ADMINISTRATIVAS — o desfazer, nunca o avançar.
 *
 * ⚠ É a ÚNICA porta de saída de `CONFIRMADA`, e é de propósito: "terminal" descreve o fluxo de
 * ida, não a impossibilidade de corrigir um erro. Uma parcela confirmada por engano ficaria
 * travada para sempre — e a saída de fato existia, escondida numa função que ignorava a tabela.
 *
 * ⚠ `CANCELADA` NÃO ESTÁ AQUI. Parcela cancelada saiu do acordo; ressuscitá-la por um estorno
 * inventaria uma parcela a pagar que ninguém contratou de volta.
 * ⚠ `PREVISTA`/`EM_ATRASO` também não: não há baixa a desfazer numa parcela que nunca foi paga.
 */
const TRANSICOES_ADMINISTRATIVAS = {
  PAGA_A_CONFERIR: ["ESTORNADA"],
  DIVERGENTE: ["ESTORNADA"],
  CONFIRMADA: ["ESTORNADA"],
};

/**
 * @param {string|null} de estado atual (null = sem estado prévio)
 * @param {string} para estado pretendido
 * @param {{administrativa?: boolean}} [opts] `administrativa:true` habilita TAMBÉM a tabela do
 *   desfazer. O default é `false`: nenhum caminho automático estorna nada por acidente.
 */
export function podeTransicionar(de, para, { administrativa = false } = {}) {
  if (!de) return true; // sem estado prévio → aceita o estado inicial
  const permitidas = administrativa
    ? [...(TRANSICOES[de] || []), ...(TRANSICOES_ADMINISTRATIVAS[de] || [])]
    : (TRANSICOES[de] || []);
  return permitidas.includes(para);
}

/** A parcela neste estado pode ter a baixa desfeita? (transição administrativa nomeada) */
export function podeEstornar(estadoAtual) {
  if (!estadoAtual) return false; // guia sem estado de parcela (INSS, DARF) — nada a rebobinar
  return podeTransicionar(estadoAtual, PARCELA_ESTADOS.ESTORNADA, { administrativa: true });
}

// Estado "em aberto" derivado do vencimento: PREVISTA (a vencer) vs EM_ATRASO (vencida).
export function estadoEmAberto(vencimento, now = new Date()) {
  if (!vencimento) return PARCELA_ESTADOS.PREVISTA;
  const d = new Date(vencimento);
  if (Number.isNaN(d.getTime())) return PARCELA_ESTADOS.PREVISTA;
  return d.getTime() < now.getTime() ? PARCELA_ESTADOS.EM_ATRASO : PARCELA_ESTADOS.PREVISTA;
}

/** Os dois estados que dependem do CALENDÁRIO — e só eles podem ser recalculados. */
export const ESTADOS_EM_ABERTO = Object.freeze([PARCELA_ESTADOS.PREVISTA, PARCELA_ESTADOS.EM_ATRASO]);

/**
 * O estado da parcela DEPOIS de a baixa ser desfeita, ou `null` quando não há o que mexer.
 *
 * ⚠ ISTO ERA UMA EXCEÇÃO DE CÓDIGO E VIROU UMA TRANSIÇÃO NOMEADA. A função existia, devolvia o
 * estado do CALENDÁRIO (a vencer × vencida) e **não passava** por `podeTransicionar`, com um
 * comentário explicando que "estorno é rebobinar, não avançar". A observação estava certa; a forma,
 * não: uma regra que só vive num comentário é uma regra que o próximo caminho de escrita não
 * consulta. Hoje o estorno tem tabela própria (`TRANSICOES_ADMINISTRATIVAS`) e destino próprio.
 *
 * ⚠ E O DESTINO NÃO É MAIS O CALENDÁRIO. Devolver a parcela a `PREVISTA`/`EM_ATRASO` a deixava
 * indistinguível de uma parcela que nunca foi paga — o rastro do estorno sumia da linha no mesmo
 * instante em que ele acontecia. O destino é `ESTORNADA`, que diz o que houve e continua na fila.
 *
 * ⚠ `CANCELADA` não volta, e agora isso é DADO, não `if`: ela simplesmente não está na tabela
 * administrativa. Parcela cancelada saiu do acordo; ressuscitá-la por um estorno inventaria uma
 * parcela a pagar que ninguém contratou de volta.
 */
export function estadoAposEstorno({ estadoAtual }) {
  return podeEstornar(estadoAtual) ? PARCELA_ESTADOS.ESTORNADA : null;
}

/**
 * O estado que a parcela DEVERIA ter hoje, ou `null` quando não há nada a mudar.
 *
 * ⚠ ESTE RECÁLCULO NÃO EXISTIA, e a ausência dele é silenciosa da pior forma: `estadoEmAberto` só
 * era chamado UMA VEZ, na ingestão. Uma parcela ingerida antes do vencimento ficava `PREVISTA`
 * para sempre — inclusive meses depois de vencida e não paga. Nenhuma tela mostrava atraso, e o
 * contador de risco de rescisão (que conta prestações não quitadas) nunca teria o que contar.
 *
 * ⚠ SÓ MEXE EM ESTADO EM ABERTO. Parcela paga, confirmada ou cancelada não volta a "em atraso"
 * porque o relógio andou — e `PAGA_A_CONFERIR → EM_ATRASO` nem transição válida é.
 */
export function estadoRecalculado({ estadoAtual, vencimento, agora = new Date() }) {
  if (!ESTADOS_EM_ABERTO.includes(estadoAtual)) return null;
  const novo = estadoEmAberto(vencimento, agora);
  if (novo === estadoAtual) return null;
  // O recálculo respeita a mesma tabela de transições de todo mundo (EM_ATRASO → PREVISTA é
  // legítimo: acontece quando o vencimento é corrigido para frente).
  return podeTransicionar(estadoAtual, novo) ? novo : null;
}
