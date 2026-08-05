// Grupo "Fiscal" da empresa → aba "Apuração" (renomeada de "Cadastro"). É onde a empresa é
// FECHADA para apuração, transmitida e retificada — tudo por dentro da própria empresa. Seções:
//   Apuração → faturamento + prévia (modal de fechamento reusado) + extrato do Simples + ações
//   Cadastro → só o essencial: regime (Simples) + atividades permitidas
//   Sugestão → sugestão de anexo por nota + pendências (por competência) — igual antes
//
// O fluxo de calcular/fechar/transmitir/retificar reaproveita o FechamentoModal (o MESMO da tela de
// lote), aberto por um botão — então a lógica validada não muda. A tela de lote (renderApuracaoPage)
// virou só "selecionar as fechadas e apurar em lote".
import { useCallback, useEffect, useState } from "react";
import { rotuloEstadoApuracao, RBT12_NOME } from "../../../lib/vocabulario";
import { PANEL, fmtDate, fmtMoney } from "../../notas/components/notasStyles";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { AbaFiscalPanel } from "../components/AbaFiscalPanel";
import { SugestaoAnexoTabela } from "../components/SugestaoAnexoPanel";
import { FechamentoModal } from "../../apuracao/components/FechamentoModal";

function competenciaAnterior() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const ESTADO_COR = {
  fechada: "#69FF47", transmitida: "#8BE9FD", calculada: "#FFB347", confirmada: "#69FF47",
};
// Mostra em que ponto do TRABALHO a competência está, não o nome do registro no banco.
// "calculada" e "bloqueada_pendencias" descrevem a linha da tabela; o contador quer saber se
// ainda falta transmitir.
function EstadoBadge({ estado }) {
  if (!estado || estado === "pendente" || estado === "aberta") {
    return <span style={{ color: PANEL.muted }}>{rotuloEstadoApuracao(estado)}</span>;
  }
  const cor = ESTADO_COR[estado] || "#FFB347";
  return <span style={{ color: cor, fontWeight: 700 }}>{rotuloEstadoApuracao(estado)}</span>;
}

function SecaoTabs({ secao, setSecao, pendCount }) {
  const itens = [
    { key: "apuracao", label: "Apuração" },
    // "Perfil fiscal", não "Cadastro": a palavra Cadastro já era o grupo de abas da empresa E a
    // tela de ficha. Três coisas com o mesmo nome, duas delas visíveis ao mesmo tempo.
    { key: "cadastro", label: "Perfil fiscal" },
    { key: "sugestao", label: "Sugestão", badge: pendCount },
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {itens.map((it) => {
        const ativo = secao === it.key;
        return (
          <button key={it.key} type="button" onClick={() => setSecao(it.key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 16px", borderRadius: 8, cursor: ativo ? "default" : "pointer",
              border: `1px solid ${ativo ? "#BD93F9" : PANEL.border}`,
              background: ativo ? "rgba(189,147,249,0.16)" : "transparent",
              color: ativo ? PANEL.text : PANEL.muted, fontSize: "0.85rem", fontWeight: ativo ? 700 : 600,
            }}>
            {it.label}
            {it.badge ? (
              <span style={{ background: "#FF4757", color: "#fff", borderRadius: 999, fontSize: "0.68rem", padding: "1px 6px", fontWeight: 700 }}>
                {it.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, cor, title }) {
  return (
    <div title={title} style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ fontSize: "0.68rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "1.05rem", fontWeight: 700, color: cor || PANEL.text, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

export function ApuracaoV2Tab({ panel, api, companyId, feedback, razao, competencia: competenciaGlobal, onCompetenciaChange }) {
  const [secao, setSecao] = useState("apuracao");
  const [resolvendo, setResolvendo] = useState(null);
  // ⚠ A COMPETÊNCIA É DA EMPRESA, não desta aba — vem do seletor do header.
  // Era `useState(competenciaAnterior())`: sair de Lançamentos em maio e entrar aqui mostrava
  // junho, sem nada indicar a troca. A apuração é o ato fiscal do mês; apurar a competência errada
  // por causa de dois seletores discordando é o erro mais caro que esta tela pode produzir.
  // O fallback local cobre a aba montada fora da página de detalhe (não há chamador assim hoje).
  const competencia = competenciaGlobal || competenciaAnterior();
  const setCompetencia = onCompetenciaChange || (() => {});

  // ── Apuração (fechamento) ─────────────────────────────────────────────
  const [fechDados, setFechDados] = useState(null);
  const [fechLoading, setFechLoading] = useState(false);
  const [snap, setSnap] = useState(null);
  const [fechando, setFechando] = useState(null); // { retificar } → abre o FechamentoModal
  // Extrato do Simples (o que realmente foi pra Receita) — botão explícito (bate no SERPRO).
  const [extrato, setExtrato] = useState(null);
  const [extratoLoading, setExtratoLoading] = useState(false);

  const carregarApuracao = useCallback(async () => {
    if (!api || !companyId || !/^\d{4}-\d{2}$/.test(competencia)) return;
    setFechLoading(true);
    try {
      const [fech, snapshot] = await Promise.all([
        api.getFechamento?.(companyId, competencia),
        api.getApuracaoSnapshot?.(companyId, competencia).catch(() => null),
      ]);
      setFechDados(fech?.dados || fech || null);
      setSnap(snapshot?.snapshot || snapshot || null);
    } catch {
      setFechDados(null);
    } finally {
      setFechLoading(false);
    }
  }, [api, companyId, competencia]);

  useEffect(() => {
    if (secao === "apuracao") carregarApuracao();
  }, [secao, carregarApuracao]);

  async function abrirRetificar() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Reabrir a apuração de ${razao || "esta empresa"} (${competencia}) para RETIFICAR?\n\nVocê corrige os valores e retransmite uma declaração RETIFICADORA (substitui a anterior).`)) return;
    try {
      const r = await api.reabrirFechamento?.(companyId, competencia);
      if (r?.ok === false) throw new Error(r?.message || r?.error || "Falha ao reabrir");
      feedback?.notifySuccess?.("Apuração reaberta — corrija e clique em Transmitir/Retificar dentro do modal.");
      setFechando({ retificar: true });
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao reabrir para retificar");
    }
  }

  async function buscarExtrato() {
    setExtratoLoading(true);
    try {
      const out = await api.syncPgdasCircular?.(companyId, competencia);
      const r = out?.result || out;
      setExtrato(r || null);
      if (out?.ok === false) feedback?.notifyError?.(out?.message || "Falha ao buscar extrato.");
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Falha ao buscar extrato do Simples.");
    } finally {
      setExtratoLoading(false);
    }
  }

  // O PDF vem por blob autenticado, não por `<a href>`: a rota exige o token no header, e a URL
  // gravada no banco é `file:///…` quando o storage é LOCAL.
  async function abrirExtratoPdf(tipo) {
    try {
      const blob = await api.fetchPgdasPdfBlob?.(companyId, competencia, tipo);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      feedback?.notifyError?.(err?.message || "O arquivo não está mais no armazenamento.");
    }
  }

  // ── Sugestão (state no pai → sobrevive à troca de sub-aba) ─────────────
  const [sugData, setSugData] = useState(null);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugErro, setSugErro] = useState(null);
  const [classificando, setClassificando] = useState(false);

  async function sugerir() {
    setSugLoading(true); setSugErro(null);
    try {
      const out = await panel.getSugestao(competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      setSugData(out);
    } catch (e) {
      setSugErro(e?.message || "Erro"); setSugData(null);
    } finally { setSugLoading(false); }
  }

  async function classificar() {
    setClassificando(true);
    try {
      await panel.classificarV2({ competencia });
      if (sugData) await sugerir();
    } catch { /* o hook já exibe o erro via feedback */ }
    finally { setClassificando(false); }
  }

  const pendencias = panel.pendencias || [];
  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", fontSize: "0.85rem", colorScheme: "dark" };
  const btnPrimary = { padding: "8px 16px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700 };
  const btnGhost = { padding: "8px 14px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 };

  const fat = fechDados?.faturamento || {};
  const estado = fechDados?.estado || snap?.estado;
  const dasApurado = snap?.dasRetornadoSerpro ?? snap?.dasCalculadoLocal ?? null;
  const extDados = extrato?.dados || extrato?.circular || null;

  return (
    // Q63: maxWidth sem margem automática colava o módulo à esquerda — centraliza como em Lançamentos.
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, marginLeft: "auto", marginRight: "auto", width: "100%" }}>
      <SecaoTabs secao={secao} setSecao={setSecao} pendCount={pendencias.length} />

      {/* ── APURAÇÃO ──────────────────────────────────────────────────── */}
      {secao === "apuracao" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            {/* ⚠ Sem `input type="month"` aqui: quem troca a competência é o seletor do header, um
                só para a empresa inteira. O RÓTULO fica — ele diz sobre que mês esta barra fala,
                e sumir com ele deixaria os botões "Calcular / Fechar" sem período à vista. */}
            <span style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
              Competência
              <strong style={{ fontSize: "0.95rem", color: PANEL.text, paddingBottom: 4 }}>{competencia}</strong>
            </span>
            <span style={{ fontSize: "0.82rem", color: PANEL.muted, paddingBottom: 6 }}>Estado: <EstadoBadge estado={estado} /></span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setFechando({ retificar: false })} style={btnPrimary} disabled={fechLoading}>
              {estado === "aberta" || !estado ? "Calcular / Fechar" : "Revisar / Fechar"}
            </button>
            {estado === "transmitida" && (
              <button onClick={abrirRetificar} style={btnGhost} title="Reabrir para corrigir e retransmitir como retificadora.">
                🔄 Retificar
              </button>
            )}
          </div>

          {/* Faturamento + valor apurado (a prévia completa — CNAEs/alíquota/DAS — sai no modal ao Calcular). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label="Fat. interno" value={`${fmtMoney(fat.interno)}`} />
            <Kpi label="Fat. externo" value={`${fmtMoney(fat.externo)}`} />
            <Kpi label="Receita 12 meses" title={`${RBT12_NOME} (RBT12)`} value={`${fmtMoney(fechDados?.rbt12)}`} />
            <Kpi label="DAS apurado" value={dasApurado != null ? `${fmtMoney(dasApurado)}` : "—"} cor="#8BE9FD" />
          </div>
          {fechDados?.cadastroCompleto === false && (
            <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 8, color: "#FFB347", fontSize: "0.82rem" }}>
              ⚠ Cadastro fiscal incompleto (sem CNAE). Ajuste na aba Cadastro antes de fechar.
            </div>
          )}

          {/* Extrato do Simples — o que realmente foi pra Receita (conferência). */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.9rem" }}>Extrato do Simples Nacional</strong>
              <button onClick={buscarExtrato} style={btnGhost} disabled={extratoLoading}>
                {extratoLoading ? "Buscando…" : "Buscar extrato"}
              </button>
            </div>
            {extDados && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Kpi label="Receita bruta" value={`${fmtMoney(extDados.receitaBruta)}`} />
                <Kpi label="DAS (Receita)" value={`${fmtMoney(extDados.dasTotal ?? extDados.impostoApurado)}`} cor="#8BE9FD" />
                {/* ⚠ Estes dois botões existiam e NUNCA apareciam: liam `files.declaracaoUrl`, e o
                    backend devolve `files.declaracaoFileId`. O campo errado é sempre `undefined`,
                    então a condição nunca era verdadeira — botão escrito, nunca renderizado.
                    E não dá para usar a URL mesmo quando ela existe: com o provider LOCAL ela é
                    `file:///…`. Quem serve o arquivo é a rota `/pgdas/:competencia/pdf`, com o
                    token no header — por isso blob, não `<a href>`. */}
                {extrato?.files?.declaracaoFileId && (
                  <button type="button" onClick={() => abrirExtratoPdf("declaracao")} style={btnGhost}>Declaração (PDF)</button>
                )}
                {extrato?.files?.reciboFileId && (
                  <button type="button" onClick={() => abrirExtratoPdf("recibo")} style={btnGhost}>Recibo (PDF)</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CADASTRO (enxuto: só regime + atividades permitidas) ───────── */}
      {secao === "cadastro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8, fontSize: "0.85rem" }}>
            Regime tributário: <strong style={{ color: "#69FF47" }}>
              {String(panel.cadastro?.regime || "SIMPLES_NACIONAL") === "SIMPLES_NACIONAL" ? "Simples Nacional" : (panel.cadastro?.regime || "—")}
            </strong>
          </div>
          <AbaFiscalPanel panel={panel} />
        </div>
      )}

      {/* ── SUGESTÃO + PENDÊNCIAS (por competência) ────────────────────── */}
      {secao === "sugestao" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            {/* ⚠ Sem `input type="month"` aqui: quem troca a competência é o seletor do header, um
                só para a empresa inteira. O RÓTULO fica — ele diz sobre que mês esta barra fala,
                e sumir com ele deixaria os botões "Calcular / Fechar" sem período à vista. */}
            <span style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
              Competência
              <strong style={{ fontSize: "0.95rem", color: PANEL.text, paddingBottom: 4 }}>{competencia}</strong>
            </span>
            <button onClick={sugerir} disabled={sugLoading}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#8BE9FD", color: "#000", cursor: sugLoading ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: sugLoading ? 0.6 : 1 }}>
              {sugLoading ? "Carregando…" : "Sugerir"}
            </button>
            <button onClick={classificar} disabled={classificando} style={{ ...btnPrimary, opacity: classificando ? 0.6 : 1 }}>
              {classificando ? "Classificando…" : "Classificar competência"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Pendências</div>
            {pendencias.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "#69FF47", background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 8, fontSize: "0.85rem" }}>
                ✓ Nenhuma pendência aberta.
              </div>
            ) : (
              pendencias.map((p) => (
                <div key={p.id}
                  style={{
                    padding: 12, background: PANEL.field, border: `1px solid ${p.tipo === "ITEM_SEM_REGRA" ? "#FFB347" : "#FF4757"}`,
                    borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.7rem", color: p.tipo === "ITEM_SEM_REGRA" ? "#FFB347" : "#FF4757", fontWeight: 600, marginBottom: 4 }}>
                      [{p.tipo}]
                    </div>
                    <div style={{ fontSize: "0.9rem" }}>{p.resumo}</div>
                    {p.competencia && (
                      <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 4 }}>
                        {p.competencia} · {fmtDate(p.createdAt)}
                      </div>
                    )}
                  </div>
                  {p.tipo === "ITEM_SEM_REGRA" && (
                    <button onClick={() => setResolvendo(p)}
                      style={{ ...btnPrimary, flex: "none", fontSize: "0.8rem" }}>
                      Classificar
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {sugErro && (
            <div style={{ padding: 10, background: "rgba(255,71,87,0.10)", border: "1px solid #FF4757", borderRadius: 8, color: "#FF6E6E", fontSize: "0.85rem" }}>{sugErro}</div>
          )}
          {sugData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Sugestão de anexo por nota</div>
              <SugestaoAnexoTabela data={sugData} />
            </div>
          )}
        </div>
      )}

      {/* Modal de fechamento reusado (calcular/fechar/transmitir/retificar). */}
      {fechando && api && (
        <FechamentoModal
          api={api}
          feedback={feedback}
          portalClientId={companyId}
          razao={razao}
          competencia={competencia}
          retificar={fechando.retificar === true}
          onClose={() => setFechando(null)}
          onChanged={() => carregarApuracao()}
        />
      )}

      {resolvendo && (
        <ResolverPendenciaModal
          pendencia={resolvendo}
          saving={panel.saving}
          onClose={() => setResolvendo(null)}
          onResolver={async (payload) => {
            await panel.resolverPendencia(resolvendo.id, payload);
            setResolvendo(null);
          }}
        />
      )}
    </div>
  );
}
