// CNPJ alfanumérico: manual de cálculo do DV da Receita Federal, snapshot 05/10/2026.
// Remove somente a máscara; nunca descarta letras ou caracteres inválidos silenciosamente.
export function normalizarDocumento(valor) {
  return String(valor ?? '').trim().replace(/[.\-/\s]/g, '').replace(/[a-z]/g, c => c.toUpperCase());
}

export function cnpjTemFormato(valor) {
  return /^[A-Z0-9]{12}[0-9]{2}$/.test(normalizarDocumento(valor));
}

export function cnpjTemDvValido(valor) {
  const doc = normalizarDocumento(valor);
  if (!cnpjTemFormato(doc) || /^(\d)\1{13}$/.test(doc)) return false;
  const dv = base => {
    let soma = 0, peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? '0' : String(11 - resto);
  };
  const base = doc.slice(0, 12);
  const primeiro = dv(base);
  return doc === base + primeiro + dv(base + primeiro);
}

// Cadastros numéricos existentes mantêm a validação anterior de formato.
// Para o formato novo, verifica também o DV antes de aceitá-lo.
export function cnpjCompativel(valor) {
  const doc = normalizarDocumento(valor);
  return cnpjTemFormato(doc) && (/^\d{14}$/.test(doc) || cnpjTemDvValido(doc));
}

export function documentoTemFormato(valor) {
  const doc = normalizarDocumento(valor);
  return /^\d{11}$/.test(doc) || cnpjCompativel(doc);
}

export function formatarDocumento(valor) {
  const doc = normalizarDocumento(valor);
  if (/^\d{11}$/.test(doc)) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (cnpjTemFormato(doc)) return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`;
  return String(valor ?? '');
}
