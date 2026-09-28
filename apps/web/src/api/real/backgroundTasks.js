export const notifyTasks = () => window.dispatchEvent(new Event("background-task-changed"));
export function createBackgroundTaskClient(request, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  async function start(path, options = {}) {
    const requestKey = crypto.randomUUID();
    try { return await request(path, { ...options, headers: { ...options.headers, Prefer: "respond-async", "Idempotency-Key": requestKey } }); }
    finally { notifyTasks(); }
  }
  async function result(out, onProgress) {
    if (!out?.taskId) return out;
    for (let i = 0; i < 1800; i++) {
      let task;
      try { ({ task } = await request(`/firm/jobs/tarefas/${encodeURIComponent(out.taskId)}`)); }
      catch (cause) {
        const err = new Error("Não foi possível atualizar o andamento. Confira a tarefa no alto da página antes de repetir a operação.");
        err.taskId = out.taskId; err.cause = cause; throw err;
      }
      onProgress?.(task);
      if (task.status !== "running") {
        notifyTasks();
        if (task.status === "interrupted" || (task.responseStatus || 200) >= 400) {
          const err = new Error(task.erroMensagem || task.result?.message || task.result?.reason || "A tarefa precisa de atenção. Confira o resultado antes de tentar novamente.");
          err.payload = task.result; err.code = task.result?.error; err.status = task.responseStatus || 503; err.taskId = task.jobId;
          throw err;
        }
        return task.result;
      }
      await wait(2000);
    }
    throw new Error("A tarefa continua disponível em Tarefas. Consulte o andamento antes de iniciar outra tentativa.");
  }
  return { start, result, request: async (path, options, onProgress) => result(await start(path, options), onProgress) };
}
