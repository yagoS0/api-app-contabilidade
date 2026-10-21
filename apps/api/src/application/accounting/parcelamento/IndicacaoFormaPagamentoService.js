import { createHash } from 'node:crypto';
const key = id => `parcelamento_indicacao_forma:v1:${id}`;
const month = /^20\d{2}-(0[1-9]|1[0-2])$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const civilMonth = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(now);
function periods(record) {
  if (!record) return [];
  if (!Array.isArray(record.periodos) || record.periodos.some(p => !month.test(p.desde) || !['GUIA_MENSAL', 'DEBITO_AUTOMATICO'].includes(p.formaPagamento) || !p.usuarioId || !p.em)) throw fail('CONFIGURACAO_INVALIDA', 'A configuração salva precisa de conferência.', 503);
  return record.periodos;
}
export function formaIndicacaoNoMes(record, mes) {
  if (!month.test(mes)) throw fail('MES_INVALIDO', 'Informe um mês válido.', 422);
  return periods(record).filter(p => p.desde <= mes).at(-1) || null;
}
function row(i, config, mes) {
  return { id: i.id, descricao: i.descricao, modalidade: i.modalidade, numeroParcelamento: i.numeroParcelamento,
    revision: digest([i.id, i.portalClientId, i.status, i.parcelamentoId, i.updatedAt, config || null]),
    atual: formaIndicacaoNoMes(config, mes), historico: periods(config), mes };
}
export async function listarFormasIndicacoes(db, portalClientId, mes) {
  if (!month.test(mes)) throw fail('MES_INVALIDO', 'Informe um mês válido.', 422);
  const indicacoes = await db.parcelamentoIndicacao.findMany({ where: { portalClientId, status: 'PENDENTE', parcelamentoId: null }, orderBy: { id: 'asc' } });
  const configs = await db.appSetting.findMany({ where: { key: { in: indicacoes.map(i => key(i.id)) } } });
  const byKey = new Map(configs.map(c => [c.key, c.value]));
  return { items: indicacoes.map(i => row(i, byKey.get(key(i.id)), mes)) };
}
export async function aplicarFormasIndicacoes(db, indicacoes, mes) {
  if (!indicacoes.length) return indicacoes;
  const configs = await db.appSetting.findMany({ where: { key: { in: indicacoes.map(i => key(i.id)) } } });
  const byKey = new Map(configs.map(c => [c.key, c.value]));
  return indicacoes.map(i => ({ ...i, formasPagamento: periods(byKey.get(key(i.id))), formaPagamento: formaIndicacaoNoMes(byKey.get(key(i.id)), mes)?.formaPagamento || null }));
}
export async function salvarFormaIndicacao(db, portalClientId, indicacaoId, user, input, now = new Date()) {
  const { requestId, expectedRevision, desde, formaPagamento } = input || {};
  if (!user?.id) throw fail('ACESSO_NEGADO', 'Acesso não autorizado.', 403);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '') || !/^[a-f0-9]{64}$/.test(expectedRevision || '') || !month.test(desde || '') || !['GUIA_MENSAL', 'DEBITO_AUTOMATICO'].includes(formaPagamento)) throw fail('CONFIGURACAO_INVALIDA', 'Confira a forma de pagamento e o início de vigência.', 422);
  const requestKey = `parcelamento_indicacao_forma_request:${user.id}:${requestId}`;
  const hash = digest([portalClientId, indicacaoId, expectedRevision, desde, formaPagamento]);
  return db.$transaction(async tx => {
    if (String(user.role).toLowerCase() !== 'admin') {
      const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId: portalClientId, userId: String(user.id) } } });
      if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('ACESSO_NEGADO', 'Seu acesso não permite configurar esta empresa.', 403);
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key(indicacaoId)}))::text`;
    const i = await tx.parcelamentoIndicacao.findFirst({ where: { id: indicacaoId, portalClientId } });
    if (!i) throw fail('INDICACAO_NAO_ENCONTRADA', 'Indicação não encontrada nesta empresa.', 404);
    const previous = await tx.appSetting.findUnique({ where: { key: requestKey } });
    if (previous) {
      if (previous.value.hash !== hash) throw fail('SOLICITACAO_DIVERGENTE', 'Esta solicitação já foi usada para outra configuração.');
      return previous.value.result;
    }
    if (i.status !== 'PENDENTE' || i.parcelamentoId) throw fail('INDICACAO_ALTERADA', 'A indicação já foi resolvida. Confira o contrato correspondente.');
    if (desde < civilMonth(now)) throw fail('VIGENCIA_PASSADA', 'Escolha o mês atual ou futuro; períodos anteriores permanecem preservados.', 422);
    const config = await tx.appSetting.findUnique({ where: { key: key(i.id) } });
    const before = row(i, config?.value, desde);
    if (before.revision !== expectedRevision) throw fail('REVISAO_ALTERADA', 'Os dados mudaram. Recarregue e confira antes de salvar.');
    const history = periods(config?.value);
    if (history.at(-1)?.desde > desde) throw fail('VIGENCIA_ANTERIOR', 'Já existe uma configuração com vigência posterior. Confira o histórico.');
    const change = { desde, formaPagamento, usuarioId: String(user.id), em: now.toISOString() };
    const value = { periodos: [...history, change] };
    // Lock the source row as well: resolver/reprocessing cannot commit concurrently between validation and the event.
    const reserved = await tx.parcelamentoIndicacao.updateMany({ where: { id: i.id, portalClientId, status: 'PENDENTE', parcelamentoId: null, updatedAt: i.updatedAt }, data: { updatedAt: now } });
    if (reserved.count !== 1) throw fail('REVISAO_ALTERADA', 'A indicação mudou. Recarregue antes de salvar.');
    await tx.appSetting.upsert({ where: { key: key(i.id) }, create: { key: key(i.id), value }, update: { value } });
    await tx.parcelamentoIndicacaoEvento.create({ data: { portalClientId, indicacaoId, tipo: 'FORMA_PAGAMENTO_DECLARADA', usuarioId: String(user.id), dados: { antes: before.atual, depois: change } } });
    const current = await tx.parcelamentoIndicacao.findFirst({ where: { id: indicacaoId, portalClientId } });
    const result = row(current, value, desde);
    await tx.appSetting.create({ data: { key: requestKey, value: { hash, result } } });
    return result;
  }, { timeout: 20000 });
}
