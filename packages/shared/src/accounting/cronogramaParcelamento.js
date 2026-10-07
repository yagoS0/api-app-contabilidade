// Calendário explicitamente informado: entrada não é referência das parcelas regulares.
export function validarCronogramaParcelamento(raw, quantidade) {
  if (raw == null) return null;
  const erro = () => { throw Object.assign(new Error('Confira quantidade, valores e vencimentos do cronograma de entrada e parcelas.'), { code: 'CRONOGRAMA_INVALIDO' }); };
  if (!Array.isArray(raw) || !raw.length || raw.length > 600 || raw.length !== Number(quantidade)) erro();
  let anterior = '';
  let regular = false;
  return raw.map((p, i) => {
    if (!p || p.numeroParcela !== i + 1 || !['ENTRADA', 'PARCELA'].includes(p.tipo)) erro();
    if (regular && p.tipo === 'ENTRADA') erro();
    regular ||= p.tipo === 'PARCELA';
    const data = String(p.vencimento || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(data)) || new Date(data).toISOString().slice(0, 10) !== data || data < anterior) erro();
    if (p.competencia !== data.slice(0, 7) || !Number.isFinite(p.valorPrevisto) || p.valorPrevisto <= 0 || Math.abs(p.valorPrevisto * 100 - Math.round(p.valorPrevisto * 100)) > 0.00001) erro();
    anterior = data;
    return { numeroParcela: i + 1, tipo: p.tipo, competencia: p.competencia, vencimento: data, valorPrevisto: p.valorPrevisto };
  });
}

export function gerarCronogramaComEntrada({ numEntradas, valorEntrada, competenciaEntrada, diaEntrada, totalParcelas, valorParcela, competenciaRegular, diaRegular }) {
  if (!Number.isInteger(totalParcelas) || totalParcelas < 1 || totalParcelas > 600 || !Number.isInteger(numEntradas) || numEntradas < 1 || numEntradas >= totalParcelas) return [];
  const rows = [];
  for (let n = 1; n <= totalParcelas; n++) {
    const entrada = n <= numEntradas;
    const base = entrada ? competenciaEntrada : competenciaRegular;
    const [ano, mes] = String(base || '').split('-').map(Number);
    if (!ano || mes < 1 || mes > 12) return [];
    const d = new Date(Date.UTC(ano, mes - 1 + (entrada ? n - 1 : n - numEntradas - 1), 1));
    const dia = Math.min(entrada ? diaEntrada : diaRegular, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate());
    if (!Number.isInteger(dia) || dia < 1) return [];
    d.setUTCDate(dia);
    const vencimento = d.toISOString().slice(0, 10);
    rows.push({ numeroParcela: n, tipo: entrada ? 'ENTRADA' : 'PARCELA', competencia: vencimento.slice(0, 7), vencimento, valorPrevisto: entrada ? valorEntrada : valorParcela });
  }
  return rows;
}
