// GAUGE DO FATOR R.
//
// ⚠ O NÚMERO NÃO É O PRODUTO — A FRASE É.
// "Fator R: 25,3%" não diz o que fazer. "Faltam R$ 2.300 de pró-labore no ano para mudar do Anexo V
// para o III, e isso economizaria R$ 18.400" é a frase que o contador fala para o cliente. Por isso
// o gauge existe para dar contexto ao número, e o texto abaixo dele carrega a decisão.
//
// ⚠ A MARGEM VALE NOS DOIS LADOS. Abaixo de 28% é "quanto falta"; acima é "quanto pode cair antes
// de despencar". O segundo é o que ninguém olha — a empresa que passou raspando não sabe que está
// a R$ 800 de perder o Anexo III no mês seguinte, porque a apuração é MENSAL e o enquadramento
// alterna mês a mês.

import { FATOR_R_LIMITE } from "../lib/tabelasFiscais";

const C = { surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0", ok: "#50FA7B", falta: "#FFB347", perigo: "#FF5555" };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(2).replace(".", ",")}%`;

/** A "zona de risco": passar raspando não é estar seguro, porque a apuração é mensal. */
const MARGEM_ESTREITA = 0.02; // 2 p.p.

export function GaugeFatorR({ fatorR, economiaSeMudar = null }) {
  if (!fatorR) return null;

  const atinge = fatorR.atinge;
  const valor = fatorR.fatorR;
  const distancia = Math.abs(valor - FATOR_R_LIMITE);
  const noLimiar = atinge && distancia <= MARGEM_ESTREITA;

  const cor = !atinge ? C.falta : noLimiar ? C.perigo : C.ok;

  // Escala de 0 a 40% — 28% cai a 70% da barra, o que deixa espaço visível dos dois lados.
  const MAX = 0.40;
  const posicao = Math.min(100, Math.max(0, (valor / MAX) * 100));
  const marca = (FATOR_R_LIMITE / MAX) * 100;

  return (
    <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${C.borda}`, background: C.surface, color: C.texto }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: "0.86rem" }}>Fator R</strong>
        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: cor }}>{pct(valor)}</span>
        <span style={{ fontSize: "0.78rem", color: C.muted }}>
          folha de 12 meses ÷ receita de 12 meses · o limite é 28%
        </span>
      </div>

      {/* A barra com o limite MARCADO — sem a marca, 25% e 31% parecem a mesma coisa. */}
      <div style={{ position: "relative", height: 12, borderRadius: 999, background: "#1A1B26", border: `1px solid ${C.borda}`, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${posicao}%`, background: cor, opacity: 0.55 }} />
        <div style={{ position: "absolute", top: -2, bottom: -2, left: `${marca}%`, width: 2, background: C.texto }} title="Limite de 28%" />
      </div>
      <div style={{ position: "relative", height: 16, fontSize: "0.66rem", color: C.muted }}>
        <span style={{ position: "absolute", left: `${marca}%`, transform: "translateX(-50%)" }}>28%</span>
      </div>

      {/* ── A FRASE ───────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 8, fontSize: "0.86rem", lineHeight: 1.45 }}>
        {!atinge ? (
          <>
            A empresa está no <strong>Anexo V</strong>. Faltam{" "}
            <strong style={{ color: C.falta }}>{brl(fatorR.diferenca)}</strong> de folha no ano
            (pró-labore e encargos entram na conta) para chegar aos 28% e migrar para o{" "}
            <strong>Anexo III</strong>
            {economiaSeMudar != null && economiaSeMudar > 0 && (
              <> — o que reduziria a carga em <strong style={{ color: C.ok }}>{brl(economiaSeMudar)}</strong> por ano</>
            )}
            .
            {/* ⚠ O custo do próprio aumento de folha NÃO está nessa economia. Dizer só o ganho seria
                metade da conta — o pró-labore adicional traz 20% de CPP e o INSS do sócio. */}
            <div style={{ marginTop: 6, fontSize: "0.78rem", color: C.muted }}>
              Compare com o custo de aumentar a folha: a CPP patronal é 20% sobre o acréscimo, e há o
              INSS do sócio sobre o pró-labore. A migração só compensa se a economia superar esse custo.
            </div>
          </>
        ) : noLimiar ? (
          <>
            A empresa está no <strong>Anexo III</strong>, mas <strong style={{ color: C.perigo }}>por pouco</strong>:
            a folha pode cair <strong>{brl(Math.abs(fatorR.diferenca))}</strong> no ano e ela volta ao Anexo V.
            {/* Por que isso é alerta e não informação: a apuração é MENSAL. */}
            <div style={{ marginTop: 6, fontSize: "0.78rem", color: C.muted }}>
              O Fator R é apurado todo mês sobre os 12 meses anteriores — o enquadramento pode mudar de
              um mês para o outro, sem aviso.
            </div>
          </>
        ) : (
          <>
            A empresa está no <strong>Anexo III</strong> com folga: a folha teria de cair{" "}
            <strong>{brl(Math.abs(fatorR.diferenca))}</strong> no ano para cair no Anexo V.
          </>
        )}
      </div>
    </div>
  );
}
