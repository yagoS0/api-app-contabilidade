import { fail, hash, stateBase, validInput, warning } from '../domain/registroCicloEnvioGuias.js';
import { projetarCanalEnvio, estadoOperacionalGuia } from '../domain/projecaoEnvioGuias.js';

const labels = { das: 'DAS', inss: 'INSS', parcDas: 'Parcelamento' };

// As operações preservam consultas sequenciais e condicionais. A leitura também
// é reutilizada nas revalidações do executor legado, sem efeitos de escrita.
export function criarLeituraCicloEnvioGuias({
  lerEmpresa, lerCadastro, lerConfiguracao, lerAgenda, lerAutomacao, lerHistoricoRegime,
  listarFeriados, lerRegistroInss, lerInssManual, listarGuias, listarEnvios, lerRegistroCiclo,
  compliance, contatos, canal, conferirParcelas, documentoValido, bloqueioEnvioParcela,
  calendarioEnvioGuias, decidirEnvioGuias, mesOperacionalDaCompetencia, revisaoDocumentoEnvio, now,
}) {
  async function load(portalClientId, competencia) {
    validInput(portalClientId, competencia);
    const portal = await lerEmpresa(portalClientId);
    if (!portal || portal.status !== 'ATIVA') throw fail('ENVIO_GUIAS_EMPRESA_INDISPONIVEL', 'A empresa não está ativa para envio automático.');
    const legacy = portal.companyId ? await lerCadastro(portal.companyId) : null;
    const config = (await lerConfiguracao(portalClientId))?.value || { enabled: false };
    const settings = (await lerAgenda())?.value;
    const agenda = settings?.rotinas?.simples_envio_guias;
    const automation = await lerAutomacao(portalClientId);
    const history = portal.companyId ? await lerHistoricoRegime(portal.companyId) : [];
    const start = `${competencia}-01`, end = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5)), 0)).toISOString().slice(0, 10);
    const civil = v => new Date(v).toISOString().slice(0, 10);
    const relevant = history.filter(h => civil(h.vigenciaInicio) <= end && (!h.vigenciaFim || civil(h.vigenciaFim) >= start));
    const currentParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' }).formatToParts(now()).map(p => [p.type, p.value]));
    const latestCompetence = new Date(Date.UTC(Number(currentParts.year), Number(currentParts.month) - 2, 1)).toISOString().slice(0, 7);
    const regimeKnown = history.length ? relevant.length === 1 && relevant[0].regime === 'SIMPLES' && civil(relevant[0].vigenciaInicio) <= start && (!relevant[0].vigenciaFim || civil(relevant[0].vigenciaFim) >= end)
      : competencia === latestCompetence && String(legacy?.regimeTributario || legacy?.tipoTributario || '').toUpperCase() === 'SIMPLES';
    const mesOperacional = mesOperacionalDaCompetencia(competencia);
    const feriados = await listarFeriados();
    const calendar = calendarioEnvioGuias({ mesOperacional, feriados, municipio: portal.municipio });
    const projection = (await compliance([{ portalId: portalClientId, hasProlabore: portal.hasProlabore, temFolha: portal.temFolha, empresaZerada: portal.empresaZerada, legacy: { ...legacy, regimeTributario: regimeKnown ? 'SIMPLES' : null, tipoTributario: regimeKnown ? 'SIMPLES' : null } }], competencia)).get(portalClientId);
    const monthlyRow = await lerRegistroInss(portalClientId, competencia);
    const monthlyInss = monthlyRow ? await lerInssManual(portalClientId, competencia) : null;
    const monthlyEvidence = monthlyInss?.applicabilitySource === 'month' && Boolean(monthlyInss.changedBy && monthlyInss.changedAt) && !monthlyInss.applicabilityConflict;
    if (monthlyEvidence && projection) projection.inss = { ...projection.inss, required: monthlyInss.applicable, ok: ['NOT_APPLICABLE', 'DOCUMENT_AVAILABLE', 'DOCUMENT_ABSENT'].includes(monthlyInss.status) };
    const required = Object.entries(labels).filter(([key]) => projection?.[key]?.required);
    const missing = required.filter(([key]) => !projection[key].ok).map(([obligationKey, label]) => ({ obligationKey, label, reason: 'Documento válido ainda não confirmado.' }));
    if (projection?.guiasParcelamentoMes?.length) missing.push({ obligationKey: 'parcelamento', label: 'Parcelamento', reason: 'Confira as parcelas esperadas nesta competência.' });
    // Cadastro atual de folha não prova matriz trabalhista nem a sua vigência histórica.
    const resolvedCount = required.filter(([key]) => projection[key].ok).length;
    const absenceConfirmedCount = required.filter(([key]) => projection[key].ok && (projection[key].state === 'vazio' || key === 'inss' && monthlyEvidence && monthlyInss.status === 'DOCUMENT_ABSENT')).length;
    const availableCount = resolvedCount - absenceConfirmedCount;
    const expectationKnown = Boolean(projection?.expectativaParcelamentoInconclusiva === false && regimeKnown && history.length > 0 && monthlyEvidence && portal.temFolha === false);
    const guides = await listarGuias(portalClientId, competencia);
    const destinations = await contatos(portalClientId), channel = await canal();
    const envios = guides.length ? await listarEnvios(guides.map(g => g.id)) : [];
    const persisted = (await lerRegistroCiclo(portalClientId, competencia))?.value || stateBase(portalClientId, competencia);
    const items = [], eligible = [];
    for (const guide of guides) {
      if (guide.status === 'VAZIO') continue;
      let reason = null;
      if (!documentoValido(guide) || guide.status !== 'PROCESSED' || guide.paymentStatus === 'PAID' || !(Number(guide.valor) > 0) || !guide.hash || !(guide.pdfBytes?.length || guide.storageKey)) reason = 'Confira o documento vigente, o valor e o pagamento.';
      if ((guide.parcelamentoId || guide.extracted?.indicacaoParcelamentoId) && !guide.vencimento) reason = 'Confira o vencimento da parcela.';
      if (!guide.parcelamentoId && !guide.extracted?.indicacaoParcelamentoId && guides.filter(g => g.status === 'PROCESSED' && !g.parcelamentoId && !g.extracted?.indicacaoParcelamentoId && g.tipo === guide.tipo && g.competencia === guide.competencia).length > 1) reason = 'Há mais de uma versão deste tipo de guia. Confira qual documento deve ser enviado.';
      const blocked = bloqueioEnvioParcela(guide); if (blocked) reason = blocked.message;
      try { await conferirParcelas([guide]); } catch (error) { reason = error.message; }
      let itemCalendar;
      try { itemCalendar = calendarioEnvioGuias({ mesOperacional, vencimento: guide.vencimento, feriados, municipio: portal.municipio }); } catch { reason = 'Confira o vencimento da guia.'; }
      if (!regimeKnown) reason = 'Confira o regime tributário da competência.';
      const documentRevision = revisaoDocumentoEnvio(guide), channels = [];
      const targets = [...destinations.emails.map(destination => ({ channel: 'EMAIL', destination })), ...destinations.telefones.map(contact => ({ channel: 'WHATSAPP', destination: contact.telefoneE164, contact }))];
      for (const target of targets) {
        const entry = projetarCanalEnvio({ guide, target, persisted, envios, documentRevision, reason, channel });
        channels.push(entry);
        if (entry.state === 'PENDING') eligible.push({ guide, documentRevision, target, calendar: itemCalendar });
      }
      if (!targets.length) reason = 'Cadastre um destinatário autorizado para receber guias.';
      items.push({ guideId: guide.id, tipo: guide.parcelamentoId ? 'PARCELAMENTO' : guide.tipo, competencia: guide.competencia, vencimento: guide.vencimento,
        documentRevision, state: estadoOperacionalGuia(reason, channels), reason, channels });
    }
    for (const item of items) if (item.reason && guides.find(g => g.id === item.guideId)?.paymentStatus !== 'PAID' && !missing.some(m => m.guideId === item.guideId)) missing.push({ obligationKey: 'documento', guideId: item.guideId, label: item.tipo, reason: item.reason });
    const prior = persisted.attempts.some(a => a.status === 'SENT');
    const advance = eligible.map(e => e.calendar?.advanceDate).filter(Boolean).sort()[0] || null;
    const decision = decidirEnvioGuias({ expectationKnown, missingCount: missing.length, availableCount: new Set(eligible.map(e => e.guide.id)).size, hasPriorDelivery: prior, calendar: { ...calendar, advanceDate: advance }, now: now() });
    const agendaValid = agenda?.enabled === true && agenda.frequency === 'DAILY' && Number.isInteger(agenda.hour) && agenda.hour >= 0 && agenda.hour <= 23;
    const enabled = config.enabled === true && agendaValid;
    const paused = automation.globalAutomationPolicy.paused || automation.automationPolicy.paused;
    const warnings = persisted.warnings.filter(w => !w.resolvedAt);
    if (!expectationKnown) warnings.push(warning('EXPECTATIVA_A_CONFERIR', 'A cobertura completa das obrigações precisa de conferência; não será declarada completa.', now()));
    return { portal, config, agenda, regimeKnown, configHash: hash(config), agendaHash: hash(agenda ?? null), destinations, channel, guides, eligible, persisted,
      dto: { ok: true, portalClientId, competencia, mesOperacional, enabled, paused, revision: persisted.revision,
        status: !enabled ? 'DISABLED' : paused ? 'PAUSED' : (persisted.attempts.some(a => ['STARTED', 'UNCERTAIN', 'REVIEW'].includes(a.status)) || items.some(item => item.channels.some(c => ['REVIEW', 'UNCERTAIN', 'STARTED'].includes(c.state)))) ? 'REVIEW' : decision.kind,
        cutoffDate: calendar.cutoffDate, calendar, expectation: { state: expectationKnown ? 'KNOWN' : 'REVIEW', requiredCount: required.length, availableCount, absenceConfirmedCount, resolvedCount, missing },
        decision, items, warnings: [...new Map(warnings.map(w => [w.id, w])).values()], lastAttempt: persisted.lastAttempt || null } };
  }
  return load;
}
