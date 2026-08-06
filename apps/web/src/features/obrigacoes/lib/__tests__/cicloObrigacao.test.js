// O CICLO DA OBRIGAÇÃO — os quatro estados e o que decide cada um.
//
// O que estes testes protegem é a decisão de NÃO cravar "urgente = 30 dias": o corte sai da janela
// que o próprio escritório declarou (`antecedenciaLembreteDias`). Com 30 dias fixos, uma obrigação
// MENSAL ficaria vermelha o mês inteiro — o paredão que a listagem já teve de desmontar.

import { cicloDaOcorrencia, aparenciaDaOcorrencia, diasAte, CICLO } from "../cicloObrigacao";

const HOJE = new Date(2026, 7, 5); // 05/08/2026
const em = (dias) => ({ dataVencimento: new Date(2026, 7, 5 + dias), status: "PENDENTE" });

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
    expect(cicloDaOcorrencia(em(0), 30, HOJE)).toBe(CICLO.URGENTE);
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

  it("singular no dia 1", () => {
    expect(aparenciaDaOcorrencia(em(1), 30, HOJE).rotulo).toBe("Urgente · 1 dia");
  });
});

describe("diasAte", () => {
  it("compara por DIA, não por hora — 23:59 de hoje ainda é hoje", () => {
    expect(diasAte(new Date(2026, 7, 5, 23, 59), HOJE)).toBe(0);
  });
});
