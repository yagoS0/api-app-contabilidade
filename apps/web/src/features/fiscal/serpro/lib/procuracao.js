export function marcadorProcuracao(dados = {}, agora = Date.now()) {
  const status = dados.procurationStatus || dados.status;
  const validade = new Date(dados.validUntil).getTime();
  const consulta = new Date(dados.checkedAt).getTime();
  const recente = consulta > 0 && agora >= consulta && agora - consulta < 86400000;
  if (!dados.checkedAt || status === "DESCONHECIDA") return { chave: "nao_verificada", rotulo: "Não verificada", cor: "var(--text-muted)" };
  if (status === "ATIVA" && validade > 0 && validade <= agora) return { chave: "regularizar", rotulo: "Vencida", cor: "var(--state-warn)" };
  if (!recente || dados.vinculoConfirmado === false || (status === "ATIVA" && !(validade > 0))) return { chave: "revalidar", rotulo: "Revalidar", cor: "var(--state-warn)" };
  if (status === "AUSENTE") return { chave: "regularizar", rotulo: "Sem procuração ativa", cor: "var(--state-warn)" };
  if (status === "ATIVA") return { chave: "ativa", rotulo: "Ativa", cor: "var(--state-ok)" };
  return { chave: "revalidar", rotulo: "A confirmar", cor: "var(--text-muted)" };
}
export function dataProcuracao(valor) {
  const data = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor || "") ? `${valor}T12:00:00Z` : valor);
  return valor && Number.isFinite(data.getTime()) ? data.toLocaleDateString("pt-BR", {timeZone:"America/Sao_Paulo"}) : "—";
}
