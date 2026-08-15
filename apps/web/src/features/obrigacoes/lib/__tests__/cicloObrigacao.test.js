// O CICLO DA OBRIGAÇÃO — os quatro estados e o que decide cada um.
//
// O que estes testes protegem é a decisão de NÃO cravar "urgente = 30 dias": o corte sai da janela
// que o próprio escritório declarou (`antecedenciaLembreteDias`). Com 30 dias fixos, uma obrigação
// MENSAL ficaria vermelha o mês inteiro — o paredão que a listagem já teve de desmontar.
//
// ⚠ AS FIXTURES MUDARAM DE FORMA, E ISSO É O CONSERTO, NÃO ARRUMAÇÃO.
// Elas montavam o vencimento como `new Date(2026, 7, 20)` — objeto `Date` em meia-noite LOCAL, a
// única forma que a produção nunca envia. O backend manda `dataVencimento` como **meia-noite UTC**
// (`"2026-08-20T00:00:00.000Z"`), e o calendário passa a data civil crua (`"2026-08-20"`). Com a
// leitura antiga (`new Date(v)` + `setHours(0,0,0,0)`) as duas viram o dia 19 em São Paulo — a
// obrigação que vence dia 20 aparecia NO DIA 20 como "Vencida · 1 dia".
//
// ⚠ O `process.env.TZ` é forçado aqui DE PROPÓSITO, num fuso NEGATIVO. Sem isso o teste passa numa
// máquina em UTC e continua quebrado em produção — que é exatamente como o defeito sobreviveu (a
// mesma trava de `apps/api/src/utils/__tests__/dataCivil.test.js`).

import { cicloDaOcorrencia, aparenciaDaOcorrencia, diasAte, CICLO } from "../cicloObrigacao";

const TZ_ORIGINAL = process.env.TZ;
process.env.TZ = "America/Sao_Paulo";
afterAll(() => { process.env.TZ = TZ_ORIGINAL; });

// `hoje` é um instante de verdade (é `new Date()` em produção): fuso LOCAL, e com hora, para que a
// leitura não possa "acertar" por acaso comparando meia-noite com meia-noite.
const HOJE = new Date(2026, 7, 5, 14, 30); // 05/08/2026, 14h30 em São Paulo

/** A FORMA REAL: meia-noite UTC, como o backend grava e manda. */
const venc = (dia) => new Date(Date.UTC(2026, 7, dia)).toISOString();
const em = (dias) => ({ dataVencimento: venc(5 + dias), status: "PENDENTE" });

describe("cicloDaOcorrencia", () => {
  it("concluída vence tudo — nem olha a data", () => {
    expect(cicloDaOcorrencia({ ...em(-90), status: "CONCLUIDA" }, 30, HOJE)).toBe(CICLO.CONCLUIDA);
  });

  it("passou do prazo: VENCIDA", () => {
    expect(cicloDaOcorrencia(em(-1), 30, HOJE)).toBe(CICLO.VENCIDA);
  });

  it("fora da janela declarada: AGUARDANDO (cinza, não é trabalho de hoje)", () => {
    expect(cicloDaOcorrencia(em(45), 30, HOJE)).toBe(CICLO.AGUARDANDO);
  });

  it("dentro da janela: ABERTA", () => {
    expect(cicloDaOcorrencia(em(20), 30, HOJE)).toBe(CICLO.ABERTA);
  });

  it("último quarto da janela: URGENTE", () => {
    // Janela de 30 → urgente a partir de 7 dias.
    expect(cicloDaOcorrencia(em(7), 30, HOJE)).toBe(CICLO.URGENTE);
    expect(cicloDaOcorrencia(em(8), 30, HOJE)).toBe(CICLO.ABERTA);
  });

  it("vence HOJE é urgente, não vencida", () => {
    // ⚠ ESTE É O CASO QUE O FUSO QUEBRAVA: `"2026-08-05T00:00:00.000Z"` é 04/08 21h em São Paulo, e
    // a leitura antiga ancorava no dia 4 — a obrigação do dia nascia VENCIDA.
    expect(cicloDaOcorrencia(em(0), 30, HOJE)).toBe(CICLO.URGENTE);
    expect(diasAte(em(0).dataVencimento, HOJE)).toBe(0);
  });

  it("⚠ o corte acompanha a janela DECLARADA — não é 30 dias fixos", () => {
    // Numa MENSAL (lembrete de 5 dias), 20 dias antes ainda é "aguardando". Com o corte fixo de 30
    // do plano, ela nasceria urgente todo mês, o mês inteiro.
    expect(cicloDaOcorrencia(em(20), 5, HOJE)).toBe(CICLO.AGUARDANDO);
    // E na ANUAL com lembrete de 60, os mesmos 20 dias já são urgentes.
    expect(cicloDaOcorrencia(em(20), 60, HOJE)).toBe(CICLO.ABERTA);
    expect(cicloDaOcorrencia(em(14), 60, HOJE)).toBe(CICLO.URGENTE);
  });

  it("piso de 2 dias: janela curta não deixa o urgente sumir", () => {
    // Com janela 5, floor(5/4) = 1 — sem o piso, só o dia do vencimento seria urgente.
    expect(cicloDaOcorrencia(em(2), 5, HOJE)).toBe(CICLO.URGENTE);
  });

  it("⚠ sem data legível NÃO se afirma atraso", () => {
    expect(cicloDaOcorrencia({ dataVencimento: null, status: "PENDENTE" }, 30, HOJE)).toBe(CICLO.ABERTA);
  });

  it("antecedência ausente ou zero cai no default do schema (5)", () => {
    expect(cicloDaOcorrencia(em(10), undefined, HOJE)).toBe(CICLO.AGUARDANDO);
    expect(cicloDaOcorrencia(em(10), 0, HOJE)).toBe(CICLO.AGUARDANDO);
  });

  it("⚠ a data civil crua do calendário é lida igual à ISO do backend", () => {
    // `renderCalendarioGrid` passa `item.data` como `"YYYY-MM-DD"`, e `hoje` como
    // `new Date("YYYY-MM-DDT00:00:00")` — meia-noite LOCAL. As duas formas têm de dar o mesmo dia.
    const hojeDoCalendario = new Date("2026-08-05T00:00:00");
    expect(diasAte("2026-08-05", hojeDoCalendario)).toBe(0);
    expect(diasAte("2026-08-20", hojeDoCalendario)).toBe(15);
    expect(cicloDaOcorrencia({ dataVencimento: "2026-08-20", status: "PENDENTE" }, 30, hojeDoCalendario))
      .toBe(CICLO.ABERTA);
  });

  it("⚠ a tela não pode se contradizer sobre a MESMA obrigação", () => {
    // No calendário, a moldura sai de `estaVencida` (`item.data < hoje`, dia civil × dia civil — e
    // esse estava certo) e o texto sai daqui, via `corDoItem`. Enquanto esta leitura andava um dia,
    // o mesmo chip dizia "Vencida · 1 dia" no rótulo e "não venceu" na moldura.
    const dia = "2026-08-20";
    const hoje = "2026-08-20";
    const molduraDizVencida = dia < hoje; // a leitura do `estaVencida`
    const textoDizVencido = cicloDaOcorrencia({ dataVencimento: dia, status: "PENDENTE" }, 30, new Date(`${hoje}T00:00:00`)) === CICLO.VENCIDA;
    expect(molduraDizVencida).toBe(false);
    expect(textoDizVencido).toBe(false);
  });

  it("⚠ o mesmo vencimento dá a MESMA leitura em qualquer fuso", () => {
    const vistos = new Set();
    for (const tz of ["UTC", "America/Sao_Paulo", "America/Manaus", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      vistos.add(cicloDaOcorrencia({ dataVencimento: venc(5), status: "PENDENTE" }, 30, new Date(2026, 7, 5, 14, 30)));
    }
    process.env.TZ = "America/Sao_Paulo";
    expect([...vistos]).toEqual([CICLO.URGENTE]);
  });
});

describe("aparenciaDaOcorrencia — o rótulo carrega a CONTAGEM", () => {
  it("aberta diz quantos dias faltam", () => {
    expect(aparenciaDaOcorrencia(em(12), 30, HOJE).rotulo).toBe("A entregar · 12 dias");
  });

  it("vencida diz há quantos dias", () => {
    const r = aparenciaDaOcorrencia(em(-3), 30, HOJE);
    expect(r.rotulo).toBe("Vencida · 3 dias");
    expect(r.cor).toBe("#FF5555");
  });

  it("o dia do vencimento tem frase própria", () => {
    expect(aparenciaDaOcorrencia(em(0), 30, HOJE).rotulo).toBe("Vence hoje");
  });

  it("⚠ a véspera NÃO diz 'Vence hoje'", () => {
    // Era o outro lado do mesmo defeito: com a data andando um dia, o dia 19 anunciava o prazo do 20.
    expect(aparenciaDaOcorrencia(em(1), 30, HOJE).rotulo).toBe("Urgente · 1 dia");
  });

  it("singular no dia 1", () => {
    expect(aparenciaDaOcorrencia(em(1), 30, HOJE).rotulo).toBe("Urgente · 1 dia");
  });
});

describe("diasAte", () => {
  it("compara por DIA, não por hora — 23:59 de hoje ainda é hoje", () => {
    expect(diasAte(venc(5), new Date(2026, 7, 5, 23, 59))).toBe(0);
    expect(diasAte(venc(5), new Date(2026, 7, 5, 0, 1))).toBe(0);
  });

  it("⚠ o dia 1º não cai para o mês anterior", () => {
    expect(diasAte("2026-09-01T00:00:00.000Z", new Date(2026, 7, 31, 10, 0))).toBe(1);
  });
});
