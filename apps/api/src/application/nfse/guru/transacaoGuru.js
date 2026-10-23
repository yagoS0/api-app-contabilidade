import { camposGuru, erroGuru, textoGuru } from './cobrancaManual.js';

export function periodoGuru(body) {
  camposGuru(body, ['campo', 'inicio', 'fim']);
  if (!['confirmed_at', 'ordered_at', 'cancelled_at'].includes(body.campo)) throw erroGuru('guru_periodo_invalido');
  for (const v of [body.inicio, body.fim]) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)
      || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw erroGuru('guru_periodo_invalido');
  }
  const dias = (Date.parse(body.fim) - Date.parse(body.inicio)) / 86400000;
  if (dias < 0 || dias >= 180) throw erroGuru('guru_periodo_invalido');
  return { campo: body.campo, inicio: body.inicio, fim: body.fim };
}

const texto = v => v == null || v === '' ? null : textoGuru(v, 300);
function numero(v) {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e12) throw erroGuru('guru_transacao_invalida', 502);
  return v;
}
function instante(v) {
  if (v == null) return null;
  if (!Number.isSafeInteger(v) || v < 0 || v > 253402300799) throw erroGuru('guru_transacao_invalida', 502);
  return v;
}

// Allowlist do contrato oficial Transaction. Não armazena comprador, cartão,
// credenciais, links nem payload bruto. Valores são financeiros, sem base fiscal.
export function normalizarTransacaoGuru(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw erroGuru('guru_transacao_invalida', 502);
  const p = raw.payment || {}, produto = raw.product || {}, f = raw.invoice || {}, s = raw.subscription || {};
  const moeda = texto(p.currency);
  if (moeda !== null && !/^[A-Z]{3}$/.test(moeda)) throw erroGuru('guru_transacao_invalida', 502);
  const parcelas = numero(p.installments?.qty), ciclo = numero(f.cycle);
  if ((parcelas !== null && (!Number.isInteger(parcelas) || parcelas < 1))
    || (ciclo !== null && (!Number.isInteger(ciclo) || ciclo < 0))) throw erroGuru('guru_transacao_invalida', 502);
  return {
    transacaoId: textoGuru(raw.id), statusOriginal: textoGuru(raw.status),
    datas: { confirmed_at: instante(raw.dates?.confirmed_at), updated_at: instante(raw.dates?.updated_at),
      ordered_at: instante(raw.dates?.ordered_at), cancelled_at: instante(raw.dates?.canceled_at) },
    financeiro: { total: numero(p.total), moeda, bruto: numero(p.gross), liquido: numero(p.net),
      parcelas: { quantidade: parcelas, valor: numero(p.installments?.value), juros: numero(p.installments?.interest) } },
    produto: { idInterno: texto(produto.internal_id), nome: texto(produto.name), ofertaId: texto(produto.offer?.id) },
    fatura: { id: texto(f.id), ciclo, inicio: texto(f.period_start), fim: texto(f.period_end), valor: numero(f.value), statusOriginal: texto(f.status) },
    assinatura: { idInterno: texto(s.internal_id), id: texto(s.id) },
  };
}
