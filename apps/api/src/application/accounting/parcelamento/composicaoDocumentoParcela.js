import { normalizeParcelaDTO, round2Decimal as round2 } from "./contracts.js";

/** Mesma leitura para baixa e conciliação: composição integral precisa fechar com o PDF. */
export function lerComposicaoDoDocumento(guide) {
  const source = guide?.extracted;
  const bruta = Array.isArray(source?.composicao) ? source.composicao
    : Array.isArray(source?.fields?.composicao) ? source.fields.composicao : [];
  const comCodigo = bruta.filter(c => String(c?.codigoTributo || c?.codigo || "").trim());
  if (!comCodigo.length) return null;
  const { tributos, valorTotal } = normalizeParcelaDTO({ tributos: comCodigo });
  if (!tributos.length || round2(valorTotal) <= 0) return null;
  const valorGuia = guide?.valor == null ? null : round2(Number(guide.valor));
  if (valorGuia != null && Math.abs(round2(valorTotal) - valorGuia) > 0.01) return { recusa: "composicao_nao_confere" };
  if (tributos.some(t => [t.principal, t.juros, t.multa, t.total].some(v => !Number.isFinite(v) || v < 0)
    || Math.abs(round2(t.principal + t.juros + t.multa) - t.total) > 0.01)) return { recusa: "composicao_nao_confere" };
  return { tributos, valorTotal: round2(valorTotal) };
}
