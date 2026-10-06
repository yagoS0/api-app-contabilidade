import { prisma } from '../../infrastructure/db/prisma.js';
import { NFSE_ENV } from '../../config.js';
import { validateNfsePayload } from '../validators/nfsePayload.js';
import { NfseService } from './NfseService.js';
import { hojeEmSaoPaulo, proximaData, validarAgenda } from './recorrenciaMensal.js';

const json = value => JSON.parse(JSON.stringify(value));
const recusa = message => Object.assign(new Error(message), { status: 400 });

export async function criarRecorrencia({ companyId, userId, body, db = prisma, hoje = hojeEmSaoPaulo() }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')) throw recusa('Identificador da solicitação inválido. Reabra o formulário.');
  const existente = await db.nfseRecorrencia.findUnique({ where: { id: body.requestId } });
  if (existente) {
    if (existente.companyId === companyId && existente.autorizadoPor === userId) {
      const validacao = validateNfsePayload({ ...body.modelo, companyId, competencia: `${body.inicio}T12:00:00-03:00` });
      const { competencia, ...modelo } = validacao.data || {};
      // PostgreSQL JSONB não preserva a ordem das chaves: comparar por conteúdo canônico.
      const igual = (a, b) => JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
      if (body.confirmada === true && validacao.ok && existente.dia === body.dia && existente.proximaData === body.inicio && igual(existente.modelo, json(modelo))) return existente;
      throw Object.assign(new Error('Esta solicitação já foi salva com outros dados. Confira a lista de recorrências antes de criar outra.'), { status: 409 });
    }
    throw Object.assign(new Error('Identificador já utilizado.'), { status: 409 });
  }
  let agenda;
  try { agenda = validarAgenda(body, hoje); } catch (e) { throw recusa(e.message); }
  if (body.confirmada !== true) throw recusa('Confirme a autorização para emissão automática mensal.');
  const validacao = validateNfsePayload({ ...body.modelo, companyId, competencia: `${agenda.inicio}T12:00:00-03:00` });
  if (!validacao.ok) throw recusa(validacao.message || validacao.error);
  // Lista permitida do validador elimina retryInvoiceId, números e chaves da nota de origem.
  const { competencia, ...modelo } = validacao.data;
  try {
    return await db.nfseRecorrencia.create({ data: { id: body.requestId, companyId, autorizadoPor: userId, ambiente: NFSE_ENV,
      dia: agenda.dia, proximaData: agenda.inicio, modelo: json(modelo) } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    return criarRecorrencia({ companyId, userId, body, db, hoje });
  }
}

function ordenar(value) {
  if (Array.isArray(value)) return value.map(ordenar);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordenar(value[key])]));
  return value;
}

export async function listarRecorrencias(companyId, db = prisma) {
  return db.nfseRecorrencia.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' },
    include: { execucoes: { orderBy: { createdAt: 'desc' }, take: 12 } } });
}

export async function pausarRecorrencia(companyId, id, db = prisma) {
  const r = await db.nfseRecorrencia.updateMany({ where: { id, companyId }, data: { ativa: false, versao: { increment: 1 } } });
  return r.count > 0;
}

export async function retomarRecorrencia({ companyId, id, userId, inicio, db = prisma, hoje = hojeEmSaoPaulo() }) {
  const item = await db.nfseRecorrencia.findFirst({ where: { id, companyId } });
  if (!item) throw Object.assign(new Error('Recorrência não encontrada.'), { status: 404 });
  if (item.ativa) throw recusa('Pause a recorrência antes de alterar a próxima emissão.');
  try { validarAgenda({ dia: item.dia, inicio }, hoje); } catch (e) { throw recusa(e.message); }
  const ultima = await db.nfseRecorrenciaExecucao.findFirst({ where: { recorrenciaId: id }, orderBy: { competencia: 'desc' } });
  // Retomada só em mês posterior; nunca reenvia uma tentativa, mesmo rejeitada ou incerta.
  if (ultima && inicio.slice(0, 7) <= ultima.competencia) throw recusa('Escolha um mês posterior à última tentativa. Confira a nota daquela competência antes de qualquer emissão manual.');
  if (ultima?.status === 'EXECUTANDO') throw recusa('Há uma execução em andamento ou interrompida. Confira seu resultado antes de retomar.');
  const r = await db.nfseRecorrencia.updateMany({ where: { id, companyId, versao: item.versao, ativa: false },
    data: { ativa: true, proximaData: inicio, autorizadoPor: userId, ambiente: NFSE_ENV, versao: { increment: 1 } } });
  if (!r.count) throw Object.assign(new Error('A recorrência mudou. Recarregue a lista.'), { status: 409 });
}

export async function executarRecorrencia(item, { db = prisma, now = new Date(), autorizar, emitir = args => NfseService.issue(args), log } = {}) {
  const hoje = hojeEmSaoPaulo(now);
  // Não acumular notas antigas após indisponibilidade do servidor.
  const atrasada = item.proximaData.slice(0, 7) < hoje.slice(0, 7);
  let execucao;
  try {
    execucao = await db.$transaction(async tx => {
      const anterior = await tx.nfseRecorrenciaExecucao.findFirst({ where: { recorrenciaId: item.id, status: 'EXECUTANDO' } });
      if (anterior) return null;
      const claim = await tx.nfseRecorrencia.updateMany({ where: { id: item.id, ativa: true, versao: item.versao,
        proximaData: item.proximaData }, data: { proximaData: proximaData(item.proximaData, item.dia), versao: { increment: 1 } } });
      if (!claim.count || item.proximaData > hoje) throw Object.assign(new Error('Não vencida ou já reservada.'), { semExecucao: true });
      return tx.nfseRecorrenciaExecucao.create({ data: { recorrenciaId: item.id, competencia: item.proximaData.slice(0, 7),
        dataPrevista: item.proximaData, status: 'EXECUTANDO', modelo: item.modelo } });
    });
  } catch (e) { if (e.code === 'P2002' || e.semExecucao) return null; throw e; }
  if (!execucao) return null;
  let status = 'REVISAO', erro = null, invoiceId = null;
  try {
    if (atrasada) throw new Error('Competência vencida em mês anterior. Confira e reagende; nenhuma nota foi enviada.');
    if (item.ambiente !== NFSE_ENV) throw new Error('Ambiente alterado. Revise e autorize novamente a recorrência.');
    if (!autorizar || !(await autorizar(item))) throw new Error('A autorização de emissão foi revogada.');
    const atual = await db.nfseRecorrencia.findUnique({ where: { id: item.id } });
    if (!atual?.ativa || atual.versao !== item.versao + 1) throw new Error('Recorrência pausada antes do envio.');
    const validation = validateNfsePayload({ ...item.modelo, companyId: item.companyId, competencia: `${item.proximaData}T12:00:00-03:00` });
    if (!validation.ok) throw new Error(validation.message || validation.error);
    const result = await emitir({ data: validation.data, log, antesDeEnviar: async id => {
      const corrente = await db.nfseRecorrencia.findUnique({ where: { id: item.id } });
      if (!corrente?.ativa || corrente.versao !== item.versao + 1 || !(await autorizar(item))) throw new Error('Autorização interrompida antes da transmissão.');
      await db.nfseRecorrenciaExecucao.update({ where: { id: execucao.id }, data: { invoiceId: id } });
      invoiceId = id;
    } });
    invoiceId = result.nfse?.id || invoiceId;
    if (result.status === 'issued') status = 'EMITIDA';
    else erro = result.message || 'Emissão não confirmada. Consulte o resultado antes de emitir novamente.';
  } catch (e) { erro = e.code || e.message || 'Falha de emissão.'; }
  // A conclusão e a pausa são atômicas. Crash antes daqui mantém EXECUTANDO e bloqueia outro mês.
  await db.$transaction(async tx => {
    await tx.nfseRecorrenciaExecucao.update({ where: { id: execucao.id }, data: { status, erro: erro?.slice(0, 1000), invoiceId, finishedAt: new Date() } });
    if (status !== 'EMITIDA') await tx.nfseRecorrencia.update({ where: { id: item.id }, data: { ativa: false, versao: { increment: 1 } } });
  });
  return { status, invoiceId, erro };
}
