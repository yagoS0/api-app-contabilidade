// ⚠⚠ O MODO `real_with_mock_fallback` NÃO PODE INVENTAR SUCESSO — medido em 19/08/2026.
//
// O fallback existe para **backend fora do ar** (rede caiu, porta vazia, 5xx de proxy). A regra
// era só `status >= 500`, e há recusas DELIBERADAS do backend nessa faixa — o mock atendia no
// lugar delas e a tela mostrava um desfecho que não aconteceu:
//
//   • `503 danfse_sem_qrcode` ⇒ o mock devolvia um PDF válido. É exatamente o documento inválido
//     servido em silêncio que esse 503 existe para impedir (NT 008 §2.2 e §2.4.3).
//   • `502` da camada TRANSPORTE da emissão ⇒ desfecho DESCONHECIDO (a DPS pode ter sido
//     processada) virava `status: "issued"` na tela do cliente.
//   • `503 mail_not_configured` ⇒ o app dizia que o e-mail de redefinição foi enviado.
//
// O que separa "o servidor recusou" de "não há servidor" é o CORPO: `pedir()` só preenche `code`
// quando o backend respondeu o nosso JSON. Backend fora do ar não responde `{ error: "..." }`.
//
// ⚠ NADA AQUI TOCA A REDE: as duas implementações são simuladas.

const chamadas = { real: [], mock: [] };

jest.mock("../real/realApi", () => ({
  createRealApi: () => ({
    fetchDanfseBlob: async () => {
      chamadas.real.push("fetchDanfseBlob");
      throw Object.assign(new Error("sem QR Code"), { status: 503, code: "danfse_sem_qrcode" });
    },
    emitirNfse: async () => {
      chamadas.real.push("emitirNfse");
      throw Object.assign(new Error("timeout"), { status: 502, code: "nfse_transporte", camada: "TRANSPORTE" });
    },
    getInvoices: async () => {
      chamadas.real.push("getInvoices");
      // 502 de PROXY: nenhum corpo nosso, logo nenhum `code`. Este é o caso que o fallback existe
      // para atender — e ele tem de continuar atendendo.
      throw Object.assign(new Error("Bad Gateway"), { status: 502, code: null });
    },
    getGuides: async () => {
      chamadas.real.push("getGuides");
      throw Object.assign(new Error("offline"), { status: 0, code: "network_error" });
    },
    getCompanies: async () => {
      chamadas.real.push("getCompanies");
      throw Object.assign(new Error("proibido"), { status: 403, code: "forbidden" });
    },
  }),
}));

jest.mock("../mock/mockApi", () => ({
  createMockApi: () => ({
    fetchDanfseBlob: async () => { chamadas.mock.push("fetchDanfseBlob"); return "PDF-DO-MOCK"; },
    emitirNfse: async () => { chamadas.mock.push("emitirNfse"); return { status: "issued" }; },
    getInvoices: async () => { chamadas.mock.push("getInvoices"); return { data: [] }; },
    getGuides: async () => { chamadas.mock.push("getGuides"); return { data: [] }; },
    getCompanies: async () => { chamadas.mock.push("getCompanies"); return []; },
  }),
}));

import { createApiClient } from "../index";

const antes = process.env.VITE_API_MODE;

beforeEach(() => {
  chamadas.real = [];
  chamadas.mock = [];
  process.env.VITE_API_MODE = "real_with_mock_fallback";
});

afterEach(() => {
  process.env.VITE_API_MODE = antes;
});

describe("⚠⚠ recusa NOMEADA do backend NUNCA vira resposta do mock", () => {
  test("`503 danfse_sem_qrcode` SOBE — o mock não entrega um PDF no lugar da recusa", async () => {
    const api = createApiClient();
    await expect(api.fetchDanfseBlob("pc-001", "inv-1")).rejects.toMatchObject({
      status: 503,
      code: "danfse_sem_qrcode",
    });
    expect(chamadas.mock).not.toContain("fetchDanfseBlob");
  });

  test("`502` da camada TRANSPORTE SOBE — desfecho desconhecido não pode virar 'emitida'", async () => {
    const api = createApiClient();
    await expect(api.emitirNfse("pc-001", {})).rejects.toMatchObject({ camada: "TRANSPORTE" });
    expect(chamadas.mock).not.toContain("emitirNfse");
  });

  test("403 continua subindo — o fallback nunca foi bypass de autorização", async () => {
    const api = createApiClient();
    await expect(api.getCompanies()).rejects.toMatchObject({ status: 403 });
    expect(chamadas.mock).not.toContain("getCompanies");
  });
});

describe("o fallback continua fazendo o que ele existe para fazer", () => {
  test("5xx SEM corpo nosso (proxy, backend fora do ar) cai para o mock", async () => {
    const api = createApiClient();
    await expect(api.getInvoices("pc-001")).resolves.toEqual({ data: [] });
    expect(chamadas.real).toContain("getInvoices");
    expect(chamadas.mock).toContain("getInvoices");
  });

  test("⚠ falha de REDE (status 0) cai para o mock mesmo tendo `code` — não houve resposta nenhuma", async () => {
    const api = createApiClient();
    await expect(api.getGuides("pc-001")).resolves.toEqual({ data: [] });
    expect(chamadas.mock).toContain("getGuides");
  });
});

describe("os outros modos não mudaram", () => {
  test("`mock`: nada da real é chamado", async () => {
    process.env.VITE_API_MODE = "mock";
    const api = createApiClient();
    await expect(api.fetchDanfseBlob("pc-001", "inv-1")).resolves.toBe("PDF-DO-MOCK");
    expect(chamadas.real).toHaveLength(0);
  });

  test("`real`: a recusa sobe intacta e o mock nunca entra", async () => {
    process.env.VITE_API_MODE = "real";
    const api = createApiClient();
    await expect(api.fetchDanfseBlob("pc-001", "inv-1")).rejects.toMatchObject({ code: "danfse_sem_qrcode" });
    expect(chamadas.mock).toHaveLength(0);
  });
});
