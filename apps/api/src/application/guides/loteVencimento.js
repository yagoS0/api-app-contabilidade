import { createHash } from "node:crypto";

export function periodoVencimento(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ""))) {
    throw Object.assign(new Error("Informe o mês de vencimento no formato AAAA-MM."), { code: "MES_VENCIMENTO_INVALIDO", status: 400 });
  }
  const inicio = new Date(`${mes}-01T00:00:00.000Z`);
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  return { gte: inicio, lt: fim };
}

// Vencimento é data civil gravada em UTC, não um instante a converter para o fuso do navegador.
export function mesDaData(data) {
  if (!data) return null;
  const value = new Date(data);
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 7);
}

export function assinaturaGuias(guias) {
  return createHash("sha256").update(JSON.stringify(guias.map((g) => [
    g.id, g.portalClientId, g.competencia, g.tipo, String(g.valor ?? ""),
    g.vencimento ? new Date(g.vencimento).toISOString() : null,
    g.status, g.paymentStatus, g.emailStatus, g.hash, g.updatedAt,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex");
}

export function loteAlterado() {
  return Object.assign(new Error("As guias mudaram. Atualize o lote e confira os documentos novamente."), {
    code: "CONFERENCIA_DIVERGENTE", status: 409,
  });
}

export function montarRelatorioVencimento({ mesVencimento, companies, guides, parcelas, enviada }) {
  periodoVencimento(mesVencimento);
  const rows = new Map();
  const empresas = new Map(companies.map((c) => [c.id, c]));
  const pendenciasAnteriores = [];
  const conferirVencimento = [];
  function rowFor(id) {
    if (!rows.has(id)) {
      const c = empresas.get(id);
      if (!c) return null;
      rows.set(id, { portalClientId: id, razao: c.razao, cnpj: c.cnpj,
        regimeTributario: String(c.company?.regimeTributario || c.company?.tipoTributario || "").toUpperCase(),
        mesVencimento, competencia: mesVencimento, documentos: [], faltantes: [], pendingGuideIds: [], tiposGuias: {} });
    }
    return rows.get(id);
  }
  for (const g of guides) {
    if (!empresas.has(g.portalClientId)) continue;
    const doc = { guideId: g.id, portalClientId: g.portalClientId, razao: empresas.get(g.portalClientId).razao,
      tipo: g.tipo, competencia: g.competencia, vencimento: g.vencimento, valor: Number(g.valor || 0),
      parcelamentoId: g.parcelamentoId, numeroParcela: g.numeroParcela,
      acordo: g.parcelamento?.numeroParcelamento || g.parcelamento?.label,
      paga: g.paymentStatus === "PAID", enviada: enviada(g), emailStatus: g.emailStatus,
      falhou: g.emailStatus === "ERROR", erro: g.emailLastError };
    const mes = mesDaData(g.vencimento);
    if (!mes) { if (!doc.paga) conferirVencimento.push(doc); continue; }
    if (mes < mesVencimento) { if (!doc.paga) pendenciasAnteriores.push(doc); continue; }
    if (mes !== mesVencimento) continue;
    const row = rowFor(g.portalClientId);
    row.documentos.push(doc);
    if (!doc.paga && !doc.enviada && (g.emailStatus == null || ["PENDING", "ERROR"].includes(g.emailStatus))) row.pendingGuideIds.push(g.id);
  }
  for (const p of parcelas) {
    if (p.baixadaEm || p.guia?.paymentStatus === "PAID" || p.parcelamento?.formaPagamento === "DEBITO_AUTOMATICO") continue;
    const data = p.guia?.vencimento || p.vencimento;
    if (mesDaData(data) !== mesVencimento) continue;
    if (p.guia?.status === "PROCESSED") continue;
    const row = rowFor(p.portalClientId);
    if (row) row.faltantes.push({ parcelaId: p.id, numeroParcela: p.numeroParcela,
      acordo: p.parcelamento?.numeroParcelamento || p.parcelamento?.label,
      vencimento: data, motivo: p.parcelamento?.formaPagamento === "GUIA_MENSAL"
        ? "Guia da parcela ainda não disponível" : "Conferir forma de pagamento e guia da parcela" });
  }
  const result = { mesVencimento, competencia: mesVencimento, simples: [], presumidos: [], outros: [], pendenciasAnteriores, conferirVencimento };
  for (const row of rows.values()) {
    row.assinatura = assinaturaGuias(guides.filter((g) => row.pendingGuideIds.includes(g.id)));
    row.situacao = row.faltantes.length ? "incompleto" : row.pendingGuideIds.length ? "pendente" : "documentos_tratados";
    const grupo = row.regimeTributario === "SIMPLES" ? "simples" : ["LUCRO_PRESUMIDO", "LUCRO_REAL"].includes(row.regimeTributario) ? "presumidos" : "outros";
    result[grupo].push(row);
  }
  return result;
}
