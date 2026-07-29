// Calendário fiscal do escritório — grade do mês.
//
// A pergunta que esta tela responde é "o que vence no dia 20, em todas as empresas?". Por isso a
// visão é do ESCRITÓRIO por padrão, com filtro de empresa opcional — e não uma agenda por cliente.
//
// Quase tudo aqui aparece sozinho: guias com vencimento, apuração não transmitida, mês não fechado.
// Só o MARCO é digitado. Uma agenda que depende de alguém alimentar envelhece e ninguém confia.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { Button } from "../../../components/ui/Button";

const COR = {
  fundo: "#21222C", borda: "#44475A", texto: "#F8F8F2", suave: "#A7B0C0",
  guia: "#FFB347", marco: "#BD93F9", hoje: "#8BE9FD", resolvido: "#6272A4",
};

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const fmtMoney = (v) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function mesAnterior(comp) {
  const [y, m] = comp.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function mesSeguinte(comp) {
  const [y, m] = comp.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Item({ item }) {
  const ehMarco = item.tipo === "marco";
  const cor = ehMarco ? COR.marco : item.resolvido ? COR.resolvido : COR.guia;
  const titulo = ehMarco
    ? `${item.titulo}${item.descricao ? ` — ${item.descricao}` : ""}${item.doEscritorio ? " (escritório)" : ""}`
    : `${item.titulo} · ${item.empresa || ""} · ${fmtMoney(item.valor)}${item.resolvido ? " · pago" : ""}`;
  return (
    <div
      title={titulo}
      style={{
        fontSize: "0.68rem", color: cor, whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", textDecoration: item.resolvido ? "line-through" : "none",
      }}
    >
      {ehMarco ? "◆" : "•"} {item.titulo}
      {!ehMarco && item.empresa ? ` ${item.empresa}` : ""}
    </div>
  );
}

export function CalendarioPage({ api, empresas = [], onBack, onOpenCompany }) {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [companyId, setCompanyId] = useState("");
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [novoMarco, setNovoMarco] = useState(null); // { data } quando o dia é clicado

  const carregar = useCallback(async () => {
    if (!api) return;
    setCarregando(true);
    setErro(null);
    try {
      const out = await api.getCalendario(competencia, companyId || undefined);
      setDados(out?.ok === false ? null : out);
      if (out?.ok === false) setErro(out?.message || "Não foi possível carregar o mês.");
    } catch (err) {
      setErro(err?.message || "Não foi possível carregar o mês.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [api, competencia, companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  const hoje = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // Alinha o dia 1 na coluna do dia da semana certo — senão a grade "anda" e o contador procura
  // o dia 20 na coluna errada.
  const offsetInicial = useMemo(() => {
    const [y, m] = competencia.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  }, [competencia]);

  async function salvarMarco(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const titulo = String(form.get("titulo") || "").trim();
    if (!titulo) return;
    try {
      await api.createMarcoFiscal({
        titulo,
        data: novoMarco.data,
        descricao: String(form.get("descricao") || "").trim() || undefined,
        importancia: String(form.get("importancia") || "MEDIA"),
        companyId: companyId || undefined,
      });
      setNovoMarco(null);
      await carregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível salvar o marco.");
    }
  }

  const totais = dados?.totais || {};
  const pendencias = dados?.pendenciasDoMes || [];

  return (
    <div style={{ minHeight: "100vh", background: "#1A1B26" }}>
      <AppShell>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {onBack && <Button variant="secondary" onClick={onBack}>← Voltar</Button>}
          <h1 style={{ margin: 0, color: COR.texto, fontSize: "1.3rem" }}>Calendário</h1>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => setCompetencia(mesAnterior(competencia))} title="Mês anterior">‹</Button>
            <input
              type="month" value={competencia}
              onChange={(e) => e.target.value && setCompetencia(e.target.value)}
              style={{ background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "6px 10px", colorScheme: "dark" }}
            />
            <Button variant="secondary" onClick={() => setCompetencia(mesSeguinte(competencia))} title="Próximo mês">›</Button>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              style={{ background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "6px 10px" }}
            >
              <option value="">Todas as empresas</option>
              {empresas.map((e) => (
                <option key={e.companyId} value={e.companyId}>{e.razao}</option>
              ))}
            </select>
          </div>
        </div>

        {erro && (
          <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", marginBottom: 12 }}>
            {erro}
          </div>
        )}

        <div style={{ color: COR.suave, fontSize: "0.8rem", marginBottom: 10 }}>
          {carregando ? "carregando…" : `${totais.guias || 0} guia(s) vencendo · ${totais.marcos || 0} marco(s)`}
          {" · clique num dia para marcar uma data"}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 6 }}>
          {DIAS_SEMANA.map((d) => (
            <div key={d} style={{ color: COR.suave, fontSize: "0.7rem", textTransform: "uppercase", textAlign: "center", paddingBottom: 4 }}>{d}</div>
          ))}
          {Array.from({ length: offsetInicial }, (_, i) => <div key={`vazio-${i}`} />)}
          {(dados?.dias || []).map((d) => {
            const ehHoje = d.data === hoje;
            return (
              <button
                key={d.data}
                type="button"
                onClick={() => setNovoMarco({ data: d.data })}
                title={`Marcar uma data em ${d.dia}`}
                style={{
                  textAlign: "left", minHeight: 92, padding: 6, borderRadius: 8, cursor: "pointer",
                  background: COR.fundo, color: COR.texto, font: "inherit",
                  border: `1px solid ${ehHoje ? COR.hoje : COR.borda}`,
                }}
              >
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: ehHoje ? COR.hoje : COR.suave, marginBottom: 4 }}>
                  {d.dia}
                </div>
                {d.itens.map((it, i) => <Item key={i} item={it} />)}
              </button>
            );
          })}
        </div>

        {/* Apuração e fechamento são estado do MÊS, não têm dia — ficam fora da grade de propósito.
            Pendurá-los num dia arbitrário inventaria um prazo que não existe. */}
        {pendencias.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ color: COR.texto, fontSize: "0.9rem", fontWeight: 700, marginBottom: 6 }}>
              Pendências do mês (sem data marcada)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pendencias.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenCompany?.(p.companyId, p.competencia)}
                  style={{
                    textAlign: "left", padding: "6px 10px", borderRadius: 6, cursor: onOpenCompany ? "pointer" : "default",
                    background: COR.fundo, border: `1px solid ${COR.borda}`, color: COR.texto, font: "inherit", fontSize: "0.8rem",
                  }}
                >
                  <span style={{ color: COR.guia }}>{p.titulo}</span>
                  <span style={{ color: COR.suave }}> — {p.empresa}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </AppShell>

      {novoMarco && (
        <div
          role="dialog" aria-modal="true" aria-label="Marcar uma data"
          onClick={(e) => { if (e.target === e.currentTarget) setNovoMarco(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
        >
          <form
            onSubmit={salvarMarco}
            style={{ width: "100%", maxWidth: 440, background: "#282A36", border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, color: COR.texto }}
          >
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Marcar uma data</h3>
            <p style={{ margin: "0 0 14px", fontSize: "0.8rem", color: COR.suave }}>
              {novoMarco.data}
              {companyId ? " · só para a empresa filtrada" : " · vale para todas as empresas"}
            </p>
            <input name="titulo" autoFocus placeholder="Ex.: CBS passa a ser cobrada" required
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "8px 10px" }} />
            <input name="descricao" placeholder="Descrição (opcional)"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "8px 10px" }} />
            <select name="importancia" defaultValue="MEDIA"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 14, background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "8px 10px" }}>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Média</option>
              <option value="BAIXA">Baixa</option>
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button type="button" variant="secondary" onClick={() => setNovoMarco(null)}>Cancelar</Button>
              <Button type="submit" variant="success">Marcar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
