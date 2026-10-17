

export const TRIBUTO_TIPO = {
  das: "SIMPLES", inss: "INSS", irpj: "IRPJ", csll: "CSLL", pisCofins: "PIS", iss: "ISS",
};

export function rotuloCanaisEnviados(tag) {
  if (tag.state !== "enviada") return "";
  const canais = Array.isArray(tag.canaisEnviados) ? tag.canaisEnviados
    : tag.canalEnvio ? [tag.canalEnvio] : tag.emailStatus === "SENT" ? ["EMAIL"] : [];
  return ["EMAIL", "WHATSAPP"].filter(c => canais.includes(c))
    .map(c => c === "EMAIL" ? "E-mail" : "WhatsApp").join(" e ");
}

export function resumoCanaisEnviados(tags) {
  const rotulos = new Set(tags.filter(t => t.state === "enviada").map(rotuloCanaisEnviados));
  return rotulos.size > 1 ? null : [...rotulos][0] || "";
}

export const ESTADO = {
  missing:  { icone: "○", cor: "var(--state-neutral)", fundo: "transparent",  rotulo: "falta gerar" },
  gerada:   { icone: "●", cor: "var(--state-ok)", fundo: "var(--state-ok-surface)",    rotulo: "gerada, falta enviar" },
  // ⚠ ESTE ESTADO EXISTIA NO BANCO E NÃO EXISTIA NA TELA. A guia cujo envio falhou tem
  // `emailStatus:"ERROR"` + `emailLastError` + `emailNextRetryAt` — e **nada drena esse retry**
  // (o laço automático saiu na Q55). Ela ficava âmbar "gerada, falta enviar", exatamente igual à
  // guia que nunca foi tentada, e por isso ninguém era avisado de nada: a falha só saía do banco
  // se alguém, por acaso, clicasse de novo.
  //
  // Vermelho e não âmbar: âmbar é "há trabalho de rotina a fazer", e no fim do mês metade da
  // carteira está em âmbar. Isto aqui é uma tentativa que já foi feita e falhou — a mesma urgência
  // de "falta gerar", com ícone próprio (a regra de aceite pede que um screenshot dessaturado
  // continue legível, e ✖ ≠ ⚠ ≠ ✈).
  falhou:   { icone: "✖", cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)",  rotulo: "o envio FALHOU — ninguém tentará de novo" },
  enviada:  { icone: "✓", cor: "var(--state-ok)",      fundo: "var(--state-ok-surface)",      rotulo: "enviada ao cliente" },
  vazio:    { icone: "⊘", cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)", rotulo: "sem movimento (confirmado)" },
  conflito: { icone: "⚠", cor: "var(--state-danger)",  fundo: "var(--state-danger-surface)",  rotulo: "marcada sem movimento, mas há faturamento" },
};

export function resumoDaGuia(tag) {
  const estado = rotuloCanaisEnviados(tag) ? `enviada por ${rotuloCanaisEnviados(tag)}` : (ESTADO[tag.state] || ESTADO.missing).rotulo;
  return `${tag.label}: ${estado}`;
}

export function todasConcluidas(tags) {
  const exigidas = (tags || []).filter((t) => t.state !== "na");
  return exigidas.length > 0 && exigidas.every((t) => !t.pendenciaOperacional && (t.state === "enviada" || t.state === "vazio"));
}

export const ehParcela = (t) => t.key === "parcDas";

export function todasPorGerar(tags) {
  const tributos = (tags || []).filter((t) => t.state !== "na" && !ehParcela(t));
  return tributos.length > 1 && tributos.every((t) => t.state === "missing");
}
