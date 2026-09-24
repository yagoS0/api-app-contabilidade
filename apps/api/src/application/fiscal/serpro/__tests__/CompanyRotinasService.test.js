jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {
  portalClient: { findMany: jest.fn() }, company: { findMany: jest.fn() },
  companyRotina: { findMany: jest.fn(), createMany: jest.fn(), upsert: jest.fn() },
} }));
jest.mock("../SerproRuntimeSettings.js", () => ({ ROTINA_KEYS: ["das", "inss", "extrato", "presumido", "parcelamento", "pagamento", "conferencia"] }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { listCompanyRotinas, seedRotinasFromLegacy, saveCompanyRotinas, idsComRotinaAtiva } from "../CompanyRotinasService.js";

beforeEach(() => {
  jest.clearAllMocks();
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
