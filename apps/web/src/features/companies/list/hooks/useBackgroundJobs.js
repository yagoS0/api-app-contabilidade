import { useCallback, useEffect, useRef, useState } from "react";

export function useBackgroundJobs({ api, enabled = true, sessionKey = "" }) {
  const [tarefas, setTarefas] = useState([]);
  const [error, setError] = useState("");
  const refreshRef = useRef(async () => []);
  useEffect(() => {
    let alive = true, pending = false, refreshQueued = false, timer;
    setTarefas([]); setError("");
    async function check() {
      if (!alive || !enabled || !api?.getJobsAtivos) return [];
      if (pending) { refreshQueued = true; return []; }
      pending = true; clearTimeout(timer);
      let active = false;
      try {
        const out = await api.getJobsAtivos();
        if (out?.ok === false) throw new Error("jobs_unavailable");
        const list = out?.tarefas || out?.jobs || [];
        active = list.some(j => ["running", "processando"].includes(j.status) || !j.status);
        if (alive) { setTarefas(list); setError(""); }
        return list;
      } catch {
        if (alive) setError("Não foi possível atualizar as tarefas. O último andamento foi preservado.");
        return [];
      } finally {
        pending = false;
        if (alive && enabled) timer = setTimeout(cycle, refreshQueued ? 0 : active ? 4000 : 30000);
        refreshQueued = false;
      }
    }
    function cycle() {
      if (document.visibilityState === "visible") void check();
      else if (alive) timer = setTimeout(cycle, 30000);
    }
    function wake() { if (document.visibilityState === "visible") void check(); }
    refreshRef.current = check;
    if (enabled) {
      cycle();
      window.addEventListener("background-task-changed", wake);
      document.addEventListener("visibilitychange", wake);
    }
    return () => {
      alive = false; clearTimeout(timer);
      window.removeEventListener("background-task-changed", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [api, enabled, sessionKey]);
  const jobs = tarefas.filter(j => !j.status || ["running", "processando"].includes(j.status));
  const refresh = useCallback(() => refreshRef.current(), []);
  return { jobs, tarefas, error, total: jobs.length,
    processadas: jobs.reduce((s, j) => s + Number(j.processadas || 0), 0),
    empresas: jobs.reduce((s, j) => s + Number(j.total || 0), 0), refresh };
}
