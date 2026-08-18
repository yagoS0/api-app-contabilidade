// A TRADUÇÃO DA RECUSA DA BAIXA — o outro lado do 409 nomeado.
//
// O backend parou de devolver 500 `internal_error` quando duas baixas colidem na mesma competência
// de pagamento e passou a devolver **409 `BAIXA_DUPLICADA_NA_COMPETENCIA`**, com a competência, o
// tributo e o conserto por extenso.
//
// ⚠ SEM ENTRADA NO `mapKnownError`, O CÓDIGO VOLTA CRU PARA A TELA. O fallback do final da função
// prefere `payload.message`, então hoje a frase chegaria por acidente — e pararia de chegar no dia
// em que o backend deixasse de mandar `message`, ou em que alguém mexesse na ordem do fallback.
// O contador voltaria a ver `BAIXA_DUPLICADA_NA_COMPETENCIA`, que é a mesma classe de defeito que
// `internal_error`: um código no lugar de uma instrução.

import { mapKnownError } from "../realApi.js";

const RECUSA_DA_COMPETENCIA = {
  error: "BAIXA_DUPLICADA_NA_COMPETENCIA",
  competencia: "2026-08",
  tributo: "DAS",
  message: "mensagem do servidor",
};

describe("BAIXA_DUPLICADA_NA_COMPETENCIA — o defeito relatado", () => {
  it("não devolve o código cru", () => {
    const texto = mapKnownError(RECUSA_DA_COMPETENCIA, 409);
    expect(texto).not.toBe("BAIXA_DUPLICADA_NA_COMPETENCIA");
    expect(texto).not.toMatch(/internal_error/);
  });

  it("nomeia a competência e o tributo do conflito", () => {
    const texto = mapKnownError(RECUSA_DA_COMPETENCIA, 409);
    expect(texto).toContain("2026-08");
    expect(texto).toContain("DAS");
  });

  it("diz O QUE FAZER — informar a data de pagamento real", () => {
    const texto = mapKnownError(RECUSA_DA_COMPETENCIA, 409);
    expect(texto).toMatch(/data de pagamento/i);
  });

  it("explica POR QUE caiu no mês corrente — senão a instrução parece arbitrária", () => {
    const texto = mapKnownError(RECUSA_DA_COMPETENCIA, 409);
    expect(texto).toMatch(/comprovante/i);
  });

  it("⚠ NÃO DEPENDE do `message` do servidor — a tradução é do front", () => {
    // Este é o ponto do teste: tirar o `message` não pode devolver o código cru.
    const semMessage = { ...RECUSA_DA_COMPETENCIA, message: undefined };
    const texto = mapKnownError(semMessage, 409);
    expect(texto).toMatch(/data de pagamento/i);
    expect(texto).toContain("2026-08");
  });

  it("sem competência/tributo no payload, ainda assim não devolve o código cru", () => {
    const texto = mapKnownError({ error: "BAIXA_DUPLICADA_NA_COMPETENCIA" }, 409);
    expect(texto).toMatch(/já existe uma baixa/i);
    expect(texto).not.toBe("BAIXA_DUPLICADA_NA_COMPETENCIA");
  });
});

describe("BAIXA_CONFLITO_UNICIDADE — o irmão genérico (outros uniques da tabela)", () => {
  it("mostra a mensagem do servidor, que nomeia o índice", () => {
    const texto = mapKnownError(
      {
        error: "BAIXA_CONFLITO_UNICIDADE",
        alvo: "uq_baixa_guia_linha",
        message: "Esta baixa de DAS conflita com uma já gravada (uq_baixa_guia_linha).",
      },
      409,
    );
    expect(texto).toContain("uq_baixa_guia_linha");
  });

  it("sem `message`, cai num texto legível — nunca no código", () => {
    const texto = mapKnownError({ error: "BAIXA_CONFLITO_UNICIDADE" }, 409);
    expect(texto).not.toBe("BAIXA_CONFLITO_UNICIDADE");
    expect(texto).toMatch(/conflita/i);
  });
});

describe("⚠ a tradução NOVA não engoliu as que já existiam", () => {
  it("MES_FECHADO continua caindo no fallback com a mensagem do servidor", () => {
    const texto = mapKnownError(
      { error: "MES_FECHADO", competencia: "2026-03", message: "Mês 2026-03 fechado — reabra a empresa antes de dar a baixa." },
      409,
    );
    expect(texto).toMatch(/reabra/i);
  });

  it("um código desconhecido sem `message` continua voltando como está (fallback intacto)", () => {
    expect(mapKnownError({ error: "algo_novo" }, 400)).toBe("algo_novo");
  });
});
