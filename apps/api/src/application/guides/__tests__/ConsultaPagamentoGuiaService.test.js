jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { capturarRevisaoConsulta, normalizarResultadoConsultaPagamento, registrarConsultaPagamentoGuia } from "../ConsultaPagamentoGuiaService.js";

const copia = obj => structuredClone(obj);
const guiaBase = () => ({
  id: "guia-1", portalClientId: "empresa-1", cnpj: "12345678000199", tipo: "SIMPLES",
  competencia: "2026-08", valor: "100", status: "PROCESSED", paymentStatus: "OPEN",
  hash: "pdf-v1", extracted: { numeroDocumento: "12345678901234567" },
});
const resultado = (estado, extra = {}) => ({
  consultaId: "consulta-1", estado, fonte: "PGDASD_CONSDECLARACAO13",
  consultadoEm: "2026-09-25T11:00:00.000Z", cobertura: "COMPLETA",
  identidadeConferida: true, numeroDocumento: "12345678901234567", ...extra,
});
function memoria(inicial) {
  let guia = copia(inicial);
  const registros = [];
  const tx = {
    $queryRaw: jest.fn(async () => guia ? [{ id: guia.id }] : []),
    portalClient: { findUnique: jest.fn(async () => ({ cnpj: guia?.cnpj })) },
    guide: {
      findUnique: jest.fn(async () => copia(guia)),
      update: jest.fn(async ({ data }) => { guia = { ...guia, ...data }; return copia(guia); }),
    },
    guidePaymentObservation: {
      findUnique: jest.fn(async ({ where }) => registros.find(r => r.consultaId === where.guideReferenceId_consultaId.consultaId) || null),
      create: jest.fn(async ({ data }) => { const r = { id: "obs-" + registros.length, ...data }; registros.push(r); return r; }),
    },
  };
  return { client: { $transaction: fn => fn(tx) }, tx, registros, atual: () => guia };
}

describe("observações fiscais de pagamento", () => {
  test.each(["INDETERMINADO", "PARCIAL_OU_DIVERGENTE", "NAO_APLICAVEL", "NAO_LOCALIZADO"])("%s não muda pagamento", async estado => {
    const g = guiaBase(), db = memoria(g);
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado(estado), client: db.client });
    expect(r.aplicada).toBe(true);
    expect(db.atual().paymentStatus).toBe("OPEN");
    expect(db.atual().paymentConfirmedAt).toBeUndefined();
    expect(db.registros).toHaveLength(1);
    expect(db.atual().extracted.consultaPagamento.estado).toBe(estado);
  });
  test("PGDAS confirmado não inventa comprovante nem data do pagamento", async () => {
    const g = guiaBase(), db = memoria(g);
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    expect(r.guia).toMatchObject({ paymentStatus: "PAID", paymentStatusSource: "SERPRO", paymentConfirmedAt: null, serproLastCheckResult: "PGDAS_PAGAMENTO_CONFIRMADO" });
    expect(r.guia.comprovantePdfFileId).toBeUndefined();
  });
  test("PAGTOWEB preserva data e encargos zero da prova", async () => {
    const g = guiaBase(), db = memoria(g);
    const c = { dataArrecadacao: "21/09/2026", principal: 100, juros: 0, multa: 0, total: 100, confiavel: true };
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO", { fonte: "PAGTOWEB" }), comprovante: c, comprovantePdfFileId: "arquivo", client: db.client });
    expect(db.atual().paymentConfirmedAt).toEqual(new Date("2026-09-21T00:00:00.000Z"));
    expect(db.atual().extracted.comprovante).toMatchObject({ principal: 100, juros: 0, multa: 0 });
  });
  test("duplicação da mesma consulta/guia não escreve duas vezes", async () => {
    const g = guiaBase(), db = memoria(g), args = { guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client };
    await registrarConsultaPagamentoGuia(args);
    const r = await registrarConsultaPagamentoGuia(args);
    expect(r.repetida).toBe(true);
    expect(db.registros).toHaveLength(1);
    expect(db.tx.guide.update).toHaveBeenCalledTimes(1);
  });
  test("recálculo durante HTTP invalida observação sem tocar nova versão", async () => {
    const g = guiaBase(), db = memoria({ ...g, hash: "pdf-v2", valor: "110" });
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    expect(r).toMatchObject({ aplicada: false, motivoNaoAplicada: "DOCUMENTO_ALTERADO", resultadoConsulta: { estado: "INDETERMINADO" } });
    expect(db.tx.guide.update).not.toHaveBeenCalled();
    expect(db.registros[0]).toMatchObject({ state: "CONFIRMADO", applied: false });
  });
  test("replay de consulta anterior após recálculo não autoriza a nova guia", async () => {
    const g = guiaBase(), db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    await db.tx.guide.update({ data: { hash: "pdf-v2", paymentStatus: "OPEN" } });
    const r = await registrarConsultaPagamentoGuia({ guide: copia(db.atual()), resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    expect(r).toMatchObject({ aplicada: false, repetida: true, motivoNaoAplicada: "DOCUMENTO_ALTERADO", resultadoConsulta: { estado: "INDETERMINADO" } });
    expect(db.registros).toHaveLength(1);
    expect(db.atual().paymentStatus).toBe("OPEN");
  });
  test.each([{ numeroDocumento: "76543210987654321" }, { cnpj: "99999999000199" }])("identidade da observação não pode contradizer a guia (%j)", async extra => {
    const g = guiaBase(), db = memoria(g);
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO", extra), client: db.client });
    expect(r.motivoNaoAplicada).toBe("IDENTIDADE_RESULTADO_DIVERGENTE");
    expect(db.atual().paymentStatus).toBe("OPEN");
  });
  test("mudança da empresa não aceita resposta do CNPJ anterior", async () => {
    const g = { ...guiaBase(), portalClient: { cnpj: "12345678000199" } }, db = memoria(g);
    db.tx.portalClient.findUnique.mockResolvedValue({ cnpj: "99999999000199" });
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    expect(r.motivoNaoAplicada).toBe("EMPRESA_ALTERADA");
    expect(db.tx.guide.update).not.toHaveBeenCalled();
  });
  test("consulta negativa atrasada não sobrescreve confirmação recente", async () => {
    const g = guiaBase(), db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    const r = await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("NAO_LOCALIZADO", { consultaId: "antiga", consultadoEm: "2026-09-25T10:00:00Z" }), client: db.client });
    expect(r.motivoNaoAplicada).toBe("OBSERVACAO_SUPERADA");
    expect(db.atual().paymentStatus).toBe("PAID");
    expect(db.atual().extracted.consultaPagamento.estado).toBe("CONFIRMADO");
    expect(db.registros).toHaveLength(2);
  });
  test("resultado negativo recente não reabre PAID nem apaga comprovante", async () => {
    const g = { ...guiaBase(), paymentStatus: "PAID", paymentStatusSource: "SERPRO", comprovantePdfFileId: "oficial" }, db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("NAO_LOCALIZADO"), client: db.client });
    expect(db.atual()).toMatchObject({ paymentStatus: "PAID", paymentStatusSource: "SERPRO", comprovantePdfFileId: "oficial" });
  });
  test("baixa manual conserva data/autoria/composição", async () => {
    const g = { ...guiaBase(), paymentStatus: "PAID", paymentStatusSource: "MANUAL", baixada: true, paymentConfirmedAt: new Date("2026-09-21"), paymentConfirmedByUserId: "contador", extracted: { numeroDocumento: "12345678901234567", comprovante: { principal: 95 } } }, db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), comprovante: { principal: 100 }, client: db.client });
    expect(db.atual()).toMatchObject({ paymentStatusSource: "MANUAL", paymentConfirmedByUserId: "contador", extracted: { comprovante: { principal: 95 } } });
    expect(db.atual().paymentConfirmedAt).toEqual(g.paymentConfirmedAt);
  });
  test("declaração cliente permanece auditável ao confirmar Receita", async () => {
    const g = { ...guiaBase(), paymentStatus: "PAID", paymentStatusSource: "CLIENTE", clienteConfirmouEm: new Date("2026-09-22"), clienteConfirmouPorUserId: "cliente", paymentConfirmedAt: new Date("2026-09-21") }, db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), client: db.client });
    expect(db.atual()).toMatchObject({ paymentStatusSource: "SERPRO", clienteConfirmouPorUserId: "cliente", paymentConfirmedAt: null });
    expect(db.atual().clienteConfirmouEm).toEqual(g.clienteConfirmouEm);
    expect(db.atual().extracted.pagamentoDeclaradoCliente).toMatchObject({ porUserId: "cliente", pagoEmInformado: "2026-09-21T00:00:00.000Z" });
  });
  test("confirmação sem identidade ou cobertura é inconclusiva", () => {
    expect(normalizarResultadoConsultaPagamento(resultado("CONFIRMADO", { identidadeConferida: false })).estado).toBe("INDETERMINADO");
    expect(normalizarResultadoConsultaPagamento(resultado("NAO_LOCALIZADO", { cobertura: "PARCIAL" })).estado).toBe("INDETERMINADO");
    expect(() => normalizarResultadoConsultaPagamento({ estado: "CONFIRMADO" })).toThrow();
  });
  test("mudança de envio não é mudança de documento", () => {
    const g = guiaBase();
    expect(capturarRevisaoConsulta(g)).toBe(capturarRevisaoConsulta({ ...g, updatedAt: new Date(), emailStatus: "SENT" }));
    expect(capturarRevisaoConsulta(g)).not.toBe(capturarRevisaoConsulta({ ...g, pdfBytes: Buffer.from("outro") }));
    const legado = { ...g, extracted: { numeroDoc: "12345678901234567" } };
    expect(capturarRevisaoConsulta(legado)).not.toBe(capturarRevisaoConsulta({ ...legado, extracted: { numeroDoc: "76543210987654321" } }));
  });
  test("nova consulta de situação não apaga data e composição oficiais anteriores", async () => {
    const g = { ...guiaBase(), paymentStatus: "PAID", paymentStatusSource: "SERPRO", paymentConfirmedAt: new Date("2026-09-21"), extracted: { numeroDocumento: "12345678901234567", comprovante: { principal: 100, confiavel: true } } }, db = memoria(g);
    await registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), comprovante: { confiavel: false, principal: null }, client: db.client });
    expect(db.atual().paymentConfirmedAt).toEqual(g.paymentConfirmedAt);
    expect(db.atual().extracted.comprovante).toEqual(g.extracted.comprovante);
  });
  test("reserva perdida antes de gravar não muda guia", async () => {
    const g = guiaBase(), db = memoria(g);
    await expect(registrarConsultaPagamentoGuia({ guide: g, resultadoConsulta: resultado("CONFIRMADO"), assertActive: () => { throw Error("lease perdido"); }, client: db.client })).rejects.toThrow("lease perdido");
    expect(db.registros).toHaveLength(0);
  });
  test("parcela sem número de documento usa contrato e referência conferidos", async () => {
    const g = { ...guiaBase(), extracted: {}, parcelamentoId: "contrato-1", anoMesParcela: "202608", numeroParcela: 5 }, db = memoria(g);
    const r = await registrarConsultaPagamentoGuia({ guide: g, client: db.client, resultadoConsulta: resultado("CONFIRMADO", {
      fonte: "PARCELAMENTO_PARCSN", numeroDocumento: null, cnpj: g.cnpj,
      identidadeObrigacao: { tipo: "PARCELA", parcelamentoId: "contrato-1", numeroParcelamento: "123", anoMesParcela: "202608", numeroParcela: 5 },
    }) });
    expect(r.aplicada).toBe(true);
    expect(db.atual().paymentStatus).toBe("PAID");
    expect(db.atual().serproLastCheckResult).toBe("PARCELA_PAGAMENTO_CONFIRMADO");
  });
  test.each([{ anoMesParcela: "202609" }, { parcelamentoId: "outro" }, { numeroParcela: 6 }])("parcela com referência divergente não confirma (%j)", async extra => {
    const g = { ...guiaBase(), extracted: {}, parcelamentoId: "contrato-1", anoMesParcela: "202608", numeroParcela: 5 }, db = memoria(g);
    const r = await registrarConsultaPagamentoGuia({ guide: g, client: db.client, resultadoConsulta: resultado("CONFIRMADO", {
      fonte: "PARCSN", numeroDocumento: null, cnpj: g.cnpj,
      identidadeObrigacao: { tipo: "PARCELA", parcelamentoId: "contrato-1", numeroParcelamento: "123", anoMesParcela: "202608", numeroParcela: 5, ...extra },
    }) });
    expect(r.aplicada).toBe(false);
    expect(db.atual().paymentStatus).toBe("OPEN");
  });
});
