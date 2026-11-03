import "./rotinas.css";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { Feedback } from "../../../../components/ui/Feedback";
import { Modal } from "../../../../components/ui/Modal";
import { ResultadoRotinaModal } from "./ResultadoRotinaModal";
import { elegivelLimparAviso, chaveAvisoRotina, estadoExecucaoRotina } from "./rotinasPresentation";
import { Button } from "../../../../components/ui/Button";

function mensagemRotinas(erro, alternativa) {
 const mensagens = { forbidden_admin_or_contador_only: 'Rotinas exige acesso de administrador ou contador do escritório.', unauthorized: 'Entre novamente para continuar.', forbidden: 'Seu acesso não permite consultar ou alterar estas rotinas.' };
 if (erro?.message && !mensagens[erro.message]) return erro.message;
 return mensagens[erro?.reason || erro?.error || erro?.message] || alternativa;
}

// Página "Rotinas" — QUEM faz o quê (tabela empresa × rotina) e QUANDO (agenda por rotina).
//
// Antes, quem capturava o quê era implícito: o worker derivava do regime (Simples→DAS+extrato,
// LP→Presumido) e tentava INSS em toda empresa. Agora é declarado e visível.
//
// O vocabulário é o REAL do SERPRO (mesmo das "Funções em lote"). PIS/COFINS/CSLL/IRPJ não são
// rotinas: os quatro vêm juntos de uma única consulta — a do Presumido — e são separados aqui
// por código de receita. Marcar "Presumido" já traz os quatro.

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = String(index + 1);
  const label = `Dia ${day}`;
  return { value: day, label };
});

const ROTINA_HINT = {
  simples_envio_guias: "Envio das guias válidas completas ou parcial no limite do dia 13 útil anterior. Seleção independente na Automação da empresa. Erros exigem conferência.",
  simples_coleta_calculo: "Coleta do dia 1 ao dia 8; cálculo após a coleta final completa, aguardando conferência do contador. Seleção e fontes em Automação da empresa.",
  das: "Guia do DAS (Simples Nacional)",
  inss: "Guia do INSS (DCTFWeb)",
  extrato: "Extrato do PGDAS-D — gera os lançamentos",
  presumido: "Lucro Presumido: traz PIS, COFINS, CSLL e IRPJ de uma vez",
  parcelamento: "Parcelas dos parcelamentos ativos",
  avisos_guias_whatsapp: "Diariamente, sem consulta SERPRO. Selecione cada empresa em Configuração → Automação → Lembretes de guias.",
  pagamento: "Confirma pagamentos de DAS, INSS e parcelas acompanhadas",
  conferencia: "Confere as NFS-e contra o ADN nacional antes do fechamento",
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function PausaCicloFiscal({ api, onPolicy }) {
  const [policy, setPolicy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [reason, setReason] = useState('');
  const generation = useRef(0);
  const focusRequest = useRef(null), statusRef = useRef(null), errorRef = useRef(null);
  useEffect(() => {
    const request = focusRequest.current;
    if (busy || !request) return;
    focusRequest.current = null;
    if (request.ticket !== generation.current) return;
    if (document.activeElement !== document.body && document.activeElement !== request.origin) return;
    (erro ? errorRef : statusRef).current?.focus();
  }, [busy, erro, policy]);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setBusy(true); setErro('');
    try {
      const out = await api.getPausaCicloFiscal();
      if (out?.ok !== true || typeof out.policy?.paused !== 'boolean' || !Number.isSafeInteger(out.policy?.version)) throw new Error('Resposta da pausa indisponível.');
      if (ticket === generation.current) { setPolicy(out.policy); onPolicy?.(out.policy); }
    } catch (e) { if (ticket === generation.current) { setPolicy(null); onPolicy?.(null); setErro(mensagemRotinas(e, 'Não foi possível consultar a pausa.')); } }
    finally { if (ticket === generation.current) setBusy(false); }
  }, [api, onPolicy]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  async function save(event) {
    event.preventDefault();
    if (busy || !policy) return;
    const ticket = ++generation.current;
    focusRequest.current = { ticket, origin: document.activeElement };
    setBusy(true); setErro('');
    try {
      const out = await api.savePausaCicloFiscal({ paused: !policy.paused, version: policy.version, reason });
      if (out?.ok !== true || out.policy?.paused !== !policy.paused || out.policy?.version !== policy.version + 1) throw new Error('Não foi possível confirmar a alteração. Atualize o estado antes de repetir.');
      if (ticket === generation.current) { setPolicy(out.policy); onPolicy?.(out.policy); setReason(''); }
    } catch (e) { if (ticket === generation.current) { setPolicy(null); onPolicy?.(null); setErro(mensagemRotinas(e, 'Falha ao salvar. Atualize para conferir o estado persistido.')); } }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  return <section className="serpro-settings-card rotinas-pausa" aria-labelledby="pausa-ciclo-titulo" aria-busy={busy}>
    <h2 id="pausa-ciclo-titulo" className="serpro-settings-card__title">Automações do ciclo fiscal</h2>
    <p role="status" ref={statusRef} tabIndex={-1}>{busy ? 'Atualizando pausa…' : policy ? policy.paused ? 'Pausa geral ativa' : 'Sem pausa geral · agendas e seleções continuam valendo' : 'Estado da pausa indisponível'}</p>
    {erro && <p role="alert" ref={errorRef} tabIndex={-1}>{erro}</p>}
    {policy?.changedAt && <p className="text-muted">{policy.reason} · {policy.actor?.name || policy.actor?.id} · {formatDateTime(policy.changedAt)}</p>}
    <details><summary>Alcance da pausa</summary>
      <p>Bloqueia novas execuções automáticas de captura fiscal e acompanhamento de guias, incluindo consultas de pagamento e lembretes. Agenda e seleção de empresas são preservadas.</p>
      <p>Chamadas já iniciadas podem terminar. Mensagens recebidas, confirmações do cliente e recibos continuam. Ações manuais mantêm suas autorizações próprias.</p>
      <p>Retomar permite somente próximos horários; não recupera execuções perdidas nem ativa cálculo, transmissão ou envio automático hoje desativados. IA comercial, Guru e emissão recorrente ficam fora deste controle.</p>
      {policy?.legacy && <p>Configuração de pausa ainda não registrada: comportamento anterior preservado, sem ativação adicional.</p>}
    </details>
    <form onSubmit={save}>
      <label htmlFor="pausa-ciclo-motivo">Motivo da {policy?.paused ? 'retomada' : 'pausa'}</label>
      <textarea id="pausa-ciclo-motivo" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} required disabled={busy || !policy} />
      <div className="rotinas-pausa__acoes">
        <Button type="submit" disabled={busy || !policy || !reason.trim()}>{policy?.paused ? 'Confirmar retomada' : 'Confirmar pausa geral'}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={load}>Atualizar estado</Button>
      </div>
    </form>
  </section>;
}

export function RotinasPage({
  api,
  workerStatus,
  onRunCron,
  runningCron,
  onRefreshWorkerStatus,
  onRunPaymentConfirmation,
  onBack,
  message,
  error,
}) {
  const [rotinas, setRotinas] = useState([]);
  const [agenda, setAgenda] = useState({});
  const [executionStatus, setExecutionStatus] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [pausePolicy, setPausePolicy] = useState(undefined);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningPayment, setRunningPayment] = useState(false);
  const focoRetornoManual = useRef(false);
  const [aba, setAba] = useState("acompanhamento");
  const [atualizando, setAtualizando] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState("");
  const [resultadoAberto, setResultadoAberto] = useState(null);
  const [execucaoAberta, setExecucaoAberta] = useState(false);
  const [operacao, setOperacao] = useState("captura");
  const [executandoManual, setExecutandoManual] = useState(false);
  const [resultadoManual, setResultadoManual] = useState(null);
  const [erroExecucao, setErroExecucao] = useState("");
  const [carregou, setCarregou] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [avisosVistos, setAvisosVistos] = useState(() => new Set());
  const [notice, setNotice] = useState(null); // { type: "error"|"ok", text }

  useEffect(() => {
    if (!resultadoAberto && focoRetornoManual.current) {
      document.getElementById("rotinas-retorno-manual")?.focus();
      focoRetornoManual.current = false;
    }
  }, [resultadoAberto]);
  function fecharResultado() {
    focoRetornoManual.current = Boolean(resultadoAberto?.manual);
    setResultadoAberto(null);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const out = await api.getRotinas();
      setRotinas(Array.isArray(out?.rotinas) ? out.rotinas : []);
      setAgenda(out?.agenda || {});
      setExecutionStatus(out?.executions || []);
      setEmpresas(Array.isArray(out?.empresas) ? out.empresas : []);
      setBaseline(JSON.stringify({ agenda: out?.agenda || {}, empresas: Array.isArray(out?.empresas) ? out.empresas : [] }));
      setCarregou(true);
    } catch (err) {
      setCarregou(false);
      setNotice({ type: "error", text: mensagemRotinas(err, "Falha ao carregar rotinas.") });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (onRefreshWorkerStatus) atualizarExecucoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAgendaCampo(key, campo, value) {
    setAgenda((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      const payloadAgenda = {};
      for (const r of rotinas) {
        const cfg = agenda[r.key] || {};
        payloadAgenda[r.key] = {
          enabled: ["simples_coleta_calculo", "simples_envio_guias"].includes(r.key) ? cfg.enabled === true : cfg.enabled !== false,
          day: r.key === "simples_coleta_calculo" ? 8 : Number(cfg.day) || 5,
          hour: cfg.hour == null || cfg.hour === "" ? 7 : Number(cfg.hour),
          frequency: r.key === "simples_coleta_calculo" ? "DAILY_UNTIL_DAY" : r.key === "simples_envio_guias" || cfg.frequency === "DAILY" ? "DAILY" : "MONTHLY",
        };
      }
      const out = await api.saveRotinas({

        agenda: payloadAgenda,
      });
      if (out?.agenda) setAgenda(out.agenda);
      setBaseline(JSON.stringify({ agenda: out?.agenda || agenda, empresas }));
      onRefreshWorkerStatus?.();
      setNotice({ type: "ok", text: "Rotinas salvas." });
    } catch (err) {
      setNotice({ type: "error", text: mensagemRotinas(err, "Falha ao salvar rotinas.") });
    } finally {
      setSaving(false);
    }
  }

  const ocupadoManual = executandoManual || runningCron || runningPayment;
  const naoSalvo = carregou && baseline !== JSON.stringify({ agenda, empresas });
  const execucoes = (workerStatus?.routines || executionStatus).map(row => pausePolicy === undefined ? row : { ...row, automationPaused: pausePolicy?.paused ?? null, automationPolicyUnavailable: !pausePolicy });
  const avisosRevisaveis = execucoes.filter(row => elegivelLimparAviso(row) && !avisosVistos.has(chaveAvisoRotina(row)));
  const tituloRotina = row => row.label || rotinas.find(r => r.key === row.routine)?.label || (row.routine === "avisos_guias_whatsapp" ? "Lembretes de guias no WhatsApp" : row.routine);

  async function atualizarExecucoes() {
    if (!onRefreshWorkerStatus || atualizando) return;
    setAtualizando(true);
    setErroAtualizacao("");
    try {
      const result = await onRefreshWorkerStatus();
      if (result === null) setErroAtualizacao("Não foi possível atualizar as execuções. Os dados anteriores foram mantidos.");
    } catch (err) { setErroAtualizacao(mensagemRotinas(err, "Não foi possível atualizar as execuções. Os dados anteriores foram mantidos.")); }
    finally { setAtualizando(false); }
  }
  function limparAvisos() {
    setAvisosVistos(prev => new Set([...prev, ...avisosRevisaveis.map(chaveAvisoRotina)]));
    setNotice({ type: "ok", text: "Avisos limpos nesta tela. O histórico foi mantido." });
  }
  async function executarAgora() {
    if (ocupadoManual || !carregou || loading) return;
    setExecutandoManual(true);
    setErroExecucao("");
    const pagamento = operacao === "pagamento";
    setRunningPayment(pagamento);
    try {
      const retorno = await (pagamento ? onRunPaymentConfirmation() : onRunCron({}));
      if (!retorno || retorno.ok === false) {
        setErroExecucao(retorno?.message || retorno?.reason || retorno?.error || "Não foi possível concluir a execução. Confira os avisos antes de repetir.");
        return;
      }
      const row = { routine: pagamento ? "pagamento" : "captura", label: pagamento ? "Consulta de pagamentos" : "Captura de guias e extratos", manual: true,
        lastRun: { status: "RETURNED", finishedAt: new Date().toISOString(), result: retorno.result || retorno } };
      setResultadoManual(row);
      setExecucaoAberta(false);
      setResultadoAberto(row);
      await atualizarExecucoes();
    } catch (err) {
      setErroExecucao(mensagemRotinas(err, "Falha ao executar. Confira o resultado antes de repetir; a consulta pode ter gerado custo."));
    } finally {
      setExecutandoManual(false);
      setRunningPayment(false);
    }
  }

  // Quantas empresas fazem cada rotina — cabeçalho mostra o alcance de cada uma.
  const contagem = useMemo(() => {
    const out = {};
    for (const r of rotinas) out[r.key] = empresas.filter((e) => r.key === "simples_envio_guias" ? e.envioGuias?.enabled === true : r.key === "simples_coleta_calculo" ? e.cicloSimples?.enabled === true : r.key === "avisos_guias_whatsapp" ? (e.lembretes?.enabled ?? e.rotinas?.avisos_guias_whatsapp) === true : e.rotinas?.[r.key]).length;
    return out;
  }, [rotinas, empresas]);

  const th = { padding: "8px 6px", fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600, textAlign: "center" };
  const td = { padding: "6px", textAlign: "center" };

  return (
    <PageShell
      title="Rotinas"

      onBack={onBack}
    >
      <AppShell className="serpro-settings-shell rotinas-page">
        <div className="serpro-settings-page">
            {notice && (
              <div role={notice.type === "error" ? "alert" : "status"} style={{
                margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
                background: notice.type === "error" ? "rgba(255,71,87,0.12)" : "rgba(105,255,71,0.10)",
                border: `1px solid ${notice.type === "error" ? "var(--danger)" : "var(--success)"}`,
                color: notice.type === "error" ? "var(--danger)" : "var(--success)",
              }}>
                {notice.text}
              </div>
            )}
          <div className="rotinas-abas" role="tablist" aria-label="Seções de Rotinas">
            {[["acompanhamento", "Acompanhamento"], ["configuracao", "Configuração"]].map(([id, label]) => <button key={id} type="button" role="tab" id={`rotinas-tab-${id}`} aria-controls={`rotinas-painel-${id}`} aria-selected={aba === id} tabIndex={aba === id ? 0 : -1} onClick={() => setAba(id)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "acompanhamento" : event.key === "End" ? "configuracao" : aba === "acompanhamento" ? "configuracao" : "acompanhamento"; setAba(next); document.getElementById(`rotinas-tab-${next}`)?.focus(); } }}>{label}</button>)}
          </div>
          <div id="rotinas-painel-acompanhamento" role="tabpanel" aria-labelledby="rotinas-tab-acompanhamento" hidden={aba !== "acompanhamento"}>
            <section className="serpro-settings-card rotinas-manual">
              <div><h2 className="serpro-settings-card__title">Execução manual</h2><p className="text-muted">Usa a configuração salva. Consultas externas podem gerar custos.</p>{naoSalvo && <p role="status">Há alterações não salvas em Configuração.</p>}</div>
              <Button variant="secondary" disabled={!carregou || loading || ocupadoManual || (!onRunCron && !onRunPaymentConfirmation)} onClick={() => { setOperacao(onRunCron ? "captura" : "pagamento"); setErroExecucao(""); setExecucaoAberta(true); }}>{ocupadoManual ? "Executando…" : "Executar agora"}</Button>
            </section>
            {resultadoManual && <section className="serpro-settings-card rotinas-manual"><div><h3>Último retorno manual</h3><p>{tituloRotina(resultadoManual)} · {formatDateTime(resultadoManual.lastRun.finishedAt)}</p></div><Button id="rotinas-retorno-manual" variant="secondary" onClick={() => setResultadoAberto(resultadoManual)}>Ver retorno manual</Button></section>}
            <section className="serpro-settings-card">
              <div className="rotinas-execucoes-topo"><h2 className="serpro-settings-card__title">Execuções programadas</h2><div className="rotinas-acoes"><Button variant="secondary" disabled={!avisosRevisaveis.length} onClick={limparAvisos}>Limpar avisos</Button><Button variant="secondary" disabled={loading || atualizando || !onRefreshWorkerStatus} onClick={atualizarExecucoes}>{atualizando ? "Atualizando…" : "Atualizar"}</Button></div></div>
              {loading && <p role="status">Carregando rotinas…</p>}
              {erroAtualizacao && <p role="alert">{erroAtualizacao}</p>}
              {!loading && !carregou && <Button variant="secondary" onClick={load}>Tentar novamente</Button>}
              {!loading && carregou && !execucoes.length && <p>Histórico por rotina ainda não disponível. O último registro geral não confirma todas as consultas.</p>}
              {!!execucoes.length && <table className="rotinas-execucoes"><thead><tr><th>Rotina</th><th>Situação</th><th>Última execução</th><th>Próximo horário</th><th><span className="rotinas-sr-only">Resultado</span></th></tr></thead><tbody>{execucoes.map(row => <tr key={row.routine}>
                <td data-label="Rotina">{tituloRotina(row)}</td>
                <td data-label="Situação">{estadoExecucaoRotina(row, avisosVistos.has(chaveAvisoRotina(row)))}</td>
                <td data-label="Última execução">{formatDateTime(row.lastRun?.finishedAt || row.lastRun?.startedAt)}</td>
                <td data-label="Próximo horário">{row.enabled && !row.automationPaused && !row.automationPolicyUnavailable ? formatDateTime(row.nextEffectiveAt || row.nextAt) : "—"}</td>
                <td>{row.lastRun && <Button variant="secondary" onClick={() => setResultadoAberto(row)} aria-label={`Ver resultado de ${tituloRotina(row)}`}>Ver resultado</Button>}</td>
              </tr>)}</tbody></table>}
              <p className="text-muted">Sem nova tentativa automática. A próxima consulta seguirá a agenda salva.</p>
            </section>
          </div>
          <div id="rotinas-painel-configuracao" role="tabpanel" aria-labelledby="rotinas-tab-configuracao" hidden={aba !== "configuracao"}>
          <PausaCicloFiscal api={api} onPolicy={setPausePolicy} />
            {naoSalvo && <p role="status">Alterações não salvas.</p>}
          <fieldset className="rotinas-configuracao" disabled={saving}>
          {/* ── Agenda: um dia/hora por rotina, valendo pras empresas marcadas ── */}
          <section className="serpro-settings-card">
            <div className="serpro-settings-card__head">
              <h2 className="serpro-settings-card__title">Agenda</h2>
              <p className="serpro-settings-card__description">
                Horário de Brasília. Consultas apenas na agenda salva, sem novas tentativas automáticas. Se o mês não tiver o dia escolhido, a rotina não será executada naquele mês.
              </p>
            </div>

            {loading ? (
              <p role="status" style={{ color: "var(--text-muted)", margin: 0 }}>Carregando…</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="rotinas-agenda" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-subtle)" }}>
                      <th style={{ ...th, textAlign: "left" }}>Rotina</th>
                      <th style={th}>Ligada</th>
                      <th style={th}>Dia</th>
                      <th style={th}>Hora</th>
                      <th style={{ ...th, textAlign: "left" }}>Empresas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotinas.map((r) => {
                      const cfg = agenda[r.key] || {};
                      const ligada = ["simples_coleta_calculo", "simples_envio_guias"].includes(r.key) ? cfg.enabled === true : cfg.enabled !== false;
                      return (
                        <tr key={r.key} style={{ borderTop: "1px solid var(--border)", opacity: ligada ? 1 : 0.55 }}>
                          <td style={{ padding: "6px", color: "var(--text)" }}>
                            <strong>{r.label}</strong>
                            <div style={{ fontSize: "0.8125rem", color: "var(--text-faint)" }}>{ROTINA_HINT[r.key]}</div>
                            {r.key === "pagamento" && (
                              <select aria-label="Frequência da consulta de pagamentos" disabled={!ligada}
                                value={cfg.frequency || "MONTHLY"}
                                onChange={(e) => setAgendaCampo(r.key, "frequency", e.target.value)}>
                                <option value="MONTHLY">Mensal</option>
                                <option value="DAILY">Diária</option>
                              </select>
                            )}
                          </td>
                          <td style={td}>
                            <input
                              type="checkbox"
                              aria-label={`Ligar ${r.label}`}
                              checked={ligada}
                              onChange={(e) => setAgendaCampo(r.key, "enabled", e.target.checked)}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                          </td>
                          <td style={td}>
                            {r.key === "simples_coleta_calculo" ? <span>Dias 1 a 8</span> : ["avisos_guias_whatsapp", "simples_envio_guias"].includes(r.key) ? <span>Diariamente</span> : <select
                              value={String(cfg.day ?? 5)}
                              disabled={!ligada || cfg.frequency === "DAILY"}
                              aria-label={`Dia de ${r.label}`}
                              onChange={(e) => setAgendaCampo(r.key, "day", Number(e.target.value))}
                              style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 6px", fontSize: "0.8rem", colorScheme: "dark" }}
                            >
                              {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>}
                          </td>
                          <td style={td}>
                            <input
                              type="time"
                              step="3600"
                              min={r.key === "simples_coleta_calculo" ? "00:00" : undefined}
                              max={r.key === "simples_coleta_calculo" ? "11:00" : undefined}
                              aria-label={`Horário de ${r.label}`}
                              value={`${pad2(cfg.hour ?? 7)}:00`}
                              disabled={!ligada}
                              onChange={(e) => setAgendaCampo(r.key, "hour", Math.max(0, Math.min(r.key === "simples_coleta_calculo" ? 11 : 23, Number(String(e.target.value || "07:00").split(":")[0]))))}
                              style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 6px", fontSize: "0.8rem", colorScheme: "dark" }}
                            />
                          </td>
                          <td style={{ padding: "6px", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                            {r.key === "simples_coleta_calculo" && empresas.some(e => typeof e.cicloSimples?.enabled !== 'boolean') ? 'Seleção a verificar' : `${contagem[r.key] || 0} de ${empresas.length}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="serpro-settings-card">
            <h2>Consultas por empresa</h2>
            <p>A ativação fica em Configurações → Automação dentro de cada empresa. Os horários acima continuam compartilhados pelas rotinas.</p>
            <ul>{empresas.map(e => <li key={e.companyId}><a href={`/companies/${encodeURIComponent(e.companyId)}/automacao`}>{e.razao}</a></li>)}</ul>
            <div className="serpro-settings-form__actions">
              <Button variant="secondary" disabled={loading || saving} onClick={load}>Descartar alterações de horário</Button>
              <Button disabled={saving || loading || !rotinas.length} onClick={handleSave}>{saving ? 'Salvando…' : 'Salvar horários'}</Button>
            </div>
          </section>

          </fieldset>

          </div>
          <Feedback message={message} error={error} />
          {execucaoAberta && <Modal titulo="Executar agora" tamanho="md" className="rotinas-executar-modal" ocupado={ocupadoManual} aoFechar={() => setExecucaoAberta(false)} fecharAoClicarFundo={false} rodape={<><Button variant="secondary" disabled={ocupadoManual} onClick={() => setExecucaoAberta(false)}>Cancelar</Button><Button disabled={ocupadoManual || !carregou || (operacao === "pagamento" ? !onRunPaymentConfirmation : !onRunCron)} onClick={executarAgora}>{ocupadoManual ? "Executando…" : operacao === "pagamento" ? "Consultar pagamentos" : "Capturar guias e extratos"}</Button></>}>
            <fieldset disabled={ocupadoManual} className="rotinas-operacoes"><legend>Operação</legend>
              {onRunCron && <label><input type="radio" name="rotinas-operacao" checked={operacao === "captura"} onChange={() => setOperacao("captura")} />Capturar guias e extratos</label>}
              {onRunPaymentConfirmation && <label><input type="radio" name="rotinas-operacao" checked={operacao === "pagamento"} onChange={() => setOperacao("pagamento")} />Consultar pagamentos</label>}
            </fieldset>
            <p>Executa fora da agenda para as empresas elegíveis pela configuração salva. A seleção de empresas em Configuração não limita esta execução.</p>
            {naoSalvo && <p>As alterações ainda não salvas não serão usadas.</p>}
            <p>Consultas externas podem gerar custos. Não há nova tentativa automática em caso de falha.</p>
            {operacao === "pagamento" && <p>Consulta, confirmação do cliente e baixa contábil são etapas distintas.</p>}
            {erroExecucao && <p role="alert">{erroExecucao}</p>}
          </Modal>}
          {resultadoAberto && <ResultadoRotinaModal row={resultadoAberto} titulo={tituloRotina(resultadoAberto)} onClose={fecharResultado} />}
        </div>
      </AppShell>
    </PageShell>
  );
}
