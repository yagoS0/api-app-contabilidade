// Módulo Fiscal — Aba Fiscal / Bloco A: atividades permitidas da empresa.
// Deriva dos CNAEs do cadastro (CnaeAnexo → anexo) e deixa o contador ativar/desativar,
// eleger a atividade padrão e informar atributos de ISS (opcionais). Essa config é a
// ENTRADA do motor de sugestão de anexo.
//
// Blocos B (tabela do anexo) e C (Fator R ao vivo) ficam na sub-aba "Apurar (motor local)"
// (MotorPanel), que já calcula faixa/alíquota efetiva/Fator R por competência.

import { useEffect, useState } from "react";
import { PANEL } from "../../notas/components/notasStyles";
import { Button } from "../../../components/ui/Button";
import { origemDoPerfil, avisoDoFatorR, COLUNAS_SEM_LEITOR, COLUNAS_COM_LEITOR } from "../lib/perfilFiscalTela";

const ANEXO_COR = {
  "Anexo I": "#8BE9FD", "Anexo II": "#8BE9FD",
  "Anexo III": "var(--success)", "Anexo IV": "#FFB86C", "Anexo V": "#FF6E6E",
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

  // ⚠ REGRA DE TELA em `lib/perfilFiscalTela.js` (18 testes) — aqui é só a ligação.
  const origem = origemDoPerfil(perfil);
  const fatorR = avisoDoFatorR(perfil);

  const inputStyle = { background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 5, color: PANEL.text, padding: "4px 6px", fontSize: "0.78rem", width: "100%" };

  if (!rows.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>🧾 Aba Fiscal — Atividades permitidas</div>
        <div style={{ padding: 24, textAlign: "center", color: PANEL.muted, background: PANEL.field, borderRadius: 8 }}>
          Nenhum CNAE encontrado.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, color: PANEL.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>Atividades permitidas</div>
        <Button onClick={salvar} disabled={panel.saving}>
          {panel.saving ? "Salvando…" : "Salvar perfil"}
        </Button>
      </div>

      {/* ⚠⚠ O PERFIL PODE NÃO ESTAR SALVO, E A TELA PRECISA DIZER. Medido: 28 das 34 empresas não
          têm linha em `cadastros_fiscais` — para elas o backend MONTA o perfil a partir dos CNAEs da
          ficha da empresa e devolve `temCadastro: false`, e ninguém no front lia esse campo. O
          contador via um perfil "preenchido" que não existe no banco. É a contradição que ele
          relatou entre esta tela e a aba Apuração. */}
      {origem.aviso && (
        <div style={{ padding: 10, background: "rgba(255,179,71,0.10)", border: "1px solid #FFB347", borderRadius: 8, fontSize: "0.8rem", color: "#FFB347", lineHeight: 1.5 }}>
          <strong>⚠ {origem.aviso.titulo}</strong>
          <div style={{ marginTop: 4, color: PANEL.text }}>{origem.aviso.texto}</div>
          <div style={{ marginTop: 4, color: PANEL.muted, fontSize: "0.74rem" }}>{origem.aviso.consequencia}</div>
        </div>
      )}

      {/* ⚠⚠ ANTES ISTO DIZIA "atenção à zona 27%–29%" — um número que NENHUM código calcula
          (varredura: zero ocorrências de 0.27/0.29 no repositório). Número inventado em tela fiscal
          é pior que texto nenhum: parece resultado de conta. Hoje a frase diz o que o perfil
          realmente sabe (QUAIS atividades são de Fator R) e manda onde o valor é calculado. */}
      {fatorR && (
        <div style={{ padding: 10, background: "rgba(139,233,253,0.10)", border: "1px solid #8BE9FD", borderRadius: 8, fontSize: "0.8rem", color: "#8BE9FD", lineHeight: 1.5 }}>
          ℹ {fatorR.texto}
          <div style={{ marginTop: 4, color: PANEL.muted, fontSize: "0.74rem" }}>{fatorR.ondeVerOValor}</div>
          {fatorR.divergencia && (
            <div style={{ marginTop: 4, color: "#FFB347", fontSize: "0.74rem" }}>⚠ {fatorR.divergencia}</div>
          )}
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
              {/* ⚠⚠ COLUNA QUE ACEITA DIGITAÇÃO E NINGUÉM LÊ É PIOR QUE COLUNA AUSENTE — o
                  contador preenche e nada acontece. Medido: dos oito campos de `perfilAtividades`,
                  só `aliquotaIss` tem leitor. As demais ficam (pode haver valor já digitado, e
                  apagar coluna leva o dado junto) mas passam a DIZER que não alimentam nada.
                  ⚠ A marca é VISÍVEL, não só `title`: `title` não aparece no teclado nem no toque. */}
              <th style={{ padding: 8 }}>
                Alíq. ISS %
                <div style={{ fontWeight: 400, fontSize: "0.66rem", color: PANEL.muted }} title={COLUNAS_COM_LEITOR.aliquotaIss}>
                  usada no Planejamento
                </div>
              </th>
              <th style={{ padding: 8 }}>
                Cód. serv. munic.
                <div style={{ fontWeight: 400, fontSize: "0.66rem", color: "#FFB347" }} title={COLUNAS_SEM_LEITOR.codigoServicoMunicipal}>
                  ⚠ ainda sem uso
                </div>
              </th>
              <th style={{ padding: 8, textAlign: "center" }}>
                Ret. fonte
                <div style={{ fontWeight: 400, fontSize: "0.66rem", color: "#FFB347" }} title={COLUNAS_SEM_LEITOR.retencaoFonte}>
                  ⚠ ainda sem uso
                </div>
              </th>
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
