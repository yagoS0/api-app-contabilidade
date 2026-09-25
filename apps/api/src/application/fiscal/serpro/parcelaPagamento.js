const digits = v => String(v ?? "").replace(/\D/g, "");
function cents(v) {
  if (typeof v === "number") {
    const escalado = v * 100, valor = Math.round(escalado);
    if (v !== 0 && valor === 0) return null;
    const toleranciaBinaria = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(escalado)) * 4);
    return Number.isFinite(v) && Number.isSafeInteger(valor) && Math.abs(escalado - valor) <= toleranciaBinaria ? valor : null;
  }
  if (typeof v !== "string") return null;
  // Decimal explícito, sem coerção de boolean/objeto, expoentes, separadores ou espaços.
  // Texto é convertido exatamente antes do limite para não arredondar valores longos.
  const partes = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v);
  if (!partes || partes[0] !== v || /[1-9]/.test((partes[3] || "").slice(2))) return null;
  const valor = (BigInt(partes[2]) * 100n + BigInt((partes[3] || "").padEnd(2, "0").slice(0, 2))) * (partes[1] ? -1n : 1n);
  if (valor > BigInt(Number.MAX_SAFE_INTEGER) || valor < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(valor);
}
function identidadeCnpj(v) {
  if (typeof v !== "string") return null;
  const valido = v.length === 14 && !/\D/.test(v)
    || v.length === 18 && /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(v);
  return valido && !/^0+$/.test(digits(v)) ? digits(v) : null;
}
function identidadeContrato(v) {
  // O serviço recebe inteiro e pode devolver texto preenchido com zeros. Comparar
  // dígitos canônicos evita falso conflito sem arredondar contratos longos com Number.
  if (typeof v === "number" && (!Number.isSafeInteger(v) || v <= 0)) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const texto = String(v);
  if (!texto || /\D/.test(texto)) return null;
  return texto.replace(/^0+/, "") || null;
}
function dataPagamento(v) {
  const s = digits(v);
  if (s.length !== 8) return null;
  const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? dt : null;
}
const erro = code => Object.assign(new Error("Não foi possível conferir o retorno de pagamento da parcela."), { code });

/** Só evidência correlacionada e valores consistentes autorizam confirmação fiscal. */
export function interpretarPagamentoParcela(raw, { contribuinteCnpj, numeroParcelamento, anoMesParcela, numeroParcela, numeroDocumento, valorMinimo, principalEsperado } = {}) {
  let envelope, d;
  try { envelope = typeof raw === "string" ? JSON.parse(raw) : raw; d = typeof envelope?.dados === "string" ? JSON.parse(envelope.dados) : envelope?.dados; }
  catch { throw erro("PARCELA_PAGAMENTO_RETORNO_INVALIDO"); }
  if (Number(envelope?.status) !== 200 || !d || typeof d !== "object" || Array.isArray(d)) throw erro("PARCELA_PAGAMENTO_RETORNO_INVALIDO");
  const divergencia = motivo => ({ status: "DIVERGENTE", motivo, raw,
    valorPago: cents(d.valorPagoArrecadacao) == null ? null : cents(d.valorPagoArrecadacao) / 100 });
  if (contribuinteCnpj !== undefined) {
    const esperado = identidadeCnpj(contribuinteCnpj);
    if (!esperado) return divergencia("CNPJ_ESPERADO_INVALIDO");
    if (envelope.contribuinte?.numero == null) return divergencia("CNPJ_AUSENTE");
    if (![2, "2"].includes(envelope.contribuinte.tipo) || identidadeCnpj(envelope.contribuinte.numero) !== esperado
      || (Object.hasOwn(d, "cnpj") && identidadeCnpj(d.cnpj) !== esperado)
      || (Object.hasOwn(d, "cnpjContribuinte") && identidadeCnpj(d.cnpjContribuinte) !== esperado)
      || (d.contribuinte != null && (![2, "2"].includes(d.contribuinte.tipo) || identidadeCnpj(d.contribuinte.numero) !== esperado))) {
      return divergencia("CNPJ_DIVERGENTE");
    }
  }
  const contratoEsperado = identidadeContrato(numeroParcelamento);
  const contratoRetornado = identidadeContrato(d.numeroParcelamento);
  if (!contratoEsperado || !contratoRetornado || contratoRetornado !== contratoEsperado
    || digits(d.paDasGerado ?? d.anoMesParcela) !== digits(anoMesParcela)) {
    return divergencia("IDENTIFICACAO_DIVERGENTE");
  }
  if (numeroParcela != null && d.numeroParcela != null && Number(d.numeroParcela) !== Number(numeroParcela)) return divergencia("PARCELA_DIVERGENTE");
  if (numeroDocumento && d.numeroDas && digits(numeroDocumento) !== digits(d.numeroDas)) return divergencia("DOCUMENTO_DIVERGENTE");
  const total = cents(d.valorPagoArrecadacao);
  const principalMinimo = cents(principalEsperado), totalMinimo = cents(valorMinimo);
  if ((principalEsperado != null && (principalMinimo == null || principalMinimo < 0))
    || (valorMinimo != null && (totalMinimo == null || totalMinimo < 0))) return divergencia("VALOR_ESPERADO_INVALIDO");
  if (!Object.hasOwn(d, "valorPagoArrecadacao") || !Object.hasOwn(d, "dataPagamento")) {
    return { status: "INDETERMINADO", motivo: "CAMPOS_PAGAMENTO_AUSENTES", raw };
  }
  // Somente ausência explícita e correlacionada. Campos faltantes, valores inválidos ou
  // composição contraditória não representam resposta negativa de pagamento.
  if ((d.valorPagoArrecadacao == null || total === 0) && d.dataPagamento == null
    && (!d.pagamentoDebitos || (Array.isArray(d.pagamentoDebitos) && d.pagamentoDebitos.length === 0))) {
    return { status: "NAO_LOCALIZADO", raw };
  }
  const pagoEm = dataPagamento(d.dataPagamento);
  if (!pagoEm || total == null || total <= 0) return divergencia("PAGAMENTO_INCOMPLETO");
  const saldos = [d.saldoDevedor, d.saldoRemanescente].filter(v => v != null).map(cents);
  if (saldos.some(v => v == null || v < 0)) return divergencia("SALDO_INVALIDO");
  if (d.pagamentoParcial === true || saldos.some(v => v > 0)) return divergencia("PAGAMENTO_PARCIAL");
  const linhas = (Array.isArray(d.pagamentoDebitos) ? d.pagamentoDebitos : []).flatMap(p => Array.isArray(p?.discriminacoesDebito) ? p.discriminacoesDebito : []);
  let principal = 0, multa = 0, juros = 0, soma = 0;
  if (!linhas.length) return divergencia("COMPOSICAO_AUSENTE");
  for (const l of linhas) {
    const vs = [l?.principal, l?.multa, l?.juros, l?.total].map(cents);
    const totalLinha = vs[0] + vs[1] + vs[2];
    if (vs.some(v => v == null || v < 0) || !Number.isSafeInteger(totalLinha)
      || Math.abs(totalLinha - vs[3]) > 1) return divergencia("COMPOSICAO_DIVERGENTE");
    principal += vs[0]; multa += vs[1]; juros += vs[2]; soma += vs[3];
    if (![principal, multa, juros, soma].every(Number.isSafeInteger)) return divergencia("COMPOSICAO_DIVERGENTE");
  }
  if (Math.abs(soma - total) > 1) return divergencia("TOTAL_DIVERGENTE");
  if (principalMinimo != null && principal < principalMinimo - 1) return divergencia("PAGAMENTO_PARCIAL");
  if (totalMinimo != null && total < totalMinimo - 1) return divergencia("PAGAMENTO_INFERIOR_AO_PREVISTO");
  return { status: "CONFIRMADO", pagoEm, valorPago: total / 100, numeroDocumento: d.numeroDas ?? null, raw,
    comprovante: { dataArrecadacao: pagoEm.toISOString().slice(0, 10), principal: principal / 100, multa: multa / 100,
      juros: juros / 100, total: total / 100, confiavel: true, meioPagamento: "SERPRO_INTEGRA_PARCELAMENTO" } };
}
