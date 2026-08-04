import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";

// CONSULTA DE NOTAS EM LOTE — aba de "Consultas".
//
// ⚠ NÃO É "Download de notas". Aquela aba zipa o XML que JÁ está no banco: empresa sem captura sai
// com pasta vazia e o job conclui com sucesso e zero notas. Foi ela que deu a impressão de que
// estava tudo certo enquanto a rotina automática não trazia nada — e o contador acabou consultando
// as trinta empresas na mão.
//
// A REGRA DESTA TELA: **nenhuma empresa some**. Sem certificado, dentro da janela da SEFAZ, em
// backoff — cada uma aparece na tabela com o motivo escrito. O worker automático descarta essas
// empresas dentro de um `filter`, e é exatamente esse silêncio que se está corrigindo aqui.

const ALVO_OPTIONS = [
  { value: "NFSE", label: "NFS-e (ADN)", hint: "Exige certificado A1 da própria empresa" },
  { value: "NFE", label: "NF-e (SEFAZ)", hint: "Só empresas com inscrição estadual · 1 consulta por hora" },
];

const STATUS_JOB = {
  processando: { label: "Consultando…", color: "var(--accent-cyan)" },
  concluido: { label: "Concluído", color: "var(--state-ok)" },
  erro: { label: "Erro", color: "var(--state-danger)" },
};

// Os cinco desfechos possíveis por empresa. Cada um tem ÍCONE além de cor — a tabela precisa ser
// legível de relance, e "pulada" x "erro" são ações diferentes do contador.
const STATUS_ITEM = {
  capturou: { icone: "✓", label: "capturou", cor: "var(--state-ok)" },
  nada_novo: { icone: "—", label: "nada novo", cor: "var(--state-neutral)" },
  // ⚠ VERMELHO, e separado de "nada novo": aqui o ADN DEVOLVEU documento e nós descartamos por
  // CNPJ divergente. Enquanto os dois desfechos apareciam iguais, "a empresa ficou sem notas mesmo
  // tendo emitido" não tinha como ser percebido — que é exatamente o defeito que se está caçando.
  recusado: { icone: "⛔", label: "recusado por CNPJ", cor: "var(--state-danger)" },
  pulada: { icone: "⚠", label: "não consultada", cor: "var(--state-warn)" },
  aguardando: { icone: "⏳", label: "aguardando", cor: "var(--state-neutral)" },
  erro: { icone: "✕", label: "erro", cor: "var(--state-danger)" },
};

function fmtDataHora(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function NotasCapturaContent({ api, companies }) {
  const [alvos, setAlvos] = useState(() => new Set(["NFSE", "NFE"]));
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [job, setJob] = useState(null);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo: "error"|"info", texto }
  const [recentes, setRecentes] = useState([]);
  const timer = useRef(null);

  const lista = useMemo(() => (Array.isArray(companies) ? companies : []), [companies]);
  const todasMarcadas = lista.length > 0 && lista.every((c) => selecionadas.has(c.companyId));
  const algumaMarcada = lista.some((c) => selecionadas.has(c.companyId));
  const rodando = job?.status === "processando";

  function alternarEmpresa(id) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function alternarTodas() {
    setSelecionadas(() => (todasMarcadas ? new Set() : new Set(lista.map((c) => c.companyId))));
  }
  function alternarAlvo(valor) {
    setAlvos((prev) => {
      const next = new Set(prev);
      if (next.has(valor)) next.delete(valor); else next.add(valor);
      return next;
    });
  }

  async function carregarRecentes() {
    try {
      const out = await api.listNotasCapturas?.();
      setRecentes(out?.jobs || []);
    } catch { /* silencioso: a lista de recentes não pode derrubar a tela */ }
  }
  useEffect(() => { carregarRecentes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Polling do job em andamento (2,5s — mesmo intervalo das outras telas de lote).
  useEffect(() => {
    if (!job?.jobId || job.status !== "processando") return undefined;
    let vivo = true;
    async function bater() {
      try {
        const out = await api.getNotasCaptura(job.jobId);
        if (!vivo || !out?.job) return;
        setJob(out.job);
        if (out.job.status !== "processando") {
          clearInterval(timer.current);
          carregarRecentes();
        }
      } catch { /* mantém o polling: falha de rede não é fim do job */ }
    }
    timer.current = setInterval(bater, 2500);
    return () => { vivo = false; clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.jobId, job?.status]);

  async function consultar() {
    setAviso(null);
    const ids = lista.filter((c) => selecionadas.has(c.companyId)).map((c) => c.companyId);
    if (!ids.length) { setAviso({ tipo: "error", texto: "Selecione ao menos uma empresa." }); return; }
    if (!alvos.size) { setAviso({ tipo: "error", texto: "Escolha NFS-e, NF-e ou as duas." }); return; }
    setCriando(true);
    try {
      const out = await api.createNotasCaptura({ companyIds: ids, alvos: [...alvos] });
      if (!out?.ok || !out.job) throw new Error(out?.message || "Falha ao iniciar a consulta.");
      setJob(out.job);
      if (out.job.status !== "processando") carregarRecentes();
    } catch (err) {
      setAviso({ tipo: "error", texto: err?.message || "Falha ao iniciar a consulta." });
    } finally {
      setCriando(false);
    }
  }

  const pct = job?.totalEmpresas ? Math.round(((job.processadas || 0) / job.totalEmpresas) * 100) : 0;
  const itens = job?.itens || [];
  // O resumo existe para responder de relance a pergunta que ninguém conseguia responder antes:
  // "quantas EU realmente consultei?".
  const resumo = itens.reduce((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; }, {});

  return (
    <div>
      <section className="serpro-settings-card">
        <div className="serpro-settings-card__head">
          <h1 className="serpro-settings-card__title">Consultar notas em lote</h1>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: "0.84rem", color: "var(--text-muted)", maxWidth: 760 }}>
          Busca notas novas no ADN (NFS-e) e na SEFAZ (NF-e) para as empresas marcadas — é a mesma
          consulta do botão dentro de cada empresa, feita de uma vez.{" "}
          <strong>Toda empresa selecionada aparece no resultado</strong>, inclusive as que não
          puderam ser consultadas, com o motivo.
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              O que buscar
            </span>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {ALVO_OPTIONS.map((o) => (
                <label key={o.value} title={o.hint} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "var(--text)" }}>
                  <input
                    type="checkbox"
                    checked={alvos.has(o.value)}
                    onChange={() => alternarAlvo(o.value)}
                    disabled={criando || rodando}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>

          <Button type="button" variant="success" disabled={criando || rodando || !algumaMarcada} onClick={consultar}>
            {criando ? "Iniciando…" : "🔄 Consultar notas"}
          </Button>
          <span style={{ fontSize: "0.78rem", color: "var(--text-faint)", paddingBottom: 8 }}>
            {selecionadas.size} empresa(s) selecionada(s)
          </span>
        </div>

        {aviso && (
          <div style={{
            margin: "0 0 12px", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem",
            background: aviso.tipo === "error" ? "var(--state-danger-surface)" : "var(--state-ok-surface)",
            border: `1px solid ${aviso.tipo === "error" ? "var(--state-danger)" : "var(--state-ok)"}`,
            color: aviso.tipo === "error" ? "var(--state-danger)" : "var(--state-ok)",
          }}>
            {aviso.texto}
          </div>
        )}

        {job && (
          <div style={{ margin: "0 0 14px", padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: STATUS_JOB[job.status]?.color || "var(--text-muted)" }}>
              {STATUS_JOB[job.status]?.label || job.status}
              {rodando && ` — ${job.processadas || 0}/${job.totalEmpresas || 0} empresa(s)`}
              {job.status === "concluido" && ` — ${job.totalNotas || 0} nota(s) nova(s)`}
            </div>
            {rodando && (
              <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "var(--bg-page)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent-cyan)", transition: "width 0.4s ease" }} />
              </div>
            )}
            {job.status === "erro" && (
              <div style={{ marginTop: 6, fontSize: "0.8rem", color: "var(--state-danger)" }}>
                {job.erroMensagem || "Falha no processamento."}
              </div>
            )}
            {itens.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.78rem" }}>
                {Object.entries(STATUS_ITEM).map(([chave, meta]) => (
                  resumo[chave] ? (
                    <span key={chave} style={{ color: meta.cor }}>
                      {meta.icone} {resumo[chave]} {meta.label}
                    </span>
                  ) : null
                ))}
              </div>
            )}
          </div>
        )}

        {/* RESULTADO POR EMPRESA — a razão de existir da tela. */}
        {itens.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px" }}>Empresa</th>
                  <th style={{ padding: "8px 10px", width: 90 }}>Busca</th>
                  <th style={{ padding: "8px 10px", width: 150 }}>Resultado</th>
                  <th style={{ padding: "8px 10px" }}>Detalhe</th>
                  <th style={{ padding: "8px 10px", width: 120, textAlign: "right" }}>Cursor NSU</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i, idx) => {
                  const meta = STATUS_ITEM[i.status] || STATUS_ITEM.erro;
                  return (
                    <tr key={`${i.portalClientId}-${i.alvo}-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ color: "var(--text)" }}>{i.razao || "—"}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "ui-monospace, monospace" }}>{i.cnpj || "—"}</div>
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{i.alvo === "NFSE" ? "NFS-e" : "NF-e"}</td>
                      <td style={{ padding: "8px 10px", color: meta.cor, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {meta.icone}{" "}
                        {i.status === "capturou" ? `${i.totalDocs} documento(s)`
                          : i.status === "recusado" ? `${i.recusadas} recusado(s)`
                            : meta.label}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--text-muted)" }}>{i.motivo || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: "0.76rem", color: "var(--text-faint)" }}>
                        {i.cursorAntes || "—"}{i.cursorDepois && i.cursorDepois !== i.cursorAntes ? ` → ${i.cursorDepois}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Seleção de empresas */}
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-subtle)", textAlign: "left" }}>
                <th style={{ padding: "8px 10px", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={todasMarcadas}
                    ref={(el) => { if (el) el.indeterminate = !todasMarcadas && algumaMarcada; }}
                    onChange={alternarTodas}
                    disabled={criando || rodando}
                    aria-label="Selecionar todas as empresas"
                  />
                </th>
                <th style={{ padding: "8px 10px" }}>Empresa</th>
                <th style={{ padding: "8px 10px", width: 200 }}>CNPJ</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.companyId} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <input
                      type="checkbox"
                      checked={selecionadas.has(c.companyId)}
                      onChange={() => alternarEmpresa(c.companyId)}
                      disabled={criando || rodando}
                      aria-label={`Selecionar ${c.razao}`}
                    />
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--text)" }}>{c.razao}</td>
                  <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>{c.cnpj}</td>
                </tr>
              ))}
              {!lista.length && (
                <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>Nenhuma empresa na carteira.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Consultas recentes: sair da aba e voltar não pode perder o resultado — senão o contador
            dispara tudo de novo, e cada disparo é chamada externa. */}
        {recentes.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: "0.9rem", margin: "0 0 8px", color: "var(--text)" }}>Consultas recentes</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentes.map((j) => (
                <button
                  key={j.jobId}
                  type="button"
                  onClick={async () => {
                    const out = await api.getNotasCaptura(j.jobId).catch(() => null);
                    if (out?.job) setJob(out.job);
                  }}
                  style={{
                    textAlign: "left", padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                    background: "transparent", border: "1px solid var(--border)", font: "inherit",
                    fontSize: "0.8rem", color: "var(--text-muted)",
                  }}
                >
                  <span style={{ color: STATUS_JOB[j.status]?.color || "var(--text-muted)", fontWeight: 700 }}>
                    {STATUS_JOB[j.status]?.label || j.status}
                  </span>
                  {" · "}{fmtDataHora(j.criadoEm)}
                  {" · "}{j.totalEmpresas} empresa(s)
                  {" · "}{j.totalNotas || 0} nota(s)
                  {" · "}{(j.alvos || []).join(" + ")}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
