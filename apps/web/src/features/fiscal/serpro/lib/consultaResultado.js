// HTTP 200 confirma transporte, não contabilização nem pagamento.
export function resultadoContabil(accounting) {
  const razoes = { mes_fechado: "Mês contábil fechado. Use a correção explícita do mês antes de contabilizar.", extrato_incompleto: "Extrato incompleto: confira os documentos e valores.", circular_not_found: "Circular não encontrada.", missing_rule: "Regra contábil ausente. Configure a regra do evento em Lançamentos." };
  const detalhe = i => i?.message || i?.motivo || razoes[i?.reason];
  const contratoValido = Array.isArray(accounting?.generatedEntries)
    && accounting.generatedEntries.every(e => e && ["created", "updated", "recalculated", "noop"].includes(e.action))
    && [accounting.divergences, accounting.skipped].every(v => v === undefined || Array.isArray(v));
  const pendente = accounting?.ok !== true || !contratoValido || accounting?.divergences?.length > 0 || accounting?.skipped?.length > 0;
  if (pendente) {
    const motivos = [detalhe(accounting), ...(Array.isArray(accounting?.divergences) ? accounting.divergences : []).map(detalhe), ...(Array.isArray(accounting?.skipped) ? accounting.skipped : []).map(detalhe)].filter(v => typeof v === "string");
    return { ok: false, message: `Contabilização pendente. ${motivos.join(" ") || "Confira as contas, regras, divergências e o fechamento em Lançamentos."}` };
  }
  const contar = (...acoes) => accounting.generatedEntries.filter(e => acoes.includes(e.action)).length;
  const partes = [[contar("created"), "criados"], [contar("updated", "recalculated"), "atualizados"], [contar("noop"), "já existentes"]]
    .filter(([n]) => n > 0).map(([n, descricao]) => `${n} ${descricao}`);
  return { ok: true, message: partes.length ? `Lançamentos: ${partes.join("; ")}. Confira a contabilidade.` : "Nenhum lançamento retornado. Confira a contabilidade." };
}

export function resultadoExtrato(payload) {
  const result = payload?.result;
  if (payload?.ok === false || !result?.circular) return { ok: false, message: payload?.message || "Sincronização sem confirmação. Confira os documentos antes de repetir." };
  if (result.circular.serproSyncStatus === "NOT_FOUND") return { ok: false, message: "Nenhuma declaração PGDAS-D transmitida foi encontrada para essa competência." };
  if (result.circular.serproSyncStatus !== "SUCCESS") return { ok: false, message: "Extrato incompleto ou indisponível. Confira os documentos e os valores antes de contabilizar." };
  const contabil = resultadoContabil(result.accounting);
  return { ...contabil, message: `${result.reutilizado ? "Extrato salvo reaproveitado" : "Extrato obtido"}. ${contabil.message}` };
}

export function resultadoPagamento(payload) {
  const r = payload?.result;
  if (payload?.ok === false || !r || ![r.total, r.paid, r.errors].every(n => Number.isInteger(n) && n >= 0) || r.paid + r.errors > r.total) {
    return { ok: false, message: payload?.message || "Consulta de pagamento sem confirmação. Confira o resultado antes de repetir a consulta paga." };
  }
  const ok = !r.pagtowebDisabled && r.errors === 0;
  return { ok, message: r.mensagem || `${r.paid} pagamento(s) localizado(s) de ${r.total}; ${r.errors} falha(s). A baixa contábil deve ser conferida separadamente.` };
}

export function resultadoDocumento(op, payload) {
  const incerto = { ok: false, message: payload?.message || "Consulta sem resultado confirmado. Confira antes de repetir." };
  if (payload?.ok !== true) return incerto;
  if (op === "parcelamento") {
    if (!Array.isArray(payload.parcelamentos)) return incerto;
    const pendentes = payload.parcelamentos.filter(p => !p || p.status === "erro" || (p.reason && p.reason !== "sem_parcelas_disponiveis") || !Array.isArray(p.parcelas)
      || p.parcelas.some(parcela => !parcela || !["ok", "reutilizada", "paga", "acompanhar_pagamento"].includes(parcela.status)));
    return { ok: !pendentes.length, message: pendentes.length
      ? `Consulta de parcelamentos com ${pendentes.length} resultado(s) pendente(s). Confira os acordos antes de repetir.`
      : payload.skipped === "sem_parcelamento_ativo" ? "Nenhum parcelamento ativo elegível para consulta." : "Consulta de parcelamentos concluída. Confira as parcelas obtidas." };
  }
  const r = payload.result;
  if (!r || typeof r !== "object") return incerto;
  if (op === "inss") {
    if (["NOT_TRANSMITTED", "NOT_INSS"].includes(r.inss?.status)) return { ok: false, message: r.inss.status === "NOT_TRANSMITTED" ? "DCTFWeb ainda não transmitida; guia de INSS não obtida." : "Consulta sem débito de INSS identificado. Confira a declaração." };
    if (!["EMITTED", "REUSED"].includes(r.inss?.status)) return incerto;
  } else if (!r.guide || !(r.guide.guideId || r.guide.id) || r.guide.status !== "PROCESSED") return incerto;
  if (r.accounting) {
    const contabil = resultadoContabil(r.accounting);
    if (!contabil.ok) return { ...contabil, message: "Documento obtido. " + contabil.message };
  }
  return { ok: true, message: "Documento obtido. Confira a contabilização separadamente." };
}
