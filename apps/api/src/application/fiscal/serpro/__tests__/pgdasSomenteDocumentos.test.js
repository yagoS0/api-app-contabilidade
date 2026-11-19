jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
 appSetting: { upsert: jest.fn(async ({create}) => create) },
 portalClient: { findUnique: jest.fn(async () => ({ id: "c", cnpj: "11222333000181" })) },
 companyMonthlyCircular: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({ id: "circ" })), update: jest.fn(async ({data}) => ({id:"circ", ...data})) },
 apuracaoSnapshot: { updateMany: jest.fn() }, guide: { findFirst: jest.fn() },
} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ certificate: { document: "12345678000199" } })) }));
jest.mock("../SerproProcurationService.js", () => ({ SerproProcurationService: jest.fn(() => ({ checkCompanyProcuration: jest.fn(async () => ({status:"ATIVA",systems:["00146"]})) })) }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn(() => ({ post: jest.fn(async (_route, body) => ({ dados: JSON.stringify(body.pedidoDados.idServico === "CONSDECLARACAO13" ? { indiceDas:{numeroDas:"1",dasPago:true} } : {numeroDeclaracao:"123",declaracao:{pdf:"JVBERi0x"},recibo:{pdf:"JVBERi0x"}}) })) })) }));
jest.mock("../../../guides/GuideStorageService.js", () => ({ GuideStorageService: { create: () => ({ upload: jest.fn(async ({key}) => ({key,url:key})) }) } }));
jest.mock("pdf-parse", () => jest.fn(async () => ({text:"Receita Bruta Informada: R$ 0,00"})));
jest.mock("../../../accounting/AccountingEntryGeneratorService.js", () => ({ generateEntriesFromCircular: jest.fn(), FONTE_VALOR_EXTRATO:"EXTRATO" }));
jest.mock("../../../accounting/semFaturamento.js", () => ({ marcarSemFaturamento: jest.fn() }));
jest.mock("../CaptureSerproGuidesService.js", () => ({ capturePgdasGuideForCompany: jest.fn() }));
jest.mock("../../../guides/GuidePaymentStatusService.js", () => ({ markGuideOpenBySerpro: jest.fn(), markGuidePaidBySerpro: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { syncPgdasByCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { SerproProcurationService } from "../SerproProcurationService.js";
import { SerproHttpClient } from "../SerproHttpClient.js";
import { generateEntriesFromCircular } from "../../../accounting/AccountingEntryGeneratorService.js";
import { marcarSemFaturamento } from "../../../accounting/semFaturamento.js";
import { capturePgdasGuideForCompany } from "../CaptureSerproGuidesService.js";
import { markGuidePaidBySerpro } from "../../../guides/GuidePaymentStatusService.js";
import pdfParse from 'pdf-parse';
beforeEach(() => jest.clearAllMocks());

test('recuperação estrita conserva pagamento e não gera efeito contábil', async () => {
 const autorizar = jest.fn(async () => {});
 const r = await syncPgdasByCompetencia({ portalClientId: 'c', competencia: '2026-09', somenteDocumentos: true,
   validacaoDocumental: { numeroDeclaracao: '123', autorizar } });
 expect(r.circular.pgdasNumeroDeclaracao).toBe('123');
 expect(autorizar).toHaveBeenCalled();
 expect(prisma.companyMonthlyCircular.update.mock.calls.every(([a]) => !Object.hasOwn(a.data, 'dasPago') && !Object.hasOwn(a.data, 'dasStatus'))).toBe(true);
 expect(generateEntriesFromCircular).not.toHaveBeenCalled();
 expect(markGuidePaidBySerpro).not.toHaveBeenCalled();
 expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
});

test('declaração divergente é recusada antes dos arquivos e histórico', async () => {
 await expect(syncPgdasByCompetencia({ portalClientId: 'c', competencia: '2026-09', somenteDocumentos: true,
   validacaoDocumental: { numeroDeclaracao: 'OUTRA-DECLARACAO', autorizar: async () => {} } })).rejects.toMatchObject({ code: 'PGDAS_DECLARACAO_DIVERGENTE' });
 expect(pdfParse).not.toHaveBeenCalled();
 expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
 expect(prisma.companyMonthlyCircular.update.mock.calls.every(([a]) => !a.data.pgdasDeclaracaoFileId)).toBe(true);
});

test('cache de outra revisão não substitui a declaração solicitada', async () => {
 prisma.companyMonthlyCircular.findUnique.mockResolvedValueOnce({ id: 'circ', serproSyncStatus: 'SUCCESS',
   pgdasNumeroDeclaracao: 'ANTERIOR', pgdasDeclaracaoFileId: 'old-pdf', pgdasReciboFileId: 'old-rec' });
 const r = await syncPgdasByCompetencia({ portalClientId: 'c', competencia: '2026-09', somenteDocumentos: true,
   validacaoDocumental: { numeroDeclaracao: '123', autorizar: async () => {} } });
 expect(r.reutilizado).not.toBe(true);
 expect(r.circular.pgdasNumeroDeclaracao).toBe('123');
 expect(SerproHttpClient).toHaveBeenCalled();
});

test('autorização revogada não reutiliza cache, consulta provedor ou grava circular', async () => {
 await expect(syncPgdasByCompetencia({ portalClientId: 'c', competencia: '2026-09', somenteDocumentos: true,
   validacaoDocumental: { numeroDeclaracao: '123', autorizar: async () => { throw Object.assign(new Error('Acesso revogado'), { status: 403 }); } } })).rejects.toMatchObject({ status: 403 });
 expect(prisma.companyMonthlyCircular.findUnique).not.toHaveBeenCalled();
 expect(prisma.companyMonthlyCircular.upsert).not.toHaveBeenCalled();
 expect(SerproHttpClient).not.toHaveBeenCalled();
});

test.each([
 ['PDF sem valores extraíveis', false],
 ['Receita Bruta Informada: R$ 0,00', false],
 ['Valor Total do Documento 0,00', false],
 ['Receita Bruta Informada: R$ 0,00\nValor Total do Documento 0,00', true],
 ['Receita Bruta Informada: R$ 100,00\nValor Total do Documento 0,00', false],
])('sincronização não transforma leitura incompleta em mês sem receita: %s', async (text, zeroConfirmado) => {
 pdfParse.mockResolvedValueOnce({ text });
 generateEntriesFromCircular.mockResolvedValueOnce({ ok: true, generatedEntries: [] });
 marcarSemFaturamento.mockResolvedValueOnce({ ok: true });
 const result = await syncPgdasByCompetencia({ portalClientId: 'c', competencia: '2026-09', atualizar: true });
 expect(generateEntriesFromCircular).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: 'c', competencia: '2026-09', fonteValor: 'EXTRATO' }));
 expect(marcarSemFaturamento).toHaveBeenCalledTimes(zeroConfirmado ? 1 : 0);
 expect(result.semFaturamento).toEqual(zeroConfirmado ? { ok: true } : null);
});
test("recupera documentos sem contabilizar, emitir guia ou mudar pagamento", async () => {
 const r=await syncPgdasByCompetencia({portalClientId:"c",competencia:"2026-09",somenteDocumentos:true});
 expect(r.circular.pgdasNumeroDeclaracao).toBe("123");
 expect(r.files.reciboFileId).toBeTruthy();
 expect(r.accounting.somenteDocumentos).toBe(true);
 expect(generateEntriesFromCircular).not.toHaveBeenCalled();
 expect(prisma.apuracaoSnapshot.updateMany).not.toHaveBeenCalled();
 expect(marcarSemFaturamento).not.toHaveBeenCalled();
 expect(capturePgdasGuideForCompany).not.toHaveBeenCalled();
 expect(markGuidePaidBySerpro).not.toHaveBeenCalled();
});
test("sem poder PGDAS não consulta índice ou declaração", async () => {
 SerproProcurationService.mockImplementationOnce(() => ({checkCompanyProcuration:jest.fn(async()=>({status:"ATIVA",systems:["00103"]}))}));
 await expect(syncPgdasByCompetencia({portalClientId:"c",competencia:"2026-09",somenteDocumentos:true})).rejects.toMatchObject({code:"SERPRO_PGDAS_PROCURACAO_INSUFICIENTE"});
 expect(SerproHttpClient).not.toHaveBeenCalled();
});


test("histórico é gravado antes de substituir documentos e mantém modo documental", async () => {
 const anterior={pgdasNumeroDeclaracao:"122",pgdasDeclaracaoFileId:"anterior",pgdasReciboFileId:"rec-anterior",receitaBruta:100,dasTotal:6};
 prisma.companyMonthlyCircular.findUnique.mockResolvedValueOnce(anterior);
 const r=await syncPgdasByCompetencia({portalClientId:"c",competencia:"2026-09",somenteDocumentos:true,atualizar:true});
 expect(prisma.appSetting.upsert.mock.calls.map(([a])=>a.create.value.numeroDeclaracao)).toEqual(["122","123"]);
 expect(prisma.appSetting.upsert.mock.calls[0][0].create.value.declaracaoFileId).toBe("anterior");
 expect(r.circular.metadata.pgdasHistoricoId).toMatch(/^[a-f0-9]{64}$/);
 expect(generateEntriesFromCircular).not.toHaveBeenCalled();
});

test("falha ao preservar histórico impede sobrescrever os PDFs anteriores", async () => {
 prisma.companyMonthlyCircular.findUnique.mockResolvedValueOnce({pgdasNumeroDeclaracao:"122",pgdasDeclaracaoFileId:"anterior"});
 prisma.appSetting.upsert.mockRejectedValueOnce(Error("historico_indisponivel"));
 await expect(syncPgdasByCompetencia({portalClientId:"c",competencia:"2026-09",somenteDocumentos:true,atualizar:true})).rejects.toThrow("historico_indisponivel");
 expect(prisma.companyMonthlyCircular.update.mock.calls.every(([a])=>!a.data.pgdasDeclaracaoFileId)).toBe(true);
});


test("declaração nova sem PDF não herda os arquivos da anterior", async () => {
 const original=SerproHttpClient.getMockImplementation();
 SerproHttpClient.mockImplementation(() => ({ post: jest.fn(async (_route,body) => ({dados:JSON.stringify(body.pedidoDados.idServico === "CONSDECLARACAO13" ? {indiceDas:{numeroDas:"1"}} : {numeroDeclaracao:"124"})})) }));
 try {
  prisma.companyMonthlyCircular.findUnique.mockResolvedValueOnce({pgdasNumeroDeclaracao:"123",pgdasDeclaracaoFileId:"old",pgdasReciboFileId:"old-rec"});
  const r=await syncPgdasByCompetencia({portalClientId:"c",competencia:"2026-09",somenteDocumentos:true,atualizar:true});
  expect(r.circular).toMatchObject({pgdasNumeroDeclaracao:"124",pgdasDeclaracaoFileId:null,pgdasReciboFileId:null,serproSyncStatus:"INCOMPLETE"});
  expect(prisma.appSetting.upsert.mock.calls.map(([a])=>a.create.value.numeroDeclaracao)).toEqual(["123","124"]);
  expect(prisma.appSetting.upsert.mock.calls[1][0].create.value.declaracaoFileId).toBeNull();
 } finally { SerproHttpClient.mockImplementation(original); }
});

test.each([false, true])("cache documental reutilizado, somenteDocumentos=%s", async somenteDocumentos => {
 const circular = { id: "circ", serproSyncStatus: "SUCCESS", pgdasNumeroDeclaracao: "123", pgdasDeclaracaoFileId: "pdf", pgdasReciboFileId: "rec", dasNumeroDocumento: "das-sem-pdf" };
 prisma.companyMonthlyCircular.findUnique.mockResolvedValueOnce(circular);
 prisma.guide.findFirst.mockResolvedValueOnce(null);
 generateEntriesFromCircular.mockResolvedValueOnce({ ok: false, reason: "mes_fechado", circular });
 const r = await syncPgdasByCompetencia({ portalClientId: "c", competencia: "2026-09", somenteDocumentos });
 expect(r.reutilizado).toBe(true);
 expect(SerproHttpClient).not.toHaveBeenCalled();
 expect(capturePgdasGuideForCompany).not.toHaveBeenCalled();
 expect(generateEntriesFromCircular).toHaveBeenCalledTimes(somenteDocumentos ? 0 : 1);
 if (!somenteDocumentos) expect(r.accounting).toMatchObject({ ok: false, reason: "mes_fechado" });
});
