

export function textoDoSelo(origemPreenchimento) {
  return String(origemPreenchimento || "").toUpperCase() === "CLIENTE"
    ? "declarado pelo cliente"
    : "declarado no atendimento";
}
