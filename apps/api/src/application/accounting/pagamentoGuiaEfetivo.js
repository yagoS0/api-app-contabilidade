// Leitura derivada: cobrança, comprovante e baixa são fatos distintos.
// Nunca grava Guide.valor nem transforma estorno contábil em devolução financeira.
const cents = (v) => v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) < 0
  ? null : Math.round(Number(v) * 100);
const money = (v) => v == null ? null : v / 100;
const date = (v) => {
  if (!v) return null;
  if (typeof v === "string") {
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (!br && !iso) return null;
    const [y, m, d] = br ? [+br[3], +br[2], +br[1]] : [+iso[1], +iso[2], +iso[3]];
    const civil = new Date(Date.UTC(y, m - 1, d));
    if (civil.getUTCFullYear() !== y || civil.getUTCMonth() !== m - 1 || civil.getUTCDate() !== d) return null;
    if (br) return civil.toISOString();
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export function baixasVigentes(entries = []) {
  const unicas = [...new Map(entries.filter(e => e?.id).map(e => [e.id, e])).values()];
  const estornadas = new Set(unicas.filter(e => e.tipo === "ESTORNO").map(e => e.estornoDeEntryId));
  return unicas.filter(e => e.tipo === "BAIXA" && !estornadas.has(e.id));
}

export function resumirBaixas(entries = []) {
  const baixas = baixasVigentes(entries);
  const porDia = new Map();
  let total = 0, principal = 0, juros = 0, multa = 0, conhecida = true, invalida = false;
  for (const e of baixas) {
    const debitos = (e.lines || []).filter(l => l.tipo === "D");
    if (!debitos.length) continue; // contrapartida isolada de lote não repete a saída
    const valores = debitos.map(l => cents(l.valor));
    if (valores.some(v => v == null)) { invalida = true; continue; }
    const valor = valores.reduce((a, b) => a + b, 0);
    total += valor;
    if (e.tipoLinha === "PRINCIPAL" || e.tipoLinha === "PARC") principal += valor;
    else if (e.tipoLinha === "JUROS") juros += valor;
    else if (e.tipoLinha === "MULTA") multa += valor;
    else conhecida = false; // TOTAL/legado não prova o rateio
    const data = date(e.data);
    const chave = data?.slice(0, 10) || "sem-data";
    const atual = porDia.get(chave) || { data, total: 0, entryIds: [] };
    atual.total += valor;
    atual.entryIds.push(e.id);
    porDia.set(chave, atual);
  }
  if (!baixas.length) return null;
  if (invalida || total <= 0) return { fonte: "BAIXA_CONTABIL", total: null, principal: null, juros: null, multa: null,
    composicaoConhecida: false, data: null, pagamentos: [], entryIds: baixas.map(e => e.id),
    estadoContabil: null, pendencia: "BAIXA_SEM_VALOR_CONFIAVEL" };
  const pagamentos = [...porDia.values()].map(p => ({ ...p, total: money(p.total) }));
  return {
    fonte: "BAIXA_CONTABIL", total: money(total), composicaoConhecida: conhecida,
    principal: conhecida ? money(principal) : null,
    juros: conhecida ? money(juros) : null, multa: conhecida ? money(multa) : null,
    data: pagamentos.length === 1 ? pagamentos[0].data : null,
    pagamentos, entryIds: baixas.map(e => e.id),
    estadoContabil: baixas.some(e => e.status === "RASCUNHO") ? "RASCUNHO"
      : baixas.every(e => e.status === "EXPORTADO") ? "EXPORTADO" : "CONFIRMADO",
  };
}

export function pagamentoDoComprovante(guia) {
  const c = guia?.extracted?.comprovante;
  const total = cents(c?.total);
  if (total == null || total <= 0) return null;
  const partes = [c.principal, c.juros, c.multa].map(cents);
  const conhecida = partes.every(v => v != null) && Math.abs(partes.reduce((a, b) => a + b, 0) - total) <= 1;
  const data = date(c.dataArrecadacao);
  return {
    fonte: "COMPROVANTE", total: money(total), composicaoConhecida: conhecida,
    principal: conhecida ? money(partes[0]) : null, juros: conhecida ? money(partes[1]) : null,
    multa: conhecida ? money(partes[2]) : null, data, estadoContabil: null,
    pagamentos: [{ data, total: money(total), entryIds: [] }], entryIds: [],
  };
}

export function resolverPagamentoGuia({ guia, baixas = [], portalClientId } = {}) {
  // Aceita apenas vínculos dessa guia/empresa, inclusive baixa genérica ligada à provisão.
  const vinculadas = baixas.filter(e => (!portalClientId || e.portalClientId === portalClientId)
    && (e.sourceGuideId === guia?.id || e.openEntry?.sourceGuideId === guia?.id));
  const contabil = resumirBaixas(vinculadas);
  const comprovante = pagamentoDoComprovante(guia);
  const resultado = contabil || comprovante;
  if (!resultado) return null;
  const divergencias = {
    valorGuia: resultado.total != null && cents(guia?.valor) != null && Math.abs(cents(guia.valor) - cents(resultado.total)) > 1,
    valorComprovante: Boolean(contabil?.total != null && comprovante && Math.abs(cents(contabil.total) - cents(comprovante.total)) > 1),
    dataComprovante: Boolean(contabil?.data && comprovante?.data && contabil.data.slice(0, 10) !== comprovante.data.slice(0, 10)),
  };
  return { ...resultado, valorDocumento: money(cents(guia?.valor)), divergencias,
    divergencia: divergencias.valorComprovante || divergencias.dataComprovante };
}

export async function carregarBaixasDasGuias(client, portalClientId, guideIds) {
  if (!guideIds.length) return [];
  return client.accountingEntry.findMany({
    where: { portalClientId, tipo: { in: ["BAIXA", "ESTORNO"] }, OR: [
      { sourceGuideId: { in: guideIds } }, { openEntry: { sourceGuideId: { in: guideIds } } },
    ] },
    include: { lines: { orderBy: { ordem: "asc" } }, openEntry: { select: {
      id: true, sourceGuideId: true, statusPagamento: true, lines: true,
      baixas: { include: { lines: true } },
    } } },
  });
}
