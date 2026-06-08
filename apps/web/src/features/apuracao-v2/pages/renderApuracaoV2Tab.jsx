// Q14.2.e — Tab "Apuração v2" dentro de CompanyDetail.
// 3 abas internas: Cadastro Fiscal | Produtos/Serviços | Pendências.
import { useState } from "react";
import { PANEL, fmtDate } from "../../notas/components/notasStyles";
import { CadastroFiscalForm } from "../components/CadastroFiscalForm";
import { ResolverPendenciaModal } from "../components/ResolverPendenciaModal";

const TIPOS_RECEITA_LABEL = {
  REVENDA_MERCADORIA: "Anexo I",
  INDUSTRIALIZACAO: "Anexo II",
  SERVICO_ANEXO_III: "Anexo III",
  SERVICO_ANEXO_IV: "Anexo IV",
  SERVICO_ANEXO_V: "Anexo V",
  SERVICO_FATOR_R: "Fator R (III↔V)",
  RECEITA_NAO_CLASSIFICADA: "(sem classificação)",
};

export function ApuracaoV2Tab({ panel }) {
  const [activeSub, setActiveSub] = useState("cadastro");
  const [resolvendo, setResolvendo] = useState(null); // pendência ou null
  const [novoProduto, setNovoProduto] = useState(null);

  const tabs = [
    { key: "cadastro", label: "📋 Cadastro Fiscal" },
    { key: "produtos", label: `📦 Produtos/Serviços (${panel.produtos.length})` },
    { key: "pendencias", label: `⚠ Pendências (${panel.pendencias.length})` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header com sub-tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${PANEL.border}` }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveSub(t.key)}
            style={{
              padding: "10px 16px", background: "transparent",
              border: "none", borderBottom: `3px solid ${activeSub === t.key ? "#BD93F9" : "transparent"}`,
              color: activeSub === t.key ? PANEL.text : PANEL.muted,
              cursor: "pointer", fontSize: "0.9rem", fontWeight: activeSub === t.key ? 600 : 400,
            }}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => panel.classificarV2({ force: true })} disabled={panel.saving}
            style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#8BE9FD", color: "#000", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
            title="Reclassifica todos os itens da empresa com o motor v2">
            🏷 Reclassificar (v2)
          </button>
        </div>
      </div>

      {/* CADASTRO */}
      {activeSub === "cadastro" && (
        <CadastroFiscalForm
          cadastro={panel.cadastro}
          cnaePrincipalRef={panel.cnaePrincipalRef}
          saving={panel.saving}
          onSave={panel.saveCadastro}
        />
      )}

      {/* PRODUTOS */}
      {activeSub === "produtos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>📦 Catálogo de produtos/serviços</div>
              <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
                Override da empresa. Produto cadastrado vence regras globais.
              </div>
            </div>
            <button onClick={() => setNovoProduto({})}
              style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#69FF47", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
              + Novo produto
            </button>
          </div>
          {panel.produtos.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, background: PANEL.field, borderRadius: 8 }}>
              Nenhum produto cadastrado. O classificador usa só as regras globais por enquanto.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Nome</th>
                  <th style={{ padding: 8 }}>Tipo Receita</th>
                  <th style={{ padding: 8 }}>Cód. Serviço</th>
                  <th style={{ padding: 8 }}>NCM</th>
                  <th style={{ padding: 8 }}>CFOP</th>
                  <th style={{ padding: 8 }}>Origem</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {panel.produtos.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ padding: 8 }}>{p.nome}</td>
                    <td style={{ padding: 8 }}><code style={{ color: "#BD93F9" }}>{TIPOS_RECEITA_LABEL[p.tipoReceita] || p.tipoReceita}</code></td>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{p.codigoServico || "—"}</td>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{p.ncm || "—"}</td>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{p.cfop || "—"}</td>
                    <td style={{ padding: 8, fontSize: "0.7rem", color: PANEL.muted }}>{p.origem}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      <button onClick={() => panel.deleteProduto(p.id)}
                        style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "#FF4757", color: "#fff", cursor: "pointer", fontSize: "0.7rem" }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PENDÊNCIAS */}
      {activeSub === "pendencias" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>⚠ Pendências fiscais</div>
            <div style={{ fontSize: "0.8rem", color: PANEL.muted }}>
              Itens sem regra ou divergências bloqueiam o fechamento. Resolver cria regra automaticamente.
            </div>
          </div>
          {panel.pendencias.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#69FF47", background: "rgba(105,255,71,0.10)", border: "1px solid #69FF47", borderRadius: 8 }}>
              ✓ Nenhuma pendência aberta. Tudo classificado.
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
                        Competência: {p.competencia} · criada em {fmtDate(p.createdAt)}
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

      {/* Modal de resolver pendência */}
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

      {/* Modal de novo produto (simples — reusa o estado direto) */}
      {novoProduto && (
        <NovoProdutoModal
          onClose={() => setNovoProduto(null)}
          onCreate={async (payload) => {
            await panel.createProduto(payload);
            setNovoProduto(null);
          }}
        />
      )}
    </div>
  );
}

function NovoProdutoModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ nome: "", tipoReceita: "", codigoServico: "", ncm: "", cfop: "" });
  const [saving, setSaving] = useState(false);
  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.nome || !form.tipoReceita) return;
    setSaving(true);
    try { await onCreate(form); } finally { setSaving(false); }
  }
  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, color: PANEL.text, padding: "8px 12px", fontSize: "0.85rem" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}
        style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 22, width: "min(92vw, 500px)", display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>+ Novo produto/serviço</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Nome *
          <input value={form.nome} onChange={(e) => setField("nome", e.target.value)} required style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Tipo Receita *
          <select value={form.tipoReceita} onChange={(e) => setField("tipoReceita", e.target.value)} required style={inputStyle}>
            <option value="">— escolha —</option>
            {Object.entries(TIPOS_RECEITA_LABEL).filter(([k]) => k !== "RECEITA_NAO_CLASSIFICADA").map(([k, v]) => (
              <option key={k} value={k}>{k} ({v})</option>
            ))}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
            Cód. Serviço
            <input value={form.codigoServico} onChange={(e) => setField("codigoServico", e.target.value)} placeholder="LC116" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
            NCM
            <input value={form.ncm} onChange={(e) => setField("ncm", e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
            CFOP
            <input value={form.cfop} onChange={(e) => setField("cfop", e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${PANEL.border}`, background: "transparent", color: PANEL.text, cursor: "pointer", fontSize: "0.85rem" }}>
            Cancelar
          </button>
          <button type="submit" disabled={saving || !form.nome || !form.tipoReceita}
            style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#69FF47", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
            {saving ? "Criando…" : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
