// Módulo Fiscal — Aba Fiscal / Bloco A: atividades permitidas da empresa.
// Deriva dos CNAEs do cadastro (CnaeAnexo → anexo) e deixa o contador ativar/desativar,
// eleger a atividade padrão e informar atributos de ISS (opcionais). Essa config é a
// ENTRADA do motor de sugestão de anexo.
//
// Blocos B (tabela do anexo) e C (Fator R ao vivo) ficam na sub-aba "Apurar (motor local)"
// (MotorPanel), que já calcula faixa/alíquota efetiva/Fator R por competência.

import { useEffect, useState } from "react";
import { PANEL } from "../../notas/components/notasStyles";

const ANEXO_COR = {
  "Anexo I": "#8BE9FD", "Anexo II": "#8BE9FD",
  "Anexo III": "#69FF47", "Anexo IV": "#FFB86C", "Anexo V": "#FF6E6E",
};

export function AbaFiscalPanel({ panel }) {
  const perfil = panel.perfil;
  const [rows, setRows] = useState([]);

  useEffect(() => {
    setRows((perfil?.candidatos || []).map((c) => ({ ...c })));
  }, [perfil]);

  function setRow(cnae, patch) {
    setRows((rs) => rs.map((r) => (r.cnae === cnae ? { ...r, ...patch } : r)));
  }
  // Padrão é exclusivo por (anexo/tipo) — na prática, marcar um desmarca os outros do mesmo tipoReceita.
  function marcarPadrao(cnae, tipoReceita) {
    setRows((rs) => rs.map((r) => ({
      ...r,
      padrao: r.cnae === cnae ? true : (r.tipoReceita === tipoReceita ? false : r.padrao),
    })));
  }

  async function salvar() {
    const config = rows.map((r) => ({
      cnae: r.cnae,
      ativo: r.ativo,
      padrao: r.padrao,
      aliquotaIss: r.aliquotaIss,
      codigoServicoMunicipal: r.codigoServicoMunicipal,
      retencaoFonte: r.retencaoFonte,
      domicilioFiscal: r.domicilioFiscal,
      obs: r.obs,
    }));
    await panel.savePerfil(config);
  }

  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 5, color: PANEL.text, padding: "4px 6px", fontSize: "0.78rem", width: "100%" };

  if (!rows.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>🧾 Aba Fiscal — Atividades permitidas</div>
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, background: PANEL.field, borderRadius: 8 }}>
          Nenhum CNAE encontrado. Preencha o <strong style={{ color: PANEL.text }}>Cadastro Fiscal</strong> (regime + CNAE principal/secundários) para derivar as atividades permitidas.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>🧾 Atividades permitidas (Bloco A)</div>
          <div style={{ fontSize: "0.8rem", color: PANEL.muted, maxWidth: 640 }}>
            Derivado dos CNAEs do cadastro. Ative/desative atividades, eleja a <strong>padrão</strong> por tipo
            e informe atributos de ISS (opcionais). Essa config alimenta o motor de sugestão de anexo.
          </div>
        </div>
        <button onClick={salvar} disabled={panel.saving}
          style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#69FF47", color: "#000", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, opacity: panel.saving ? 0.6 : 1 }}>
          {panel.saving ? "Salvando…" : "Salvar perfil"}
        </button>
      </div>

      {perfil?.temFatorR && (
        <div style={{ padding: 10, background: "rgba(139,233,253,0.10)", border: "1px solid #8BE9FD", borderRadius: 8, fontSize: "0.8rem", color: "#8BE9FD" }}>
          ℹ Há atividade sujeita a <strong>Fator R</strong> (III↔V). O anexo é decidido a cada competência na
          sub-aba <strong>“Apurar (motor local)”</strong>, com a folha (FS12). Atenção à zona de risco 27%–29%.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 900 }}>
          <thead>
            <tr style={{ background: PANEL.field, color: PANEL.muted, textAlign: "left" }}>
              <th style={{ padding: 8 }}>Ativo</th>
              <th style={{ padding: 8 }}>CNAE</th>
              <th style={{ padding: 8 }}>Descrição</th>
              <th style={{ padding: 8 }}>Anexo</th>
              <th style={{ padding: 8 }}>Fator R</th>
              <th style={{ padding: 8, textAlign: "center" }}>Padrão</th>
              <th style={{ padding: 8 }}>Alíq. ISS %</th>
              <th style={{ padding: 8 }}>Cód. serv. munic.</th>
              <th style={{ padding: 8, textAlign: "center" }}>Ret. fonte</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cnae} style={{ borderTop: `1px solid ${PANEL.border}`, opacity: r.ativo ? 1 : 0.5 }}>
                <td style={{ padding: 8 }}>
                  <input type="checkbox" checked={Boolean(r.ativo)} onChange={(e) => setRow(r.cnae, { ativo: e.target.checked })} />
                </td>
                <td style={{ padding: 8, fontFamily: "monospace" }}>
                  {r.cnae}{r.isPrincipal && <span title="CNAE principal" style={{ marginLeft: 4, color: "#BD93F9" }}>★</span>}
                </td>
                <td style={{ padding: 8, maxWidth: 280 }}>
                  {r.descricao}
                  {r.ambiguo && <span title="CNAE ambíguo — múltiplos anexos possíveis" style={{ marginLeft: 6, color: "#FFB347" }}>⚠ ambíguo</span>}
                  {r.impeditivo && <span title="CNAE não catalogado — revisar manualmente" style={{ marginLeft: 6, color: "#FF6E6E" }}>⚠ revisar</span>}
                </td>
                <td style={{ padding: 8, fontWeight: 700, color: ANEXO_COR[r.anexoLabel] || PANEL.muted }}>
                  {r.anexoLabel}
                </td>
                <td style={{ padding: 8 }}>{r.sujeitoFatorR ? "sim" : "—"}</td>
                <td style={{ padding: 8, textAlign: "center" }}>
                  <input type="checkbox" checked={Boolean(r.padrao)} disabled={!r.ativo}
                    onChange={(e) => (e.target.checked ? marcarPadrao(r.cnae, r.tipoReceita) : setRow(r.cnae, { padrao: false }))} />
                </td>
                <td style={{ padding: 8, width: 90 }}>
                  <input type="number" step="0.01" min="0" max="10" value={r.aliquotaIss ?? ""}
                    onChange={(e) => setRow(r.cnae, { aliquotaIss: e.target.value === "" ? null : Number(e.target.value) })}
                    style={inputStyle} placeholder="—" />
                </td>
                <td style={{ padding: 8, width: 130 }}>
                  <input value={r.codigoServicoMunicipal ?? ""} onChange={(e) => setRow(r.cnae, { codigoServicoMunicipal: e.target.value || null })}
                    style={inputStyle} placeholder="—" />
                </td>
                <td style={{ padding: 8, textAlign: "center" }}>
                  <input type="checkbox" checked={Boolean(r.retencaoFonte)} onChange={(e) => setRow(r.cnae, { retencaoFonte: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
