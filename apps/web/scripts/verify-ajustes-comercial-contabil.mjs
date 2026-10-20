// Catálogo dirigido local; não inicia aplicação, worker ou provedor externo.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const jest = fileURLToPath(new URL("../../../node_modules/jest/bin/jest.js", import.meta.url));
const suites = [
  ["apps/api", [
    "retomarAtendimento", "automacaoComercialDoCaso", "fiscalLead", "whatsappDurableWorker",
    "declaradoService", "regraService", "lancamentoPorRegra", "conferenciaRota",
    "onboardingRotas", "circularSemRegistroMensal", "pgdasSomenteDocumentos", "coletaComercialWhatsapp", "watchdogComercial",
    "contingenciaComercial", "assistenteComercialService",
  ]],
  ["apps/web", [
    "dataDoComprovante", "pagamentosBaixaIntegrada", "usePagamentosPendentes", "pagamentosProvisionados",
    "navegacaoComRascunho", "OfficeNavigation", "useManageAccountingWorkspace",
    "AcoesOportunidade", "AutorizacaoDoLead", "AcompanhamentoComercial", "ComercialPage",
    "tabelaEmpresasLeitura", "lancamentoPorRegraNaTela", "renderCircularTab",
  ]],
];
for (const [app, nomes] of suites) {
  const result = spawnSync(process.execPath, [jest, "--runInBand", "--testPathPatterns", nomes.join("|")], {
    cwd: `${root}/${app}`, stdio: "inherit", env: { ...process.env, NODE_ENV: "test" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
