import { avisarPagamentoNaoConfirmado } from "../AvisoPagamentoService.js";
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z")));
afterEach(() => jest.useRealTimers());
function setup() {
  const records = new Map();
  const guide = { id: "g", portalClientId: "c", competencia: "2026-09", tipo: "INSS", paymentStatus: "OPEN", liberadaCliente: true, vencimento: "2026-09-20" };
  const db = { guide: { findUnique: jest.fn(async () => ({ ...guide })) }, portalClient: { findUnique: jest.fn(async () => ({ razao: "Empresa sintética" })) },
    appSetting: { create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error("duplicado"), { code: "P2002" }); records.set(data.key, data); return data; }),
      findUnique: jest.fn(async ({ where }) => records.get(where.key)), update: jest.fn(async ({ where, data }) => { records.set(where.key, { key: where.key, ...data }); return data; }) } };
  const transporte = { canais: jest.fn(async () => ({ escolha: "EMAIL" })), destinatarios: jest.fn(async () => ({ emails: ["fixture@example.invalid"], telefones: [] })),
    email: jest.fn(async ({ conferir }) => { await conferir(); }), whatsapp: jest.fn() };
  const run = extra => avisarPagamentoNaoConfirmado({ guideId: "g", scheduledAt: "2026-09-24T11:00:00Z", ...extra }, { db, transporte, portalUrl: "https://portal.example.invalid/" });
  return { guide, db, transporte, records, run };
}
test("aviso neutro só aos destinatários cadastrados e uma vez sob concorrência/reinício", async () => {
  const f = setup();
  await Promise.all([f.run(), f.run()]);
  await f.run({ scheduledAt: "2026-10-24T11:00:00Z" });
  expect(f.transporte.email).toHaveBeenCalledTimes(1);
  expect(f.transporte.email.mock.calls[0][0]).toMatchObject({ to: "fixture@example.invalid", texto: expect.stringContaining("Não é necessário pagar novamente") });
  expect(f.transporte.email.mock.calls[0][0].texto).toContain("confirme no portal");
});
test.each(["MANUAL", "CLIENTE"])("confirmação %s impede aviso antes de qualquer transporte", async origem => {
  const f = setup(); Object.assign(f.guide, { paymentStatus: "PAID", paymentStatusSource: origem });
  expect(await f.run()).toMatchObject({ status: "IGNORADO", motivo: "PAGAMENTO_JA_CONFIRMADO" });
  expect(f.transporte.email).not.toHaveBeenCalled();
});
test("confirmação do cliente ocorrida durante preparação cancela antes de enviar", async () => {
  const f = setup(); let enviadas = 0;
  f.transporte.email.mockImplementation(async ({ conferir }) => { f.guide.paymentStatus = "PAID"; await conferir(); enviadas++; });
  await f.run(); expect(enviadas).toBe(0);
  expect([...f.records.values()][0].value.status).toBe("CANCELADO");
});
test.each(["PERGUNTAR", "SEM_EMAIL", "JANELA_FECHADA"])("%s informa pendência sem falso envio", async caso => {
  const f = setup();
  if (caso === "PERGUNTAR") f.transporte.canais.mockResolvedValue({ escolha: null });
  if (caso === "SEM_EMAIL") f.transporte.destinatarios.mockResolvedValue({ emails: [], telefones: [] });
  if (caso === "JANELA_FECHADA") {
    f.transporte.canais.mockResolvedValue({ escolha: "WHATSAPP" });
    f.transporte.destinatarios.mockResolvedValue({ emails: [], telefones: [{ id: "contato", telefoneE164: "5511000000000" }] });
    f.transporte.whatsapp.mockRejectedValue(Object.assign(Error("janela"), { code: "WHATSAPP_JANELA_FECHADA" }));
  }
  expect(await f.run()).toMatchObject({ status: "PENDENTE" }); expect(f.transporte.email).not.toHaveBeenCalled();
  expect([...f.records.values()].some(v => v.value.status === "ENVIADO")).toBe(false);
});
test("timeout preserva indeterminação e não reenfileira envio", async () => {
  const f = setup(); f.transporte.email.mockImplementation(async ({ conferir }) => { await conferir(); throw Error("timeout"); });
  await f.run(); await f.run();
  expect(f.transporte.email).toHaveBeenCalledTimes(1);
  expect([...f.records.values()][0].value.status).toBe("INDETERMINADO");
});
test("consulta manual e lease perdida não enviam", async () => {
  const f = setup(); await f.run({ scheduledAt: null }); await expect(f.run({ assertActive: () => { throw Error("lease"); } })).rejects.toThrow("lease");
  expect(f.transporte.email).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});
test("falha de banco não é tratada como aviso ignorado", async () => {
  const f = setup(); f.db.guide.findUnique.mockRejectedValue(Error("banco indisponível"));
  await expect(f.run()).rejects.toThrow("banco indisponível"); expect(f.transporte.email).not.toHaveBeenCalled();
});
test("guia não liberada fica pendente; guia DAS oferece dois links sem efetuar ação", async () => {
  const f = setup(); f.guide.liberadaCliente = false;
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "GUIA_NAO_LIBERADA" });
  Object.assign(f.guide, { liberadaCliente: true, source: "SERPRO", tipo: "SIMPLES" }); await f.run();
  const { acoes } = f.transporte.email.mock.calls[0][0]; expect(acoes).toHaveLength(2);
  expect(acoes.find(a => a.acao === "recalcular").url).toBe("https://portal.example.invalid/?empresa=c&guia=g&competencia=2026-09&acao=recalcular#/guias");
});
test("vínculo posterior da mesma guia não duplica aviso", async () => {
  const f = setup(); await f.run();
  f.db.parcela = { findUnique: jest.fn(async () => ({ id: "parcela-nova", portalClientId: "c", anoMesParcela: "202609", guia: f.guide, parcelamento: { numeroParcelamento: "123" } })) };
  expect(await f.run({ parcelaId: "parcela-nova" })).toMatchObject({ status: "JA_ENVIADO" });
  expect(f.transporte.email).toHaveBeenCalledTimes(1);
});
