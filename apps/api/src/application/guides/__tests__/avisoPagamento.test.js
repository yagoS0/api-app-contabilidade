import { avisarPagamentoNaoConfirmado } from "../AvisoPagamentoService.js";
import { capturarRevisaoConsulta } from "../ConsultaPagamentoGuiaService.js";
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z")));
afterEach(() => jest.useRealTimers());
function setup() {
  const records = new Map();
  const outrasGuias = [];
  const company = { razao: "Empresa sintética", cnpj: "11222333000181" };
  const guide = { id: "g", portalClientId: "c", cnpj: company.cnpj, competencia: "2026-09", tipo: "SIMPLES", status: "PROCESSED", source: "SERPRO", hash: "pdf-v1", paymentStatus: "OPEN", liberadaCliente: true, vencimento: "2026-09-20", extracted: { numeroDocumento: "07162619444412336" } };
  const resultado = { observacaoId: "obs", consultaId: "consulta", estado: "NAO_LOCALIZADO", fonte: "PGDASD_CONSDECLARACAO13", cnpj: company.cnpj, numeroDocumento: guide.extracted.numeroDocumento, consultadoEm: "2026-09-24T14:00:00Z", cobertura: "COMPLETA", identidadeConferida: true,
    evidencia: { periodoPgdas: { competencia: guide.competencia, cobertura: "COMPLETA", impedimentoAviso: null, documentos: [{ numeroDocumento: guide.extracted.numeroDocumento, dasPago: false }] } } };
  const observacao = {};
  const refazerProva = (extra = {}) => {
    Object.assign(resultado, extra);
    guide.extracted.consultaPagamento = structuredClone(resultado);
    Object.assign(observacao, { id: resultado.observacaoId, consultaId: resultado.consultaId, guideId: guide.id, guideReferenceId: guide.id,
      portalClientId: guide.portalClientId, documentRevision: capturarRevisaoConsulta(guide), source: resultado.fonte, state: resultado.estado,
      checkedAt: new Date(resultado.consultadoEm), applied: true, ignoredReason: null, result: structuredClone(resultado) });
  };
  refazerProva();
  const db = { guide: { findUnique: jest.fn(async () => ({ ...guide })), findMany: jest.fn(async () => structuredClone(outrasGuias)) }, portalClient: { findUnique: jest.fn(async () => ({ ...company })) },
    guidePaymentObservation: { findUnique: jest.fn(async () => structuredClone(observacao)) },
    appSetting: { create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error("duplicado"), { code: "P2002" }); records.set(data.key, data); return data; }),
      findUnique: jest.fn(async ({ where }) => records.get(where.key)), update: jest.fn(async ({ where, data }) => { records.set(where.key, { key: where.key, ...data }); return data; }) } };
  const transporte = { canais: jest.fn(async () => ({ escolha: "EMAIL" })), destinatarios: jest.fn(async () => ({ emails: ["fixture@example.invalid"], telefones: [] })),
    email: jest.fn(async ({ conferir }) => { await conferir(); }), whatsapp: jest.fn() };
  const run = extra => avisarPagamentoNaoConfirmado({ guideId: "g", scheduledAt: "2026-09-24T11:00:00Z", resultadoConsulta: resultado, ...extra }, { db, transporte, portalUrl: "https://portal.example.invalid/" });
  return { guide, company, resultado, observacao, refazerProva, db, transporte, records, run, outrasGuias };
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
  prepararParcela(f);
  expect(await f.run({ parcelaId: "parcela-nova" })).toMatchObject({ status: "JA_ENVIADO" });
  expect(f.transporte.email).toHaveBeenCalledTimes(1);
});

function prepararParcela(f, tipo = "PARCSN") {
  Object.assign(f.guide, { parcelamentoId: "contrato", anoMesParcela: "202609", numeroParcela: 1 });
  const parcela = { id: "parcela-nova", portalClientId: "c", guiaId: "g", parcelamentoId: "contrato", anoMesParcela: "202609", numeroParcela: 1,
    pagamentoStatus: "NAO_LOCALIZADO", pagamentoErro: null, guia: f.guide, parcelamento: { tipo, numeroParcelamento: "123" } };
  f.db.parcela = { findUnique: jest.fn(async () => parcela) };
  f.refazerProva({ fonte: `PARCELAMENTO_${tipo}`, identidadeObrigacao: { tipo: "PARCELA", parcelamentoId: "contrato", anoMesParcela: "202609", numeroParcela: 1, numeroParcelamento: "123" } });
  return parcela;
}

const semSaida = f => {
  expect(f.transporte.email).not.toHaveBeenCalled();
  expect(f.transporte.whatsapp).not.toHaveBeenCalled();
};

test.each([null, {}, { estado: "NAO_LOCALIZADO", cobertura: "COMPLETA", identidadeConferida: true }])("sem observação identificada não avisa (%j)", async resultadoConsulta => {
  const f = setup();
  // Reproduz o risco do índice antigo visto no piloto: ele jamais é prova atual.
  f.guide.extracted.dasPago = false;
  expect(await f.run({ resultadoConsulta })).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_NEGATIVA_NAO_COMPROVADA" });
  semSaida(f); expect(f.records.size).toBe(0);
});

test.each(["CONFIRMADO", "INDETERMINADO", "PARCIAL_OU_DIVERGENTE", "NAO_APLICAVEL"])("estado %s não autoriza aviso", async estado => {
  const f = setup(); f.refazerProva({ estado });
  expect(await f.run()).toMatchObject({ status: "PENDENTE" }); semSaida(f);
});

test.each([{ cobertura: "PARCIAL" }, { identidadeConferida: false }, { fonte: "PAGTOWEB" }, { fonte: "INDICE_ANTIGO" }])("evidência insuficiente ou fonte sem negativa comprovada não autoriza (%j)", async extra => {
  const f = setup(); f.refazerProva(extra);
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_NEGATIVA_NAO_COMPROVADA" }); semSaida(f);
});

test.each([{ applied: false }, { ignoredReason: "DOCUMENTO_ALTERADO" }, { state: "INDETERMINADO" }, { guideId: "outra" }, { guideReferenceId: "outra" }, { portalClientId: "outra" }, { consultaId: "outra" }])("registro rejeitado ou de outro escopo não autoriza (%j)", async extra => {
  const f = setup(); Object.assign(f.observacao, extra);
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_NEGATIVA_NAO_COMPROVADA" }); semSaida(f);
});

test("projeção sem registro append-only não basta", async () => {
  const f = setup(); f.db.guidePaymentObservation.findUnique.mockResolvedValue(null);
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_NEGATIVA_NAO_COMPROVADA" }); semSaida(f);
});

test.each([
  { consultadoEm: "2026-09-23T13:59:00Z", scheduledAt: "2026-09-23T10:00:00Z" },
  { consultadoEm: "2026-09-24T10:59:59Z", scheduledAt: "2026-09-24T11:00:00Z" },
  { consultadoEm: "2026-09-24T15:00:01Z", scheduledAt: "2026-09-24T11:00:00Z" },
  { consultadoEm: "2026-09-24T14:00:00Z", scheduledAt: "inválido" },
])("consulta antiga, anterior à rodada ou futura não autoriza (%j)", async ({ consultadoEm, scheduledAt }) => {
  const f = setup(); f.refazerProva({ consultadoEm });
  expect(await f.run({ scheduledAt })).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_DESATUALIZADA" }); semSaida(f);
});

test("retomada usa a mesma observação recente, sem inventar data nova", async () => {
  const f = setup();
  const r = await f.run({ resultadoConsulta: structuredClone(f.guide.extracted.consultaPagamento) });
  expect(r.status).toBe("ENVIADO");
  expect([...f.records.values()][0].value).toMatchObject({ observacaoId: "obs", consultaId: "consulta", consultadoEm: "2026-09-24T14:00:00.000Z", documentRevision: f.observacao.documentRevision });
});

test.each(["resultado", "projecao", "registro"])("instante de %s adulterado não transforma consulta antiga em atual", async local => {
  const f = setup();
  if (local === "resultado") f.resultado.consultadoEm = "2026-09-24T14:30:00Z";
  if (local === "projecao") f.guide.extracted.consultaPagamento.consultadoEm = "2026-09-24T14:30:00Z";
  if (local === "registro") f.observacao.checkedAt = new Date("2026-09-24T14:30:00Z");
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_DESATUALIZADA" }); semSaida(f);
});

test.each([{ hash: "pdf-retificado" }, { valor: "999" }, { competencia: "2026-08" }, { cnpj: "99999999000199" }])("alteração da obrigação invalida consulta antes do aviso (%j)", async extra => {
  const f = setup(); Object.assign(f.guide, extra);
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_DOCUMENTO_ALTERADO" }); semSaida(f);
});

test("CNPJ atual da empresa é conferido, mesmo sem editar a guia", async () => {
  const f = setup(); f.company.cnpj = "99999999000199";
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_DOCUMENTO_ALTERADO" }); semSaida(f);
});

test.each([{ paymentStatusSource: "CLIENTE" }, { clienteConfirmouEm: new Date("2026-09-24") }, { baixada: true }, { paymentConfirmedAt: new Date("2026-09-24") }])("declaração/baixa preservada bloqueia aviso mesmo com OPEN legado (%j)", async extra => {
  const f = setup(); Object.assign(f.guide, extra);
  expect(await f.run()).toMatchObject({ status: "IGNORADO", motivo: "PAGAMENTO_JA_CONFIRMADO" }); semSaida(f);
});

test.each([null, "UNKNOWN"])("estado financeiro %s não é presumido aberto", async paymentStatus => {
  const f = setup(); f.guide.paymentStatus = paymentStatus;
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_NAO_CONCLUIDA" }); semSaida(f);
});

test.each(["INDETERMINADO", "CONFIRMADO"])("projeção mais nova %s impede resultado negativo antigo", async estado => {
  const f = setup(); Object.assign(f.guide.extracted.consultaPagamento, { estado, observacaoId: "nova", consultaId: "nova" });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "CONSULTA_SUPERADA" }); semSaida(f);
});

test.each(["PDF", "INCONCLUSIVA", "CNPJ", "VENCIDA"])("mudança %s imediatamente antes do transporte impede saída", async caso => {
  const f = setup(); let enviadas = 0;
  f.transporte.email.mockImplementation(async ({ conferir }) => {
    if (caso === "PDF") f.guide.hash = "pdf-novo";
    if (caso === "INCONCLUSIVA") f.guide.extracted.consultaPagamento.estado = "INDETERMINADO";
    if (caso === "CNPJ") f.company.cnpj = "99999999000199";
    if (caso === "VENCIDA") jest.setSystemTime(new Date("2026-09-25T14:00:01Z"));
    await conferir(); enviadas++;
  });
  expect((await f.run()).status).toBe("PENDENTE"); expect(enviadas).toBe(0);
  expect([...f.records.values()][0].value.status).toBe("PENDENTE");
});

test("metadados de envio não invalidam a evidência fiscal", async () => {
  const f = setup(); Object.assign(f.guide, { emailStatus: "SENT", updatedAt: new Date() });
  expect((await f.run()).status).toBe("ENVIADO");
});

test.each(["PARCSN", "PARCMEI"])("negativa aplicada da parcela %s usa o contrato vigente", async tipo => {
  const f = setup(); prepararParcela(f, tipo);
  expect((await f.run({ parcelaId: "parcela-nova" })).status).toBe("ENVIADO");
  expect(f.transporte.email.mock.calls[0][0].texto).toContain("parcela 1 do parcelamento 123");
});

test.each(["CONTRATO", "REFERENCIA", "NUMERO", "GUIA", "INCONCLUSIVA", "EXCLUIDO"])("parcela alterada %s não reutiliza evidência anterior", async caso => {
  const f = setup(); const p = prepararParcela(f);
  if (caso === "CONTRATO") p.parcelamento.numeroParcelamento = "999";
  if (caso === "REFERENCIA") p.anoMesParcela = "202608";
  if (caso === "NUMERO") p.numeroParcela = 2;
  if (caso === "GUIA") p.guiaId = "outra";
  if (caso === "INCONCLUSIVA") p.pagamentoStatus = "INDETERMINADO";
  if (caso === "EXCLUIDO") p.parcelamento.status = "EXCLUIDO";
  expect((await f.run({ parcelaId: "parcela-nova" })).status).toBe("PENDENTE"); semSaida(f);
});

test("parcela sem número de arrecadação ainda exige identidade oficial de contrato e referência", async () => {
  const f = setup(); prepararParcela(f);
  delete f.guide.extracted.numeroDocumento;
  f.refazerProva({ numeroDocumento: null });
  expect((await f.run({ parcelaId: "parcela-nova" })).status).toBe("ENVIADO");
});

test("fonte PGDAS não avisa INSS e prova de parcela precisa da parcela atual", async () => {
  const f = setup(); f.guide.tipo = "INSS"; f.refazerProva();
  expect((await f.run()).status).toBe("PENDENTE"); semSaida(f);
  f.guide.tipo = "SIMPLES"; prepararParcela(f);
  expect((await f.run()).status).toBe("PENDENTE"); semSaida(f);
});

test("contraprova DAS antigo negativo fresco não avisa se outro DAS local do mesmo PA está pago", async () => {
  const f = setup();
  f.outrasGuias.push({ ...structuredClone(f.guide), id: "das-atual", hash: "pdf-atual", paymentStatus: "PAID", extracted: { numeroDocumento: "07162619444412337" } });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "GUIAS_DO_PERIODO_AMBIGUAS" });
  semSaida(f); expect(f.records.size).toBe(0);
});

test.each([
  { paymentStatus: "OPEN" }, { paymentStatus: "OVERDUE" }, { paymentStatus: "OPEN", paymentStatusSource: "CLIENTE" },
  { paymentStatus: "OPEN", baixada: true }, { paymentStatus: "PAID", liberadaCliente: false },
  { paymentStatus: "OPEN", status: "NEEDS_REVIEW" }, { paymentStatus: "OPEN", extracted: {} },
])("outra versão mensal ativa ou paga bloqueia aviso mesmo com prova exata negativa (%j)", async extra => {
  const f = setup();
  f.outrasGuias.push({ ...structuredClone(f.guide), id: "outra", extracted: { numeroDocumento: "07162619444412337" }, ...extra });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "GUIAS_DO_PERIODO_AMBIGUAS" }); semSaida(f);
});

test("duplicata do mesmo documento paga bloqueia o exemplar que continuou OPEN", async () => {
  const f = setup(); f.outrasGuias.push({ ...structuredClone(f.guide), id: "duplicata", paymentStatus: "PAID" });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "GUIAS_DO_PERIODO_AMBIGUAS" }); semSaida(f);
});

test.each([
  { tipo: "INSS", paymentStatus: "PAID" }, { tipo: "DARF", paymentStatus: "PAID" }, { tipo: "OUTRA", paymentStatus: "PAID" },
  { competencia: "2026-08", paymentStatus: "PAID" }, { portalClientId: "outra-empresa", paymentStatus: "PAID" },
  { parcelamentoId: "contrato", paymentStatus: "PAID" }, { extracted: { isParcelamento: true }, paymentStatus: "PAID" },
  { extracted: { parcelamentoAvulso: true }, paymentStatus: "PAID" }, { numeroParcela: 1, paymentStatus: "PAID" },
  { status: "VAZIO", paymentStatus: "OPEN" },
])("obrigações diferentes ou registro sem guia não bloqueiam um DAS mensal único (%j)", async extra => {
  const f = setup();
  f.outrasGuias.push({ ...structuredClone(f.guide), id: "outra", extracted: { numeroDocumento: "07162619444412337" }, ...extra });
  expect((await f.run()).status).toBe("ENVIADO");
  expect(f.db.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { not: "g" }, portalClientId: "c", competencia: "2026-09", tipo: "SIMPLES", parcelamentoId: null } }));
});

test("duplicata aberta do mesmo documento não inventa uma versão diferente", async () => {
  const f = setup(); f.outrasGuias.push({ ...structuredClone(f.guide), id: "duplicata" });
  expect((await f.run()).status).toBe("ENVIADO");
});

test("guia nova paga inserida durante a preparação impede o aviso da antiga antes da rede", async () => {
  const f = setup(); let enviadas = 0;
  f.transporte.email.mockImplementation(async ({ conferir }) => {
    f.outrasGuias.push({ ...structuredClone(f.guide), id: "nova", paymentStatus: "PAID", extracted: { numeroDocumento: "07162619444412337" } });
    await conferir(); enviadas++;
  });
  expect((await f.run()).status).toBe("PENDENTE"); expect(enviadas).toBe(0);
  expect([...f.records.values()][0].value).toMatchObject({ status: "PENDENTE", motivo: "GUIAS_DO_PERIODO_AMBIGUAS" });
});

test.each([
  { documentos: [{ numeroDocumento: "07162619444412336", dasPago: false }, { numeroDocumento: "07162619444412337", dasPago: true }] },
  { documentos: [{ numeroDocumento: "07162619444412336", dasPago: false }, { numeroDocumento: "07162619444412337", dasPago: false }] },
  { documentos: [{ numeroDocumento: "07162619444412336", dasPago: null }] },
  { documentos: [{ numeroDocumento: "07162619444412336", dasPago: "false" }] },
  { documentos: [{ numeroDocumento: "07162619444412337", dasPago: false }] },
  { cobertura: "PARCIAL" }, { competencia: "2026-08" }, { impedimentoAviso: "DECLARACAO_POSTERIOR_OU_SEM_DATA" },
])("índice atual do PA ambíguo impede aviso mesmo sem outra guia cadastrada (%j)", async extra => {
  const f = setup();
  f.refazerProva({ evidencia: { periodoPgdas: { ...f.resultado.evidencia.periodoPgdas, ...extra } } });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "INDICE_PGDAS_AMBIGUO" });
  expect(f.outrasGuias).toHaveLength(0); semSaida(f); expect(f.records.size).toBe(0);
});

test("índice exato false sem metadados da cobertura do PA não comprova vigência", async () => {
  const f = setup(); f.refazerProva({ evidencia: { competencia: "2026-09", dasPago: false, vinculo: "DOCUMENTO_EXATO" } });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "INDICE_PGDAS_AMBIGUO" }); semSaida(f);
});

test("metadados do PA sem impedimentoAviso explícito não autorizam aviso", async () => {
  const f = setup();
  const periodoPgdas = { ...f.resultado.evidencia.periodoPgdas };
  delete periodoPgdas.impedimentoAviso;
  f.refazerProva({ evidencia: { periodoPgdas } });
  expect(await f.run()).toMatchObject({ status: "PENDENTE", motivo: "INDICE_PGDAS_AMBIGUO" }); semSaida(f);
});
