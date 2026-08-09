// SELO DO DADO DECLARADO — "isto ainda não foi conferido".
//
// ⚠ O TEXTO MUDA COM `origemPreenchimento`, e essa é a razão de o componente existir em vez de uma
// string fixa. "Declarado pelo cliente" só vale quando o CLIENTE preencheu (Fase 2). Na Fase 1 quem
// digita é o escritório, e um selo dizendo "declarado pelo cliente" mentiria sobre um dado que o
// próprio contador acabou de escrever — o que destruiria a confiança no selo justamente onde ele
// serve, que é distinguir o conferido do não-conferido.
//
// ⚠ COR: `--state-warn`, com FUNDO TRANSPARENTE. Pendência, não erro nem conclusão. Vermelho é
// reservado ao que bloqueia fechamento contábil; verde é conclusão.

export function textoDoSelo(origemPreenchimento) {
  return String(origemPreenchimento || "").toUpperCase() === "CLIENTE"
    ? "declarado pelo cliente"
    : "declarado no atendimento";
}

export function SeloDeclarado({ origemPreenchimento, titulo }) {
  const texto = textoDoSelo(origemPreenchimento);
  return (
    <span
      title={titulo || "Informação declarada, ainda não conferida contra a fonte oficial."}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 999,
        border: "1px solid var(--state-warn)",
        color: "var(--state-warn)",
        background: "transparent",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">!</span>
      {texto}
    </span>
  );
}

export default SeloDeclarado;
