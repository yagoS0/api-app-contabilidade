// Parsing de apresentação, não validação fiscal. Ausência nunca vira zero.
export function valorFolhaInformado(valor) {
  if (valor == null || (typeof valor !== 'number' && typeof valor !== 'string')) return null;
  const texto = String(valor).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return null;
  const [inteiro, fracao = ''] = texto.replace(',', '.').split('.');
  const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
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
