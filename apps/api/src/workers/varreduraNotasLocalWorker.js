import { varrerEmpresasComVarreduraAutomatica } from "../application/declarados/VarreduraDeNotasService.js";
import { log } from "../config.js";

// Somente notas já importadas: a presença da configuração com data-piso é o opt-in.
// Este worker não depende da captura DFe/ADN nem consulta provedores externos.
const INTERVALO_LOCAL_MS = 60 * 60000;
let timer = null;
let emCurso = null;

export function executarVarreduraNotasLocal() {
  if (emCurso) return emCurso;
  emCurso = Promise.resolve().then(() => varrerEmpresasComVarreduraAutomatica())
    .finally(() => { emCurso = null; });
  return emCurso;
}

export function iniciarWorkerVarreduraNotasLocal() {
  if (timer) return;
  const executar = () => executarVarreduraNotasLocal().catch(error => {
    log.error({ erro: error?.message }, "Falha na varredura local das notas já importadas");
  });
  timer = setInterval(executar, INTERVALO_LOCAL_MS);
  timer.unref?.();
  void executar();
}

export async function pararWorkerVarreduraNotasLocal() {
  clearInterval(timer);
  timer = null;
  await emCurso?.catch(() => {});
}
