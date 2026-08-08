// A MÁQUINA DE ESTADOS DA PARCELA — que existia e nunca era consultada.
//
// ⚠ Os dois defeitos que estes testes fixam são de OMISSÃO, e por isso não davam erro nenhum:
//   1. `podeTransicionar` nunca era chamado. A ingestão (idempotente, roda de novo na recaptura)
//      escrevia o estado inicial por cima do que houvesse — inclusive por cima de PAGA_A_CONFERIR.
//   2. `estadoEmAberto` só era chamado UMA VEZ, na ingestão. Parcela ingerida antes do vencimento
//      ficava PREVISTA para sempre, mesmo meses depois de vencida e não paga.

import {
  PARCELA_ESTADOS, ESTADOS_EM_ABERTO, podeTransicionar, estadoEmAberto, estadoRecalculado,
  estadoAposEstorno,
} from "../parcelaStateMachine";

const { PREVISTA, EM_ATRASO, PAGA_A_CONFERIR, DIVERGENTE, CONFIRMADA, CANCELADA } = PARCELA_ESTADOS;
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

// ESTORNO — desfazer a baixa devolve a parcela à fila.
//
// ⚠ O defeito que isto cobre: apagar o lançamento de baixa deixava a guia `PAGA_A_CONFERIR` sem
// lançamento nenhum. Fora da fila de pendentes (que exige `baixada:false`) e sem baixa de verdade
// na conferência: invisível nas duas telas, e sem caminho para refazer.
describe("estadoAposEstorno", () => {
  it("⚠ paga a conferir volta ao que o CALENDÁRIO manda — o estorno rebobina, não avança", () => {
    // `podeTransicionar(PAGA_A_CONFERIR, EM_ATRASO)` é false de propósito (é a guarda da
    // reingestão). Desfazer a baixa é outra pergunta, e por isso não passa por lá.
    expect(podeTransicionar(PAGA_A_CONFERIR, EM_ATRASO)).toBe(false);
    expect(estadoAposEstorno({ estadoAtual: PAGA_A_CONFERIR, vencimento: ONTEM, agora: HOJE })).toBe(EM_ATRASO);
    expect(estadoAposEstorno({ estadoAtual: PAGA_A_CONFERIR, vencimento: AMANHA, agora: HOJE })).toBe(PREVISTA);
  });

  it("parcela já CONFIRMADA na conferência também volta — senão fica travada para sempre", () => {
    expect(estadoAposEstorno({ estadoAtual: CONFIRMADA, vencimento: ONTEM, agora: HOJE })).toBe(EM_ATRASO);
    expect(estadoAposEstorno({ estadoAtual: DIVERGENTE, vencimento: AMANHA, agora: HOJE })).toBe(PREVISTA);
  });

  it("⚠ CANCELADA não ressuscita pela porta dos fundos de um DELETE", () => {
    expect(estadoAposEstorno({ estadoAtual: CANCELADA, vencimento: ONTEM, agora: HOJE })).toBeNull();
  });

  it("guia que não é parcela (INSS, DARF) não tem estado — devolve null", () => {
    expect(estadoAposEstorno({ estadoAtual: null, vencimento: ONTEM, agora: HOJE })).toBeNull();
  });

  it("já no estado certo devolve null (não reescreve à toa)", () => {
    expect(estadoAposEstorno({ estadoAtual: EM_ATRASO, vencimento: ONTEM, agora: HOJE })).toBeNull();
    expect(estadoAposEstorno({ estadoAtual: PREVISTA, vencimento: AMANHA, agora: HOJE })).toBeNull();
  });
});
