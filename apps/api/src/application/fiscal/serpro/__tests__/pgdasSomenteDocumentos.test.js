jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
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
beforeEach(() => jest.clearAllMocks());
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
