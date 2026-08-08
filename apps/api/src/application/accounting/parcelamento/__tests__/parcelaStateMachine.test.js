// A MÁQUINA DE ESTADOS DA PARCELA — que existia e nunca era consultada.
//
// ⚠ Os dois defeitos que estes testes fixam são de OMISSÃO, e por isso não davam erro nenhum:
//   1. `podeTransicionar` nunca era chamado. A ingestão (idempotente, roda de novo na recaptura)
//      escrevia o estado inicial por cima do que houvesse — inclusive por cima de PAGA_A_CONFERIR.
//   2. `estadoEmAberto` só era chamado UMA VEZ, na ingestão. Parcela ingerida antes do vencimento
//      ficava PREVISTA para sempre, mesmo meses depois de vencida e não paga.

import {
  PARCELA_ESTADOS, ESTADOS_EM_ABERTO, podeTransicionar, estadoEmAberto, estadoRecalculado,
  estadoAposEstorno, podeEstornar,
} from "../parcelaStateMachine";

const {
  PREVISTA, EM_ATRASO, PAGA_A_CONFERIR, DIVERGENTE, CONFIRMADA, CANCELADA, ESTORNADA,
} = PARCELA_ESTADOS;
const ONTEM = new Date("2026-08-06T12:00:00Z");
const HOJE = new Date("2026-08-07T12:00:00Z");
const AMANHA = new Date("2026-08-08T12:00:00Z");

describe("podeTransicionar", () => {
  it("⚠ RECUSA voltar de paga para em aberto — o defeito da reingestão", () => {
    // Era este o estrago: a recaptura rebaixava a parcela e o pagamento sumia da fila de
    // conferência, sem erro, sem log, sem nada.
    expect(podeTransicionar(PAGA_A_CONFERIR, PREVISTA)).toBe(false);
    expect(podeTransicionar(PAGA_A_CONFERIR, EM_ATRASO)).toBe(false);
    expect(podeTransicionar(CONFIRMADA, PREVISTA)).toBe(false);
  });

  it("sem estado prévio, aceita o inicial", () => {
    expect(podeTransicionar(null, PREVISTA)).toBe(true);
    expect(podeTransicionar(undefined, EM_ATRASO)).toBe(true);
  });

  it("CONFIRMADA e CANCELADA são terminais", () => {
    expect(podeTransicionar(CONFIRMADA, CONFIRMADA)).toBe(false);
    expect(podeTransicionar(CANCELADA, PAGA_A_CONFERIR)).toBe(false);
  });

  it("o caminho normal e o desvio por divergência seguem abertos", () => {
    expect(podeTransicionar(PREVISTA, EM_ATRASO)).toBe(true);
    expect(podeTransicionar(EM_ATRASO, PAGA_A_CONFERIR)).toBe(true);
    expect(podeTransicionar(PAGA_A_CONFERIR, CONFIRMADA)).toBe(true);
    expect(podeTransicionar(PAGA_A_CONFERIR, DIVERGENTE)).toBe(true);
    expect(podeTransicionar(DIVERGENTE, CONFIRMADA)).toBe(true);
  });
});

describe("estadoRecalculado", () => {
  it("⚠ parcela vencida e não paga deixa de ficar PREVISTA para sempre", () => {
    // O caso que mantinha o contador de risco de rescisão eternamente em zero.
    expect(estadoRecalculado({ estadoAtual: PREVISTA, vencimento: ONTEM, agora: HOJE })).toBe(EM_ATRASO);
  });

  it("parcela ainda a vencer não é tocada", () => {
    expect(estadoRecalculado({ estadoAtual: PREVISTA, vencimento: AMANHA, agora: HOJE })).toBeNull();
  });

  it("já EM_ATRASO e continua vencida: nada a fazer (null, não uma reescrita)", () => {
    // Devolver o mesmo estado faria o lote gravar linha por linha sem mudar nada.
    expect(estadoRecalculado({ estadoAtual: EM_ATRASO, vencimento: ONTEM, agora: HOJE })).toBeNull();
  });

  it("vencimento corrigido para frente devolve a parcela a PREVISTA", () => {
    expect(estadoRecalculado({ estadoAtual: EM_ATRASO, vencimento: AMANHA, agora: HOJE })).toBe(PREVISTA);
  });

  it("⚠ estado que NÃO é em aberto nunca é recalculado", () => {
    // Parcela paga não volta a "em atraso" porque o relógio andou.
    for (const estado of [PAGA_A_CONFERIR, DIVERGENTE, CONFIRMADA, CANCELADA]) {
      expect(estadoRecalculado({ estadoAtual: estado, vencimento: ONTEM, agora: HOJE })).toBeNull();
    }
  });

  it("sem vencimento, fica PREVISTA (ausência de data não é atraso)", () => {
    expect(estadoEmAberto(null, HOJE)).toBe(PREVISTA);
    expect(estadoRecalculado({ estadoAtual: PREVISTA, vencimento: null, agora: HOJE })).toBeNull();
    expect(estadoRecalculado({ estadoAtual: EM_ATRASO, vencimento: "não é data", agora: HOJE })).toBe(PREVISTA);
  });

  it("os estados em aberto são só dois", () => {
    expect(ESTADOS_EM_ABERTO).toEqual([PREVISTA, EM_ATRASO]);
  });
});

// ESTORNO — a transição ADMINISTRATIVA, agora nomeada e declarada.
//
// ⚠ O QUE MUDOU AQUI, E POR QUÊ. `estadoAposEstorno` existia, devolvia o estado do CALENDÁRIO e
// **pulava** `podeTransicionar` com um comentário explicando que "estorno é rebobinar, não avançar".
// A observação estava certa; a forma, não — regra que vive num comentário é regra que o próximo
// caminho de escrita não consulta. Duas coisas foram promovidas a DADO:
//
//   1. `TRANSICOES_ADMINISTRATIVAS`, uma tabela própria para o desfazer. É por ela que `CONFIRMADA`
//      tem saída, sem que "CONFIRMADA é terminal" deixe de ser verdade no fluxo de IDA.
//   2. `ESTORNADA`, um estado de destino próprio. O salto direto para PREVISTA/EM_ATRASO deixava a
//      parcela estornada indistinguível de uma que nunca foi paga — o rastro do estorno sumia no
//      instante em que ele acontecia.
describe("transição administrativa (estorno)", () => {
  it("⚠ CONFIRMADA continua terminal NO FLUXO DE IDA — e é isso que o estado ESTORNADA preserva", () => {
    // A afirmação antiga ("CONFIRMADA é terminal") continua literalmente verdadeira aqui...
    expect(podeTransicionar(CONFIRMADA, ESTORNADA)).toBe(false);
    expect(podeTransicionar(CONFIRMADA, PREVISTA)).toBe(false);
    // ...e a saída existe, declarada, só pela porta administrativa.
    expect(podeTransicionar(CONFIRMADA, ESTORNADA, { administrativa: true })).toBe(true);
  });

  it("o default de `podeTransicionar` é NÃO administrativo — nenhum caminho automático estorna sem pedir", () => {
    for (const de of [PAGA_A_CONFERIR, DIVERGENTE, CONFIRMADA]) {
      expect(podeTransicionar(de, ESTORNADA)).toBe(false);
      expect(podeTransicionar(de, ESTORNADA, { administrativa: true })).toBe(true);
    }
  });

  it("o flag administrativo NÃO abre o fluxo de ida — ele só ACRESCENTA o desfazer", () => {
    // Se o flag liberasse a tabela inteira, a reingestão passaria a poder rebaixar uma parcela paga
    // — o defeito que `podeTransicionar` existe para impedir.
    expect(podeTransicionar(PAGA_A_CONFERIR, PREVISTA, { administrativa: true })).toBe(false);
    expect(podeTransicionar(CONFIRMADA, PAGA_A_CONFERIR, { administrativa: true })).toBe(false);
  });

  it("⚠ ESTORNADA é INTERMEDIÁRIO: sai para um novo pagamento, não regride sozinha", () => {
    expect(podeTransicionar(ESTORNADA, PAGA_A_CONFERIR)).toBe(true);
    expect(podeTransicionar(ESTORNADA, CANCELADA)).toBe(true);
    // Voltar a PREVISTA/EM_ATRASO apagaria o rastro, que é a única razão de o estado existir.
    expect(podeTransicionar(ESTORNADA, PREVISTA, { administrativa: true })).toBe(false);
    expect(podeTransicionar(ESTORNADA, EM_ATRASO, { administrativa: true })).toBe(false);
  });

  it("⚠ e o relógio não a move: `estadoRecalculado` só toca os dois estados EM ABERTO", () => {
    expect(estadoRecalculado({ estadoAtual: ESTORNADA, vencimento: ONTEM, agora: HOJE })).toBeNull();
    expect(ESTADOS_EM_ABERTO).not.toContain(ESTORNADA);
  });
});

describe("estadoAposEstorno", () => {
  it("paga a conferir, divergente e confirmada vão para ESTORNADA", () => {
    for (const de of [PAGA_A_CONFERIR, DIVERGENTE, CONFIRMADA]) {
      expect(estadoAposEstorno({ estadoAtual: de })).toBe(ESTORNADA);
      expect(podeEstornar(de)).toBe(true);
    }
  });

  it("⚠ CANCELADA não ressuscita — e agora isso é DADO, não um `if`", () => {
    // Parcela cancelada saiu do acordo; ressuscitá-la por um estorno inventaria uma parcela a pagar
    // que ninguém contratou de volta. Ela simplesmente não está na tabela administrativa.
    expect(podeEstornar(CANCELADA)).toBe(false);
    expect(estadoAposEstorno({ estadoAtual: CANCELADA })).toBeNull();
  });

  it("parcela que nunca foi paga não tem baixa a desfazer", () => {
    expect(estadoAposEstorno({ estadoAtual: PREVISTA })).toBeNull();
    expect(estadoAposEstorno({ estadoAtual: EM_ATRASO })).toBeNull();
  });

  it("guia que não é parcela (INSS, DARF) não tem estado — devolve null", () => {
    expect(podeEstornar(null)).toBe(false);
    expect(estadoAposEstorno({ estadoAtual: null })).toBeNull();
  });

  it("⚠ NÃO depende mais do vencimento — o destino é o rastro, não o calendário", () => {
    // Chamadas antigas passavam `vencimento`/`agora`; ignorá-los é intencional, e este teste é o
    // que impede alguém de "restaurar" o comportamento antigo sem perceber o que ele apagava.
    expect(estadoAposEstorno({ estadoAtual: CONFIRMADA, vencimento: ONTEM, agora: HOJE })).toBe(ESTORNADA);
    expect(estadoAposEstorno({ estadoAtual: CONFIRMADA, vencimento: AMANHA, agora: HOJE })).toBe(ESTORNADA);
  });
});
