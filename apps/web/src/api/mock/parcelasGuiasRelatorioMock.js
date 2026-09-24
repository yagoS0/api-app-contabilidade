export function relatorioParcelasGuiasMock({ companyId, mesVencimento, empresa = {}, guias = [], acompanhamento = {} }) {
  const row = { portalClientId: companyId, razao: empresa.razao, cnpj: empresa.cnpj, regimeTributario: empresa.legacyCompany?.regimeTributario || "SIMPLES", documentos: [], faltantes: [], pendingGuideIds: [], tiposGuias: {} };
  const anteriores = [], conferirVencimento = [];
  for (const g of guias) {
    const doc = { ...g, guideId: g.id, portalClientId: companyId, paga: g.paymentStatus === "PAID" || Boolean(g.baixada), enviada: g.emailStatus === "SENT" };
    const mes = String(g.vencimento || "").slice(0, 7);
    if (!mes) { conferirVencimento.push(doc); continue; }
    if (mes < mesVencimento) { if (!doc.paga) anteriores.push(doc); continue; }
    if (mes !== mesVencimento) continue;
    row.documentos.push(doc);
    if (!doc.paga && !doc.enviada && !g.extracted?.conferenciaDocumentoPendente) row.pendingGuideIds.push(g.id);
  }
  for (const i of acompanhamento.indicacoes || []) {
    if (i.status !== "PENDENTE") continue;
    const compat = guias.some(g => g.parcelamentoId && g.status === "PROCESSED" && g.hasPdf && (g.extracted?.indicacaoId === i.id || (!g.extracted?.indicacaoId && g.parcelamentoTipo === i.modalidade && (acompanhamento.indicacoes || []).filter(j => j.status === "PENDENTE" && j.modalidade === i.modalidade).length === 1))
      && String(g.vencimento || g.competencia || "").slice(0, 7) === mesVencimento);
    if (!compat) row.faltantes.push({ id: `${i.id}:mes:${mesVencimento}`, indicacaoId: i.id, portalClientId: companyId, tipo: i.modalidade,
      referencia: mesVencimento, numeroParcelamento: i.numeroParcelamento, vencimento: null, estado: "OBTER_GUIA", label: "Falta guia de parcelamento", motivo: "Falta guia de parcelamento" });
    if (Number(i.parcelasEmAtraso) > 0) anteriores.push({ id: `${i.id}:anteriores`, indicacaoId: i.id, portalClientId: companyId, tipo: i.modalidade,
      somenteAnteriores: true, guiaDoMesPresente: compat, anterior: true, atrasada: true, parcelasEmAtraso: i.parcelasEmAtraso, atrasosInformados: i.parcelasEmAtraso,
      label: `${i.parcelasEmAtraso} parcelas em atraso informadas no relatório fiscal. Confira os períodos.`, motivo: "Há parcelas anteriores em atraso no relatório fiscal." });
  }
  for (const item of acompanhamento.itens || []) {
    if (item.indicacaoId || item.guideId || item.pagamentoConfirmado || item.estado === "RESOLVIDA" || item.formaPagamento === "DEBITO_AUTOMATICO") continue;
    // Contrato sem cronograma não gera uma obrigação mensal inventada.
    const mes = String(item.vencimento || item.referencia || "").slice(0, 7);
    if (!mes) continue;
    const falta = { ...item, acordo: item.numeroParcelamento, motivo: item.label };
    if (mes < mesVencimento) anteriores.push(falta); else if (mes === mesVencimento) row.faltantes.push(falta);
  }
  row.assinatura = JSON.stringify(row.pendingGuideIds);
  row.situacao = row.faltantes.length ? "incompleto" : row.pendingGuideIds.length ? "pendente" : "documentos_tratados";
  return { mesVencimento, competencia: mesVencimento, simples: [row], presumidos: [], outros: [], pendenciasAnteriores: anteriores, conferirVencimento };
}
