import { createMockApi } from "../mockApi";
import { conferirEnvioParcelaMock } from "../guiaParcelaEnvioMock";

const api = createMockApi();
let seq = 0;
async function parcela() {
  const companyId = `guard-mock-${++seq}`;
  const { contrato } = await api.criarAcompanhamentoParcelamento(companyId, { tipo: "PARCSN", numeroParcelamento: "999", formaPagamento: "GUIA_MENSAL" });
  await api.definirCenarioAcompanhamento(companyId, "documento");
  await api.capturarContratoParcelamento(companyId, contrato.id);
  const item = (await api.getAcompanhamentoParcelamentos(companyId)).itens.find(i => i.parcelaId);
  return { companyId, contrato, item };
}
async function conferir(ctx) {
  const { documento } = await api.getDocumentoParcela(ctx.companyId, ctx.item.parcelaId);
  await api.conferirDocumentoParcela(ctx.companyId, ctx.item.parcelaId, { ...documento, confirmado: true });
}

test("documento pendente bloqueia liberação, e-mail, WhatsApp e lote; conferência permite liberar", async () => {
  const ctx = await parcela();
  const { companyId, item } = ctx;
  const lote = { items: [{ portalClientId: companyId, guideIds: [item.guideId], mesVencimento: item.referencia }] };
  for (const acao of [() => api.liberarGuiaCliente(item.guideId), () => api.resendGuideEmail(item.guideId), () => api.enviarGuiaWhatsapp(companyId, item.guideId), () => api.liberarGuiasLote(lote)]) {
    await expect(acao()).rejects.toMatchObject({ code: "PARCELA_DOCUMENTO_PENDENTE" });
  }
  await conferir(ctx);
  expect(await api.liberarGuiaCliente(item.guideId)).toMatchObject({ ok: true, liberadas: 1 });
});

test.each(["paga", "automatica"])("parcela %s não é liberada nem cobrada após conferência", async cenario => {
  const ctx = await parcela();
  await conferir(ctx);
  const { companyId, contrato, item } = ctx;
  if (cenario === "paga") {
    await api.definirCenarioAcompanhamento(companyId, "sucesso");
    await api.consultarPagamentoParcela(companyId, item.parcelaId);
  } else await api.editarAcompanhamentoParcelamento(companyId, contrato.id, { formaPagamento: "DEBITO_AUTOMATICO" });
  const code = cenario === "paga" ? "PARCELA_PAGA" : "PARCELA_DEBITO_AUTOMATICO";
  await expect(api.liberarGuiaCliente(item.guideId)).rejects.toMatchObject({ code });
  await expect(api.resendGuideEmail(item.guideId)).rejects.toMatchObject({ code });
  await expect(api.enviarGuiaWhatsapp(companyId, item.guideId)).rejects.toMatchObject({ code });
});

test("guard preserva guias normais e bloqueia parcela baixada mesmo sem status pago", () => {
  expect(() => conferirEnvioParcelaMock({ tipo: "SIMPLES", paymentStatus: "PAID" })).not.toThrow();
  expect(() => conferirEnvioParcelaMock({ parcelamentoId: "p", baixada: true })).toThrow("pagamento confirmado");
});
