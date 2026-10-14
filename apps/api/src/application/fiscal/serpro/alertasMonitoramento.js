// Projeção dos registros locais: nunca consulta o provedor, agenda tarefas ou altera apurações.
export async function anexarAlertasMonitoramento(items, consultarSituacoesSalvas, competencia, agora = new Date()) {
  if (!items.length) return items;
  try {
    const situacoes = await consultarSituacoesSalvas(items.map(item => ({ companyId: item.portalClientId, cnpj: item.cnpj })));
    const porEmpresa = new Map(situacoes.map(item => [item.companyId, item.serproStatus]));
    return items.map(item => ({ ...item, alertasFiscais: alertasMonitoramento(item, porEmpresa.get(item.portalClientId), competencia, agora) }));
  } catch {
    // Monitoramento indisponível não impede conferir ou apurar; também não equivale a zero alertas.
    return items.map(item => ({ ...item, monitoramentoErro: true }));
  }
}

export function alertasMonitoramento(item, procuracao = {}, competencia, agora = new Date()) {
  const alertas = [];
  const instante = new Date(agora).getTime();
  const adicionar = (codigo, categoria, titulo, detalhe) => alertas.push({
    id: `${item.portalClientId}:${categoria === "procuracao" ? "procuracao" : competencia}:${codigo}`,
    codigo, categoria, titulo, detalhe,
  });
  const consulta = new Date(procuracao.checkedAt).getTime();
  const validade = new Date(procuracao.validUntil).getTime();
  const recente = consulta > 0 && consulta <= instante && instante - consulta < 86400000;
  const vinculada = procuracao.vinculoConfirmado === true;
  if (vinculada && procuracao.procurationStatus === "ATIVA" && validade > 0 && validade <= instante) {
    adicionar("PROCURACAO_VENCIDA", "procuracao", "Procuração vencida", "Regularize a autorização e use Testar procuração em Consultas antes de conciliar.");
  } else if (vinculada && recente && procuracao.procurationStatus === "AUSENTE") {
    adicionar("PROCURACAO_AUSENTE", "procuracao", "Sem procuração ativa", "A última consulta confirmou ausência de autorização para o procurador configurado. Regularize e atualize a verificação.");
  } else if (!vinculada || !recente || !(validade > instante) || procuracao.procurationStatus !== "ATIVA") {
    adicionar("PROCURACAO_REVALIDAR", "procuracao", "Procuração a verificar", "A autorização atual não está confirmada nos registros locais. Confira em Consultas; este alerta não dispara consulta fiscal.");
  }

  const entrega = item.entregaPgdas || {};
  const comprovada = Boolean(entrega.numeroDeclaracaoRfb || (item.estado === "transmitida" && item.numeroDeclaracao));
  if (comprovada) {
    if (!entrega.temPdfDaDeclaracao || !entrega.temRecibo) adicionar("PGDAS_DOCUMENTOS_INCOMPLETOS", "documentos", "Entrega confirmada; documentos incompletos", "Falta extrato ou recibo salvo. Use a conciliação documental para recuperar o que falta, sem transmitir novamente.");
    return alertas;
  }
  // Sem calendário legal nesta projeção: não inventar prazo ou atraso. Só meses já encerrados.
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date(agora)).map(p => [p.type, p.value]));
  const mesAtual = `${partes.year}-${partes.month}`;
  if (item.regime !== "SIMPLES" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) || competencia >= mesAtual || (item.inicioMonitoramentoPgdas && competencia < item.inicioMonitoramentoPgdas)) return alertas;
  if (entrega.extratoStatus === "NOT_FOUND") {
    adicionar("PGDAS_NAO_LOCALIZADO", "declaracao", "Declaração não localizada", "A última consulta não localizou a declaração desta competência. Confira a entrega antes de solicitar nova consulta; não há repetição automática.");
  } else if (["ERROR", "INCOMPLETE", "RUNNING"].includes(entrega.extratoStatus)) {
    adicionar("PGDAS_CONSULTA_INCONCLUSIVA", "declaracao", "Entrega a confirmar — consulta inconclusiva", "O registro não comprova entrega nem ausência de declaração. Confira a autorização e o resultado anterior antes de conciliar.");
  } else {
    adicionar("PGDAS_COMPROVACAO_PENDENTE", "declaracao", "Entrega pendente de comprovação", "Não há número de declaração confirmado no sistema para esta competência. Isso não prova falta de entrega; confira se ela foi transmitida por fora.");
  }
  return alertas;
}
