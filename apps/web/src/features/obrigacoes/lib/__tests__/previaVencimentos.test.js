// A PRÉVIA NÃO ANUNCIA DATA QUE JÁ PASSOU.
//
// O caso reproduzido no navegador, e que dá o nome ao arquivo: em **16/08/2026**, cadastrar uma
// obrigação com vencimento no dia **15** anunciava *"Próximos vencimentos: 14/08/2026 · 15/09 ·
// 15/10"* — a primeira data no passado — e, ao salvar, as empresas do escopo apareciam com
// "Vencida · 14/08/2026" em vermelho, no primeiro segundo de vida da regra.
//
// (15/08/2026 é sábado; com ANTECIPAR o vencimento cai em sexta, 14/08.)

import { calcularPreviaVencimentos } from "../previaVencimentos";

const HOJE = new Date("2026-08-16T09:30:00Z"); // domingo, o dia seguinte ao vencimento

describe("calcularPreviaVencimentos — o passado não é 'próximo vencimento'", () => {
  it("⚠ MENSAL dia 15 em 16/08: a lista começa em SETEMBRO", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 15, ajusteDiaUtil: "ANTECIPAR" },
      HOJE,
    );
    expect(p.proximas).toEqual(["2026-09-15", "2026-10-15", "2026-11-13"]);
    expect(p.proximas).not.toContain("2026-08-14");
  });

  it("⚠ a data que passou é DITA, à parte — sumir com ela esconderia por que setembro é o próximo", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 15, ajusteDiaUtil: "ANTECIPAR" },
      HOJE,
    );
    expect(p.jaVencida).toBe("2026-08-14");
  });

  it("vencimento AINDA no mês corrente continua sendo o primeiro da lista", () => {
    // Dia 20 visto do dia 16: não passou, então nada muda em relação ao comportamento anterior.
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 20, ajusteDiaUtil: "ANTECIPAR" },
      HOJE,
    );
    expect(p.proximas[0]).toBe("2026-08-20");
    expect(p.jaVencida).toBeNull();
  });

  it("vencimento HOJE não é passado — o corte é a data, não o instante", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 16, ajusteDiaUtil: "MANTER" },
      HOJE,
    );
    expect(p.proximas[0]).toBe("2026-08-16");
    expect(p.jaVencida).toBeNull();
  });

  it("TRIMESTRAL perde só a ocorrência vencida, e o ciclo segue de 3 em 3", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "TRIMESTRAL", mesReferencia: 8, diaVencimento: 15, ajusteDiaUtil: "ANTECIPAR" },
      HOJE,
    );
    expect(p.jaVencida).toBe("2026-08-14");
    expect(p.proximas[0]).toBe("2026-11-13");
  });

  it("⚠ ANUAL do mês corrente já vencido mostra a do ANO QUE VEM — não fica sem prazo nenhum", () => {
    // "Não tem vencimento" é pior que "o próximo é daqui a um ano": some da tela quem não deve
    // nada, e aí ninguém sabe se foi dispensa ou esquecimento.
    const p = calcularPreviaVencimentos(
      { periodicidade: "ANUAL", mesReferencia: 8, diaVencimento: 15, ajusteDiaUtil: "ANTECIPAR" },
      HOJE,
    );
    expect(p.jaVencida).toBe("2026-08-14");
    expect(p.proximas).toEqual(["2027-08-13"]);
  });

  it("MANTER não move a data, nem para fugir do sábado", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 15, ajusteDiaUtil: "MANTER" },
      HOJE,
    );
    expect(p.proximas[0]).toBe("2026-09-15");
    expect(p.jaVencida).toBe("2026-08-15");
  });

  it("POSTERGAR empurra o sábado para segunda — e aí o mês corrente NÃO venceu", () => {
    // O ajuste de dia útil decide antes do corte: 15/08 é sábado, POSTERGAR leva a 17/08, que
    // ainda está à frente de 16/08. Cortar pela data crua diria "já venceu" sobre um prazo que
    // ainda não chegou.
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 15, ajusteDiaUtil: "POSTERGAR" },
      HOJE,
    );
    expect(p.jaVencida).toBeNull();
    expect(p.proximas[0]).toBe("2026-08-17");
  });

  it("dia 31 não transborda para o mês seguinte", () => {
    const p = calcularPreviaVencimentos(
      { periodicidade: "MENSAL", diaVencimento: 31, ajusteDiaUtil: "MANTER" },
      new Date("2027-01-05T00:00:00Z"),
    );
    expect(p.proximas).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
});
