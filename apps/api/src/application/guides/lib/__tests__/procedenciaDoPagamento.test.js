// DE ONDE VEIO A AFIRMAÇÃO DE QUE A GUIA FOI PAGA — e até onde ela alcança.
//
// ⚠⚠ O que este arquivo protege é o RAZÃO. `GuideToProvisionService` deriva `isPaid` de
// `guide.paymentStatus` e grava `statusPagamento: "PAGO"` na PROVISÃO CONTÁBIL. Com o cliente
// podendo confirmar, sem a guarda ele passaria a marcar lançamento contábil como pago — sem baixa
// lançada e sem ninguém do escritório ter decidido isso.

import {
  PROCEDENCIA_PAGAMENTO, estaPaga, procedenciaDoPagamento,
  pagamentoAlcancaOContabil, leituraDoPagamento,
} from "../procedenciaDoPagamento.js";

const paga = (source) => ({ paymentStatus: "PAID", paymentStatusSource: source });

describe("⚠⚠ A GUARDA — a confirmação do CLIENTE não chega ao lançamento contábil", () => {
  it("SERPRO alcança: o comprovante existe", () => {
    expect(pagamentoAlcancaOContabil(paga("SERPRO"))).toBe(true);
  });

  it("MANUAL alcança: é o contador afirmando, e ele responde pela contabilidade", () => {
    expect(pagamentoAlcancaOContabil(paga("MANUAL"))).toBe(true);
  });

  it("⚠⚠ CLIENTE **NÃO** alcança — marca a guia e para aí", () => {
    // Pedido literal do dono: *"o cliente confirmar deve ser como a confirmação da consulta de
    // pagamento"*. Quem faz a baixa continua sendo o contador, pela Circular.
    expect(pagamentoAlcancaOContabil(paga("CLIENTE"))).toBe(false);
  });

  it("⚠⚠ PROCEDÊNCIA AUSENTE ALCANÇA — e isso é deliberado", () => {
    // `paymentStatusSource` é `String?` sem default, e há guias PAGAS anteriores à coluna. Tratar
    // ausência como "cliente" faria a provisão de linha ANTIGA deixar de ser marcada paga —
    // mudaria contabilidade já fechada por causa de um campo que ninguém preencheu.
    for (const v of [null, undefined, ""]) {
      expect(pagamentoAlcancaOContabil({ paymentStatus: "PAID", paymentStatusSource: v })).toBe(true);
    }
    expect(pagamentoAlcancaOContabil({ paymentStatus: "PAID" })).toBe(true);
  });

  it("⚠ valor desconhecido também alcança — falha para o COMPORTAMENTO ANTIGO", () => {
    // Só `CLIENTE`, dito com todas as letras, bloqueia. Um valor novo não pode parar a
    // contabilidade sem ninguém ter decidido isso.
    expect(pagamentoAlcancaOContabil(paga("COISA_NOVA"))).toBe(true);
  });

  it("guia NÃO paga não alcança nada", () => {
    expect(pagamentoAlcancaOContabil({ paymentStatus: "OPEN", paymentStatusSource: "SERPRO" })).toBe(false);
    expect(pagamentoAlcancaOContabil({})).toBe(false);
    expect(pagamentoAlcancaOContabil()).toBe(false);
  });

  it("caixa não muda a resposta", () => {
    expect(estaPaga({ paymentStatus: "paid" })).toBe(true);
    expect(pagamentoAlcancaOContabil({ paymentStatus: "paid", paymentStatusSource: "cliente" })).toBe(false);
  });
});

describe("⚠ A PROCEDÊNCIA — três valores, e nada fora deles", () => {
  it("os três são reconhecidos", () => {
    for (const p of Object.values(PROCEDENCIA_PAGAMENTO)) {
      expect(procedenciaDoPagamento({ paymentStatusSource: p })).toBe(p);
    }
  });

  it("⚠ valor fora da lista devolve `null`, nunca um dos três", () => {
    for (const v of ["FIRM", "portal", "", null, undefined, "constructor"]) {
      expect(procedenciaDoPagamento({ paymentStatusSource: v })).toBeNull();
    }
  });
});

describe("⚠⚠ A LEITURA DA TELA — e só UMA das três é PROVA", () => {
  it("SERPRO é prova; as outras duas são afirmações de pessoas", () => {
    expect(leituraDoPagamento(paga("SERPRO")).ehProva).toBe(true);
    expect(leituraDoPagamento(paga("MANUAL")).ehProva).toBe(false);
    expect(leituraDoPagamento(paga("CLIENTE")).ehProva).toBe(false);
  });

  it("⚠⚠ a do CLIENTE diz as DUAS coisas: é afirmação, e NÃO lançou baixa", () => {
    // Sem isso o contador lê "pago" e fecha o mês.
    const l = leituraDoPagamento(paga("CLIENTE"));
    expect(l.rotulo).toBe("o cliente confirmou");
    expect(l.detalhe).toMatch(/afirmação dele, não um comprovante/i);
    expect(l.detalhe).toMatch(/não lançou a baixa contábil/i);
    expect(l.alcancaOContabil).toBe(false);
  });

  it("⚠ os três rótulos são DISTINTOS — hoje a tela imprime o mesmo ✓ para todos", () => {
    const rotulos = Object.values(PROCEDENCIA_PAGAMENTO).map((p) => leituraDoPagamento(paga(p)).rotulo);
    expect(new Set(rotulos).size).toBe(3);
    for (const r of rotulos) expect(String(r).length).toBeGreaterThan(8);
  });

  it("⚠⚠ procedência DESCONHECIDA não vira 'o cliente confirmou' nem 'o contador marcou'", () => {
    // Inventar quem disse o quê é pior que dizer que não se sabe.
    const l = leituraDoPagamento({ paymentStatus: "PAID" });
    expect(l.procedencia).toBeNull();
    expect(l.rotulo).toBe("pagamento confirmado");
    expect(l.detalhe).toMatch(/Não há registro de quem confirmou/i);
    // ⚠ E ela continua alcançando o contábil — é linha antiga.
    expect(l.alcancaOContabil).toBe(true);
  });

  it("guia não paga não tem procedência — não há pagamento afirmado", () => {
    expect(leituraDoPagamento({ paymentStatus: "OPEN" })).toBeNull();
    expect(leituraDoPagamento()).toBeNull();
  });
});
