// A REGRA QUE SEPARA "A VENCER" DE "VENCIDA".
//
// Até aqui `statusPagamento === "ABERTO"` bastava para pintar a célula de vermelho, e o mês inteiro
// ficava vermelho no dia 1. Estes testes fixam as três decisões que não podem escorregar: o dia do
// vencimento ainda é prazo, ausência de vencimento não vira atraso, e o total em aberto separa o
// que já venceu do que ainda vai vencer.

import { estadoDaGuia, diasDeAtraso, aparenciaDaGuia, totaisEmAberto, ESTADO_GUIA } from "../estadoGuia";

const HOJE = new Date(2026, 7, 5); // 05/08/2026 — injetado para o teste não depender do relógio
const aberta = (vencimento) => ({ statusPagamento: "ABERTO", valor: 100, sourceGuide: { vencimento } });

describe("estadoDaGuia — o vencimento é o que decide", () => {
  it("em aberto e ainda no prazo: A VENCER, não vencida", () => {
    expect(estadoDaGuia(aberta(new Date(2026, 7, 20)), HOJE)).toBe(ESTADO_GUIA.A_VENCER);
  });

  it("⚠ vence HOJE ainda é a vencer — dá para pagar no dia", () => {
    // Comparar timestamps crus (e não o início do dia) faria a guia do dia nascer vencida às 00:01.
    expect(estadoDaGuia(aberta(new Date(2026, 7, 5, 23, 59)), HOJE)).toBe(ESTADO_GUIA.A_VENCER);
  });

  it("passou do vencimento: VENCIDA", () => {
    expect(estadoDaGuia(aberta(new Date(2026, 6, 20)), HOJE)).toBe(ESTADO_GUIA.VENCIDA);
    expect(diasDeAtraso(aberta(new Date(2026, 6, 20)), HOJE)).toBe(16);
  });

  it("⚠ SEM vencimento não se afirma atraso — cai em ABERTA, neutra", () => {
    // Chutar "vencida" por falta de dado inventa um atraso; chutar "a vencer" esconde um real.
    const r = aparenciaDaGuia(aberta(null), HOJE);
    expect(r.estado).toBe(ESTADO_GUIA.ABERTA);
    expect(r.rotulo).toBe("Em aberto");
    expect(r.titulo).toMatch(/não é conhecido/);
  });

  it("paga e parcial não olham vencimento", () => {
    expect(estadoDaGuia({ statusPagamento: "PAGO", sourceGuide: { vencimento: new Date(2020, 0, 1) } }, HOJE)).toBe(ESTADO_GUIA.PAGA);
    expect(estadoDaGuia({ statusPagamento: "PARCIAL", sourceGuide: { vencimento: new Date(2020, 0, 1) } }, HOJE)).toBe(ESTADO_GUIA.PARCIAL);
  });

  it("provisão prevista (placeholder/template) não é dívida", () => {
    expect(estadoDaGuia({ placeholder: true, statusPagamento: "ABERTO" }, HOJE)).toBe(ESTADO_GUIA.PLACEHOLDER);
    expect(estadoDaGuia({ origem: "TEMPLATE", statusPagamento: "ABERTO" }, HOJE)).toBe(ESTADO_GUIA.PLACEHOLDER);
  });
});

describe("aparenciaDaGuia — a cor nunca viaja sozinha", () => {
  it("vencida é vermelha E diz há quantos dias", () => {
    const r = aparenciaDaGuia(aberta(new Date(2026, 7, 3)), HOJE);
    expect(r.cor).toBe("#FF4757");
    expect(r.rotulo).toBe("Vencida · 2 dias");
  });

  it("a vencer é âmbar E diz a data", () => {
    const r = aparenciaDaGuia(aberta(new Date(2026, 7, 20)), HOJE);
    expect(r.cor).toBe("#FFB347");
    expect(r.rotulo).toBe("A vencer · 20/08");
  });

  it("1 dia de atraso fica no singular", () => {
    expect(aparenciaDaGuia(aberta(new Date(2026, 7, 4)), HOJE).rotulo).toBe("Vencida · 1 dia");
  });
});

describe("totaisEmAberto — somar tudo junto responde a pergunta errada", () => {
  it("separa vencido de a vencer", () => {
    // Um "Total em aberto" único misturaria dívida atrasada com compromisso futuro, e o contador
    // quer saber quanto está ATRASADO.
    const t = totaisEmAberto([
      { statusPagamento: "ABERTO", valor: 300, sourceGuide: { vencimento: new Date(2026, 6, 20) } }, // vencida
      { statusPagamento: "ABERTO", valor: 200, sourceGuide: { vencimento: new Date(2026, 7, 20) } }, // a vencer
      { statusPagamento: "PAGO", valor: 999, sourceGuide: { vencimento: new Date(2026, 6, 1) } },    // fora
    ], HOJE);
    expect(t).toEqual({ aVencer: 200, vencido: 300, parcial: 0, semData: 0 });
  });

  it("⚠ guia SEM vencimento não engorda 'a vencer' — vai para semData", () => {
    // Somá-la em "a vencer" faria o rodapé afirmar um prazo que a célula, logo acima, se recusa a
    // afirmar ("Em aberto — o vencimento não é conhecido"). A mesma tela diria as duas coisas.
    const t = totaisEmAberto([{ statusPagamento: "ABERTO", valor: 400, sourceGuide: {} }], HOJE);
    expect(t.aVencer).toBe(0);
    expect(t.semData).toBe(400);
  });

  it("parcial entra pelo SALDO, não pelo valor cheio", () => {
    // O valor cheio já foi pago em parte; somá-lo cobraria duas vezes o que já saiu do caixa.
    const t = totaisEmAberto([{ statusPagamento: "PARCIAL", valor: 500, saldo: 120 }], HOJE);
    expect(t.parcial).toBe(120);
  });
});
