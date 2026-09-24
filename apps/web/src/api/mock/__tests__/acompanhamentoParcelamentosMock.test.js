import { criarMockAcompanhamentoParcelamentos } from "../acompanhamentoParcelamentosMock";

let seq = 0;
function setup(qtd = 3) {
  const id = `test-acomp-${++seq}`;
  const guias = new Map();
  const api = criarMockAcompanhamentoParcelamentos({ empresas: [{ companyId: id, parcelamentoDemoAtrasos: qtd }], guias });
  return { id, api, guias };
}
test.each([3, 2])("indicação de %i atrasos não inventa parcelas nem provisão", async qtd => {
  const { id, api } = setup(qtd);
  const out = await api.getAcompanhamentoParcelamentos(id);
  expect(out.indicacoes[0].parcelasEmAtraso).toBe(qtd);
  expect(out.contratos).toEqual([]);
  expect(out.itens[0]).toMatchObject({ estado: "IDENTIFICAR", atrasada: true });
  expect(out.itens[0].vencimento).toBeUndefined();
});
test("descoberta e captura repetidas não duplicam contrato, parcelas ou guia e não criam provisão", async () => {
  const { id, api, guias } = setup();
  await api.localizarParcelamentos(id); await api.localizarParcelamentos(id);
  const out = await api.getAcompanhamentoParcelamentos(id);
  expect(out.contratos).toHaveLength(1);
  expect(out.contratos[0]).toMatchObject({ aberturaEntryId: null, totalValue: null });
  await api.resolverIndicacaoParcelamento(id, out.indicacoes[0].id, { status: "VINCULADO", parcelamentoId: out.contratos[0].id, motivo: "Conferido no relatório" });
  await api.capturarContratoParcelamento(id, out.contratos[0].id);
  await api.capturarContratoParcelamento(id, out.contratos[0].id);
  expect(guias.get(id)).toHaveLength(4);
  expect((await api.getAcompanhamentoParcelamentos(id)).resumo.anteriores).toBe(3);
});
test("falha e pagamento parcial não quitam; pagamento integral não contabiliza", async () => {
  const { id, api } = setup();
  const out = await api.localizarParcelamentos(id);
  await api.capturarContratoParcelamento(id, out.contratos[0].id);
  const p = (await api.getAcompanhamentoParcelamentos(id)).itens.find(i => i.parcelaId);
  await api.definirCenarioAcompanhamento(id, "erro");
  await expect(api.consultarPagamentoParcela(id, p.parcelaId)).rejects.toThrow("indisponível");
  await api.definirCenarioAcompanhamento(id, "parcial");
  await api.consultarPagamentoParcela(id, p.parcelaId);
  expect((await api.getAcompanhamentoParcelamentos(id)).itens.find(i => i.parcelaId === p.parcelaId).pagamentoConfirmado).toBe(false);
  await api.definirCenarioAcompanhamento(id, "sucesso");
  await api.consultarPagamentoParcela(id, p.parcelaId);
  const next = await api.getAcompanhamentoParcelamentos(id);
  expect(next.itens.find(i => i.parcelaId === p.parcelaId).pagamentoConfirmado).toBe(true);
  expect(next.contratos[0].aberturaEntryId).toBeNull();
});
test("débito automático consulta pagamento sem guia, e consulta repetida preserva valor pago", async () => {
  const { id, api, guias } = setup(0);
  const { contrato } = await api.criarAcompanhamentoParcelamento(id, { tipo: "PARCMEI", numeroParcelamento: "99", formaPagamento: "DEBITO_AUTOMATICO" });
  await api.capturarContratoParcelamento(id, contrato.id);
  const p = (await api.getAcompanhamentoParcelamentos(id)).itens[0];
  expect(p.estado).toBe("CONSULTAR_PAGAMENTO");
  expect(guias.get(id)).toBeUndefined();
  await api.consultarPagamentoParcela(id, p.parcelaId);
  await api.consultarPagamentoParcela(id, p.parcelaId);
  expect((await api.getAcompanhamentoParcelamentos(id)).itens[0]).toMatchObject({ estado: "CONTABILIZAR", valorPago: 620 });
});
test("outro CNPJ não consegue resolver indicação ou parcela; descarte exige motivo", async () => {
  const a = setup(), b = setup();
  const out = await a.api.getAcompanhamentoParcelamentos(a.id);
  await expect(b.api.resolverIndicacaoParcelamento(b.id, out.indicacoes[0].id, { status: "DESCARTADO", motivo: "Duplicado" })).rejects.toThrow("nesta empresa");
  await expect(a.api.resolverIndicacaoParcelamento(a.id, out.indicacoes[0].id, { status: "DESCARTADO", motivo: "" })).rejects.toThrow("motivo");
  await a.api.resolverIndicacaoParcelamento(a.id, out.indicacoes[0].id, { status: "DESCARTADO", motivo: "Indício duplicado" });
  expect((await a.api.getAcompanhamentoParcelamentos(a.id)).itens).toHaveLength(0);
});
test("edição fiscal altera forma de pagamento e descrição, nunca a abertura contábil", async () => {
  const { id, api } = setup();
  const out = await api.localizarParcelamentos(id);
  await api.editarAcompanhamentoParcelamento(id, out.contratos[0].id, { formaPagamento: "DEBITO_AUTOMATICO", label: "Débito em conta" });
  const next = await api.getAcompanhamentoParcelamentos(id);
  expect(next.contratos[0]).toMatchObject({ formaPagamento: "DEBITO_AUTOMATICO", label: "Débito em conta", aberturaEntryId: null });
  expect(next.indicacoes[0].status).toBe("PENDENTE");
});

test("confirmação não retrocede no cenário parcial e baixa encerra a pendência contábil", async () => {
  const { id, api } = setup(0);
  const { contrato } = await api.criarAcompanhamentoParcelamento(id, { tipo: "PARCMEI", numeroParcelamento: "97", formaPagamento: "DEBITO_AUTOMATICO" });
  await api.capturarContratoParcelamento(id, contrato.id);
  const itens = (await api.getAcompanhamentoParcelamentos(id)).itens;
  for (const p of itens) {
    expect(await api.consultarPagamentoParcela(id, p.parcelaId)).toMatchObject({ status: "CONFIRMADO" });
    await api.definirCenarioAcompanhamento(id, "parcial");
    expect(await api.consultarPagamentoParcela(id, p.parcelaId)).toMatchObject({ skipped: "already_paid" });
    api.registrarBaixaAcompanhamento(id, p.parcelaId);
    await api.definirCenarioAcompanhamento(id, "sucesso");
  }
  const out = await api.getAcompanhamentoParcelamentos(id);
  expect(out.resumo).toMatchObject({ contabilizar: 0, pendentes: 0 });
  expect(out.itens.every(i => i.estado === "RESOLVIDA" && !i.contabilizacaoPendente)).toBe(true);
  expect(api.complianceAcompanhamentoParcelamentos(id, { ok: true }).parcDas).toMatchObject({ state: "enviada", ok: true, pendenciaOperacional: false });
});
