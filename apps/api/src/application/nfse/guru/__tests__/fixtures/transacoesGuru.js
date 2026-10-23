// Somente dados sintéticos; campos conforme Transaction do OpenAPI Guru v2.
export const periodo = { campo: 'confirmed_at', inicio: '2026-10-01', fim: '2026-10-22' };
export function transacao(id = 'venda-sintetica', overrides = {}) {
  return { id, status: 'approved', dates: { confirmed_at: 1790899200, updated_at: 1790899200, ordered_at: 1790899200 },
    payment: { total: 1200, currency: 'BRL', gross: 1200, net: 1150, installments: { qty: 12, value: 100, interest: 0 } },
    product: { id: 'marketplace-nao-interno', internal_id: 'produto-interno-sintetico', name: 'SaaS anual sintético', offer: { id: 'oferta-sintetica' } },
    invoice: { id: 'fatura-sintetica', cycle: 1, period_start: '2026-10-01', period_end: '2027-09-30', value: 1200, status: 'paid' },
    subscription: { id: 'assinatura-marketplace', internal_id: 'assinatura-interna' }, ...overrides };
}
export const pagina = (data = [transacao()], extra = {}) => ({ data, hasMore: false, nextCursor: null, total: data.length, ...extra });
