// A empresa não deve a DEFIS — e a tela DIZ ISSO, com a fonte, no lugar onde o botão estaria.
//
// ⚠ ISTO NÃO É "SUMIR", e a distinção é o ponto inteiro deste arquivo. A tela oferecia o espelho da
// DEFIS a TODA empresa, sem perguntar o regime; o conserto óbvio — esconder o botão para quem não é
// do Simples — trocaria um defeito por outro pior. Some da tela quem não deve nada, e aí ninguém
// sabe se foi dispensa ou esquecimento: o contador que procurasse a DEFIS de uma empresa do
// Presumido não encontraria nem a obrigação nem a explicação, e não teria como distinguir "a lei
// não pede" de "o portal perdeu isso".
//
// É a mesma forma de `entregas/components/EntregaPorArquivo.jsx` (`ObrigacaoNaoDevida`), com o
// sinal invertido: lá a EFD-Contribuições dispensa o Simples; aqui a DEFIS dispensa quem NÃO é do
// Simples.
//
// ⚠ Este componente é IMPORTADO DIRETO, sem `lazy`. O `EspelhoDefis` é carregado sob demanda porque
// carrega a especificação inteira (~40 campos); a dispensa é um parágrafo, e fazê-la esperar um
// chunk mostraria "Carregando…" para dizer que não há trabalho a fazer.

/**
 * @param {{
 *   anoCalendario: number,
 *   veredito: ReturnType<import("../lib/obrigatoriedadeDefis").obrigatoriedadeDefis>,
 *   onAbrirMesmoAssim?: (() => void) | null,
 *   abrindo?: boolean,
 * }} props
 */
export function DefisNaoDevida({ anoCalendario, veredito, onAbrirMesmoAssim = null, abrindo = false }) {
  const indefinida = veredito.situacao === "indefinida";
  // ⚠ Indefinida usa a cor de PENDÊNCIA (falta cadastrar o regime — há ação rápida); dispensada é
  // NEUTRA. Pintar a dispensa de âmbar treinaria o olho a ignorar o âmbar que importa, e verde
  // está fora de questão: verde é concluído, e não se concluiu nada aqui.
  const cor = indefinida ? "var(--state-warn)" : "var(--state-neutral)";
  const fundo = indefinida ? "var(--state-warn-surface)" : "var(--state-neutral-surface)";

  return (
    <div
      style={{
        width: "var(--content-wide)",
        margin: "0 auto",
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${indefinida ? cor : "var(--border)"}`,
        background: "var(--bg-surface)",
        color: "var(--text)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.9rem" }}>Espelho da DEFIS</strong>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          ano-calendário {anoCalendario}
        </span>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 800,
            borderRadius: 999,
            padding: "2px 9px",
            border: `1px solid ${cor}`,
            // ⚠ O par `-surface` existe justamente para isto: nunca derivar fundo com `${cor}22`,
            // que quebra em silêncio assim que a cor vira `var(--…)`.
            background: fundo,
            color: cor,
          }}
        >
          {indefinida ? "NÃO DÁ PARA DIZER" : "NÃO DEVIDA"}
        </span>
      </div>

      <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>{veredito.motivo}</div>
      {veredito.acao && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          {veredito.acao}
        </div>
      )}

      {/* ⚠ AS HIPÓTESES QUE DERRUBARIAM A DISPENSA APARECEM JUNTO DELA, não escondidas. O sistema
          guarda só o regime de HOJE: empresa que saiu do Simples continua devendo a DEFIS do ano em
          que foi optante, e há a porta do processo administrativo. Nomeá-las é o que impede
          "dispensada" de ser lida como "assunto encerrado", sem que o portal afirme uma obrigação
          que não pode verificar. */}
      {veredito.obrigatoriedadesNaoAvaliadas?.length > 0 && (
        <details style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <summary style={{ cursor: "pointer" }}>
            Há hipóteses em que a DEFIS continua devida e o sistema não consegue avaliar — confira
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 5, lineHeight: 1.5 }}>
            {veredito.obrigatoriedadesNaoAvaliadas.map((o) => (
              <li key={o.chave}>
                <strong style={{ color: "var(--text)" }}>{o.titulo}</strong> — {o.detalhe}
              </li>
            ))}
          </ul>

          {/* ⚠ A SAÍDA MORA AQUI, colada no motivo que a justifica — e não solta no painel. Se uma
              destas hipóteses for o caso, a DEFIS é devida DE VERDADE e o contador precisa
              transcrevê-la; um painel que só informasse a dispensa transformaria a regra nova num
              beco sem saída, que é trocar um defeito por outro. Fica secundária de propósito: o
              caminho normal de uma empresa não-optante é NÃO entregar.
              ⚠ Abrir o espelho não grava nada nem transmite nada — é uma folha de transcrição, e a
              DEFIS continua sendo transmitida no portal da Receita. */}
          {onAbrirMesmoAssim && (
            <button
              type="button"
              onClick={onAbrirMesmoAssim}
              disabled={abrindo}
              style={{
                marginTop: 8,
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text)",
                borderRadius: 6,
                padding: "4px 10px",
                font: "inherit",
                fontSize: "0.75rem",
                cursor: abrindo ? "default" : "pointer",
              }}
            >
              {abrindo ? "Abrindo…" : `Abrir o espelho de ${anoCalendario} mesmo assim`}
            </button>
          )}
        </details>
      )}

      <div
        style={{
          fontSize: "0.72rem",
          color: "var(--text-muted)",
          borderTop: "1px solid var(--border)",
          paddingTop: 8,
        }}
      >
        {veredito.fonte}
      </div>
    </div>
  );
}
