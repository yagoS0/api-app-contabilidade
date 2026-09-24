jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: { appSetting: { findUnique: jest.fn(), upsert: jest.fn() } } }));
jest.mock("../SerproConfig.js", () => ({ getSerproConfig: jest.fn(() => ({ enabled: true, timeoutMs: 30000 })) }));
jest.mock("../../../../infrastructure/storage/CertStorage.js", () => ({ deleteCompanyPfx: jest.fn(), isDatabaseCertificateStorageKey: jest.fn() }));
jest.mock("../../../../utils/crypto.js", () => ({ decryptSecret: jest.fn(async () => "secret"), encryptSecret: jest.fn(async () => "encrypted"), encryptBytes: jest.fn() }));
jest.mock("../../../security/CertAccessAudit.js", () => ({ auditCertAccess: jest.fn() }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { getSerproRuntimeSettings, updateSerproRuntimeSettings, ROTINA_KEYS } from "../SerproRuntimeSettings.js";

let stored;
beforeEach(() => {
  jest.clearAllMocks(); stored = {};
  prisma.appSetting.findUnique.mockImplementation(async () => ({ value: stored }));
  prisma.appSetting.upsert.mockImplementation(async ({ update }) => { stored = update.value; return { value: stored }; });
});

test.each([{}, { fetchDay: 14, fetchHour: 9, paymentConfirmationEnabled: true, paymentConfirmationDay: 15, paymentConfirmationHour: 10 },
  { fetchCron: "0 8 12-14 * *", rotinas: {} }])("configuração global não autoriza nenhuma rotina ausente: %j", async value => {
  stored = value;
  const result = await getSerproRuntimeSettings();
  expect(Object.values(result.rotinas).every(r => r.enabled === false)).toBe(true);
  expect(result.rotinas.das.day).toBe(5); // sugestão independente da agenda global
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test.each([
  { day: 7, hour: 8 }, { enabled: "true", day: 7, hour: 8 }, { enabled: true, hour: 8 }, { enabled: true, day: 7 },
  { enabled: true, day: null, hour: 8 }, { enabled: true, day: 32, hour: 8 }, { enabled: true, day: 7.5, hour: 8 },
  { enabled: true, day: 7, hour: "" }, { enabled: true, day: 7, hour: 24 }, { enabled: true, day: true, hour: false },
  { enabled: true, day: 7, hour: 8, frequency: "WEEKLY" }, { enabled: true, day: 7, hour: 8, frequency: "DAILY" },
])("configuração ausente/inválida não vira autorização: %j", async salva => {
  stored = { rotinas: { das: salva } };
  expect((await getSerproRuntimeSettings()).rotinas.das.enabled).toBe(false);
});
test("configurações históricas completas mantêm dia e hora, sem janelas extras", async () => {
  stored = { rotinas: Object.fromEntries(ROTINA_KEYS.map((key, i) => [key, { enabled: true, day: i + 1, hour: i }])) };
  const result = await getSerproRuntimeSettings();
  ROTINA_KEYS.forEach((key, i) => expect(result.rotinas[key]).toMatchObject({ enabled: true, day: i + 1, hour: i, frequency: "MONTHLY", cron: `0 ${i} ${i + 1} * *` }));
});
test("pagamento diário exige configuração explícita e mantém meia-noite", async () => {
  stored = { rotinas: { pagamento: { enabled: true, day: 31, hour: 0, frequency: "DAILY" } } };
  expect((await getSerproRuntimeSettings()).rotinas.pagamento).toMatchObject({ enabled: true, cron: "0 0 * * *", hour: 0 });
});
test("cron mensal legado também não inclui D+1 ou D+2", async () => {
  stored = { fetchDay: 10, fetchHour: 7, paymentConfirmationDay: 20, paymentConfirmationHour: 8 };
  expect(await getSerproRuntimeSettings()).toMatchObject({ fetchCron: "0 7 10 * *", paymentConfirmationCron: "0 8 20 * *" });
});
test.each([
  { enabled: true }, { enabled: true, day: 10 }, { enabled: true, hour: 7 }, { enabled: true, day: 0, hour: 7 },
  { enabled: true, day: 10, hour: 24 }, { enabled: true, day: 10.5, hour: 7 }, { enabled: true, day: 10, hour: null },
  { enabled: "true", day: 10, hour: 7 }, { enabled: true, day: " ", hour: 7 }, { enabled: true, day: 10, hour: false },
  { enabled: true, day: 10, hour: 7, frequency: "WEEKLY" }, { enabled: true, day: 10, hour: 7, frequency: "DAILY" },
])("gravação recusa agenda inválida sem aplicar padrões: %j", async entrada => {
  stored = { fetchDay: 15, fetchHour: 9 };
  await expect(updateSerproRuntimeSettings({ rotinas: { das: entrada } })).rejects.toMatchObject({ code: "SERPRO_ROTINA_AGENDA_INVALIDA", status: 400 });
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
test("mudança de credenciais não materializa sugestões como agendas salvas", async () => {
  stored = { consumerKey: "old", customConfig: { preserve: true } };
  const out = await updateSerproRuntimeSettings({ consumerKey: "new" });
  expect(stored).not.toHaveProperty("rotinas");
  expect(stored.customConfig).toEqual({ preserve: true });
  expect(Object.values(out.rotinas).every(r => !r.enabled)).toBe(true);
});
test("merge parcial usa somente campos efetivamente persistidos e preserva demais rotinas", async () => {
  stored = { rotinas: { inss: { enabled: true, day: 11, hour: 8 }, das: { enabled: false, day: 10, hour: 0 } }, customConfig: 123 };
  const out = await updateSerproRuntimeSettings({ rotinas: { das: { enabled: true } } });
  expect(stored.rotinas).toEqual({ inss: { enabled: true, day: 11, hour: 8 }, das: { enabled: true, day: 10, hour: 0 } });
  expect(out.rotinas.das).toMatchObject({ enabled: true, cron: "0 0 10 * *" });
  expect(stored.customConfig).toBe(123);
});
test("desabilitar configuração antiga incompleta é permitido sem completá-la", async () => {
  stored = { rotinas: { das: { enabled: true } } };
  await updateSerproRuntimeSettings({ rotinas: { das: { enabled: false } } });
  expect(stored.rotinas.das).toEqual({ enabled: false });
});
test("habilitar rotina nova exige informar agenda mesmo depois de ler sugestões", async () => {
  await getSerproRuntimeSettings();
  await expect(updateSerproRuntimeSettings({ rotinas: { conferencia: { enabled: true } } })).rejects.toMatchObject({ code: "SERPRO_ROTINA_AGENDA_INVALIDA" });
  await expect(updateSerproRuntimeSettings({ rotinas: { conferencia: { enabled: true, day: 1, hour: 6 } } })).resolves.toMatchObject({ rotinas: { conferencia: { enabled: true, cron: "0 6 1 * *" } } });
});
test.each([null, [], "all", { desconhecida: { enabled: true } }])("objeto de rotinas malformado é recusado: %j", async rotinas => {
  await expect(updateSerproRuntimeSettings({ rotinas })).rejects.toMatchObject({ code: "SERPRO_ROTINA_AGENDA_INVALIDA" });
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
});
