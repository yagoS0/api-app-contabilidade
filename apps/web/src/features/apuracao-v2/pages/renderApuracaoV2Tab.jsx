// Grupo "Fiscal" da empresa → aba "Cadastro", com 2 sub-abas INTERNAS:
//   Cadastro   → Cadastro Fiscal + Atividades permitidas (Bloco A)
//   Sugestão   → sugestão de anexo por nota (leitura) + Pendências (fila) juntas, por competência
//
// Sugestão e Pendências foram unidas: as duas trabalham por competência e se complementam
// (a sugestão mostra as notas; classificar cria as pendências dos itens sem regra). O state da
// sugestão fica AQUI (no pai), não no componente da tabela — assim não some ao trocar de sub-aba,
// que era o bug de "sumia e tinha que clicar em Sugerir de novo".
import { useState } from "react";
import { PANEL, fmtDate } from "../../notas/components/notasStyles";
import { CadastroFiscalForm } from "../components/CadastroFiscalForm";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { AbaFiscalPanel } from "../components/AbaFiscalPanel";
import { SugestaoAnexoTabela } from "../components/SugestaoAnexoPanel";

function competenciaAnterior() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function SecaoTabs({ secao, setSecao, pendCount }) {
  const itens = [
    { key: "cadastro", label: "Cadastro" },
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

export function ApuracaoV2Tab({ panel }) {
  const [secao, setSecao] = useState("cadastro");
  const [resolvendo, setResolvendo] = useState(null);
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  // State da sugestão no PAI → sobrevive à troca de sub-aba.
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
      // recarrega a sugestão pra refletir o que virou pendência (se já tinha carregado antes)
      if (sugData) await sugerir();
    } catch { /* o hook já exibe o erro via feedback */ }
    finally { setClassificando(false); }
  }

  const pendencias = panel.pendencias || [];
  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", fontSize: "0.85rem", colorScheme: "dark" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <SecaoTabs secao={secao} setSecao={setSecao} pendCount={pendencias.length} />

      {/* CADASTRO FISCAL (+ Bloco A: atividades permitidas) */}
      {secao === "cadastro" && (
        <>
          <CadastroFiscalForm
            cadastro={panel.cadastro}
            cnaePrincipalRef={panel.cnaePrincipalRef}
            saving={panel.saving}
            onSave={panel.saveCadastro}
          />
          <AbaFiscalPanel panel={panel} />
        </>
      )}

      {/* SUGESTÃO + PENDÊNCIAS (por competência) */}
      {secao === "sugestao" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, color: PANEL.text }}>
          {/* Toolbar única: competência + Sugerir (leitura) + Classificar (grava, cria pendências) */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            <label style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
              Competência
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={inputStyle} />
            </label>
            <button onClick={sugerir} disabled={sugLoading}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#8BE9FD", color: "#000", cursor: sugLoading ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: sugLoading ? 0.6 : 1 }}>
              {sugLoading ? "Carregando…" : "Sugerir"}
            </button>
            <button onClick={classificar} disabled={classificando}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: classificando ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 700, opacity: classificando ? 0.6 : 1 }}>
              {classificando ? "Classificando…" : "Classificar competência"}
            </button>
            <span style={{ fontSize: "0.72rem", color: PANEL.muted, paddingBottom: 6, flex: 1, minWidth: 180 }}>
              Sugerir só mostra. Classificar grava e cria as pendências dos itens sem regra.
            </span>
          </div>

          {/* Pendências primeiro — é o que precisa de ação */}
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
                      style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, flex: "none" }}>
                      Classificar
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Tabela da sugestão (leitura) */}
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
