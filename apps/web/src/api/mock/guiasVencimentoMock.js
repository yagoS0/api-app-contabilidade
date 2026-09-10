const carteiras = new Map();
export function relatorioVencimentoMock(empresas, { mesVencimento, competencia = "" }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesVencimento)) throw new Error("Mês de vencimento inválido");
  if (!carteiras.has(mesVencimento)) {
    const anterior = new Date(`${mesVencimento}-01T00:00:00Z`);
    anterior.setUTCMonth(anterior.getUTCMonth() - 1);
    carteiras.set(mesVencimento, empresas.map((c, i) => ({ portalClientId: c.companyId, razao: c.razao, cnpj: c.cnpj,
      competencia: mesVencimento, mesVencimento, regimeTributario: "SIMPLES", tiposGuias: {},
      documentos: [
        { guideId: `mock-das-${mesVencimento}-${c.companyId}`, tipo: "SIMPLES", competencia: anterior.toISOString().slice(0, 7), vencimento: `${mesVencimento}-20`, valor: 500, enviada: false },
        { guideId: `mock-parcela-${mesVencimento}-${c.companyId}`, tipo: "SIMPLES", parcelamentoId: `acordo-${i}`, acordo: `A${i}`, numeroParcela: 9, competencia: mesVencimento, vencimento: `${mesVencimento}-28`, valor: 300, enviada: false },
      ], faltantes: i === 0 ? [{ parcelaId: "mock-faltante", motivo: "Guia da parcela ainda não disponível", acordo: "B1", numeroParcela: 9, vencimento: `${mesVencimento}-28` }] : [],
    })));
  }
  const simples = carteiras.get(mesVencimento).map((r) => {
    const documentos = r.documentos.filter((d) => !competencia || d.competencia === competencia);
    const ids = documentos.filter((d) => !d.enviada && !d.paga).map((d) => d.guideId);
    return { ...r, documentos: documentos.map((d) => ({ ...d })), pendingGuideIds: ids, assinatura: JSON.stringify(ids), situacao: r.faltantes.length ? "incompleto" : ids.length ? "pendente" : "documentos_tratados" };
  });
  return { mesVencimento, competencia: mesVencimento, competenciaFiltro: competencia, simples, presumidos: [], outros: [], pendenciasAnteriores: [], conferirVencimento: [] };
}
export function enviarVencimentoMock(items) {
  return { ok: true, total: items.length, sent: items.length, results: items.map((it) => {
    const row = carteiras.get(it.mesVencimento)?.find((r) => r.portalClientId === it.portalClientId);
    const ids = row?.documentos.filter((d) => it.guideIds?.includes(d.guideId) && !d.enviada && !d.paga).map((d) => d.guideId) || [];
    if (!ids.length || JSON.stringify(ids) !== it.assinatura) throw Object.assign(new Error("Confira novamente o lote."), { code: "CONFERENCIA_DIVERGENTE" });
    row.documentos.forEach((d) => { if (ids.includes(d.guideId)) d.enviada = true; });
    return { portalClientId: it.portalClientId, ok: true, status: "sent", sentNow: ids.length, attachmentsCount: ids.length };
  }) };
}
export function previaVencimentoMock(empresas, contatosPorEmpresa, { mesVencimento, portalClientIds, guideIds }) {
  const r = relatorioVencimentoMock(empresas, { mesVencimento });
  const linhas = r.simples.filter((c) => portalClientIds?.includes(c.portalClientId)).flatMap((c) => c.documentos.filter((d) => guideIds?.includes(d.guideId) && !d.enviada && !d.paga).map((d) => {
    const contato = (contatosPorEmpresa[c.portalClientId] || []).find((k) => k.ativo !== false && k.optInEm && k.telefoneE164);
    return { ...d, portalClientId: c.portalClientId, empresa: c.razao, tipoLabel: d.parcelamentoId ? "Parcelamento" : "DAS", canalSugerido: contato ? "WHATSAPP" : "EMAIL", motivo: contato ? null : "SEM_CONTATO", destino: contato?.telefoneE164, contatoNome: contato?.nome };
  }));
  if (!guideIds?.length || linhas.length !== guideIds.length) throw Object.assign(new Error("Confira novamente o lote."), { code: "CONFERENCIA_DIVERGENTE" });
  return { ok: true, mesVencimento, competencia: mesVencimento, assinatura: JSON.stringify(guideIds), canal: { disponivel: true }, linhas,
    resumo: { total: linhas.length, porWhatsapp: linhas.filter((l) => l.canalSugerido === "WHATSAPP").length, porEmail: linhas.filter((l) => l.canalSugerido === "EMAIL").length, jaEnviadas: 0 } };
}
