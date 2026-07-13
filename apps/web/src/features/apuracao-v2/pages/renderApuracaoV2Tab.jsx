// Grupo "Fiscal" da empresa — renderiza UM painel conforme o sub-tab ativo (vem do header/URL):
//   cadastroFiscal → Cadastro Fiscal + Atividades permitidas (Bloco A)
//   sugestao       → Sugestão de anexo por nota
//   pendencias     → Pendências fiscais (destrava o fechamento)
// Motor local, Produtos/Serviços e "Reclassificar" foram removidos (minimalista).
import { useState } from "react";
import { PANEL, fmtDate } from "../../notas/components/notasStyles";
import { CadastroFiscalForm } from "../components/CadastroFiscalForm";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";
import { AbaFiscalPanel } from "../components/AbaFiscalPanel";
import { SugestaoAnexoPanel } from "../components/SugestaoAnexoPanel";

export function ApuracaoV2Tab({ panel, sub = "cadastroFiscal" }) {
  const [resolvendo, setResolvendo] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* CADASTRO FISCAL (+ Bloco A: atividades permitidas) */}
      {sub === "cadastroFiscal" && (
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
      {sub === "sugestao" && <SugestaoAnexoPanel panel={panel} />}

      {/* PENDÊNCIAS */}
      {sub === "pendencias" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
          {panel.pendencias.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#69FF47", background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 8 }}>
              ✓ Nenhuma pendência aberta.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {panel.pendencias.map((p) => (
                <div key={p.id}
                  style={{
                    padding: 12, background: PANEL.field, border: `1px solid ${p.tipo === "ITEM_SEM_REGRA" ? "#FFB347" : "#FF4757"}`,
                    borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  }}>
                  <div style={{ flex: 1 }}>
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
                      style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#BD93F9", color: "#000", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
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
