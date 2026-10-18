import { createHash, randomUUID } from 'node:crypto';
import { lerDataDoPagamentoInformada } from './lib/dataDoPagamento.js';

// Evidências append-only, sem expiração ou vínculo cascade. Estado de execução separado.
export const PREFIXO_CONFIRMACAO = 'contabil:cliente:confirmacao:';
export const PREFIXO_ESTADO = 'contabil:cliente:estado:';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const erro = (code, message) => Object.assign(new Error(message), { code });
export const versaoPagamentoGuia = guia => hash([guia.id, guia.portalClientId, guia.hash || null,
  guia.tipo, guia.parcelamentoId || null, guia.numeroParcela ?? null, guia.competencia || null,
  guia.valor == null ? null : String(guia.valor), guia.extracted?.composicao || null,
  guia.extracted?.fields || null, ...['principal', 'juros', 'multa', 'total', 'valorPrincipal', 'valorJuros', 'valorMulta', 'valorTotal']
    .map(k => guia.extracted?.[k] ?? null)]);
const chave = (companyId, id) => `${PREFIXO_CONFIRMACAO}${companyId}:${id}`;
const estadoKey = (companyId, id) => `${PREFIXO_ESTADO}${companyId}:${id}`;
const json = value => JSON.parse(JSON.stringify(value));

export function resumoConfirmacaoPagamento(registro) {
  if (!registro) return null;
  const { id, guideId, companyId, origem, canal, confirmadoEm, pagoEm, estadoBaixa,
    motivo, entryIds = [], competenciaPagamento, versaoGuia, substituiConfirmacaoId, substituidaPor } = registro;
  return { id, guideId, companyId, origem, canal, confirmadoEm, pagoEm, estadoBaixa,
    motivo: motivo || null, entryIds, competenciaPagamento, versaoGuia, substituiConfirmacaoId, substituidaPor };
}

export async function lerConfirmacaoPagamento(db, companyId, id) {
  const registro = await db.appSetting.findUnique({ where: { key: chave(companyId, id) } });
  if (registro?.value?.companyId !== companyId) return null;
  const estado = await db.appSetting.findUnique({ where: { key: estadoKey(companyId, id) } });
  const resultado = { ...registro.value, ...(estado?.value || {}) };
  if (resultado.estadoBaixa === 'CONCLUIDA') {
    const guia = await db.guide.findFirst({ where: { id: resultado.guideId, portalClientId: companyId } });
    if (!guia?.baixada || !guia?.lancamentoId) return { ...resultado, estadoBaixa: 'PENDENTE',
      motivo: 'BAIXA_A_CONCILIAR', baixaAnteriorConcluida: true };
  }
  return resultado;
}

export async function listarConfirmacoesPagamento(db, companyId) {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: `${PREFIXO_CONFIRMACAO}${companyId}:` } } });
  return Promise.all(rows.filter(r => r.value?.companyId === companyId).map(r => lerConfirmacaoPagamento(db, companyId, r.value.id)));
}

export async function reconfirmacaoPagamentoTx(tx, guia, registros = null) {
  if (!guia || guia.paymentStatusSource !== 'CLIENTE' || guia.paymentStatus !== 'PAID'
    || guia.baixada || guia.lancamentoId || !guia.liberadaCliente || guia.status !== 'PROCESSED') return null;
  const historico = (registros || await listarConfirmacoesPagamento(tx, guia.portalClientId)).filter(r => r.guideId === guia.id);
  if (!historico.length || historico.some(r => r.estadoBaixa === 'CONCLUIDA' || r.baixaAnteriorConcluida || r.entryIds?.length)) return null;
  const ativos = historico.filter(r => r.estadoBaixa !== 'SUBSTITUIDA');
  if (ativos.length !== 1 || ativos[0].estadoBaixa !== 'PENDENTE' || ativos[0].politica !== 'R25-2026-10-16') return null;
  const versaoPagamento = guia.versaoPagamento || versaoPagamentoGuia(guia);
  if (ativos[0].versaoGuia === versaoPagamento) return null;
  const baixas = await tx.accountingEntry.findMany({ where: { portalClientId: guia.portalClientId, sourceGuideId: guia.id, tipo: 'BAIXA' } });
  if (baixas.length || await tx.estornoBaixa.findFirst({ where: { portalClientId: guia.portalClientId, guideId: guia.id }, select: { id: true } })) return null;
  return { confirmacaoAnteriorId: ativos[0].id, versaoPagamento };
}

export async function registrarConfirmacaoTx(tx, args) {
  const { companyId, guideId, pagoEm, canal, autor, eventId, expectedVersion, agora = new Date() } = args;
  if (!companyId || !guideId || !eventId || !['PORTAL', 'WHATSAPP'].includes(canal)
    || !(autor?.userId || autor?.contatoId)) throw erro('CONFIRMACAO_INVALIDA', 'Confirmação sem identidade autenticada.');
  if (canal === 'PORTAL') {
    const usuario = await tx.user.findUnique({ where: { id: autor.userId }, select: { role: true, status: true } });
    const acesso = await tx.companyClientUser.findUnique({ where: { companyId_userId: { companyId, userId: autor.userId } } });
    if (!usuario || String(usuario.status).toLowerCase() !== 'active'
      || (String(usuario.role).toLowerCase() !== 'admin' && acesso?.status !== 'ACTIVE'))
      throw erro('ACESSO_REVOGADO', 'Seu acesso à empresa mudou. Entre novamente antes de confirmar.');
  }
  const data = lerDataDoPagamentoInformada(pagoEm instanceof Date ? pagoEm.toISOString().slice(0, 10) : pagoEm, { hoje: agora });
  if (data.recusa) throw erro(data.recusa, 'Informe uma data válida de pagamento.');
  const guia = await tx.guide.findFirst({ where: { id: guideId, portalClientId: companyId, liberadaCliente: true, status: 'PROCESSED' } });
  if (!guia || guia.portalClientId !== companyId || guia.status !== 'PROCESSED' || !guia.liberadaCliente)
    throw erro('GUIA_INDISPONIVEL', 'Guia indisponível para confirmação.');
  const versaoGuia = versaoPagamentoGuia(guia);
  if (!expectedVersion || versaoGuia !== expectedVersion) throw erro('GUIA_ALTERADA', 'A guia mudou. Atualize antes de confirmar.');
  const id = hash([companyId, guideId, versaoGuia, ...(args.reconfirmaConfirmacaoId ? [args.reconfirmaConfirmacaoId] : [])]);
  const anterior = await lerConfirmacaoPagamento(tx, companyId, id);
  if (anterior?.estadoBaixa === 'SUBSTITUIDA') throw erro('CONFIRMACAO_SUBSTITUIDA', 'Esta confirmação foi substituída. Atualize a guia.');
  if (anterior) return { confirmacaoId: id, guide: guia, repetida: true, confirmacao: anterior };
  let substituida = null;
  if (args.reconfirmaConfirmacaoId) {
    const elegivel = await reconfirmacaoPagamentoTx(tx, guia);
    if (!elegivel || elegivel.confirmacaoAnteriorId !== args.reconfirmaConfirmacaoId)
      throw erro('RECONFIRMACAO_INDISPONIVEL', 'A confirmação mudou ou já foi contabilizada. Atualize a guia.');
    substituida = await lerConfirmacaoPagamento(tx, companyId, args.reconfirmaConfirmacaoId);
  }
  // Não converter confirmações anteriores à política; somente um novo evento elegível.
  if (!substituida && (guia.paymentStatus === 'PAID' || guia.baixada || guia.clienteConfirmouEm))
    throw erro('GUIA_JA_CONFIRMADA', 'Pagamento já registrado; os dados anteriores foram preservados.');
  const registro = json({ id, companyId, guideId, versaoGuia, substituiConfirmacaoId: substituida?.id || null, origem: 'CLIENTE', canal, autor,
    eventId, declaracao: args.declaracao || 'Confirmo que paguei esta guia na data informada.',
    confirmadoEm: agora.toISOString(), pagoEm: data.data.toISOString(), competenciaPagamento: data.data.toISOString().slice(0, 7),
    politica: 'R25-2026-10-16', documento: { hash: guia.hash || null, competencia: guia.competencia || null,
      tipo: guia.tipo, valor: guia.valor == null ? null : String(guia.valor), composicao: guia.extracted?.composicao || guia.extracted?.fields?.composicao || guia.extracted?.fields || null },
    estadoBaixa: 'PENDENTE', motivo: 'AGUARDANDO_BAIXA', entryIds: [] });
  await tx.appSetting.create({ data: { key: chave(companyId, id), value: registro } });
  await tx.appSetting.create({ data: { key: estadoKey(companyId, id), value: { estadoBaixa: 'PENDENTE', motivo: 'AGUARDANDO_BAIXA', entryIds: [], revisao: 0 } } });
  const gravada = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: guia.updatedAt,
    liberadaCliente: true, status: 'PROCESSED', baixada: false, lancamentoId: null,
    ...(substituida ? { paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', clienteConfirmouEm: guia.clienteConfirmouEm }
      : { clienteConfirmouEm: null, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'PAID' } }] }) }, data: {
    paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE', clienteConfirmouEm: agora,
    clienteConfirmouPorUserId: autor.userId || null, paymentConfirmedAt: data.data,
    paymentConfirmedByUserId: autor.userId || null, serproLastCheckResult: 'CLIENTE_CONFIRMOU',
  } });
  if (gravada.count !== 1) throw erro('P2034', 'Guia alterada durante a confirmação.');
  if (substituida) {
    const estadoAnterior = await tx.appSetting.findUnique({ where: { key: estadoKey(companyId, substituida.id) } });
    const troca = await tx.appSetting.updateMany({ where: { key: estadoKey(companyId, substituida.id), value: { equals: estadoAnterior.value } },
      data: { value: json({ ...estadoAnterior.value, estadoBaixa: 'SUBSTITUIDA', substituidaPor: id, substituidaEm: agora.toISOString(), revisao: (substituida.revisao || 0) + 1 }) } });
    if (troca.count !== 1) throw erro('P2034', 'Confirmação concorrente.');
    await tx.appSetting.create({ data: { key: `contabil:cliente:evento:${companyId}:${substituida.id}:substituida:${id}`,
      value: json({ tipo: 'CONFIRMACAO_SUBSTITUIDA', companyId, confirmacaoId: substituida.id, substituidaPor: id, autor, ocorridoEm: agora.toISOString() }) } });
  }
  return { confirmacaoId: id, guide: { ...guia, paymentStatus: 'PAID', paymentStatusSource: 'CLIENTE' }, confirmacao: registro, repetida: false };
}

async function transacao(db, fn) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try { return await db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 30000 }); }
    catch (e) { if (!['P2034', 'P2002'].includes(e.code) || tentativa === 2) throw e; }
  }
}

export async function confirmarPagamentoCliente(args, db) {
  const registro = await transacao(db, tx => registrarConfirmacaoTx(tx, args));
  return tentarBaixaConfirmacao({ companyId: args.companyId, confirmacaoId: registro.confirmacaoId, actor: args.autor }, db);
}

export async function tentarBaixaConfirmacao({ companyId, confirmacaoId, actor }, db, executar) {
  const eventoId = randomUUID();
  try {
    await transacao(db, async tx => {
      const registro = await lerConfirmacaoPagamento(tx, companyId, confirmacaoId);
      if (!registro) throw erro('CONFIRMACAO_NAO_ENCONTRADA', 'Confirmação não encontrada.');
      if (['CONCLUIDA', 'SUBSTITUIDA'].includes(registro.estadoBaixa)) return;
      const guia = await tx.guide.findFirst({ where: { id: registro.guideId, portalClientId: companyId } });
      if (!guia || versaoPagamentoGuia(guia) !== registro.versaoGuia)
        throw erro('GUIA_ALTERADA', 'Documento alterado após a confirmação; confira antes de lançar.');
      if (registro.baixaAnteriorConcluida && !guia.baixada) throw Object.assign(new Error('Baixa anterior desfeita; confira o histórico.'), { pendencia: 'BAIXA_A_CONCILIAR' });
      const executarBaixa = executar || (await import('../accounting/BaixaPagamentoClienteService.js')).executarBaixaClienteTx;
      const resultado = await executarBaixa(tx, { guide: guia, confirmacao: registro, userId: actor?.userId || null });
      const value = json({ estadoBaixa: 'CONCLUIDA', motivo: null, entryIds: resultado.entryIds,
        revisao: (registro.revisao || 0) + 1, concluidaEm: new Date().toISOString() });
      await tx.appSetting.create({ data: { key: `contabil:cliente:evento:${companyId}:${confirmacaoId}:${eventoId}`, value: json({
        tipo: 'BAIXA_CONCLUIDA', confirmacaoId, companyId, actor: actor || null, resultado, ocorridoEm: new Date().toISOString(),
      }) } });
      await tx.appSetting.update({ where: { key: estadoKey(companyId, confirmacaoId) }, data: { value } });
    });
  } catch (e) {
    if (e.code === 'CONFIRMACAO_NAO_ENCONTRADA') throw e;
    await transacao(db, async tx => {
      const registro = await lerConfirmacaoPagamento(tx, companyId, confirmacaoId);
      if (!registro || ['CONCLUIDA', 'SUBSTITUIDA'].includes(registro.estadoBaixa)) return;
      // A falha não substitui nem apaga o relato original; o evento também não expira.
      const motivo = e.pendencia || (['MES_FECHADO', 'GUIA_ALTERADA'].includes(e.code) ? e.code : 'FALHA_CONTABIL');
      const estadoPersistido = await tx.appSetting.findUnique({ where: { key: estadoKey(companyId, confirmacaoId) } });
      // Reentregas tentam a baixa novamente, mas uma pendência inalterada não é
      // outra transição. Após conflito serializável, a releitura vê o vencedor.
      // Comparar o estado salvo, não a projeção CONCLUIDA -> BAIXA_A_CONCILIAR.
      const atual = estadoPersistido?.value;
      if (atual?.estadoBaixa === 'PENDENTE' && atual.motivo === motivo
        && !atual.entryIds?.length
        && Boolean(atual.baixaAnteriorConcluida) === Boolean(registro.baixaAnteriorConcluida)) return;
      await tx.appSetting.create({ data: { key: `contabil:cliente:evento:${companyId}:${confirmacaoId}:${eventoId}`, value: json({
        tipo: 'BAIXA_PENDENTE', confirmacaoId, companyId, motivo, actor: actor || null, ocorridoEm: new Date().toISOString(),
      }) } });
      await tx.appSetting.update({ where: { key: estadoKey(companyId, confirmacaoId) }, data: { value: {
        estadoBaixa: 'PENDENTE', motivo, entryIds: [], baixaAnteriorConcluida: Boolean(registro.baixaAnteriorConcluida), revisao: (registro.revisao || 0) + 1,
      } } });
    });
  }
  const registro = await lerConfirmacaoPagamento(db, companyId, confirmacaoId);
  const guide = await db.guide.findFirst({ where: { id: registro.guideId, portalClientId: companyId }, include: { parcelamento: true } });
  return { ok: true, confirmacao: resumoConfirmacaoPagamento(registro), guide: { ...guide, confirmacaoCliente: resumoConfirmacaoPagamento(registro) },
    aviso: registro.estadoBaixa === 'SUBSTITUIDA' ? 'Esta confirmação foi substituída por uma nova declaração do cliente.' : registro.estadoBaixa === 'CONCLUIDA' ? 'Pagamento confirmado por você e baixa contábil registrada.'
      : 'Pagamento confirmado por você. A baixa contábil tem uma pendência para o escritório conferir.' };
}
