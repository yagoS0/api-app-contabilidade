import { conferirVigenciaDocumentoAcompanhamento } from './VigenciaDocumentoAcompanhamento.js';
import { lerAgendaEventosEmpresa } from '../fiscal/serpro/AgendaEventosService.js';
import { calendarioEventosGuia } from './calendarioEventosGuia.js';
import { lerModoEventos } from '../fiscal/serpro/AgendaEventosModo.js';
import { prepararEventosAcompanhamento, conferirEventoAcompanhamento } from './AgendaEventosExecucao.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { calendarioAvisosGuia, faseAvisoGuia, hojeSaoPaulo, POLITICA_ACOMPANHAMENTO_GUIAS } from './calendarioAvisosGuia.js';
import { versaoPagamentoGuia, listarConfirmacoesPagamento } from './ConfirmacaoPagamentoClienteService.js';
import { lerRegistroRecalculo } from './RegistroRecalculoGuia.js';
import { conferirEntregaGuiaWhatsapp } from './EntregaGuiaWhatsappService.js';
import { conferirFormaIndicacaoParaEnvio, bloqueioEnvioParcela } from './GuiaParcelaEnvioGuard.js';
import { exigirGuiaArrecadatoria } from './lib/documentoNaoArrecadatorio.js';
import { conferirAutomacaoCicloFiscal, lerAutomacaoCicloFiscal } from '../fiscal/AutomacaoCicloFiscalService.js';
import { lerPoliticaAutomacao } from '../fiscal/serpro/CompanyAutomationPolicy.js';
import { comAutomacaoAgendada, comAutomacaoEmpresa, comVerificacaoTentativaAutomatica } from '../fiscal/automacaoCicloFiscalContext.js';
import { executarConsultaAutomatica, conferirReservaConsulta, chaveConsultaAutomatica } from '../fiscal/serpro/ConsultaPagamentoAutomaticaService.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
export const chaveConfiguracaoAcompanhamento = id => `acompanhamento_guias_config:${id}`;
export async function lerConfiguracaoAcompanhamento(db, id) {
  const value = (await db.appSetting.findUnique({ where: { key: chaveConfiguracaoAcompanhamento(id) } }))?.value;
  return { enabled: value?.enabled === true, politica: value?.politica || null,
    limiteConsultas: value?.limiteConsultas === 1 ? 1 : 0, selectionToken: value?.selectionToken || null };
}
const destinatariosPadrao = async id => (await import('../whatsapp/ContatoWhatsappService.js')).destinatariosDeEnvio(id);
const consultaPadrao = async input => (await import('../fiscal/serpro/SerproPaymentConfirmationService.js')).confirmarPagamentoGuia(input);
const avisoPadrao = async (input, deps) => (await import('./AvisoPagamentoService.js')).avisarPagamentoNaoConfirmado(input, deps);
const carregarGuia = (db, guideId) => db.guide.findUnique({ where: { id: guideId }, include: { parcela: { include: { parcelamento: true } }, parcelamento: true, tributosParcela: true, portalClient: { select: { municipio: true, cnpj: true } } } });
const identidade = g => JSON.stringify([g.portalClientId, g.id, g.parcela?.id || null, versaoPagamentoGuia(g), String(g.vencimento), g.sourceFileId || null,
  g.cnpj || null, g.portalClient?.cnpj || null,
  ...['numeroDocumento', 'numeroDoc', 'numeroDas'].map(k => g.extracted?.[k] ?? null),
  g.parcela?.anoMesParcela ?? null, g.parcela?.numeroParcela ?? null, g.parcela?.valorPrevisto == null ? null : String(g.parcela.valorPrevisto),
  g.parcelamento?.numeroParcelamento ?? null, g.parcelamento?.tipo ?? null,
  g.parcela?.parcelamento?.numeroParcelamento ?? null, g.parcela?.parcelamento?.tipo ?? null,
  (g.tributosParcela || []).map(t => [t.id, String(t.principal ?? '')]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);

// Somente leituras locais: esta mesma guarda roda depois da autenticação fiscal.
export async function conferirGuiaAcompanhamento(db, g, { permitirRecalculada = false } = {}) {
  if (!g || !g.portalClientId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(g.competencia || '')) throw fail('IDENTIFICACAO_INCOMPLETA', 'Confira a identificação da guia.');
  exigirGuiaArrecadatoria(g);
  if (g.baixada || g.clienteConfirmouEm || g.paymentConfirmedAt || g.paymentStatus === 'PAID'
    || g.parcela?.origemBaixa || g.parcela?.baixadaEm || g.parcela?.pagamentoStatus === 'CONFIRMADO') throw fail('PAGAMENTO_JA_CONFIRMADO', 'Pagamento informado ou confirmado; acompanhamento encerrado.');
  if (!permitirRecalculada && lerRegistroRecalculo(g)) throw fail('GUIA_RECALCULADA', 'Guia recalculada; confira a nova versão antes de qualquer acompanhamento.');
  if (g.status !== 'PROCESSED' || !g.liberadaCliente || !g.hash) throw fail('GUIA_NAO_LIBERADA', 'Confira o documento e a liberação da guia.');
  if (g.parcela && (g.parcela.portalClientId !== g.portalClientId || g.parcela.guiaId !== g.id || g.parcela.parcelamentoId !== g.parcelamentoId)
    || g.parcelamento && g.parcelamento.portalClientId !== g.portalClientId) throw fail('DOCUMENTO_ESCOPO_DIVERGENTE', 'Confira o vínculo entre empresa, guia e parcela.');
  if (g.parcelamentoId && (!g.parcela || !g.parcelamento)) throw fail('PARCELA_VINCULO_INCOMPLETO', 'Confira os vínculos da parcela.');
  await conferirFormaIndicacaoParaEnvio(g, db);
  const bloqueio = bloqueioEnvioParcela(g);
  if (bloqueio) throw fail(bloqueio.code, bloqueio.message);
  // R26 pertence ao mês do pagamento na baixa existente. Fechar a apuração
  // não impede acompanhar uma guia ainda não confirmada com vencimento futuro.
}

export async function acompanharGuia({ guideId, scheduledAt, agora = new Date(), assertActive = () => {}, eventoFase = null, executionMode = null }, deps = {}) {
  const db = deps.db || prisma;
  if (!scheduledAt) return { status: 'IGNORADO', motivo: 'CONSULTA_MANUAL' };
  const consultar = deps.consultar || consultaPadrao, avisar = deps.avisar || avisoPadrao;
  const destinatarios = deps.destinatarios || destinatariosPadrao;
  let consulta = null;
  try {
    await assertActive();
    const original = await carregarGuia(db, guideId);
    const modo = await lerModoEventos(db, original?.portalClientId);
    if (executionMode && modo.executionMode !== executionMode) return { status: 'IGNORADO', motivo: 'EVENT_MODE_CHANGED' };
    const relativo = modo.executionMode === 'RELATIVO_V1';
    await conferirGuiaAcompanhamento(db, original, { permitirRecalculada: relativo });
    const companyId = original.portalClientId;
    const originalIdentity = identidade(original);
    const config = await lerConfiguracaoAcompanhamento(db, companyId);
    if (!config.enabled || config.politica !== POLITICA_ACOMPANHAMENTO_GUIAS) return { status: 'IGNORADO', motivo: 'ACOMPANHAMENTO_DESLIGADO' };
    const feriados = await db.feriado.findMany({});
    if (!Array.isArray(feriados) || !original.portalClient?.municipio) throw fail('CALENDARIO_INDISPONIVEL', 'Confira o município e o calendário de feriados.');
    const calendario = calendarioAvisosGuia(original.vencimento, feriados, original.portalClient.municipio, config.politica);
    if (!calendario) throw fail('VENCIMENTO_INVALIDO', 'Confira o vencimento nominal da guia.');
    const relativeSnapshot = relativo ? await prepararEventosAcompanhamento(db, original, agora) : null;
    if (relativo && !eventoFase && relativeSnapshot.events.length > 1) {
      const resultados = [];
      for (const event of [...relativeSnapshot.events].sort((a,b) => (a.tipo === 'CONSULTA_PAGAMENTO' ? -1 : 0) - (b.tipo === 'CONSULTA_PAGAMENTO' ? -1 : 0)))
        resultados.push(await acompanharGuia({ guideId, scheduledAt, agora, assertActive, eventoFase: event.fase, executionMode: modo.executionMode }, deps));
      return { status: resultados.some(r => r.status === 'PENDENTE') ? 'PENDENTE' : 'CONCLUIDO', resultados };
    }
    const event = relativo ? relativeSnapshot.events.find(e => !eventoFase || e.fase === eventoFase) : null;
    const fase = relativo ? event?.fase : faseAvisoGuia(original.vencimento, agora, feriados, original.portalClient.municipio, config.politica);
    const eventProof = event ? { fingerprint: relativeSnapshot.fingerprint, tipo: event.tipo, fase: event.fase } : null;
    if (!fase) return { status: 'IGNORADO', motivo: 'FORA_DO_DIA_DO_AVISO' };
    const destinos = (await destinatarios(companyId)).telefones;
    if (!destinos?.length) throw fail('SEM_DESTINATARIO_WHATSAPP', 'Cadastre um destinatário autorizado com entrega comprovada.');
    // Uma entrega compatível é necessária antes de gastar uma consulta fiscal.
    const entregues = [];
    for (const d of destinos) {
      try { await conferirEntregaGuiaWhatsapp(db, original, d.telefoneE164, d.vinculoNumeroId); entregues.push(d); }
      catch (e) { if (e.code !== 'GUIA_WHATSAPP_NAO_ENTREGUE') throw e; }
    }
    if (!entregues.length) throw fail('GUIA_WHATSAPP_NAO_ENTREGUE', 'Sem entrega comprovada da revisão atual para um contato autorizado.');
    const policy = await conferirAutomacaoCicloFiscal({ db, scheduledAt });
    const companyPolicy = await lerPoliticaAutomacao(db, companyId);
    const verificarLocal = async database => {
      const globalAtual = await lerAutomacaoCicloFiscal(database), companyAtual = await lerPoliticaAutomacao(database, companyId);
      if (globalAtual.paused || companyAtual.paused || globalAtual.version !== policy.version || companyAtual.version !== companyPolicy.version) throw fail('AUTOMACAO_EMPRESA_PAUSADA', 'A pausa mudou durante a preparação.');
      const g = await carregarGuia(database, guideId);
      await conferirGuiaAcompanhamento(database, g, { permitirRecalculada: relativo });
      const modeNow = await lerModoEventos(database, companyId);
      if (modeNow.modeRevision !== modo.modeRevision) throw fail('EVENT_MODE_CHANGED', 'A adoção mudou durante o preparo.');
      if (relativo) await conferirEventoAcompanhamento(database, g, agora, eventProof);
      if (identidade(g) !== originalIdentity) throw fail('GUIA_ALTERADA', 'A guia ou sua revisão mudou; confira o acompanhamento.');
      const atual = await lerConfiguracaoAcompanhamento(database, companyId);
      if (JSON.stringify(atual) !== JSON.stringify(config)) throw fail('CONFIGURACAO_ALTERADA', 'A seleção de acompanhamento mudou.');
      const rotina = await database.companyRotina.findUnique({ where: { portalClientId_rotina: { portalClientId: companyId, rotina: 'avisos_guias_whatsapp' } } });
      const agenda = (await database.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } }))?.value?.rotinas?.avisos_guias_whatsapp;
      const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(scheduledAt)));
      if (!rotina?.enabled || !agenda?.enabled || agenda.frequency !== 'DAILY' || !Number.isInteger(agenda.hour) || (!relativo && agenda.hour !== hora) || hojeSaoPaulo(new Date(scheduledAt)) !== hojeSaoPaulo(agora)) throw fail('AGENDA_ALTERADA', 'Confira seleção e horário salvo da agenda diária.');
      const atuais = (await destinatarios(companyId)).telefones;
      const elegiveis = entregues.filter(d => atuais.some(a => a.id === d.id && a.telefoneE164 === d.telefoneE164 && a.vinculoNumeroId === d.vinculoNumeroId));
      if (!elegiveis.length) throw fail('DESTINATARIO_ALTERADO', 'O contato autorizado mudou durante o preparo.');
      for (const d of elegiveis) await conferirEntregaGuiaWhatsapp(database, g, d.telefoneE164, d.vinculoNumeroId);
      return true;
    };
    return await comAutomacaoAgendada({ ...policy, scheduledAt }, () => comAutomacaoEmpresa(companyId, async () => {
      await verificarLocal(db);
      if (relativo ? event.tipo === 'CONSULTA_PAGAMENTO' : fase === 'DEPOIS') {
        if (config.limiteConsultas !== 1) throw fail('LIMITE_CONSULTA_NAO_AUTORIZADO', 'Autorize explicitamente o limite de uma consulta por guia antes do acompanhamento.');
        const input = { companyId, guideId, parcelaId: original.parcela?.id || null, revisao: versaoPagamentoGuia(original), politica: config.politica, fase, scheduledAt, executionMode: modo.executionMode };
        consulta = await executarConsultaAutomatica(input, () => comVerificacaoTentativaAutomatica({ portalClientId: companyId, competencia: original.competencia,
          verificar: async () => {
            // O transporte fornece um transaction client distinto. A origem das leituras
            // fica vinculada ao banco que criou o claim, nunca a um argumento externo.
            if (!await conferirReservaConsulta(input, db)) return false;
            return verificarLocal(db);
          } }, () => consultar({ guideId, scheduledAt, assertActive: async () => { await assertActive(); await verificarLocal(db); } })), db);
        if (consulta?.pago === true) return { status: 'ENCERRADO', consulta: { resultado: 'PAGA' } };
        if (consulta?.skipped) return { status: 'PENDENTE', motivo: 'CONSULTA_A_CONFERIR', mensagem: 'Consulta já reservada ou inconclusiva; confira o histórico, sem nova consulta automática.', consulta };
      }
      if (relativo && event.tipo === 'CONSULTA_PAGAMENTO') return { status: consulta?.pago ? 'ENCERRADO' : 'PENDENTE', consulta, motivo: 'CONSULTA_A_CONFERIR' };
      const aviso = await avisar({ guideId, scheduledAt, agora, politica: config.politica, eventoRelativo: eventProof, assertActive: async () => { await assertActive(); await verificarLocal(db); } }, { ...deps, db, feriados });
      return { ...aviso, ...(consulta ? { status: 'PENDENTE', motivo: 'CONSULTA_A_CONFERIR', mensagem: 'Pagamento não confirmado pela consulta. Confira o resultado fiscal; isso não comprova inadimplência.', consulta: { resultado: consulta.negativaConfirmada || consulta.status === 'NAO_LOCALIZADO' ? 'NAO_LOCALIZADO' : 'INCONCLUSIVO' } } : {}) };
    }, db), db);
  } catch (e) {
    return { status: ['PAGAMENTO_JA_CONFIRMADO', 'GUIA_RECALCULADA'].includes(e.code) ? 'ENCERRADO' : 'PENDENTE', motivo: e.code || 'ACOMPANHAMENTO_INDISPONIVEL',
      mensagem: 'Não foi possível concluir o acompanhamento. Confira documento, configuração e histórico; nenhuma tentativa incerta será repetida.', ...(consulta ? { consulta } : {}) };
  }
}

// Somente orientações próprias: mensagem externa e códigos desconhecidos nunca são ecoados.
const orientacoesAviso = Object.freeze({
  WHATSAPP_TEMPLATE_PENDENTE: 'Confira a aprovação Utility e o contrato do modelo WhatsApp antes de avisar.',
  GUIA_WHATSAPP_NAO_ENTREGUE: 'Confira a entrega comprovada da revisão atual da guia ao destinatário.',
  DESTINATARIO_ALTERADO: 'Confira o contato autorizado e seu vínculo com a empresa antes de avisar.',
  SEM_DESTINATARIO_WHATSAPP: 'Cadastre um destinatário WhatsApp autorizado para esta empresa.',
  WHATSAPP_JANELA_FECHADA: 'A janela de atendimento fechou; confira um modelo Utility aprovado.',
  WHATSAPP_DESLIGADO: 'A integração WhatsApp está desligada; o aviso permanece pendente.',
  CICLO_FISCAL_PAUSADO: 'As automações gerais estão pausadas; o histórico do aviso foi preservado.',
  AUTOMACAO_EMPRESA_PAUSADA: 'As automações desta empresa estão pausadas; o histórico foi preservado.',
  ROTINA_EMPRESA_DESABILITADA: 'A empresa não está selecionada para lembretes WhatsApp.',
  AGENDA_ALTERADA: 'A agenda mudou durante o preparo; confira o horário salvo.',
  GUIA_ALTERADA: 'A guia mudou durante o preparo; confira o documento e a revisão.',
  AVISO_REVISAO_A_CONFERIR: 'Confira a revisão do aviso anterior antes de qualquer novo envio.',
  AVISO_JA_RESERVADO: 'O aviso já foi reservado; confira seu resultado antes de repetir.',
  GUIA_RECALCULADA: 'A guia foi recalculada; confira o histórico e a nova versão.',
  PAGAMENTO_JA_CONFIRMADO: 'O pagamento foi informado ou confirmado; o aviso foi interrompido.',
});
function motivoSeguroAviso(value) {
  if (typeof value.motivo === 'string' && Object.hasOwn(orientacoesAviso, value.motivo)) return orientacoesAviso[value.motivo];
  return value.motivo || ['PENDENTE', 'RESERVADO', 'INDETERMINADO'].includes(value.status)
    ? 'Confira o histórico do aviso com o contador. Não repita uma tentativa de resultado incerto.' : null;
}

// Projeção somente local; nunca chama transporte ou obtém credenciais.
export async function lerAcompanhamentoGuias({ portalClientId, competencia }, { db = prisma, agora = new Date() } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw Object.assign(fail('COMPETENCIA_INVALIDA', 'Confira a competência.'), { status: 422 });
  const config = await lerConfiguracaoAcompanhamento(db, portalClientId);
  const { agendaEventos, paymentHour } = await db.$transaction(async tx => ({ agendaEventos: await lerAgendaEventosEmpresa(tx, portalClientId), paymentHour: (await tx.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } }))?.value?.rotinas?.avisos_guias_whatsapp?.hour }), { isolationLevel: 'RepeatableRead' });
  const relativo = agendaEventos.executionMode === 'RELATIVO_V1';
  const geral = await lerAutomacaoCicloFiscal(db), empresa = await lerPoliticaAutomacao(db, portalClientId);
  const feriados = await db.feriado.findMany({});
  const guias = await db.guide.findMany({ where: { portalClientId, competencia }, include: { portalClient: { select: { municipio: true } }, parcela: { include: { parcelamento: true } }, parcelamento: true, tributosParcela: true }, orderBy: { id: 'asc' } });
  const confirmacoes = await listarConfirmacoesPagamento(db, portalClientId);
  const items = [];
  for (const g of guias) {
    const calendario = relativo ? null : calendarioAvisosGuia(g.vencimento, feriados, g.portalClient?.municipio, POLITICA_ACOMPANHAMENTO_GUIAS);
    const vigenciaDocumento = relativo ? await conferirVigenciaDocumentoAcompanhamento(db, g) : null;
    const calendarioEventos = relativo ? calendarioEventosGuia({ guia: g, revisao: versaoPagamentoGuia(g), globalPolicy: { schemaVersion: 1, tributos: agendaEventos.effective }, companyPolicy: { schemaVersion: 1 }, feriados, municipio: g.portalClient?.municipio, estado: { documentoVigente: vigenciaDocumento.vigente, pagamentoConfirmado: Boolean(g.baixada || g.clienteConfirmouEm || g.paymentConfirmedAt || g.paymentStatus === 'PAID' || g.parcela?.origemBaixa || g.parcela?.baixadaEm || g.parcela?.pagamentoStatus === 'CONFIRMADO'), recalculada: Boolean(lerRegistroRecalculo(g)) }, horaConsultaPagamento: paymentHour }) : null;
    const tentativa = (await db.appSetting.findUnique({ where: { key: chaveConsultaAutomatica({ guideId: g.id }) } }))?.value;
    const avisos = await db.appSetting.findMany({ where: { key: { startsWith: 'aviso_pagamento:' }, value: { path: ['guideId'], equals: g.id } } });
    const historico = avisos.filter(r => r.value?.companyId === portalClientId && r.value?.guideId === g.id).map(r => ({ fase: r.value.fase, status: r.value.status, politica: r.value.politica === POLITICA_ACOMPANHAMENTO_GUIAS ? POLITICA_ACOMPANHAMENTO_GUIAS : null, motivo: motivoSeguroAviso(r.value), revisaoCompativel: r.value.revisao === versaoPagamentoGuia(g) }));
    const tentativasEntrega = await db.envioGuiaTentativa.findMany({ where: { envioGuia: { guideId: g.id, canal: 'WHATSAPP' }, status: { in: ['entregue', 'lido'] } }, select: { snapshot: true } });
    let comprovada = false;
    for (const t of tentativasEntrega) {
      if (!t.snapshot?.telefone || t.snapshot.portalClientId !== portalClientId) continue;
      try { await conferirEntregaGuiaWhatsapp(db, g, t.snapshot.telefone, t.snapshot.vinculoNumeroId); comprovada = true; break; }
      catch (e) { if (e.code !== 'GUIA_WHATSAPP_NAO_ENTREGUE') throw e; }
    }
    const pendenciaContabil = confirmacoes.some(c => c.guideId === g.id && !['CONCLUIDA', 'SUBSTITUIDA'].includes(c.estadoBaixa));
    const encerrada = Boolean(g.baixada || g.clienteConfirmouEm || g.paymentConfirmedAt || g.paymentStatus === 'PAID' || g.parcela?.origemBaixa || g.parcela?.baixadaEm || g.parcela?.pagamentoStatus === 'CONFIRMADO' || (!relativo && lerRegistroRecalculo(g)));
    items.push({ guideId: g.id, revisao: versaoPagamentoGuia(g), documento: g.tipo, competencia: g.competencia,
      calendario, calendarioEventos, vigenciaDocumento, executionMode: agendaEventos.executionMode, fase: calendario ? faseAvisoGuia(g.vencimento, agora, feriados, g.portalClient?.municipio, POLITICA_ACOMPANHAMENTO_GUIAS) : null,
      encerrada, pendenciaContabil, entrega: { comprovada }, historico, consulta: tentativa?.companyId === portalClientId ? { status: tentativa.status, resultado: tentativa.resultado || null, revisaoCompativel: tentativa.revisao === versaoPagamentoGuia(g) } : null,
      motivo: pendenciaContabil ? 'Confirmação do cliente preservada; a baixa contábil exige conferência explícita.' : encerrada ? 'Pagamento informado/confirmado ou guia recalculada; acompanhamento encerrado.' : relativo && calendarioEventos?.status === 'A_CONFERIR' || !relativo && !calendario ? 'Vencimento ou calendário a conferir.' : !comprovada ? 'Sem entrega comprovada da revisão atual; confira o histórico.' : tentativa && tentativa.status !== 'PAGA' ? 'Consulta reservada ou inconclusiva; exige conferência, sem repetição automática.' : 'Entrega e contato autorizado serão conferidos antes de qualquer saída.' });
  }
  return { portalClientId, competencia, enabled: config.enabled, politica: config.politica, limiteConsultas: config.limiteConsultas,
    executionMode: agendaEventos.executionMode, paused: geral.paused || empresa.paused, items, template: { status: 'A_CONFERIR', mensagem: 'Fora da janela, exige modelo Utility aprovado e contrato comprovado na Meta.' } };
}
