// Grupo "Fiscal" da empresa → aba "Cadastro", com 3 sub-abas INTERNAS:
//   Cadastro   → Cadastro Fiscal + Atividades permitidas (Bloco A)
//   Sugestão   → Sugestão de anexo por nota (leitura)
//   Pendências → fila de itens sem regra + botão que RODA a classificação (o que popula a fila)
//
// Antes eram 3 abas de topo separadas. A classificação (que cria as pendências) tinha perdido o
// gatilho na reforma minimalista — por isso a fila ficava sempre vazia. O botão "Classificar
// competência" reconecta isso.
import { useState } from "react";
import { PANEL, fmtDate } from "../../notas/components/notasStyles";
import { CadastroFiscalForm } from "../components/CadastroFiscalForm";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { AbaFiscalPanel } from "../components/AbaFiscalPanel";
import { SugestaoAnexoPanel } from "../components/SugestaoAnexoPanel";

function competenciaAnterior() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Seletor de seção — pílulas simples, dentro do conteúdo (as abas Chrome de verdade são as do header).
function SecaoTabs({ secao, setSecao, pendCount }) {
  const itens = [
    { key: "cadastro", label: "Cadastro" },
    { key: "sugestao", label: "Sugestão" },
    { key: "pendencias", label: "Pendências", badge: pendCount },
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
  const [classificando, setClassificando] = useState(false);

  async function classificar() {
    setClassificando(true);
    try {
      await panel.classificarV2({ competencia });
    } catch { /* o hook já exibe o erro via feedback */ }
    finally { setClassificando(false); }
  }

  const pendencias = panel.pendencias || [];

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

      {/* SUGESTÃO DE ANEXO POR NOTA */}
      {secao === "sugestao" && <SugestaoAnexoPanel panel={panel} />}

      {/* PENDÊNCIAS — com o gatilho que as cria */}
      {secao === "pendencias" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
          {/* Rodar a classificação da competência: é o que gera a fila (marca tipoReceita + cria pendências). */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", padding: 12, background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 8 }}>
            <label style={{ display: "grid", gap: 3, fontSize: "0.75rem", color: PANEL.muted }}>
              Competência
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "6px 10px", fontSize: "0.85rem", colorScheme: "dark" }} />
            </label>
            <button onClick={classificar} disabled={classificando}
              style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: classificando ? "default" : "pointer", fontSize: "0.85rem", fontWeight: 700, opacity: classificando ? 0.6 : 1 }}>
              {classificando ? "Classificando…" : "Classificar competência"}
            </button>
            <span style={{ fontSize: "0.75rem", color: PANEL.muted, paddingBottom: 6, flex: 1, minWidth: 200 }}>
              Classifica as notas da competência. Cada item sem regra vira uma pendência aqui embaixo.
            </span>
          </div>

          {pendencias.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#69FF47", background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 8 }}>
              ✓ Nenhuma pendência aberta.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pendencias.map((p) => (
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
              ))}
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
