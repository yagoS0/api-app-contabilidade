import { createRealApi } from "../real/realApi";
import { ApiError } from "../ApiError";
jest.mock("../sessionStore", () => ({ lerSessao: () => ({ accessToken: "token-ficticio" }), definirTokens: jest.fn(), limparSessao: jest.fn() }));
const fetchOriginal = global.fetch;
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = fetchOriginal; });
const responder = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(corpo) });
test("confirmação real envia data e versão no JSON, com identidade e autenticação", async () => {
 const resposta = { ok: true, confirmacao: { id: "c1", estadoBaixa: "CONCLUIDA" } };
 global.fetch.mockResolvedValue(responder(200, resposta));
 await expect(createRealApi().confirmarPagamentoDaGuia("empresa/1", "guia/2", { pagoEm: "2026-09-20", versaoPagamento: "v-atual" })).resolves.toEqual(resposta);
 expect(global.fetch).toHaveBeenCalledTimes(1);
 const [url, init] = global.fetch.mock.calls[0];
 expect(url).toMatch(/\/client\/companies\/empresa%2F1\/guides\/guia%2F2\/confirmar-pagamento$/);
 expect(init.method).toBe("POST"); expect(init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer token-ficticio" });
 expect(JSON.parse(init.body)).toEqual({ pagoEm: "2026-09-20", versaoPagamento: "v-atual" });
});
test("reconfirmação real conserva identificador anterior e versão corrigida no JSON", async () => {
 global.fetch.mockResolvedValue(responder(200, { ok: true, confirmacao: { id: "c-nova", estadoBaixa: "PENDENTE" } }));
 await createRealApi().confirmarPagamentoDaGuia("empresa", "guia", { pagoEm: "2026-09-21", versaoPagamento: "v-corrigida", reconfirmaConfirmacaoId: "c-anterior" });
 expect(global.fetch).toHaveBeenCalledTimes(1);
 expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ pagoEm: "2026-09-21", versaoPagamento: "v-corrigida", reconfirmaConfirmacaoId: "c-anterior" });
});
test.each([403, 409, 422])("recusa HTTP %s conserva código, mensagem e corpo sem repetir POST", async status => {
 const corpo = { ok: false, error: "GUIA_ALTERADA", message: "Atualize a guia antes de confirmar.", versaoEsperada: "nova" };
 global.fetch.mockResolvedValue(responder(status, corpo));
 const erro = await createRealApi().confirmarPagamentoDaGuia("empresa", "guia", { pagoEm: "2026-09-20", versaoPagamento: "antiga" }).catch(e => e);
 expect(erro).toBeInstanceOf(ApiError); expect(erro).toMatchObject({ status, code: "GUIA_ALTERADA", message: corpo.message, corpo });
 expect(global.fetch).toHaveBeenCalledTimes(1);
});
