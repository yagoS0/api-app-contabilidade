// Valores de entrada são convertidos sem multiplicação de ponto flutuante.
export function valorParaCentavos(valor) {
  const texto = String(valor ?? '').trim();
  if (texto.includes(',') && !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(texto)) return null;
  const normalizado = texto.includes(',') ? texto.replace(/\.(?=\d{3}(?:\.|,))/g, '').replace(',', '.') : texto;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizado)) return null;
  const [inteiro, decimal = ''] = normalizado.split('.');
  const centavos = (BigInt(inteiro) * 100n + BigInt(decimal.padEnd(2, '0'))).toString();
  return centavos.length <= 18 ? centavos : null;
}
export function moedaCentavos(valor) {
  if (valor == null || !/^-?\d+$/.test(String(valor))) return 'Não informado';
  const centavos = BigInt(valor), absoluto = centavos < 0n ? -centavos : centavos;
  return `${centavos < 0n ? '-' : ''}R$ ${(absoluto / 100n).toLocaleString('pt-BR')},${String(absoluto % 100n).padStart(2, '0')}`;
}
export const evidenciaValida = e => Boolean(e?.referencia?.trim() && e?.descricao?.trim() && /^[a-f\d]{64}$/i.test(e?.sha256 || ''));
export const evidenciaVazia = () => ({ referencia: '', sha256: '', descricao: '' });
