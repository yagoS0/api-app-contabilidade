import { createHash } from 'node:crypto';

export function mesFiscal(valor) {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor || '');
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:$|-\d{2}(?:T.*)?$)/.exec(texto);
  return match ? `${match[1]}-${match[2]}` : null;
}

// Somente fatos locais. Cálculo e simulação não são recibo de transmissão.
export async function situacaoDoPeriodo(db, { portalClientId, competencia }) {
  const mes = mesFiscal(competencia);
  if (!mes) throw new Error('Competência inválida para conferir o período.');
  const [circular, apuracao, legado] = await Promise.all([
    db.companyMonthlyCircular.findFirst({ where: { portalClientId, competencia: mes }, select: { estado: true, lockedAt: true } }),
    db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia: mes } },
      select: { estado: true, numeroDeclaracao: true, reciboNumero: true, transmitidoEm: true, fechadaEm: true,
        dasCalculadoLocal: true, dasSimuladoSerpro: true } }),
    db.apuracao.findUnique({ where: { portalClientId_competencia: { portalClientId, competencia: mes } },
      select: { estado: true, numeroDeclaracao: true, reciboNumero: true, transmitidoEm: true, dasValor: true } }),
  ]);
  const transmitida = Boolean(apuracao?.numeroDeclaracao || apuracao?.reciboNumero || legado?.numeroDeclaracao || legado?.reciboNumero);
  const calculada = legado?.dasValor != null || ['calculada', 'revisada'].includes(legado?.estado) || apuracao?.dasCalculadoLocal != null || apuracao?.dasSimuladoSerpro != null
    || ['calculada', 'revisada'].includes(apuracao?.estado) || ['calculado', 'revisado'].includes(circular?.estado);
  const fechada = ['transmitida', 'confirmada'].includes(legado?.estado) || Boolean(apuracao?.fechadaEm) || ['fechada', 'transmitida', 'confirmada'].includes(apuracao?.estado)
    || ['fechado', 'transmitido', 'confirmado'].includes(circular?.estado);
  const estado = transmitida ? 'TRANSMITIDA' : calculada ? 'APURADA' : fechada ? 'FECHADA' : 'ABERTA';
  const mensagens = {
    TRANSMITIDA: 'Esta competência tem declaração transmitida. Confira se a operação já está na receita declarada; se houver alteração, poderá ser necessária retificação. Considere o regime de caixa ou competência.',
    APURADA: 'Esta competência já tem apuração calculada ou simulada. Confira a operação e revise o cálculo antes de concluir. Cálculo salvo não comprova transmissão.',
    FECHADA: 'Esta competência está fechada. Confira a data da prestação e revise o fechamento com o contador. Fechamento não comprova transmissão.',
  };
  return { competencia: mes, estado, exigeRevisao: estado !== 'ABERTA', mensagem: mensagens[estado] || null,
    provaTransmissao: transmitida, referenciaEm: apuracao?.transmitidoEm || legado?.transmitidoEm || apuracao?.fechadaEm || circular?.lockedAt || null };
}

// Mesmo identificador para emissão própria e posterior captura. O índice único também
// protege processos concorrentes. Nunca reabrir pendência já resolvida ao recapturar.
export async function registrarPendenciaDoPeriodo(db, { portalClientId, competencia, chaveAcesso,
  notaId = null, serviceInvoiceId = null, papel = 'EMIT', evento = 'nota_retroativa', origem = 'CAPTURA', valor = null, situacao }) {
  if (!competencia) return null; // não inventar competência pela data da descoberta/emissão
  const periodo = situacao || await situacaoDoPeriodo(db, { portalClientId, competencia });
  if (!periodo.exigeRevisao) return null;
  const identidade = chaveAcesso || notaId || serviceInvoiceId;
  if (!identidade) throw new Error('Nota sem identidade para registrar pendência.');
  const chaveEvento = createHash('sha256').update(JSON.stringify([portalClientId, periodo.competencia, identidade, evento])).digest('hex');
  const mensagem = papel === 'EMIT' ? periodo.mensagem
    : 'Documento recebido em período fechado ou apurado. Confira despesas e retenções; não representa automaticamente receita nem retificação do PGDAS-D.';
  return db.pendenciaPosFechamento.upsert({ where: { chaveEvento },
    create: { chaveEvento, portalClientId, competencia: periodo.competencia, notaId, serviceInvoiceId,
      motivo: evento, origem, situacaoPeriodo: periodo.estado, valor: valor == null ? null : String(valor),
      observacoes: `${evento === 'nota_retroativa' ? 'Nota identificada' : 'Cancelamento/substituição identificado'}: ${identidade}. ${mensagem}` },
    update: { ...(notaId ? { notaId } : {}), ...(serviceInvoiceId ? { serviceInvoiceId } : {}) } });
}

// Outbox local: o sinal é gravado junto com o resultado autorizado. Falhar aqui nunca
// muda uma nota autorizada para falha_envio nem provoca outro POST fiscal.
export async function processarAvisoDaEmissao(db, invoice) {
  if (!invoice?.revisaoPeriodoPendente || !['issued', 'cancelled', 'cancelled_substitution'].includes(invoice.status)) return;
  const portal = await db.portalClient.findUnique({ where: { companyId: invoice.companyId }, select: { id: true } });
  if (!portal) throw new Error('Emissão sem vínculo cadastral para revisão do período.');
  await registrarPendenciaDoPeriodo(db, { portalClientId: portal.id, competencia: invoice.competencia,
    chaveAcesso: invoice.chaveAcesso, serviceInvoiceId: invoice.id, valor: invoice.valorServicos, origem: 'EMISSAO', evento: invoice.status === 'issued' ? 'nota_retroativa' : 'evento_retroativo' });
  await db.serviceInvoice.updateMany({ where: { id: invoice.id, status: invoice.status, updatedAt: invoice.updatedAt, revisaoPeriodoPendente: true },
    data: { revisaoPeriodoPendente: false } });
}

export async function recuperarAvisosDeEmissao(db, log) {
  const notas = await db.serviceInvoice.findMany({ where: { revisaoPeriodoPendente: true, status: { in: ['issued', 'cancelled', 'cancelled_substitution'] } }, orderBy: { updatedAt: 'asc' }, take: 100 });
  for (const nota of notas) {
    try { await processarAvisoDaEmissao(db, nota); }
    catch (error) { log?.error?.({ invoiceId: nota.id, erro: error.message }, 'Pendência fiscal aguarda nova tentativa local'); }
  }
}
