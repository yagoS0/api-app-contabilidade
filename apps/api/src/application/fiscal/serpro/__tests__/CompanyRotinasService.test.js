jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  appSetting: { findMany: jest.fn() },
  portalClient: { findMany: jest.fn() }, company: { findMany: jest.fn() },
  companyRotina: { findMany: jest.fn(), createMany: jest.fn(), upsert: jest.fn() },
} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ ROTINA_KEYS: ["das", "inss", "extrato", "presumido", "parcelamento", "pagamento", "conferencia"] }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { listCompanyRotinas, seedRotinasFromLegacy, saveCompanyRotinas, idsComRotinaAtiva } from "../CompanyRotinasService.js";

beforeEach(() => {
  jest.clearAllMocks();
  prisma.appSetting.findMany.mockResolvedValue([]);
  prisma.portalClient.findMany.mockResolvedValue([{ id: "p", companyId: "c", razao: "Empresa", status: "ATIVA" }]);
  prisma.company.findMany.mockResolvedValue([{ id: "c", regimeTributario: "SIMPLES" }]);
  prisma.companyRotina.findMany.mockResolvedValue([]);
});

test("GET não grava nem liga rotinas inferidas do regime", async () => {
  const [empresa] = await listCompanyRotinas();
  expect(Object.values(empresa.rotinas).every(v => v === false)).toBe(true);
  expect(prisma.companyRotina.createMany).not.toHaveBeenCalled();
  expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
});

test("GET preserva escolhas salvas e deixa ausências desligadas", async () => {
  prisma.companyRotina.findMany.mockResolvedValue([{ portalClientId: "p", rotina: "das", enabled: true }, { portalClientId: "p", rotina: "pagamento", enabled: false }]);
  expect((await listCompanyRotinas())[0].rotinas).toMatchObject({ das: true, pagamento: false, inss: false, parcelamento: false });
  expect(prisma.companyRotina.createMany).not.toHaveBeenCalled();
  expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
});

test("manutenção explícita inicializa somente ausências desligadas", async () => {
  prisma.companyRotina.findMany.mockResolvedValue([{ portalClientId: "p", rotina: "das", enabled: true }, { portalClientId: "p", rotina: "pagamento", enabled: false }]);
  await seedRotinasFromLegacy();
  const { data, skipDuplicates } = prisma.companyRotina.createMany.mock.calls[0][0];
  expect(skipDuplicates).toBe(true);
  expect(data).toHaveLength(5);
  expect(data.every(r => r.enabled === false)).toBe(true);
  expect(data.some(r => ["das", "pagamento"].includes(r.rotina))).toBe(false);
  expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
});

test("apenas salvamento explícito altera rotinas enviadas; worker lê enabled true persistido", async () => {
  await saveCompanyRotinas([{ companyId: "p", rotinas: { pagamento: true, das: false } }]);
  expect(prisma.companyRotina.upsert).toHaveBeenCalledTimes(2);
  expect(prisma.companyRotina.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId_rotina: { portalClientId: "p", rotina: "pagamento" } }, update: { enabled: true } }));
  prisma.companyRotina.findMany.mockResolvedValue([{ portalClientId: "p" }]);
  expect(await idsComRotinaAtiva("pagamento")).toEqual(new Set(["p"]));
  expect(prisma.companyRotina.findMany).toHaveBeenLastCalledWith({ where: { rotina: "pagamento", enabled: true }, select: { portalClientId: true } });
});

test('seleção de lembretes é independente e não entra no lote fiscal', async () => {
  prisma.companyRotina.findMany.mockResolvedValue([{ portalClientId: 'p', rotina: 'pagamento', enabled: true }]);
  expect((await listCompanyRotinas())[0].lembretes.enabled).toBe(false);
  prisma.companyRotina.findMany.mockResolvedValue([{ portalClientId: 'p', rotina: 'avisos_guias_whatsapp', enabled: true }]);
  const [company] = await listCompanyRotinas();
  expect(company.lembretes.enabled).toBe(true);
  expect(company.rotinas.pagamento).toBe(false);
  expect(company.rotinas.avisos_guias_whatsapp).toBeUndefined();
  await saveCompanyRotinas([{ companyId: 'p', rotinas: { avisos_guias_whatsapp: false } }]);
  expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
});

test('projeção do ciclo usa configuração única sem acrescentar rotina obrigatória ou escrever', async () => {
 prisma.appSetting.findMany.mockResolvedValue([{ key: 'ciclo_simples_config:p', value: { enabled: true, fontes: ['NFSE'] } }]);
 const [company] = await listCompanyRotinas();
 expect(company.cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'], applicableCurrentRegime: true, configurationValid: true });
 expect(company.rotinas.simples_coleta_calculo).toBeUndefined();
 expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
});

test('lista preserva seleção histórica fora do regime atual sem declarar aplicabilidade ou gravar', async () => {
 prisma.company.findMany.mockResolvedValue([{ id: 'c', regimeTributario: 'LUCRO_PRESUMIDO' }]);
 prisma.appSetting.findMany.mockResolvedValue([{ key: 'ciclo_simples_config:p', value: { enabled: true, fontes: ['NFSE'] } }]);
 expect((await listCompanyRotinas())[0].cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'], applicableCurrentRegime: false, configurationValid: true });
 expect(prisma.companyRotina.upsert).not.toHaveBeenCalled();
 expect(prisma.companyRotina.createMany).not.toHaveBeenCalled();
});
