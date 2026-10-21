function timestampValido(valor) {
  if (!valor || (typeof valor !== "string" && typeof valor !== "number" && !(valor instanceof Date))) return NaN;
  const partes = typeof valor === "string" && /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(valor);
  if (partes) {
    const [, ano, mes, dia] = partes.map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return NaN;
  }
  return new Date(valor).getTime();
}

export function marcadorProcuracao(dados = {}, agora = Date.now()) {
  dados = dados || {};
  const status = dados.procurationStatus || dados.status;
  const validade = timestampValido(dados.validUntil);
  const consulta = timestampValido(dados.checkedAt);
  const recente = consulta > 0 && agora >= consulta && agora - consulta < 86400000;
  if (dados.ultimaTentativa?.vinculoConfirmado === true && dados.ultimaTentativa.status === 'ERRO') return { chave: 'revalidar', rotulo: 'Erro na verificação', cor: 'var(--state-danger)' };
  if (dados.ultimaTentativa?.vinculoConfirmado === true && dados.ultimaTentativa.status === 'CONSULTANDO') return { chave: 'revalidar', rotulo: 'Verificação pendente', cor: 'var(--state-warn)' };
  if (status === "ERRO" || status === "ERROR") return { chave: "revalidar", rotulo: "Erro na verificação", cor: "var(--state-danger)" };
  if (!dados.checkedAt || status === "DESCONHECIDA") return { chave: "nao_verificada", rotulo: "Não verificada", cor: "var(--text-muted)" };
  if (dados.vinculoConfirmado !== true) return { chave: "revalidar", rotulo: "Revalidar", cor: "var(--state-warn)", orientacao: "A evidência salva não confirma o vínculo com esta empresa e o procurador atual." };
  if (status === "ATIVA" && validade > 0 && validade <= agora) return { chave: "regularizar", rotulo: "Vencida", cor: "var(--state-warn)" };
  if (status === "ATIVA" && validade > agora && consulta > 0 && consulta <= agora && !recente) {
    // Validade documental não renova a elegibilidade operacional nem o filtro de ativas.
    return { chave: "revalidar", rotulo: "Revalidar", rotuloDocumental: `Procuração ativa até ${dataProcuracao(dados.validUntil)}`, cor: "var(--state-warn)", orientacao: "A verificação salva tem 24 horas ou mais. Atualize a verificação antes de operar." };
  }
  if (!recente || (status === "ATIVA" && !(validade > 0))) return { chave: "revalidar", rotulo: "Revalidar", cor: "var(--state-warn)", orientacao: !(consulta > 0) || consulta > agora
    ? "A data da verificação salva é inválida ou futura. Confira a evidência antes de operar."
    : !recente ? "A verificação salva tem 24 horas ou mais. Atualize a verificação antes de operar."
      : "A evidência salva não informa uma validade válida. Confira a procuração antes de operar." };
  if (status === "AUSENTE") return { chave: "regularizar", rotulo: "Sem procuração ativa", cor: "var(--state-warn)" };
  if (status === "ATIVA") return { chave: "ativa", rotulo: "Ativa", rotuloDocumental: `Procuração ativa até ${dataProcuracao(dados.validUntil)}`, cor: "var(--state-ok)" };
  return { chave: "revalidar", rotulo: "A confirmar", cor: "var(--text-muted)" };
}
export function dataProcuracao(valor) {
  if (!Number.isFinite(timestampValido(valor))) return "—";
  const data = new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor || "") ? `${valor}T12:00:00Z` : valor);
  return valor && Number.isFinite(data.getTime()) ? data.toLocaleDateString("pt-BR", {timeZone:"America/Sao_Paulo"}) : "—";
}
