// A RECUSA DA RESCISÃO — o que este arquivo protege é o `|| 0` não voltar.
//
// O modal lia `parc.saldoRestante` com `Number.isFinite(...) ? ... : 0`. Num contrato sem
// `principalTotal` declarado (o que o wizard produz hoje) isso pré-preenchia as três linhas da
// rescisão com **R$ 0,00** — um formulário que parece pronto, num ato que manda o saldo remanescente
// para a Dívida Ativa da União e restabelece as reduções de multa da adesão.
//
// Pré-preencher zero é pior que recusar: ninguém digita zero por engano, mas todo mundo confirma um
// campo já preenchido.

import {
  baseDaRescisao, valorPorPapelDaRescisao, lerValorDaRescisao, somasDaRescisao,
} from "../rescisaoParcelamento";

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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A LEITURA DO CAMPO — o defeito mais caro do módulo, e ele passava pelas DUAS guardas.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// O modal lia os três campos com `Number(String(v).replace(",", "."))`. Digitando o saldo real de
// um contrato (`12.000` / `10.000` / `2.000`) o rodapé mostrava "Σ Débito 12,00 · Σ Crédito 12,00
// ✓" e a confirmação dizia "R$ 12,00" — porque Σ D e Σ C erram na MESMA proporção, e o piso
// `Σ D < 0,01` é satisfeito por doze reais. O servidor não re-deriva nada; ele grava o que recebe.
//
// ⚠ EXPERIMENTO EXECUTADO (não afirmado): trocando o corpo de `lerValorDaRescisao` de volta pelo
// `Number(String(v).replace(",", "."))` de antes, os dois blocos abaixo ficam com **9 vermelhos**
// (de 22) — `expect(12000)` recebe **12**, `6.900,00` recebe **0**, e `somasDaRescisao` devolve
// Σ D = Σ C = 12 com `desbalanceado: false`, que é o "✓" que o rodapé carimbava. Restaurado, 22
// verdes.
describe("lerValorDaRescisao — a gramática do projeto, não um quarto parser", () => {
  it("⚠ O CASO DO INCIDENTE: `12.000` é doze MIL, não doze reais", () => {
    expect(lerValorDaRescisao("12.000").valor).toBe(12000);
    expect(lerValorDaRescisao("10.000").valor).toBe(10000);
    expect(lerValorDaRescisao("2.000").valor).toBe(2000);
  });

  it("⚠ `6.900,00` valia ZERO com o parser antigo (o `replace` de uma vírgula só produz NaN)", () => {
    const r = lerValorDaRescisao("6.900,00");
    expect(r.ok).toBe(true);
    expect(r.valor).toBe(6900);
  });

  it("as duas formas canônicas do projeto passam, e o resultado é o mesmo número", () => {
    expect(lerValorDaRescisao("1.234,56").valor).toBe(1234.56);
    expect(lerValorDaRescisao("1234,56").valor).toBe(1234.56);
    expect(lerValorDaRescisao("1234.56").valor).toBe(1234.56);
    expect(lerValorDaRescisao("12000").valor).toBe(12000);
  });

  it("número (o pré-preenchimento vem da lib, não da tela) atravessa intacto", () => {
    expect(lerValorDaRescisao(12000).valor).toBe(12000);
    expect(lerValorDaRescisao(4000.5).valor).toBe(4000.5);
  });

  // ⚠ Este é o par do `?? ""` do modal: linha em branco é o estado INICIAL quando o contrato não
  // permite pré-preencher. Ela não é erro — quem recusa a rescisão zerada é o gate `Σ D < 0,01`.
  it("vazio é 0 e NÃO é erro", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = lerValorDaRescisao(v);
      expect(r.ok).toBe(true);
      expect(r.vazio).toBe(true);
      expect(r.valor).toBe(0);
    }
  });

  // ⚠ APERTA A GUARDA: o `num` antigo devolvia 0 para tudo que não entendia.
  it("ilegível deixou de virar 0 — recusa COM MOTIVO", () => {
    for (const v of ["1,234.56", "1.23.4", "abc", "10 x 3"]) {
      const r = lerValorDaRescisao(v);
      expect(r.ok).toBe(false);
      expect(r.valor).toBeNull();
      expect(String(r.mensagem || "").trim()).not.toBe("");
    }
  });
});

describe("somasDaRescisao — os dois gates sobre a leitura CERTA", () => {
  const linhas = (a, b, c) => ([
    { tipoLinha: "PARC", tipo: "D", valor: a },
    { tipoLinha: "PRINCIPAL", tipo: "C", valor: b },
    { tipoLinha: "JUROS", tipo: "C", valor: c },
  ]);

  it("⚠ o lote do incidente vale DOZE MIL, e continua balanceado", () => {
    const s = somasDaRescisao(linhas("12.000", "10.000", "2.000"));
    expect(s.somaD).toBe(12000);
    expect(s.somaC).toBe(12000);
    expect(s.desbalanceado).toBe(false);
    expect(s.semValor).toBe(false);
    expect(s.somasConfiaveis).toBe(true);
  });

  // ⚠ A tolerância continua sendo `>= 0,01`, a MESMA do gate de fechamento. Como toda leitura já
  // vem arredondada a 2 casas (a coluna é `Decimal(18,2)`), na prática ela recusa a partir do
  // primeiro centavo — que é exatamente o que o gate do backend faz.
  it("D ≠ C continua bloqueando — um centavo já basta", () => {
    expect(somasDaRescisao(linhas("12.000", "10.000", "1.999")).desbalanceado).toBe(true);
    expect(somasDaRescisao(linhas("100,00", "99,99", "0,00")).desbalanceado).toBe(true);
    expect(somasDaRescisao(linhas("100,00", "99,99", "0,01")).desbalanceado).toBe(false);
  });

  it("rescisão zerada continua recusada — o gate `Σ D < 0,01` não foi afrouxado", () => {
    expect(somasDaRescisao(linhas("", "", "")).semValor).toBe(true);
    expect(somasDaRescisao(linhas("0", "0", "0")).semValor).toBe(true);
  });

  it("com campo ilegível a soma NÃO é confiável — nada de carimbar ✓", () => {
    const s = somasDaRescisao(linhas("1,234.56", "10.000", "2.000"));
    expect(s.ilegiveis).toBe(1);
    expect(s.somasConfiaveis).toBe(false);
    expect(s.leituras[0].ok).toBe(false);
    expect(s.leituras[1].valor).toBe(10000);
  });

  it("as leituras vêm na ORDEM das linhas — é por elas que a prévia sai embaixo do campo certo", () => {
    const s = somasDaRescisao(linhas("12.000", "10.000", "2.000"));
    expect(s.leituras.map((r) => r.valor)).toEqual([12000, 10000, 2000]);
  });

  it("não quebra sem linha nenhuma", () => {
    expect(somasDaRescisao(null).somaD).toBe(0);
    expect(somasDaRescisao([]).semValor).toBe(true);
  });
});
