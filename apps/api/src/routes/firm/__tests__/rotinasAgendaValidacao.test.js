jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../infrastructure/storage/CertStorage.js", () => ({ deleteCompanyPfx: jest.fn(), isDatabaseCertificateStorageKey: jest.fn() }));
jest.mock("../../../utils/crypto.js", () => ({ decryptSecret: jest.fn(), encryptSecret: jest.fn(), encryptBytes: jest.fn() }));
jest.mock("../../../application/security/CertAccessAudit.js", () => ({ auditCertAccess: jest.fn() }));
jest.mock("../../../application/fiscal/serpro/SerproConfig.js", () => ({ getSerproConfig: jest.fn(() => ({})) }));
import fs from "node:fs";
import path from "node:path";
import { validarAgendaRotinas } from "../../../application/fiscal/serpro/SerproRuntimeSettings.js";

// Executa o handler efetivamente registrado, isolando integrações não relacionadas da rota firm.
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const begin = source.indexOf('router.put("/rotinas"');
const end = source.indexOf('\n  router.post(', begin);
const register = new Function("router", "requireAccountType", "prisma", "validarAgendaRotinas", "saveCompanyRotinas", "updateSerproRuntimeSettings", "getSerproRuntimeSettings", source.slice(begin, end));
function setup(stored = {}) {
  let handler;
  const save = jest.fn(async () => ({ atualizadas: 1 }));
  const update = jest.fn(async () => ({ rotinas: {} }));
  register({ put: (_path, _gate, h) => { handler = h; } }, () => null,
    { appSetting: { findUnique: jest.fn(async () => ({ value: stored })) } }, validarAgendaRotinas, save, update, async () => ({ rotinas: {} }));
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { save, update, res, run: body => handler({ auth: { user: { role: "contador" } }, body }, res) };
}
test.each([{ das: { enabled: true } }, { das: { enabled: true, day: 5, hour: 99 } }, null, []])("agenda inválida não altera nenhuma empresa: %j", async agenda => {
  const test = setup();
  await test.run({ empresas: [{ portalClientId: "c", rotinas: { das: true } }], agenda });
  expect(test.res.status).toHaveBeenCalledWith(400);
  expect(test.res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "SERPRO_ROTINA_AGENDA_INVALIDA" }));
  expect(test.save).not.toHaveBeenCalled(); expect(test.update).not.toHaveBeenCalled();
});
test("agenda válida segue para gravação com seleção explícita", async () => {
  const test = setup(); const empresas = [{ portalClientId: "c", rotinas: { das: true } }];
  await test.run({ empresas, agenda: { das: { enabled: true, day: 5, hour: 0 } } });
  expect(test.save).toHaveBeenCalledWith(empresas);
  expect(test.update).toHaveBeenCalledWith({ rotinas: { das: { enabled: true, day: 5, hour: 0 } } });
});
test("habilitação parcial aceita agenda já persistida, mas não sugestões", async () => {
  const test = setup({ rotinas: { das: { enabled: false, day: 5, hour: 0 } } });
  await test.run({ empresas: [{}], agenda: { das: { enabled: true } } });
  expect(test.save).toHaveBeenCalledTimes(1);
});
