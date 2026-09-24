const digits = v => String(v ?? "").replace(/\D/g, "");
const cents = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100);
function dataPagamento(v) {
  const s = digits(v);
  if (s.length !== 8) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? dt : null;
}
const erro = code => Object.assign(new Error("Não foi possível conferir o retorno de pagamento da parcela."), { code });

/** Só evidência correlacionada e valores consistentes autorizam confirmação fiscal. */
export function interpretarPagamentoParcela(raw, { numeroParcelamento, anoMesParcela, numeroParcela, numeroDocumento, valorMinimo, principalEsperado } = {}) {
  let envelope, d;
  try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; d = typeof envelope?.dados === "string" ? JSON.parse(envelope.dados) : envelope?.dados; }
  catch { throw erro("PARCELA_PAGAMENTO_RETORNO_INVALIDO"); }
  if (Number(envelope?.status) !== 200 || !d || typeof d !== "object" || Array.isArray(d)) throw erro("PARCELA_PAGAMENTO_RETORNO_INVALIDO");
  const divergencia = motivo => ({ status: "DIVERGENTE", motivo, raw,
    valorPago: cents(d.valorPagoArrecadacao) == null ? null : cents(d.valorPagoArrecadacao) / 100 });
  if (digits(d.numeroParcelamento) !== digits(numeroParcelamento) || digits(d.paDasGerado ?? d.anoMesParcela) !== digits(anoMesParcela)) {
    return divergencia("IDENTIFICACAO_DIVERGENTE");
  }
  if (numeroParcela != null && d.numeroParcela != null && Number(d.numeroParcela) !== Number(numeroParcela)) return divergencia("PARCELA_DIVERGENTE");
  if (numeroDocumento && d.numeroDas && digits(numeroDocumento) !== digits(d.numeroDas)) return divergencia("DOCUMENTO_DIVERGENTE");
  const total = cents(d.valorPagoArrecadacao);
  if ((total == null || total === 0) && !d.dataPagamento) return { status: "NAO_LOCALIZADO", raw };
  const pagoEm = dataPagamento(d.dataPagamento);
  if (!pagoEm || total == null || total <= 0) return divergencia("PAGAMENTO_INCOMPLETO");
  if (d.pagamentoParcial === true || Number(d.saldoDevedor || d.saldoRemanescente || 0) > 0) return divergencia("PAGAMENTO_PARCIAL");
  const linhas = (Array.isArray(d.pagamentoDebitos) ? d.pagamentoDebitos : []).flatMap(p => Array.isArray(p.discriminacoesDebito) ? p.discriminacoesDebito : []);
  let principal = 0, multa = 0, juros = 0, soma = 0;
  if (!linhas.length) return divergencia("COMPOSICAO_AUSENTE");
  for (const l of linhas) {
    const vs = [l.principal, l.multa, l.juros, l.total].map(cents);
    if (vs.some(v => v == null || v < 0) || Math.abs(vs[0] + vs[1] + vs[2] - vs[3]) > 1) return divergencia("COMPOSICAO_DIVERGENTE");
    principal += vs[0]; multa += vs[1]; juros += vs[2]; soma += vs[3];
  }
  if (Math.abs(soma - total) > 1) return divergencia("TOTAL_DIVERGENTE");
  if (cents(principalEsperado) != null && principal < cents(principalEsperado) - 1) return divergencia("PAGAMENTO_PARCIAL");
  if (cents(valorMinimo) != null && total < cents(valorMinimo) - 1) return divergencia("PAGAMENTO_INFERIOR_AO_PREVISTO");
  return { status: "CONFIRMADO", pagoEm, valorPago: total / 100, numeroDocumento: d.numeroDas ?? null, raw,
    comprovante: { dataArrecadacao: pagoEm.toISOString().slice(0, 10), principal: principal / 100, multa: multa / 100,
      juros: juros / 100, total: total / 100, confiavel: true, meioPagamento: "SERPRO_INTEGRA_PARCELAMENTO" } };
}
