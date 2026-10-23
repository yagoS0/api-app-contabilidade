import { createHash } from 'node:crypto';

export function erroGuru(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

export function textoGuru(value, max = 191) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw erroGuru('guru_campo_invalido');
  }
  return value.trim();
}

export function camposGuru(body, permitidos) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !permitidos.includes(key))) throw erroGuru('guru_campos_invalidos');
}

// Contrato INTERNO de digitação conferida. Não é o payload da API/webhook Guru.
// Não receber payload bruto (pode conter api_token e dados pessoais desnecessários).
export function normalizarCobrancaManual(body) {
  camposGuru(body, ['transacaoId', 'referenciaOrigem', 'valorCentavos', 'moeda', 'situacaoPagamento']);
  const transacaoId = textoGuru(body.transacaoId);
  const referenciaOrigem = textoGuru(body.referenciaOrigem, 500);
  if (!Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0) throw erroGuru('guru_valor_invalido');
  if (typeof body.moeda !== 'string' || !/^[A-Z]{3}$/.test(body.moeda)) throw erroGuru('guru_moeda_invalida');
  if (!['DESCONHECIDO', 'PENDENTE', 'INFORMADO_PAGO', 'INFORMADO_ESTORNADO'].includes(body.situacaoPagamento)) {
    throw erroGuru('guru_pagamento_invalido');
  }
  return { transacaoId, referenciaOrigem, valorCentavos: body.valorCentavos, moeda: body.moeda,
    situacaoPagamento: body.situacaoPagamento };
}

export const hashGuru = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
