// Parsing de apresentação, não validação fiscal. Ausência nunca vira zero.
export function valorFolhaInformado(valor) {
  if (valor == null || (typeof valor !== 'number' && typeof valor !== 'string')) return null;
  const texto = String(valor).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return null;
  const [inteiro, fracao = ''] = texto.replace(',', '.').split('.');
  const centavos = BigInt(inteiro) * 100n + BigInt(fracao.padEnd(2, '0'));
  return centavos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(centavos) : null;
}

// Dividir um Number grande por 100 pode arredondar um centavo na apresentação.
export function formatarCentavosFs12(valor) {
  if (!Number.isSafeInteger(valor) || valor < 0) return null;
  const centavos = BigInt(valor);
  return `R$\u00a0${(centavos / 100n).toLocaleString('pt-BR')},${String(centavos % 100n).padStart(2, '0')}`;
}

export function referenciasFolha(serie, competencia) {
  const itens = Array.isArray(serie) ? serie.filter(f => f?.pa === competencia) : [];
  if (itens.length > 1) return { situacao: 'DUPLICADA', valor: null };
  if (!itens.length) return { situacao: 'AUSENTE', valor: null };
  const valor = valorFolhaInformado(itens[0].valor);
  return { situacao: valor === null ? 'INVALIDA' : 'NAO_CONFERIDA', valor };
}

export function respostaFs12Valida(out, portalClientId, competencia) {
  const f = out?.fs12;
  const meses = f?.politica?.janela?.competencias;
  return out?.ok === true && f?.portalClientId === portalClientId && f?.competencia === competencia
    && typeof f?.politica?.empresaId === 'string' && f.politica.competenciaApuracao === competencia
    && f.autorizaEfeitoFiscal === false && f?.integracao?.permiteNovoCalculo === false
    && f.qualidade?.totalCentavos === null
    && (f.politica.janela === null || (Array.isArray(meses) && meses.length > 0 && meses.length <= 12
      && meses.every(m => typeof m === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m))
      && new Set(meses).size === meses.length));
}

export function serieDoRascunhoFs12(meses, rascunho) {
  const serie = meses.map(mes => ({ mes, valorCentavos: valorFolhaInformado(rascunho[mes]) }));
  const informados = serie.filter(m => m.valorCentavos !== null).length;
  const soma = serie.reduce((total, m) => total + (m.valorCentavos ?? 0), 0);
  const completa = meses.length > 0 && informados === meses.length && Number.isSafeInteger(soma);
  return { serie, informados, completa, totalCentavos: completa ? soma : null };
}
export function confirmacaoFs12Valida(r, portalClientId, competencia) {
  return r && r.portalClientId === portalClientId && r.competencia === competencia
    && typeof r.id === 'string' && typeof r.companyId === 'string'
    && Number.isSafeInteger(r.revisao) && r.revisao > 0
    && typeof r.autorId === 'string' && typeof r.confirmadoEm === 'string'
    && Number.isFinite(Date.parse(r.confirmadoEm)) && r.origem === 'MANUAL_APURACAO'
    && Array.isArray(r.serie) && r.serie.length > 0 && r.serie.length <= 12
    && new Set(r.serie.map(m => m.mes)).size === r.serie.length
    && r.serie.every(m => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(m.mes)
      && Number.isSafeInteger(m.valorCentavos) && m.valorCentavos >= 0)
    && Number.isSafeInteger(r.totalCentavos)
    && r.totalCentavos === r.serie.reduce((s, m) => s + m.valorCentavos, 0);
}
export function rascunhoDaConfirmacaoFs12(r) {
  // Preserve inclusive o último centavo no limite inteiro seguro.
  return Object.fromEntries(r.serie.map(m => [m.mes,
    `${BigInt(m.valorCentavos) / 100n},${String(BigInt(m.valorCentavos) % 100n).padStart(2, '0')}`]));
}
