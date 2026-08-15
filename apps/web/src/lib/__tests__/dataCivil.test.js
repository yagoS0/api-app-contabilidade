// A DATA CIVIL NÃO PODE ANDAR COM O FUSO DO NAVEGADOR.
//
// ⚠ Estes testes existem por um defeito MEDIDO, não por precaução: o backend já pagou este preço em
// 13/08/2026 (621 lançamentos no export CSV e a data de pagamento no e-mail ao cliente), e o front
// carregava a mesma leitura em três lugares — `cicloObrigacao.js`, `estadoGuia.js` e o `fmtDate`
// aplicado a vencimento.
//
// ⚠ O `process.env.TZ` é forçado aqui DE PROPÓSITO, num fuso NEGATIVO. Sem isso o teste passa numa
// máquina em UTC e continua quebrado em produção — que é exatamente como o defeito sobreviveu.

import { diaCivil, diaCivilDeHoje, diasEntreDiasCivis, diaMesCivil, dataCivilBR } from "../dataCivil";
import { fmtDataCivil, fmtDate } from "../format";

const TZ_ORIGINAL = process.env.TZ;
process.env.TZ = "America/Sao_Paulo";
afterAll(() => { process.env.TZ = TZ_ORIGINAL; });

describe("diaCivil — o dia do fato, não o instante", () => {
  it("⚠ a forma que o backend manda: meia-noite UTC não vira o dia anterior", () => {
    expect(diaCivil("2026-08-20T00:00:00.000Z")).toBe("2026-08-20");
    expect(diaCivil("2026-08-05T00:00:00.000Z")).toBe("2026-08-05");
  });

  it("⚠ o dia 1º NÃO cai para o mês anterior — muda DIA e MÊS", () => {
    // A guia que vence 01/09 era impressa como 31/08.
    expect(diaCivil("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
    expect(diaCivil("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("a data civil crua (o que o calendário passa) atravessa intacta", () => {
    expect(diaCivil("2026-08-20")).toBe("2026-08-20");
  });

  it("`Date` é lido pelos componentes UTC — a forma em que o backend grava", () => {
    expect(diaCivil(new Date("2026-08-20T00:00:00.000Z"))).toBe("2026-08-20");
  });

  it("não depende do fuso do processo — o mesmo valor em quatro fusos dá o mesmo dia", () => {
    const vistos = new Set();
    for (const tz of ["UTC", "America/Sao_Paulo", "America/Manaus", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      vistos.add(diaCivil("2026-08-20T00:00:00.000Z"));
    }
    process.env.TZ = "America/Sao_Paulo";
    expect([...vistos]).toEqual(["2026-08-20"]);
  });

  it("ausência é vazio, nunca 'Invalid Date' nem a data de hoje", () => {
    expect(diaCivil(null)).toBe("");
    expect(diaCivil(undefined)).toBe("");
    expect(diaCivil("")).toBe("");
    expect(diaCivil("nao é data")).toBe("");
  });
});

describe("diaCivilDeHoje — 'hoje' é o dia de quem está olhando a tela", () => {
  it("⚠ lê em LOCAL, não em UTC — senão o dia viraria às 21h em São Paulo", () => {
    expect(diaCivilDeHoje(new Date(2026, 7, 5, 23, 59))).toBe("2026-08-05");
    expect(diaCivilDeHoje(new Date(2026, 7, 5, 0, 1))).toBe("2026-08-05");
  });

  it("aceita a data civil crua que o calendário usa como âncora", () => {
    expect(diaCivilDeHoje("2026-08-05")).toBe("2026-08-05");
    expect(diaCivilDeHoje(new Date("2026-08-05T00:00:00"))).toBe("2026-08-05");
  });
});

describe("diasEntreDiasCivis — dia civil contra dia civil, nunca instante contra instante", () => {
  it("conta dias inteiros, com sinal", () => {
    expect(diasEntreDiasCivis("2026-08-05", "2026-08-05")).toBe(0);
    expect(diasEntreDiasCivis("2026-08-05", "2026-08-20")).toBe(15);
    expect(diasEntreDiasCivis("2026-08-05", "2026-07-20")).toBe(-16);
  });

  it("⚠ atravessa o horário de verão sem meio dia", () => {
    // Diferença de instantes daria 30,96 dias e o arredondamento esconderia o defeito só às vezes.
    expect(diasEntreDiasCivis("2026-10-01", "2026-11-01")).toBe(31);
    expect(diasEntreDiasCivis("2026-02-01", "2026-03-01")).toBe(28);
  });

  it("ausência não vira zero", () => {
    expect(diasEntreDiasCivis("", "2026-08-05")).toBeNull();
    expect(diasEntreDiasCivis("2026-08-05", "")).toBeNull();
  });
});

describe("os formatadores", () => {
  it("diaMesCivil e dataCivilBR não perdem o dia", () => {
    expect(diaMesCivil("2026-09-01T00:00:00.000Z")).toBe("01/09");
    expect(dataCivilBR("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
    expect(diaMesCivil(null)).toBe("");
    expect(dataCivilBR(null)).toBe("");
  });

  it("⚠ `fmtDataCivil` é o vencimento; `fmtDate` continua sendo o TIMESTAMP", () => {
    // Os dois convivem de propósito: `fmtDate` formata criação/envio/liberação, onde o fuso de quem
    // lê é o certo. É por isso que ele NÃO foi mudado — e este teste registra a diferença.
    expect(fmtDataCivil("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
    expect(fmtDate("2026-09-01T00:00:00.000Z")).toBe("31/08/2026");
  });

  it("`fmtDataCivil` devolve o mesmo '-' da ausência que `fmtDate`", () => {
    expect(fmtDataCivil(null)).toBe("-");
    expect(fmtDataCivil("")).toBe("-");
    expect(fmtDataCivil("nao é data")).toBe("-");
  });
});
