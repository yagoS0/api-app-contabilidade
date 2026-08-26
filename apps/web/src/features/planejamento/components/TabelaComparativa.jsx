// A TABELA COMPARATIVA — quatro colunas, composição por tributo, e nenhuma célula vazia.
//
// Pedido do dono (25/08/2026): *"Quatro colunas lado a lado (Simples III · Simples V · Presumido ·
// Real), com total anual, alíquota efetiva e composição por tributo."*
//
// ⚠ A REGRA mora em `lib/comparativoDeRegimes.js` (22 testes) — aqui é a LIGAÇÃO. Nenhuma conta
// nesta tela: o número que vai ao papel é o do motor.
//
// ⚠⚠ CÉLULA VAZIA É PROIBIDA. Numa tabela de custo, branco se lê como ZERO. Toda ausência sai com
// o motivo em texto — "dentro do DAS", "não se aplica", "não estimado" —, que são três fatos
// diferentes com três consertos diferentes.

import { celulaDoTributo, fraseDaAusencia, ROTULO_DO_TRIBUTO, AUSENCIA } from "../lib/comparativoDeRegimes";

const C = {
  surface: "#24253A", borda: "#44475A", texto: "#F8F8F2",
  muted: "#A7B0C0", accent: "#BD93F9", alerta: "#FFB347",
};

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

const th = {
  padding: "8px 10px", textAlign: "right", fontSize: "0.72rem", color: C.muted,
  borderBottom: `1px solid ${C.borda}`, whiteSpace: "nowrap",
};
const td = { padding: "6px 10px", textAlign: "right", fontSize: "0.82rem", color: C.texto, whiteSpace: "nowrap" };
const tdRotulo = { ...td, textAlign: "left", color: C.muted, fontSize: "0.78rem" };

/** ⚠ A ausência é TEXTO, nunca um traço solto: o traço não diz qual dos três casos é. */
function Celula({ coluna, tributo }) {
  const { valor, ausencia } = celulaDoTributo(coluna, tributo);
  if (valor != null) return <>{brl(valor)}</>;
  return (
    <span style={{
      fontSize: "0.7rem",
      // ⚠ Só a falta de DADO é âmbar. "Dentro do DAS" e "não se aplica" são o sistema funcionando —
      // pintá-los de pendência treinaria o olho a ignorar a cor que significa "falta fazer".
      color: ausencia === AUSENCIA.NAO_ESTIMADO ? C.alerta : C.muted,
      fontStyle: "italic",
    }}>
      {ausencia === AUSENCIA.NAO_ESTIMADO ? "⚠ " : ""}{fraseDaAusencia(ausencia)}
    </span>
  );
}

export function TabelaComparativa({ comparativo }) {
  if (!comparativo || !comparativo.colunas?.length) return null;
  const { colunas, tributos } = comparativo;

  return (
    <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface }}>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: C.texto, marginBottom: 2 }}>
        Comparativo por tributo
      </div>
      <div style={{ fontSize: "0.74rem", color: C.muted, marginBottom: 10, lineHeight: 1.45 }}>
        {/* ⚠⚠ A FRASE QUE EXPLICA A TABELA INTEIRA, e ela é a observação do dono: no Simples a
            contribuição patronal está DENTRO do DAS; no Presumido ela é 20% da folha por fora. É
            isso que faz "o Presumido compensa acima de X" não valer para quem tem folha. */}
        A contribuição patronal (CPP) está <strong>dentro do DAS</strong> no Simples e vem{" "}
        <strong>por fora, sobre a folha</strong>, no Presumido e no Real — é a linha que mais muda a
        comparação de uma prestadora de serviços.
      </div>

      {/* ⚠ Rola dentro do próprio contêiner: a página nunca rola na horizontal. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>&nbsp;</th>
              {colunas.map((c) => (
                <th key={c.chave} style={{ ...th, color: c.vencedora ? C.accent : C.muted }}>
                  <div style={{ fontWeight: 700 }}>{c.titulo}</div>
                  {/* ⚠ Com Fator R são DUAS colunas de Simples. Sem esta marca o contador acharia
                      que ele escolhe o anexo — e no Fator R ele sai da folha, não da escolha. */}
                  {c.atual === false ? (
                    <div style={{ fontSize: "0.64rem", fontWeight: 400, color: C.muted }}>não é o anexo atual</div>
                  ) : null}
                  {c.vencedora ? (
                    <div style={{ fontSize: "0.64rem", fontWeight: 400, color: C.accent }}>menor custo</div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${C.borda}` }}>
              <td style={tdRotulo}>Total no ano</td>
              {colunas.map((c) => (
                <td key={c.chave} style={{ ...td, fontWeight: 700, color: c.vencedora ? C.accent : C.texto }}>
                  {/* ⚠⚠ RECUSA COM O MESMO PESO DO NÚMERO. Regime indisponível não vira traço
                      discreto — é a regra do `CardRegime`: número ausente em cinza vira ausência
                      de dúvida. */}
                  {c.indisponivel || c.elegivel === false
                    ? <span style={{ fontSize: "0.72rem", fontWeight: 600, color: C.alerta }}>não dá para calcular</span>
                    : brl(c.total)}
                </td>
              ))}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.borda}` }}>
              <td style={tdRotulo}>Carga efetiva sobre a receita</td>
              {colunas.map((c) => (
                <td key={c.chave} style={td}>
                  {c.indisponivel || c.elegivel === false ? "—" : pct(c.cargaEfetiva)}
                </td>
              ))}
            </tr>
            {tributos.map((t) => (
              <tr key={t}>
                <td style={tdRotulo}>{ROTULO_DO_TRIBUTO[t]}</td>
                {colunas.map((c) => (
                  <td key={c.chave} style={td}>
                    {c.indisponivel || c.elegivel === false ? "—" : <Celula coluna={c} tributo={t} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ⚠⚠ O QUE FICOU DE FORA, POR COLUNA. Um rodapé único faria o contador atribuir a ressalva
          à coluna errada: o ISS falta no Presumido e não no Simples abaixo do sublimite. */}
      {colunas.some((c) => (c.naoConsiderado || []).length || c.motivo) ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {colunas.map((c) => {
            const itens = c.naoConsiderado || [];
            if (!itens.length && !c.motivo) return null;
            return (
              <div key={c.chave} style={{ fontSize: "0.7rem", color: C.muted, lineHeight: 1.45 }}>
                <strong style={{ color: C.texto }}>{c.titulo}:</strong>{" "}
                {c.motivo ? <span style={{ color: C.alerta }}>{c.motivo} </span> : null}
                {itens.length ? `Fora desta conta: ${itens.join(" · ")}.` : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
