import { liberarSelecao } from "../../features/guides/lib/liberarSelecao";

// Só simula tarefas iniciadas pelo usuário; nenhuma linha fictícia permanente no painel.
export function withBackgroundTasksMock(api) {
  const tasks = new Map();
  const changed = () => window.dispatchEvent(new Event("background-task-changed"));
  function launch(tipo, companyIds, run) {
    const id = crypto.randomUUID();
    const task = { jobId: id, tipo, companyIds, origem: "manual", status: "running", createdAt: new Date().toISOString(), descricao: null, total: 0, processadas: 0 };
    tasks.set(id, task); changed();
    const finished = (async () => {
      try {
        const [result] = await Promise.all([run(), new Promise(resolve => setTimeout(resolve, 1500))]);
        task.result = result; task.status = result?.ok === false || result?.errors?.length || result?.resultados?.some(r => !r.ok || r.tom === "pendente") ? "partial" : "done";
        if (["notas", "sitfis"].includes(tipo) && result?.jobId) { task.arquivoDisponivel = true; task.downloadJobId = result.jobId; }
        return result;
      } catch (err) { task.status = "error"; task.erroMensagem = err.message; throw err; }
      finally { changed(); }
    })();
    return { id, finished };
  }
  const wrapped = { ...api,
    clearSession() { tasks.clear(); changed(); return api.clearSession?.(); },
    async login(...args) { const result = await api.login(...args); tasks.clear(); changed(); return result; },
    async getJobsAtivos() { const tarefas = [...tasks.values()].map(t => ({ ...t })); const jobs = tarefas.filter(t => t.status === "running"); return { ok: true, tarefas, jobs, total: jobs.length }; },
    async getBackgroundTask(id) { return { ok: true, task: { ...tasks.get(id) } }; },
    async sendGuidesTask(companyId, { items, whatsappRequested }, onProgress) {
      return launch("envio-guias", [companyId], async () => {
        const resultados = await liberarSelecao({ api, companyId, items, onProgress, perguntar: () => whatsappRequested });
        return { resultados };
      }).finished.then(out => out.resultados);
    },
    async criarApuracaoBatch(body) {
      const t = launch("apuracao", body.portalClientIds, () => api.criarApuracaoBatch(body));
      void t.finished.catch(() => {});
      return { ok: true, taskId: t.id };
    },
  };
  for (const [method, tipo, ids] of [
    ["syncAdn", "captura-notas", args => [args[0]]], ["syncDfe", "captura-notas", args => [args[0]]],
    ["getSitfis", "consulta-sitfis", args => [args[0]]],
    ["captureSerproPgdasd", "consulta-das", args => [args[0]]], ["syncSerproInss", "consulta-inss", args => [args[0]]],
    ["captureSerproLp", "consulta-lp", args => [args[0]]], ["captureSerproParcelamento", "consulta-parcelas", args => [args[0]]],
    ["confirmarPagamentoSerpro", "consulta-pagamentos", args => [args[0]]],
    ["liberarGuiasLote", "envio-guias", args => args[0].items.map(i => i.portalClientId)],
    ["executarLoteWhatsapp", "envio-guias", args => args[0].portalClientIds || []],
    ["createNotasDownload", "notas", args => args[0].companyIds], ["createSitfisDownload", "sitfis", args => args[0]],
    ["createNotasCaptura", "captura-notas", args => args[0].companyIds],
  ]) if (api[method]) wrapped[method] = (...args) => launch(tipo, ids(args), () => api[method](...args)).finished;
  return wrapped;
}
