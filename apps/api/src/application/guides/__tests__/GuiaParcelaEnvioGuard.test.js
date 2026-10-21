jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { $transaction: jest.fn(), guide: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() } } }));
jest.mock("../GuideCompanyEmailService.js", () => ({ sendCompanyGuidesEmail: jest.fn() }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { bloqueioEnvioParcela, conferirParcelasParaEnvio, SELECT_PARCELA_ENVIO } from "../GuiaParcelaEnvioGuard.js";
import { liberarGuiaCliente, liberarGuiasCliente } from "../GuideLiberacaoService.js";
import { avaliarLinha } from "../../whatsapp/elegibilidadeEnvioGuia.js";
const guia = { id: "g", portalClientId: "c", parcelamentoId: "p", valor: 100, vencimento: new Date("2026-09-25Z"),
  status: "PROCESSED", paymentStatus: "OPEN", parcelamento: { formaPagamento: "GUIA" } };
beforeEach(() => jest.clearAllMocks());
test.each([
  [{ extracted: { conferenciaDocumentoPendente: true } }, "PARCELA_DOCUMENTO_PENDENTE"],
  [{ valor: null }, "PARCELA_DOCUMENTO_INCOMPLETO"],
  [{ vencimento: null }, "PARCELA_DOCUMENTO_INCOMPLETO"],
  [{ parcelamento: { formaPagamento: "DEBITO_AUTOMATICO" } }, "PARCELA_DEBITO_AUTOMATICO"],
  [{ paymentStatus: "PAID" }, "PARCELA_PAGA"],
  [{ baixada: true }, "PARCELA_PAGA"],
  [{ parcela: { pagamentoStatus: "CONFIRMADO" } }, "PARCELA_PAGA"],
  [{ parcela: { origemBaixa: "HISTORICO" } }, "PARCELA_PAGA"],
  [{ parcela: { baixadaEm: new Date() } }, "PARCELA_PAGA"],
])("bloqueia cobrança por evidência atual %j", (extra, code) => {
  const g = { ...guia, ...extra };
  expect(bloqueioEnvioParcela(g)).toMatchObject({ code });
  expect(avaliarLinha({ guide: g, canal: { disponivel: true }, destinatario: { contato: {} } })).toMatchObject({ pode: false, motivo: code, canalSugerido: null });
});
test("preserva outras guias e permite parcela conferida em boleto", () => {
  expect(bloqueioEnvioParcela({ id: "das", tipo: "SIMPLES" })).toBeNull();
  expect(bloqueioEnvioParcela(guia)).toBeNull();
  expect(SELECT_PARCELA_ENVIO.parcela.select.pagamentoStatus).toBe(true);
  expect(SELECT_PARCELA_ENVIO).not.toHaveProperty("parcelas");
});
test("recarrega a parcela e barra confirmação fiscal ocorrida depois da prévia", async () => {
  prisma.guide.findFirst.mockResolvedValue({ ...guia, parcela: { pagamentoStatus: "CONFIRMADO" } });
  await expect(conferirParcelasParaEnvio([guia])).rejects.toMatchObject({ code: "PARCELA_PAGA" });
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g", portalClientId: "c" } }));
});
test.each(["individual", "competencia"])("liberação %s impede exposição ao portal antes de qualquer escrita", async modo => {
  const pendente = { ...guia, extracted: { conferenciaDocumentoPendente: true } };
  prisma.guide.findUnique.mockResolvedValue(pendente);
  prisma.guide.findMany.mockResolvedValue([pendente]);
  prisma.guide.findFirst.mockResolvedValue(pendente);
  const chamada = modo === "individual" ? liberarGuiaCliente({ guideId: "g" }) : liberarGuiasCliente({ portalClientId: "c", competencia: "2026-09" });
  await expect(chamada).rejects.toMatchObject({ code: "PARCELA_DOCUMENTO_PENDENTE" });
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
});

 test("conflito durante liberação em competência reverte o lote e não envia e-mail", async () => {
  const rows = ["a", "b"].map(id => ({ ...guia, id, updatedAt: new Date("2026-09-01Z"), liberadaCliente: false }));
  prisma.guide.findMany.mockResolvedValue(rows);
  prisma.guide.findFirst.mockResolvedValue(guia);
  const gravadas = [];
  prisma.$transaction.mockImplementation(async fn => { try { return await fn({ guide: { updateMany: async query => {
    expect(query.where.updatedAt).toEqual(rows[0].updatedAt);
    if (query.where.id === "b") return { count: 0 };
    gravadas.push(query.where.id); return { count: 1 };
  } } }); } catch (e) { gravadas.length = 0; throw e; } });
  await expect(liberarGuiasCliente({ portalClientId: "c", competencia: "2026-09" })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
  expect(gravadas).toEqual([]);
 });


test('declaração da indicação impede cobrança avulsa e preserva vigência/isolamento', async () => {
 const g = { ...guia, extracted: { indicacaoParcelamentoId: 'i' }, vencimento: new Date('2026-10-20Z') };
 const client = { parcelamentoIndicacao: { findFirst: jest.fn(async () => ({ id: 'i', portalClientId: 'c' })) }, appSetting: { findUnique: jest.fn(async () => ({ value: { periodos: [{ desde: '2026-10', formaPagamento: 'DEBITO_AUTOMATICO', usuarioId: 'u', em: '2026-10-01' }] } })) } };
 await expect(conferirParcelasParaEnvio([g], { client, atualizar: false })).rejects.toMatchObject({ code: 'PARCELA_DEBITO_AUTOMATICO' });
 expect(client.parcelamentoIndicacao.findFirst).toHaveBeenCalledWith({ where: { id: 'i', portalClientId: 'c' } });
 await expect(conferirParcelasParaEnvio([{ ...g, vencimento: new Date('2026-09-20Z') }], { client, atualizar: false })).resolves.toBeUndefined();
 client.parcelamentoIndicacao.findFirst.mockResolvedValue(null);
 await expect(conferirParcelasParaEnvio([g], { client, atualizar: false })).rejects.toMatchObject({ code: 'PARCELA_INDICACAO_INVALIDA' });
});


test('transição avulsa para contrato real usa forma atual sem apagar histórico nem liberar débito automático', async () => {
 const historico = { indicacaoParcelamentoId: 'i' };
 const avulsa = { ...guia, extracted: historico, vencimento: new Date('2026-10-20Z'), parcelamento: { origem: 'GUIA_AVULSA', formaPagamento: 'GUIA_MENSAL' } };
 const client = {
  guide: { findFirst: jest.fn(async () => avulsa) },
  parcelamentoIndicacao: { findFirst: jest.fn(async () => ({ id: 'i', portalClientId: 'c', status: 'VINCULADO' })) },
  appSetting: { findUnique: jest.fn(async () => ({ value: { periodos: [{ desde: '2026-10', formaPagamento: 'DEBITO_AUTOMATICO', usuarioId: 'u', em: '2026-10-01' }] } })) },
 };
 await expect(conferirParcelasParaEnvio([avulsa], { client })).rejects.toMatchObject({ code: 'PARCELA_DEBITO_AUTOMATICO' });
 const real = { ...avulsa, parcelamentoId: 'contrato-real', parcelamento: { origem: 'MANUAL', formaPagamento: 'GUIA_MENSAL' } };
 client.guide.findFirst.mockResolvedValue(real);
 client.parcelamentoIndicacao.findFirst.mockClear();
 client.appSetting.findUnique.mockClear();
 await expect(conferirParcelasParaEnvio([avulsa], { client })).resolves.toBeUndefined();
 expect(client.guide.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ select: expect.objectContaining({ parcelamento: { select: { formaPagamento: true, status: true, origem: true } } }) }));
 expect(client.parcelamentoIndicacao.findFirst).not.toHaveBeenCalled();
 expect(client.appSetting.findUnique).not.toHaveBeenCalled();
 expect(real.extracted).toEqual(historico);
 client.guide.findFirst.mockResolvedValue({ ...real, parcelamento: { origem: 'MANUAL', formaPagamento: 'DEBITO_AUTOMATICO' } });
 await expect(conferirParcelasParaEnvio([avulsa], { client })).rejects.toMatchObject({ code: 'PARCELA_DEBITO_AUTOMATICO' });
 client.guide.findFirst.mockResolvedValue({ ...real, parcelamento: { formaPagamento: 'GUIA_MENSAL' } });
 await expect(conferirParcelasParaEnvio([avulsa], { client })).rejects.toMatchObject({ code: 'PARCELA_DEBITO_AUTOMATICO' });
});
