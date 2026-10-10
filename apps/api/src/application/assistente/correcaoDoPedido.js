// Correções explícitas suspendem o código antigo antes de uma nova chamada ao modelo.
// Perguntas sobre o pedido não representam uma alteração confirmada de seus dados.
export function correcaoExplicita(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return !t.includes('?') && /^(na verdade\b|corrigindo\b|correcao\b|corrija\b|altere\b|troque\b|mude\b|o valor correto\b|o tomador correto\b)/.test(t);
}
