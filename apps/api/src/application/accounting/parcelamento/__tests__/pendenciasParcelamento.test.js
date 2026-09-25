import { projetarPendenciasParcelamento, complianceParcelamentos, mesOperacionalDaCompetencia, parcelaPagamentoConfirmado } from "../pendenciasParcelamento.js";
const contrato = extra => ({ id: "c1", portalClientId: "empresa", status: "ATIVO", tipo: "PARCSN", formaPagamento: "GUIA_MENSAL", parcelas: [], ...extra });
const parcela = extra => ({ id: "p1", numeroParcela: 1, competencia: "2026-09", vencimento: "2026-09-20", ...extra });
const projetar = (contratos, indicacoes = []) => projetarPendenciasParcelamento({ contratos, indicacoes, mesOperacional: "2026-09", agora: new Date("2026-09-24Z"), enviada: g => g.emailStatus === "SENT" });

test("declaração do cliente suspende pendência operacional mas não dispensa consulta fiscal", () => {
  const p = { guia: { paymentStatus: "PAID", paymentStatusSource: "CLIENTE" } };
  expect(parcelaPagamentoConfirmado(p)).toBe(true);
  expect(parcelaPagamentoConfirmado(p, { aceitarDeclaracaoCliente: false })).toBe(false);
  expect(parcelaPagamentoConfirmado({ ...p, pagamentoStatus: "CONFIRMADO" }, { aceitarDeclaracaoCliente: false })).toBe(true);
});

test("indício SITFIS aparece sem inventar três parcelas, valor ou provisão", () => {
  const r = projetar([], [{ id: "i", status: "PENDENTE", portalClientId: "empresa", parcelasEmAtraso: 3 }]);
  expect(r.itens).toHaveLength(1);
  expect(r.itens[0]).toMatchObject({ estado: "IDENTIFICAR", atrasosInformados: 3, vencimento: null, valor: null });
  expect(complianceParcelamentos(r.itens)).toMatchObject({ state: "missing", pendenciaOperacional: true });
});
test("todos os contratos são acompanhados sem abertura contábil", () => {
  const r = projetar([contrato({}), contrato({ id: "c2", tipo: "PARCMEI" })]);
  expect(r.itens.map(i => i.parcelamentoId)).toEqual(["c1", "c2"]);
  expect(r.resumo.pendentes).toBe(2);
});
test("anterior sem PDF permanece visível e calendário previsto não afirma atraso oficial", () => {
  const r = projetar([contrato({ parcelas: [parcela({ competencia: "2026-08", vencimento: "2026-08-20" })] })]);
  expect(r.itens[0]).toMatchObject({ anterior: true, atrasada: false, vencimentoPrevisto: true, estado: "OBTER_GUIA" });
  expect(r.itens[1].estado).toBe("CONFERIR_PARCELA");
});
test("guia do primeiro contrato enviada não oculta atraso do segundo", () => {
  const r = projetar([contrato({ parcelas: [parcela({ guia: { id: "g", status: "PROCESSED", vencimento: "2026-09-30", emailStatus: "SENT" } })] }),
    contrato({ id: "c2", parcelas: [parcela({ id: "p2", guia: { id: "g2", status: "PROCESSED", storageKey: "g2.pdf", valor: 100, vencimento: "2026-09-20" } })] })]);
  expect(complianceParcelamentos(r.itens)).toMatchObject({ quantidade: 2, atrasada: true, pendencias: 2, state: "gerada" });
});
test("débito automático exige conferir pagamento, nunca falta de boleto", () => {
  const r = projetar([contrato({ formaPagamento: "DEBITO_AUTOMATICO", parcelas: [parcela({})] })]);
  expect(r.itens[0]).toMatchObject({ estado: "CONSULTAR_PAGAMENTO", guideId: null });
  expect(complianceParcelamentos(r.itens)).toMatchObject({ pendenciaOperacional: true });
});
test("pagamento confirmado sem lançamento sai da cobrança e entra em contabilização", () => {
  const r = projetar([contrato({ parcelas: [parcela({ pagamentoStatus: "CONFIRMADO", valorPago: 100, guia: { id: "g", valor: 120 } })] })]);
  expect(r.itens[0]).toMatchObject({ estado: "CONTABILIZAR", valor: 100, pagamentoConfirmado: true });
});
test("baixa corrigida prevalece sobre comprovante posterior; valor desconhecido não usa cobrança", () => {
  const r = projetar([contrato({ parcelas: [parcela({ valorPago: 120, valorEfetivoPago: 100, guia: { id: "g", baixada: true, valor: 140 } }),
    parcela({ id: "p2", guia: { id: "g2", paymentStatus: "PAID", valor: 999 } })] })]);
  expect(r.itens.find(i => i.parcelaId === "p1").valor).toBe(100);
  expect(r.itens.find(i => i.parcelaId === "p2").valor).toBeNull();
});
test("indícios vinculados/descartados não duplicam contrato", () => {
  expect(projetar([], [{ id: "i", status: "VINCULADO" }, { id: "j", status: "DESCARTADO" }]).itens).toEqual([]);
});
test("mês operacional segue vencimento seguinte à competência inclusive dezembro", () => {
  expect(mesOperacionalDaCompetencia("2026-12")).toBe("2027-01");
  expect(() => mesOperacionalDaCompetencia("2026-99")).toThrow();
});
test.each(["QUITADO", "RESCINDIDO"])("encerramento fiscal %s interrompe expectativa mensal mesmo com cadastro ativo", fiscalSituacao => {
  expect(projetar([contrato({ fiscalSituacao })]).itens).toEqual([]);
});
test("PDF com leitura pendente ou ausente não oferece envio", () => {
  const c = contrato({ parcelas: [parcela({ guia: { id: "g", status: "PROCESSED", valor: 100, vencimento: "2026-09-20", storageKey: "g.pdf", extracted: { conferenciaDocumentoPendente: true } } }),
    parcela({ id: "p2", guia: { id: "g2", status: "PROCESSED", valor: 100, vencimento: "2026-09-20" } })] });
  expect(projetar([c]).itens.map(i => i.estado)).toEqual(["CONFERIR_DOCUMENTO", "OBTER_GUIA"]);
});

test("contrato excluído não retorna tarefas de guias antigas nem ação sem contrato visível", () => {
  expect(projetar([contrato({ status: "EXCLUIDO", parcelas: [parcela({ guia: { id: "g", valor: 100, vencimento: "2026-09-20" } })] })]).itens).toEqual([]);
});

test("vencimento de hoje não vira atraso antes da meia-noite em São Paulo", () => {
  const r = projetarPendenciasParcelamento({ mesOperacional: "2026-09", agora: new Date("2026-09-25T01:00:00Z"),
    contratos: [contrato({ parcelas: [parcela({ guia: { id: "g", vencimento: "2026-09-24", valor: 100 } })] })] });
  expect(r.itens[0].atrasada).toBe(false);
});

test("encerramento mantém conferência de parcela anterior identificada oficialmente sem criar cobrança futura", () => {
  const r = projetar([contrato({ fiscalSituacao: "RESCINDIDO", parcelas: [parcela({ origem: "SERPRO", competencia: "2026-08", vencimento: null }),
    parcela({ id: "prevista", origem: "MANUAL", competencia: "2026-08", vencimento: null })] })]);
  expect(r.itens).toHaveLength(1);
  expect(r.itens[0]).toMatchObject({ anterior: true, atrasada: false, estado: "CONSULTAR_PAGAMENTO", guideId: null });
});

const indicioUpload = extra => ({ id: "ind", portalClientId: "empresa", status: "PENDENTE", modalidade: "PARCSN", ...extra });
const guiaAvulsa = extra => contrato({ origem: "GUIA_AVULSA", parcelas: [parcela({ guia: { id: "upload", status: "PROCESSED", storageKey: "upload.pdf", valor: 100, vencimento: "2026-09-20", ...extra } })] });
test("upload avulso cobre falta mensal sem pedir conferência do indício", () => {
  const r = projetar([guiaAvulsa()], [indicioUpload()]);
  expect(r.itens.map(i => i.id)).toEqual(["parcela:p1"]);
});
test("upload do mês preserva indicação anterior sem inventar sua referência ou declarar pagamento", () => {
  const r = projetar([guiaAvulsa()], [indicioUpload({ parcelasEmAtraso: 3 })]);
  expect(r.itens.find(i => i.indicacaoId)).toMatchObject({ somenteAnteriores: true, anterior: true, guiaDoMesPresente: true, referencia: null, atrasosInformados: 3, pagamentoConfirmado: false });
});
test("guia anterior não cobre falta deste mês e não cria calendário para guia avulsa", () => {
  const r = projetar([guiaAvulsa({ vencimento: "2026-08-20" })], [indicioUpload()]);
  expect(r.itens.find(i => i.indicacaoId)).toMatchObject({ referencia: "2026-09", guiaDoMesPresente: false });
  expect(r.itens.filter(i => i.id.startsWith("contrato:"))).toEqual([]);
  expect(r.itens.some(i => i.guideId === "upload" && i.anterior)).toBe(true);
});
test("upload de outro acordo identificado não resolve o aviso", () => {
  expect(projetar([guiaAvulsa()], [indicioUpload({ numeroParcelamento: "999" })]).itens.some(i => i.indicacaoId)).toBe(true);
  expect(projetar([guiaAvulsa({ extracted: { indicacaoParcelamentoId: "ind" } })], [indicioUpload({ numeroParcelamento: "999" })]).itens.some(i => i.indicacaoId)).toBe(false);
});

test("uma guia sem identificação não cobre dois indícios da mesma modalidade", () => {
  const indicacoes = [indicioUpload(), indicioUpload({ id: "outro" })];
  expect(projetar([guiaAvulsa()], indicacoes).itens.filter(i => i.indicacaoId).map(i => i.indicacaoId)).toEqual(["ind", "outro"]);
  expect(projetar([guiaAvulsa({ extracted: { indicacaoParcelamentoId: "ind" } })], indicacoes).itens.filter(i => i.indicacaoId).map(i => i.indicacaoId)).toEqual(["outro"]);
});

test("a guia de setembro não esconde o lembrete de outubro do mesmo indício", () => {
  const r = projetarPendenciasParcelamento({ contratos: [guiaAvulsa({ extracted: { indicacaoParcelamentoId: "ind" } })],
    indicacoes: [indicioUpload({ parcelasEmAtraso: 3 })], mesOperacional: "2026-10" });
  expect(r.itens.find(i => i.indicacaoId)).toMatchObject({ referencia: "2026-10", guiaDoMesPresente: false, atrasosInformados: 3 });
  expect(r.itens.find(i => i.guideId === "upload")).toMatchObject({ anterior: true });
});
