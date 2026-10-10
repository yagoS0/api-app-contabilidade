// PDF + linha digitável no mesmo envio, usando Payments BR (order_details).
// COPY_CODE de cupom não é usado: a guia de arrecadação tem 48 dígitos.
export function parametrosPagamentoGuia({ referencia, linhaDigitavel, valor, descricao }) {
  const codigo = String(linhaDigitavel || '').replace(/[ .-]/g, '');
  const centavos = Math.round(Number(valor) * 100);
  if (!/^8\d{47}$/.test(codigo) || !Number.isSafeInteger(centavos) || centavos <= 0
    || !referencia || String(referencia).length > 120 || !descricao) {
    throw Object.assign(new Error('Confira o código de barras, o valor e a identificação da guia antes do envio.'), { code: 'GUIA_PAGAMENTO_INVALIDA' });
  }
  const amount = { value: centavos, offset: 100 };
  return {
    reference_id: String(referencia), type: 'digital-goods', payment_type: 'br', currency: 'BRL',
    total_amount: amount,
    payment_settings: [{ type: 'boleto', boleto: { digitable_line: codigo } }],
    order: { status: 'pending', subtotal: amount,
      items: [{ retailer_id: String(referencia), name: String(descricao), amount, quantity: 1 }] },
  };
}
