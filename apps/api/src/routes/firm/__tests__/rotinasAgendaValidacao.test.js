jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../infrastructure/storage/CertStorage.js", () => ({ deleteCompanyPfx: jest.fn(), isDatabaseCertificateStorageKey: jest.fn() }));
jest.mock("../../../utils/crypto.js", () => ({ decryptSecret: jest.fn(), encryptSecret: jest.fn(), encryptBytes: jest.fn() }));
jest.mock("../../../application/security/CertAccessAudit.js", () => ({ auditCertAccess: jest.fn() }));
jest.mock("../../../application/fiscal/serpro/SerproConfig.js", () => ({ getSerproConfig: jest.fn(() => ({})) }));
import fs from "node:fs";
import path from "node:path";
import { listCompanyRotinas, ROTINA_LABELS } from "../../../application/fiscal/serpro/CompanyRotinasService.js";
import { AGENDA_KEYS } from "../../../application/fiscal/serpro/SerproRuntimeSettings.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
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

test('GET registrado retorna label e empresas opt-in do ciclo sem duplicar seleção fiscal', async () => {
 prisma.portalClient = { findMany: jest.fn(async () => [{ id: 'p', companyId: 'c', razao: 'Fictícia' }]) };
 prisma.company = { findMany: jest.fn(async () => [{ id: 'c', regimeTributario: 'SIMPLES' }]) };
 prisma.companyRotina = { findMany: jest.fn(async () => []) };
 prisma.appSetting = { findMany: jest.fn(async () => [{ key: 'ciclo_simples_config:p', value: { enabled: true, fontes: ['NFSE'] } }]) };
 const start = source.indexOf('router.get("/rotinas"');
 const finish = source.indexOf('router.put("/rotinas"', start);
 let handler;
 const agendaEventos = { schemaVersion: 1, revision: 'agenda-r1', executionMode: 'LEGADO', relativeConsumerReady: false };
 const lerAgendaEventosGlobal = jest.fn(async () => agendaEventos);
 new Function('router', 'requireAccountType', 'listCompanyRotinas', 'getSerproRuntimeSettings', 'AGENDA_KEYS', 'ROTINA_LABELS', 'getRoutineExecutionStatus', 'lerAgendaEventosGlobal', 'prisma', source.slice(start, finish))({ get: (_p, _g, h) => { handler = h; } }, () => null, listCompanyRotinas, async () => ({ rotinas: {} }), AGENDA_KEYS, ROTINA_LABELS, async () => ({}), lerAgendaEventosGlobal, prisma);
 const res = { json: jest.fn() };
 await handler({ auth: { user: { role: 'contador' } } }, res);
 const payload = res.json.mock.calls[0][0];
 expect(lerAgendaEventosGlobal).toHaveBeenCalledWith(prisma);
 expect(payload.agendaEventos).toBe(agendaEventos);
 expect(payload.rotinas.find(r => r.key === 'simples_coleta_calculo')).toEqual({ key: 'simples_coleta_calculo', label: 'Coleta e cálculo do Simples' });
 expect(payload.empresas[0].cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'], applicableCurrentRegime: true, configurationValid: true });
 expect(payload.empresas[0].rotinas.simples_coleta_calculo).toBeUndefined();
 prisma.company.findMany.mockResolvedValue([{ id: 'c', regimeTributario: 'LUCRO_PRESUMIDO' }]);
 await handler({ auth: { user: { role: 'contador' } } }, res);
 expect(res.json.mock.calls[1][0].empresas[0].cicloSimples).toEqual({ enabled: true, fontes: ['NFSE'], applicableCurrentRegime: false, configurationValid: true });
});
