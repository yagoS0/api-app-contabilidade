// CARD DE UM REGIME — o resultado da simulação, ou a RECUSA de simular.
//
// ⚠ EXIGÊNCIA DE PRODUTO, E É A MAIS IMPORTANTE DESTE ARQUIVO:
// a recusa de calcular tem o MESMO PESO VISUAL do resultado. Se o card do Lucro Real dissesse
// "faltam margem e créditos" em cinza pequeno enquanto os outros dois mostram números grandes, o
// usuário compararia os dois visíveis e decidiria sem o terceiro — que é exatamente o cenário que
// o `null` do motor existe para impedir. Recusar calcular e depois deixar a recusa desaparecer na
// diagramação é pior que ter calculado errado: o número ausente vira ausência de dúvida.
//
// Por isso o card indisponível tem a mesma altura, a mesma borda e o mesmo destaque; o que muda é
// que no lugar do valor há a PERGUNTA que falta responder, e ela é um campo, não um aviso.

const C = {
  surface: "#24253A", borda: "#44475A", texto: "#F8F8F2", muted: "#A7B0C0",
  vencedor: "#50FA7B", alerta: "#FFB347", falta: "#8BE9FD",
};

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => `${(Number(v || 0) * 100).toFixed(2).replace(".", ",")}%`;

const ROTULO_TRIBUTO = {
  irpj: "IRPJ", adicionalIrpj: "Adicional de IRPJ", csll: "CSLL", cofins: "COFINS",
  pis: "PIS/Pasep", pisCofins: "PIS/COFINS", cpp: "CPP (INSS patronal)", icms: "ICMS",
  iss: "ISS", ipi: "IPI",
};

export function CardRegime({ resultado, vencedor, aberto, onToggle }) {
  if (!resultado) return null;

  // ── RECUSA DE CALCULAR — mesmo peso do resultado ──────────────────────────
  if (resultado.indisponivel) {
    return (
      <div style={{
        flex: "1 1 280px", minWidth: 260, padding: 16, borderRadius: 12,
        // Borda e fundo com o MESMO destaque dos outros; a cor muda para dizer "falta dado",
        // não para diminuir.
        border: `2px solid ${C.falta}`, background: C.surface, color: C.texto, boxSizing: "border-box",
      }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 800, marginBottom: 10 }}>{resultado.regime}</div>

        {/* No lugar do valor grande, a pergunta que falta — no mesmo tamanho do valor. */}
        <div style={{ fontSize: "1.15rem", fontWeight: 800, color: C.falta, lineHeight: 1.3, marginBottom: 8 }}>
          Não dá para comparar ainda
        </div>
        <div style={{ fontSize: "0.82rem", color: C.texto, marginBottom: 10 }}>{resultado.motivo}</div>

        <div style={{ fontSize: "0.8rem", color: C.texto }}>
          <strong style={{ display: "block", marginBottom: 4 }}>Falta informar:</strong>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3 }}>
            {(resultado.faltam || []).map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  const inelegivel = resultado.elegivel === false;

  return (
    <div style={{
      flex: "1 1 280px", minWidth: 260, padding: 16, borderRadius: 12,
      border: `2px solid ${vencedor ? C.vencedor : C.borda}`,
      background: C.surface, color: C.texto, boxSizing: "border-box",
      opacity: inelegivel ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 800 }}>{resultado.regime}</span>
        {vencedor && (
          <span style={{ fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.05em", color: "#1A1B26", background: C.vencedor, borderRadius: 999, padding: "2px 8px" }}>
            MENOR CARGA
          </span>
        )}
      </div>

      {inelegivel ? (
        <div style={{ fontSize: "1rem", fontWeight: 700, color: C.alerta }}>
          A empresa não é elegível a este regime com esta receita.
        </div>
      ) : (
        <>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.15 }}>{brl(resultado.total)}</div>
          <div style={{ fontSize: "0.8rem", color: C.muted, marginTop: 2 }}>
            por ano · carga efetiva de <strong style={{ color: C.texto }}>{pct(resultado.cargaEfetiva)}</strong> sobre a receita
          </div>
          {resultado.anexo && <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 4 }}>{resultado.anexo} · {resultado.faixa}ª faixa</div>}
          {resultado.atividade && <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 4 }}>{resultado.atividade}</div>}

          {/* ⚠ O QUE FICOU DE FORA VAI NO CORPO DO CARD, NÃO EM RODAPÉ.
              Um total que não inclui o ISS parece completo; quem lê o número grande e o aviso longe
              dele compara duas coisas que não são comparáveis. */}
          {(resultado.naoConsiderado || []).length > 0 && (
            <div style={{ marginTop: 10, padding: 8, borderRadius: 8, border: `1px solid ${C.alerta}`, background: "rgba(255,179,71,0.10)", fontSize: "0.76rem" }}>
              <strong style={{ color: C.alerta }}>Fora desta conta:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, display: "grid", gap: 2 }}>
                {resultado.naoConsiderado.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          {resultado.tetoIssAplicado && (
            <div style={{ marginTop: 8, fontSize: "0.74rem", color: C.muted }}>
              Teto de ISS de 5% aplicado, com o excedente redistribuído aos tributos federais.
            </div>
          )}
          {resultado.cppPorFora > 0 && (
            <div style={{ marginTop: 8, fontSize: "0.76rem", color: C.alerta }}>
              Inclui {brl(resultado.cppPorFora)} de INSS patronal <strong>por fora do DAS</strong> — no Anexo IV a CPP não está incluída.
            </div>
          )}
          {resultado.majoracaoLc224?.aplicada && (
            <div style={{ marginTop: 8, fontSize: "0.74rem", color: C.alerta }}>
              Presunção majorada pela LC 224/2025.
              {resultado.majoracaoLc224.controvertida && " Há discussão judicial em curso sobre a exigência."}
            </div>
          )}

          <button
            type="button"
            onClick={onToggle}
            style={{ marginTop: 10, background: "transparent", border: `1px solid ${C.borda}`, color: C.texto, borderRadius: 6, padding: "4px 10px", font: "inherit", fontSize: "0.75rem", cursor: "pointer" }}
          >
            {aberto ? "▴ Ocultar detalhamento" : "▾ Ver por tributo e premissas"}
          </button>

          {aberto && (
            <div style={{ marginTop: 10, display: "grid", gap: 3, fontSize: "0.78rem" }}>
              {Object.entries(resultado.porTributo || {}).map(([t, v]) => (
                <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: C.muted }}>{ROTULO_TRIBUTO[t] || t}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(v)}</span>
                </div>
              ))}
              {/* "Ver premissas" não é enfeite: é o que permite contestar o número. */}
              {(resultado.premissas || []).length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borda}` }}>
                  <strong style={{ fontSize: "0.74rem", color: C.muted }}>Premissas</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: "0.74rem", color: C.muted, display: "grid", gap: 2 }}>
                    {resultado.premissas.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
