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

/**
 * ⚠ O GATILHO DE 80% É ESCOLHA DE PRODUTO, NÃO REGRA LEGAL — e por isso mora aqui, na tela, e não
 * em `tabelasFiscais.js`, onde todo valor aponta para a lei. A lei só conhece dois pontos: dentro
 * do limite, e fora dele (com o degrau de 20% definindo o efeito). O aviso antecipado existe porque
 * a empresa que já consumiu 80% do limite proporcional ainda pode decidir — depois de estourar,
 * não pode mais.
 */
const CONSUMO_PARA_AVISAR = 0.8;

function AvisoLimiteProporcional({ guarda }) {
  const perto = guarda.consumoDoLimite != null && guarda.consumoDoLimite >= CONSUMO_PARA_AVISAR;
  if (!guarda.excedeu && !perto) return null;

  // Ultrapassou até 20%: continua no Simples ESTE ano e sai no seguinte. É aviso, não bloqueio —
  // o bloqueio (retroativo) nem chega aqui, porque vira `elegivel: false` no motor.
  const jaEstourou = guarda.excedeu;

  return (
    <div style={{ marginTop: 10, padding: 8, borderRadius: 8, border: `1px solid ${C.alerta}`, background: "rgba(255,179,71,0.10)", fontSize: "0.76rem" }}>
      <strong style={{ color: C.alerta }}>
        {jaEstourou ? "Limite proporcional ultrapassado" : "Elegibilidade por um fio"}
      </strong>
      <div style={{ marginTop: 4, lineHeight: 1.5 }}>
        {jaEstourou ? (
          <>
            A receita de {brl(guarda.receita)} nos {guarda.meses} meses de atividade passou do limite
            proporcional de <strong>{brl(guarda.limite)}</strong> em {brl(guarda.excesso)}. Como o excesso
            não chega a 20%, a empresa permanece no Simples neste ano e é <strong>excluída a partir do
            ano-calendário seguinte</strong> (LC 123/2006, art. 3º, § 12).
          </>
        ) : (
          <>
            No ano de início o limite não é R$ 4,8 mi: é <strong>{brl(guarda.limite)}</strong> ({guarda.meses}{" "}
            {guarda.meses === 1 ? "mês" : "meses"} × R$ 400.000). Faltam <strong>{brl(guarda.margem)}</strong> para
            estourar. Passando dele em mais de 20%, a exclusão <strong>retroage ao início das atividades</strong> —
            os tributos de todo o período são refeitos pelas normas gerais (art. 3º, §§ 2º e 10).
          </>
        )}
      </div>
    </div>
  );
}

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
          {/* ⚠ A INELEGIBILIDADE PRECISA DIZER O PORQUÊ E A CONSEQUÊNCIA. "Não é elegível" manda o
              usuário embora sem saber o que fazer; o motivo do limite proporcional é acionável —
              ele muda com a receita dos meses de atividade, que é decisão da empresa. */}
          {resultado.motivo && (
            <div style={{ marginTop: 6, fontSize: "0.8rem", fontWeight: 400, color: C.texto }}>
              {resultado.motivo}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.15 }}>{brl(resultado.total)}</div>
          <div style={{ fontSize: "0.8rem", color: C.muted, marginTop: 2 }}>
            por ano · carga efetiva de <strong style={{ color: C.texto }}>{pct(resultado.cargaEfetiva)}</strong> sobre a receita
          </div>
          {resultado.anexo && <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 4 }}>{resultado.anexo} · {resultado.faixa}ª faixa</div>}
          {resultado.atividade && <div style={{ fontSize: "0.78rem", color: C.muted, marginTop: 4 }}>{resultado.atividade}</div>}

          {/* ⚠⚠ ELEGIBILIDADE POR UM FIO — no CORPO do card, junto do número que ela pode anular.
              O resultado aqui não pode ser binário: entre "cabe" e "não cabe" existe a faixa em que
              a empresa ainda cabe mas está a poucos reais de não caber, e quem lê "MENOR CARGA" sem
              esse aviso opta sem saber o que arrisca. A consequência vai escrita junto, porque
              "atenção ao limite" não diz que os tributos do período podem ser refeitos. */}
          {resultado.elegibilidadeInicioAtividade && (
            <AvisoLimiteProporcional guarda={resultado.elegibilidadeInicioAtividade} />
          )}

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
          {/* ⚠ Par do aviso da CPP: o total do Simples na 6ª faixa inclui um imposto que NÃO está
              no DAS. Sem esta linha, quem confere o DAS na guia não reconhece o número do card. */}
          {resultado.issPorFora > 0 && (
            <div style={{ marginTop: 8, fontSize: "0.76rem", color: C.alerta }}>
              Inclui {brl(resultado.issPorFora)} de ISS <strong>por fora do DAS</strong> — acima do sublimite de R$ 3,6 mi o ISS sai do DAS (art. 13-A).
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
