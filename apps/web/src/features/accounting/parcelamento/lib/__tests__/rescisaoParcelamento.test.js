// A RECUSA DA RESCISÃO — o que este arquivo protege é o `|| 0` não voltar.
//
// O modal lia `parc.saldoRestante` com `Number.isFinite(...) ? ... : 0`. Num contrato sem
// `principalTotal` declarado (o que o wizard produz hoje) isso pré-preenchia as três linhas da
// rescisão com **R$ 0,00** — um formulário que parece pronto, num ato que manda o saldo remanescente
// para a Dívida Ativa da União e restabelece as reduções de multa da adesão.
//
// Pré-preencher zero é pior que recusar: ninguém digita zero por engano, mas todo mundo confirma um
// campo já preenchido.

import { baseDaRescisao, valorPorPapelDaRescisao } from "../rescisaoParcelamento";

/** Contrato como `listParcelamentos` o devolve DEPOIS da correção de `decorateParcelamento`. */
const CONTRATO = {
  id: "parc1",
  numParcelas: 60,
  parcelasPagas: 20,
  jurosTotal: 6000,
  principalPorParcela: 200,
  principalPago: 4000,
  saldoContratual: 8000,
  saldoPassivo: 12000,
};

describe("quando o contrato diz quanto falta", () => {
  it("pré-preenche principal, juros proporcional e o total que fecha D=C", () => {
    const b = baseDaRescisao(CONTRATO);
    expect(b.podePrePreencher).toBe(true);
    expect(b.principalRemanescente).toBe(8000);
    expect(b.jurosRemanescente).toBe(4000);   // 6.000 × 40/60
    expect(b.totalRemanescente).toBe(12000);  // = principal + juros, por construção
  });

  it("os papéis saem com os valores, e a identidade PARC = PRINCIPAL + JUROS se mantém", () => {
    const v = valorPorPapelDaRescisao(baseDaRescisao(CONTRATO));
    expect(v.PARC).toBe(12000);
    expect(v.PRINCIPAL).toBe(8000);
    expect(v.JUROS).toBe(4000);
    expect(v.PARC).toBe(v.PRINCIPAL + v.JUROS);
  });

  it("sem `jurosTotal`, o juros remanescente é ZERO — e aí zero É a resposta", () => {
    // ⚠ A distinção que este teste fixa: o cabeçalho DECLAROU que não há juros. Isso não é o mesmo
    // que não saber quanto é o principal, e por isso um vira 0 e o outro vira recusa.
    const b = baseDaRescisao({ ...CONTRATO, jurosTotal: null });
    expect(b.podePrePreencher).toBe(true);
    expect(b.jurosRemanescente).toBe(0);
    expect(b.totalRemanescente).toBe(8000);
  });
});

describe("⚠ quando NÃO se sabe quanto falta — a recusa", () => {
  it("`saldoContratual: null` recusa o pré-preenchimento e diz por quê", () => {
    const b = baseDaRescisao({ ...CONTRATO, saldoContratual: null });
    expect(b.podePrePreencher).toBe(false);
    expect(b.principalRemanescente).toBeNull();
    expect(b.motivo).toMatch(/principal/i);
    // A mensagem tem de nomear a SAÍDA, não só o problema.
    expect(b.motivo).toMatch(/à mão|corrija/i);
  });

  it("⚠ nenhum papel vem com zero — vêm todos VAZIOS (`null`), exceto a multa", () => {
    const v = valorPorPapelDaRescisao(baseDaRescisao({ ...CONTRATO, saldoContratual: null }));
    expect(v.PARC).toBeNull();
    expect(v.PRINCIPAL).toBeNull();
    expect(v.JUROS).toBeNull();
    expect(v.MULTA).toBeNull();
  });

  it("o nome ANTIGO não ressuscita o zero: `saldoRestante` não é lido", () => {
    // Se a lib voltasse a ler `saldoRestante`, este contrato pré-preencheria 9.999 — e é exatamente
    // o número errado (consolidado menos um principal inflado) que a correção tirou de circulação.
    const b = baseDaRescisao({ ...CONTRATO, saldoContratual: null, saldoRestante: 9999 });
    expect(b.podePrePreencher).toBe(false);
    expect(b.principalRemanescente).toBeNull();
  });

  it("`0` continua sendo uma resposta legítima, e NÃO cai na recusa", () => {
    const b = baseDaRescisao({ ...CONTRATO, saldoContratual: 0, jurosTotal: 0 });
    expect(b.podePrePreencher).toBe(true);
    expect(b.principalRemanescente).toBe(0);
  });
});

describe("o passivo do razão é CONFERÊNCIA, nunca bloqueio", () => {
  it("avisa quando o razão e o contrato discordam", () => {
    const b = baseDaRescisao({ ...CONTRATO, saldoPassivo: 14754.85 });
    expect(b.podePrePreencher).toBe(true);          // ⚠ segue liberado
    expect(b.avisoDivergencia).toMatch(/2\.754,85/);
    expect(b.avisoDivergencia).toMatch(/Parcelamento a Pagar/);
  });

  it("batendo, não há aviso nenhum", () => {
    expect(baseDaRescisao(CONTRATO).avisoDivergencia).toBeNull();
  });

  it("`saldoPassivo: null` (o V1, sem linha de papel PARC) não inventa divergência", () => {
    // Ausência de leitura do razão não é prova de divergência — o mesmo motivo pelo qual
    // `saldoPassivo` é `null` em vez de 0 lá atrás.
    expect(baseDaRescisao({ ...CONTRATO, saldoPassivo: null }).avisoDivergencia).toBeNull();
  });
});
