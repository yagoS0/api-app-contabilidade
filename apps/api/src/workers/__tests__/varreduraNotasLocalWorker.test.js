jest.mock("../../application/declarados/VarreduraDeNotasService.js", () => ({ varrerEmpresasComVarreduraAutomatica: jest.fn() }));
jest.mock("../../application/notas/adn/AdnNotasService.js", () => ({ syncAdnNotasForCompany: jest.fn() }));
jest.mock("../../application/notas/dfe/DfeSyncService.js", () => ({ syncDfeForCompany: jest.fn() }));
jest.mock("../../config.js", () => ({ log: { error: jest.fn() } }));
import { varrerEmpresasComVarreduraAutomatica } from "../../application/declarados/VarreduraDeNotasService.js";
import { syncAdnNotasForCompany } from "../../application/notas/adn/AdnNotasService.js";
import { syncDfeForCompany } from "../../application/notas/dfe/DfeSyncService.js";
import { executarVarreduraNotasLocal, iniciarWorkerVarreduraNotasLocal, pararWorkerVarreduraNotasLocal } from "../varreduraNotasLocalWorker.js";

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  varrerEmpresasComVarreduraAutomatica.mockResolvedValue({ varridas: 0, empresas: [] });
});
afterEach(async () => { await pararWorkerVarreduraNotasLocal(); jest.useRealTimers(); });

test("mantém varredura local configurada sem disparar captura externa", async () => {
  iniciarWorkerVarreduraNotasLocal();
  iniciarWorkerVarreduraNotasLocal();
  await executarVarreduraNotasLocal();
  expect(varrerEmpresasComVarreduraAutomatica).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60 * 60000);
  await executarVarreduraNotasLocal();
  expect(varrerEmpresasComVarreduraAutomatica).toHaveBeenCalledTimes(2);
  expect(syncAdnNotasForCompany).not.toHaveBeenCalled();
  expect(syncDfeForCompany).not.toHaveBeenCalled();
});

test("não sobrepõe ciclos locais demorados", async () => {
  let concluir;
  varrerEmpresasComVarreduraAutomatica.mockReturnValue(new Promise(resolve => { concluir = resolve; }));
  iniciarWorkerVarreduraNotasLocal();
  await Promise.resolve();
  jest.advanceTimersByTime(2 * 60 * 60000);
  expect(varrerEmpresasComVarreduraAutomatica).toHaveBeenCalledTimes(1);
  concluir({ varridas: 0, empresas: [] });
  await executarVarreduraNotasLocal();
});
