// A REGRA QUE SEPARA "A VENCER" DE "VENCIDA".
//
// Até aqui `statusPagamento === "ABERTO"` bastava para pintar a célula de vermelho, e o mês inteiro
// ficava vermelho no dia 1. Estes testes fixam as três decisões que não podem escorregar: o dia do
// vencimento ainda é prazo, ausência de vencimento não vira atraso, e o total em aberto separa o
// que já venceu do que ainda vai vencer.
//
// ⚠ AS FIXTURES MUDARAM DE FORMA, E ISSO É O CONSERTO, NÃO ARRUMAÇÃO.
// Elas montavam o vencimento como `new Date(2026, 7, 20)` — objeto `Date` em meia-noite LOCAL, a
// única forma que a produção nunca envia. O backend grava `Guide.vencimento` como **meia-noite
// UTC** e o manda pelo JSON como `"2026-08-20T00:00:00.000Z"`; com a leitura antiga
// (`new Date(v)` + `setHours(0,0,0,0)`) essa string vira o dia 19 em São Paulo. Os testes passavam
// com o código errado porque nunca exerciam o dado real.
//
// ⚠ O `process.env.TZ` é forçado aqui DE PROPÓSITO, num fuso NEGATIVO. Sem isso o teste passa numa
// máquina em UTC e continua quebrado em produção — que é exatamente como o defeito sobreviveu (a
// mesma trava de `apps/api/src/utils/__tests__/dataCivil.test.js`).

import { estadoDaGuia, diasDeAtraso, aparenciaDaGuia, totaisEmAberto, ESTADO_GUIA } from "../estadoGuia";

const TZ_ORIGINAL = process.env.TZ;
process.env.TZ = "America/Sao_Paulo";
afterAll(() => { process.env.TZ = TZ_ORIGINAL; });

/** A FORMA REAL: meia-noite UTC, como o backend grava e manda. */
const venc = (mes, dia) => new Date(Date.UTC(2026, mes - 1, dia)).toISOString();

// `hoje` é um instante de verdade (é `new Date()` em produção), então ele é montado no fuso LOCAL —
// e com hora, para que a leitura não possa "acertar" por acaso comparando meia-noite com meia-noite.
const HOJE = new Date(2026, 7, 5, 14, 30); // 05/08/2026, 14h30 em São Paulo
const aberta = (vencimento) => ({ statusPagamento: "ABERTO", valor: 100, sourceGuide: { vencimento } });

describe("estadoDaGuia — o vencimento é o que decide", () => {
  it("em aberto e ainda no prazo: A VENCER, não vencida", () => {
    expect(estadoDaGuia(aberta(venc(8, 20)), HOJE)).toBe(ESTADO_GUIA.A_VENCER);
  });

  it("⚠ vence HOJE ainda é a vencer — dá para pagar no dia", () => {
    // ⚠ ESTE É O CASO QUE O FUSO QUEBRAVA. `"2026-08-05T00:00:00.000Z"` é 04/08 21h em São Paulo:
    // a leitura antiga ancorava no dia 4 e a guia do dia nascia VENCIDA, com "juros e multa
    // correndo" e o valor no balde "vencido" do rodapé.
    expect(estadoDaGuia(aberta(venc(8, 5)), HOJE)).toBe(ESTADO_GUIA.A_VENCER);
    expect(diasDeAtraso(aberta(venc(8, 5)), HOJE)).toBeNull();
  });

  it("⚠ nem a última hora do dia do vencimento antecipa o atraso", () => {
    // O instante de "hoje" anda o dia todo; o dia civil do vencimento, não.
    expect(estadoDaGuia(aberta(venc(8, 5)), new Date(2026, 7, 5, 23, 59))).toBe(ESTADO_GUIA.A_VENCER);
    expect(estadoDaGuia(aberta(venc(8, 5)), new Date(2026, 7, 5, 0, 1))).toBe(ESTADO_GUIA.A_VENCER);
  });

  it("passou do vencimento: VENCIDA", () => {
    expect(estadoDaGuia(aberta(venc(7, 20)), HOJE)).toBe(ESTADO_GUIA.VENCIDA);
    expect(diasDeAtraso(aberta(venc(7, 20)), HOJE)).toBe(16);
  });

  it("o dia seguinte ao vencimento é 1 dia de atraso — não 2", () => {
    expect(diasDeAtraso(aberta(venc(8, 4)), HOJE)).toBe(1);
  });

  it("⚠ SEM vencimento não se afirma atraso — cai em ABERTA, neutra", () => {
    // Chutar "vencida" por falta de dado inventa um atraso; chutar "a vencer" esconde um real.
    const r = aparenciaDaGuia(aberta(null), HOJE);
    expect(r.estado).toBe(ESTADO_GUIA.ABERTA);
    expect(r.rotulo).toBe("Em aberto");
    expect(r.titulo).toMatch(/não é conhecido/);
  });

  it("paga e parcial não olham vencimento", () => {
    expect(estadoDaGuia({ statusPagamento: "PAGO", sourceGuide: { vencimento: venc(1, 1) } }, HOJE)).toBe(ESTADO_GUIA.PAGA);
    expect(estadoDaGuia({ statusPagamento: "PARCIAL", sourceGuide: { vencimento: venc(1, 1) } }, HOJE)).toBe(ESTADO_GUIA.PARCIAL);
  });

  it("provisão prevista (placeholder/template) não é dívida", () => {
    expect(estadoDaGuia({ placeholder: true, statusPagamento: "ABERTO" }, HOJE)).toBe(ESTADO_GUIA.PLACEHOLDER);
    expect(estadoDaGuia({ origem: "TEMPLATE", statusPagamento: "ABERTO" }, HOJE)).toBe(ESTADO_GUIA.PLACEHOLDER);
  });

  it("⚠ o mesmo vencimento dá a MESMA leitura em qualquer fuso", () => {
    // A tela do contador em São Paulo e a de quem abrir o portal de outro lugar não podem discordar
    // sobre se a guia venceu.
    const vistos = new Set();
    for (const tz of ["UTC", "America/Sao_Paulo", "America/Manaus", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      vistos.add(estadoDaGuia(aberta(venc(8, 5)), new Date(2026, 7, 5, 14, 30)));
    }
    process.env.TZ = "America/Sao_Paulo";
    expect([...vistos]).toEqual([ESTADO_GUIA.A_VENCER]);
  });
});

describe("aparenciaDaGuia — a cor nunca viaja sozinha", () => {
  it("vencida é vermelha E diz há quantos dias", () => {
    const r = aparenciaDaGuia(aberta(venc(8, 3)), HOJE);
    expect(r.cor).toBe("var(--danger)");
    expect(r.rotulo).toBe("Vencida · 2 dias");
  });

  it("a vencer é âmbar E diz a data", () => {
    const r = aparenciaDaGuia(aberta(venc(8, 20)), HOJE);
    expect(r.cor).toBe("#FFB347");
    expect(r.rotulo).toBe("A vencer · 20/08");
  });

  it("⚠ o rótulo do dia 1º não cai para o mês anterior", () => {
    // `"2026-09-01T00:00:00.000Z"` lido no fuso local vira 31/08: muda de DIA e de MÊS.
    expect(aparenciaDaGuia(aberta(venc(9, 1)), HOJE).rotulo).toBe("A vencer · 01/09");
    expect(aparenciaDaGuia(aberta(venc(9, 1)), HOJE).titulo).toContain("vence em 01/09");
  });

  it("1 dia de atraso fica no singular", () => {
    expect(aparenciaDaGuia(aberta(venc(8, 4)), HOJE).rotulo).toBe("Vencida · 1 dia");
  });
});

describe("totaisEmAberto — somar tudo junto responde a pergunta errada", () => {
  it("separa vencido de a vencer", () => {
    // Um "Total em aberto" único misturaria dívida atrasada com compromisso futuro, e o contador
    // quer saber quanto está ATRASADO.
    const t = totaisEmAberto([
      { statusPagamento: "ABERTO", valor: 300, sourceGuide: { vencimento: venc(7, 20) } }, // vencida
      { statusPagamento: "ABERTO", valor: 200, sourceGuide: { vencimento: venc(8, 20) } }, // a vencer
      { statusPagamento: "PAGO", valor: 999, sourceGuide: { vencimento: venc(7, 1) } },    // fora
    ], HOJE);
    expect(t).toEqual({ aVencer: 200, vencido: 300, parcial: 0, semData: 0 });
  });

  it("⚠ a guia que vence HOJE entra em 'a vencer', não em 'vencido'", () => {
    // Era este o balde errado: o rodapé cobrava como atrasado o que ainda dá para pagar no dia.
    const t = totaisEmAberto([{ statusPagamento: "ABERTO", valor: 750, sourceGuide: { vencimento: venc(8, 5) } }], HOJE);
    expect(t.aVencer).toBe(750);
    expect(t.vencido).toBe(0);
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
