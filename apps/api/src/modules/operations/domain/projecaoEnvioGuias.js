// Interpreta evidências existentes para a projeção operacional; não registra entrega.
export function projetarCanalEnvio({ guide, target, persisted, envios, documentRevision, reason, channel }) {
  const previous = persisted.attempts.filter(a => a.guideId === guide.id && a.channel === target.channel);
  const ledger = envios.filter(e => e.guideId === guide.id && (e.canal === target.channel || e.canal === 'EXTERNO'));
  const matching = ledger.find(e => e.destino === target.destination || e.destino == null || e.canal === 'EXTERNO');
  let state = 'PENDING', message = reason;
  if (previous.some(a => a.documentRevision !== documentRevision)) message = 'O documento mudou após uma tentativa. Confira o histórico antes de reenviar.';
  else if (previous.length) {
    const exact = previous.find(a => a.destination === target.destination && a.documentRevision === documentRevision);
    state = exact?.status || 'REVIEW'; message = exact?.message || (state === 'SENT' ? null : 'Confira a tentativa anterior; não haverá repetição automática.');
    // The cycle preserves provider acceptance history; current delivery truth comes from its ledger.
    if (state === 'SENT' && matching?.canal === target.channel && ['falhou', 'indeterminado', 'enviando'].includes(matching.status)) {
      state = matching.status === 'indeterminado' ? 'UNCERTAIN' : matching.status === 'enviando' ? 'STARTED' : 'REVIEW';
      message = matching.erroMensagemUsuario || 'O provedor não confirmou a entrega. Confira a tentativa antes de repetir.';
    }
  } else if (ledger.length || target.channel === 'EMAIL' && ['SENT', 'ERROR', 'SENDING'].includes(guide.emailStatus)) {
    state = 'REVIEW';
    message = 'Histórico de envio preservado. Confira o destinatário e a revisão do documento; não haverá repetição automática.';
  }
  if (target.channel === 'WHATSAPP' && !channel.disponivel) message = channel.mensagem || 'Canal WhatsApp indisponível.';
  if (message && state === 'PENDING') state = 'REVIEW';
  const entry = { channel: target.channel, destinationLabel: target.destination, state, reason: message, attemptId: previous.find(a => a.destination === target.destination)?.id || null };
  return entry;
}

export function estadoOperacionalGuia(reason, channels) {
  return reason || channels.some(c => ['REVIEW', 'UNCERTAIN'].includes(c.state)) ? 'REVIEW' : channels.some(c => c.state === 'STARTED') ? 'STARTED' : channels.every(c => c.state === 'SENT') && channels.length ? 'SENT' : 'PENDING';
}

export function selecionarGuiasNaJanela(snapshot) {
  const eligibleKinds = ['COMPLETE', 'PARTIAL_DEADLINE', 'PARTIAL_DUE', 'COMPLEMENT'];
  return eligibleKinds.includes(snapshot.dto.decision.kind) ? snapshot.eligible.filter(e => snapshot.dto.expectation.state === 'KNOWN' && !snapshot.dto.expectation.missing.length || snapshot.dto.decision.eligibleAt >= snapshot.dto.cutoffDate || e.calendar.advanceDate && e.calendar.advanceDate <= snapshot.dto.decision.eligibleAt) : [];
}
