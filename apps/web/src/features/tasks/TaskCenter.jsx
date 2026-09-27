import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { taskTitles, taskStatuses, taskRunning, taskPath } from "./taskLabels";
import { resultadoImportacao } from "../notas/lib/resultadoImportacao";
import "./tasks.css";

function Resultado({ result, tipo }) {
  if (!result) return null;
  if (["import-nfe", "import-nfse"].includes(tipo) && ("importadas" in result || "created" in result)) {
    const summary = resultadoImportacao(result, tipo === "import-nfe" ? "NFE" : "NFSE");
    return <div className="task-center__result"><p>{summary.mensagem}</p>{summary.problemas.map((p, i) => <p key={i}><strong>{p.arquivo}:</strong> {p.mensagem}</p>)}</div>;
  }
  const data = result.result && typeof result.result === "object" ? result.result : result;
  const rows = data.resultados || data.results || data.errors || data.items || data.details?.failed || [];
  const reasons = { campos_obrigatorios: "Preencha os campos obrigatórios.", data_invalida: "Data inválida.", conta_sintetica: "Selecione uma conta analítica para o lançamento." };
  return <div className="task-center__result">
    <p>{data.mensagem || data.message || data.motivo || data.reason || "Confira os dados e documentos na área da empresa."}</p>
    {[["created", "Novas"], ["importadas", "Importadas"], ["updated", "Atualizadas"], ["duplicates", "Duplicadas"], ["duplicadas", "Duplicadas"], ["recusadas", "Recusadas"], ["failed", "Não importadas"], ["okCount", "Concluídas"], ["errorCount", "Com pendências"]]
      .filter(([key]) => typeof data[key] === "number").map(([key, label]) => <span key={key}>{label}: {data[key]} </span>)}
    {rows.map((r, i) => <p key={i}><strong>{r.rotulo || r.razao || r.file || r.arquivo || (r.rowIndex != null ? `Linha ${r.rowIndex + 1}` : `Item ${i + 1}`)}:</strong> {r.texto || r.message || r.mensagem || r.erroMensagem || r.motivo || reasons[r.reason] || r.reason || (r.ok || ["ok", "capturou"].includes(r.status) ? "Processado" : "Confira os detalhes na tela de origem.")}</p>)}
  </div>;
}

function TaskItem({ task, api, companies }) {
  const [details, setDetails] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function openResult() {
    setBusy(true); setError("");
    try {
      if (task.onOpen) { task.onOpen(); return; }
      if (task.arquivoDisponivel) {
        const id = task.downloadJobId || task.jobId;
        const blob = await (task.tipo === "notas" ? api.fetchNotasDownloadBlob(id) : api.fetchSitfisDownloadBlob(id));
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = task.tipo === "notas" ? "notas.zip" : "situacoes-fiscais.zip"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else if (task.origem === "manual") {
        const out = await api.getBackgroundTask(task.jobId);
        if (alive.current) setDetails(out.task.result || { message: out.task.erroMensagem || "O resultado ficará disponível ao concluir." });
      } else if (task.tipo === "captura-notas") {
        const out = await api.getNotasCaptura(task.jobId);
        if (alive.current) setDetails({ items: out.items || out.itens || out.job?.itens || [], message: out.job?.erroMensagem });
      }
    } catch { if (alive.current) setError("Não foi possível abrir o resultado. Consulte novamente; a operação não será repetida."); }
    finally { if (alive.current) setBusy(false); }
  }
  const ids = task.companyIds || [];
  const company = ids.length === 1 ? companies?.find(c => c.companyId === ids[0] || c.id === ids[0]) : null;
  const name = task.companyName || company?.nomeFantasia || company?.razao || company?.razaoSocial || (ids.length ? `${ids.length} empresa${ids.length === 1 ? "" : "s"}` : "Operação do escritório");
  return <li className="task-center__item">
    <div className="task-center__row"><strong>{task.descricao || taskTitles[task.tipo] || "Tarefa"}</strong><span className={`task-center__status ${["error", "erro", "partial", "interrupted"].includes(task.status) ? "task-center__status--warning" : ""}`}>{taskStatuses[task.status] || "Em execução"}</span></div>
    <p className="task-center__context">{name}{task.competencia ? ` · ${task.competencia}` : ""}</p>
    {task.total > 0 && <><progress aria-label={`Progresso: ${taskTitles[task.tipo] || "tarefa"}`} value={task.processadas || 0} max={task.total} /><small>{task.processadas || 0} de {task.total} processados</small></>}
    {task.browserDependent && taskRunning(task) && <p className="task-center__context">Você pode navegar pelo sistema. Mantenha esta aba do navegador aberta até concluir.</p>}
    {task.erroMensagem && <p role="alert">{task.erroMensagem}</p>}
    {(task.result || task.progress) && <Resultado result={task.result || task.progress} tipo={task.tipo} />}
    <div className="task-center__actions">
      {(task.onOpen || task.arquivoDisponivel || task.origem === "manual" || task.tipo === "captura-notas") && <Button size="sm" variant="secondary" disabled={busy} onClick={openResult}>{busy ? "Abrindo…" : task.arquivoDisponivel ? "Baixar arquivo" : "Ver resultado"}</Button>}
      {ids.length === 1 && <Link to={`/companies/${ids[0]}/${taskPath(task)}`}>Abrir empresa</Link>}
    </div>
    {error && <p role="alert">{error}</p>}
    {details && <Resultado result={details} tipo={task.tipo} />}
  </li>;
}

export function TaskCenter({ background, localTasks = [], api, companies }) {
  const [open, setOpen] = useState(false), [history, setHistory] = useState({});
  const trigger = useRef(null), panel = useRef(null);
  useEffect(() => {
    if (!localTasks.length) return;
    const finished = localTasks.filter(t => !taskRunning(t));
    if (finished.length) setHistory(old => Object.fromEntries(Object.entries({ ...old, ...Object.fromEntries(finished.map(t => [t.jobId, t])) }).slice(-30)));
  }, [localTasks]);
  useEffect(() => {
    function key(e) { if (e.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); } }
    function outside(e) { if (!panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  const local = Object.values({ ...history, ...Object.fromEntries(localTasks.map(t => [t.jobId, t])) });
  const tasks = [...(background?.tarefas || background?.jobs || []), ...local]
    .sort((a, b) => Number(taskRunning(b)) - Number(taskRunning(a)) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const active = tasks.filter(taskRunning).length;
  return <aside className="task-center" aria-label="Tarefas em segundo plano">
    <div className="task-center__bar"><button ref={trigger} className="task-center__trigger" aria-expanded={open} aria-controls="task-center-list" onClick={() => { setOpen(v => !v); void background?.refresh?.(); }}>
      {active > 0 && <span className="task-center__dot" aria-hidden="true" />}Tarefas ({active}) <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button><span role="status" className="task-center__hint">{background?.error ? "Acompanhamento indisponível" : active ? "Você pode continuar usando o sistema" : tasks.length ? "Resultados disponíveis" : "Nenhuma tarefa em execução"}</span></div>
    {open && <section ref={panel} id="task-center-list" aria-label="Lista de tarefas" className="task-center__panel">
      <div className="task-center__row"><strong>Tarefas e resultados recentes</strong><Button size="sm" variant="secondary" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Fechar</Button></div>
      {background?.error && <p role="alert">{background.error} <button onClick={() => background.refresh()}>Atualizar andamento</button></p>}
      {!tasks.length && <p>Nenhuma tarefa recente.</p>}
      <ul>{tasks.map(t => <TaskItem key={`${t.origem || t.tipo}-${t.jobId}`} task={t} api={api} companies={companies} />)}</ul>
    </section>}
  </aside>;
}
