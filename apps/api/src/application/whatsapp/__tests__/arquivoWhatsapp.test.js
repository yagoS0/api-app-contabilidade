jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../config.js", () => ({ WHATSAPP_TOKEN: "", WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com", WHATSAPP_GRAPH_VERSION: "v22.0" }));
import { identificarArquivo, baixarMidiaMeta, enqueueArquivoWhatsapp, arquivoParaTela, expirarArquivosWhatsapp, processarArquivosWhatsapp, LIMITE_ARQUIVO_BYTES } from "../ArquivoWhatsappService.js";

test("identifica conteúdo real e recusa extensão enganosa e excesso de bytes", () => {
  expect(identificarArquivo(Buffer.from("%PDF-1.7 teste"), "extrato.exe").mimeType).toBe("application/pdf");
  expect(identificarArquivo(Buffer.from("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>"), "x.qfx").extensao).toBe(".qfx");
  expect(() => identificarArquivo(Buffer.from("<script>alert(1)</script>"), "x.pdf")).toThrow(/Formato/);
  expect(() => identificarArquivo(Buffer.alloc(LIMITE_ARQUIVO_BYTES + 1))).toThrow(/15 MB/);
});
test.each(["https://evil.test/x", "https://facebook.com.evil.test/x", "http://lookaside.fbsbx.com/x", "https://user:pass@facebook.com/x", "https://127.0.0.1/x"])("não encaminha credencial para origem não autorizada %s", async url => {
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ url })));
  await expect(baixarMidiaMeta("123", { token: "segredo", fetchImpl })).rejects.toMatchObject({ code: "MIDIA_URL_INVALIDA" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
});
test("credenciais e detalhes de transporte não vazam nos erros", async () => {
  await expect(baixarMidiaMeta("123", { token: "segredo", fetchImpl: async () => { throw new Error("secret authorization"); } })).rejects.toMatchObject({ code: "MIDIA_DOWNLOAD_FALHOU" });
});
test("bytes de mídia são limitados independentemente do content length", async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/x" }))).mockResolvedValueOnce(new Response(Buffer.alloc(LIMITE_ARQUIVO_BYTES + 1)));
  await expect(baixarMidiaMeta("123", { token: "x", fetchImpl })).rejects.toMatchObject({ code: "ARQUIVO_TAMANHO_INVALIDO" });
});
test("retém 90 dias desde a mensagem, idempotência não estende prazo nem muda empresa", async () => {
  const db = { arquivoWhatsapp: { upsert: jest.fn(async x => x) } };
  const r = await enqueueArquivoWhatsapp({ mensagem: { id: "m", conversaId: "c", midiaProvedorId: "123", registradaEm: new Date("2026-01-01Z") }, conversa: { id: "c", portalClientId: "A", escopoVerificado: true }, nomeArquivo: "../extrato.ofx" }, db);
  expect(r.update).toEqual({});
  expect(r.create).toMatchObject({ portalClientId: "A", nomeArquivo: "extrato.ofx", expiraEm: new Date("2026-04-01Z") });
  expect(await enqueueArquivoWhatsapp({ mensagem: { id: "m", conversaId: "c", midiaProvedorId: "123" }, conversa: { id: "c", portalClientId: "A", escopoVerificado: false } }, db)).toBeNull();
  await expect(enqueueArquivoWhatsapp({ mensagem: { id: "m", conversaId: "outro", midiaProvedorId: "123" }, conversa: { id: "c", portalClientId: "A", escopoVerificado: true } }, db)).rejects.toMatchObject({ code: "MIDIA_ESCOPO_INVALIDO" });
  expect(db.arquivoWhatsapp.upsert).toHaveBeenCalledTimes(1);
});
test("expiração remove somente bytes e bloqueia abertura antes mesmo da limpeza", async () => {
  const db = { arquivoWhatsapp: { updateMany: jest.fn() } };
  await expirarArquivosWhatsapp(db, new Date("2026-04-02Z"));
  expect(db.arquivoWhatsapp.updateMany.mock.calls[0][0].data).toMatchObject({ conteudo: null, estado: "EXPIRADO" });
  expect(arquivoParaTela({ estado: "DISPONIVEL", expiraEm: "2026-04-01Z", mimeType: "application/x-ofx", conteudo: Buffer.from("x") }, new Date("2026-04-02Z"))).toMatchObject({ podeAbrir: false, podeImportarOfx: false, estado: "EXPIRADO" });
});
test("perder disputa da reserva não baixa nem importa arquivo", async () => {
  const db = { arquivoWhatsapp: { updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => [{ id: "a", tentativas: 0 }]) } };
  const baixar = jest.fn();
  expect(await processarArquivosWhatsapp({ db, baixar })).toEqual({ processados: 0 });
  expect(baixar).not.toHaveBeenCalled();
});
test("falha transitória agenda nova tentativa com registro persistido", async () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-01-01Z"));
  const db = { arquivoWhatsapp: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => [{ id: "a", tentativas: 1, midiaProvedorId: "123" }]) } };
  await processarArquivosWhatsapp({ db, baixar: async () => { throw new Error("transport secret"); }, agora: new Date("2026-01-01Z") });
  expect(db.arquivoWhatsapp.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ estado: "FALHOU", erroCodigo: "MIDIA_DOWNLOAD_FALHOU", proximaTentativaEm: new Date("2026-01-01T00:01:00Z") });
  jest.useRealTimers();
});
