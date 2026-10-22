import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { STATUS_DOCUMENTO, PREFIXO_DOCUMENTO, documentoNaoArrecadatorio } from './lib/documentoNaoArrecadatorio.js';

const erro = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
export const revisaoReclassificacao = g => sha(JSON.stringify([g.id, g.portalClientId, g.updatedAt, g.hash, g.status, g.extracted]));
const CATEGORIAS = ['FOLHA', 'PRO_LABORE', 'DOCUMENTO_NAO_ARRECADATORIO'];

export function criarReclassificarDocumentoGuia({ db = prisma, agora = () => new Date() } = {}) {
  async function autorizar(tx, companyId, user) {
    if (!user?.id || user.accountType !== 'FIRM') throw erro('forbidden', 'Acesso restrito ao escritório.', 403);
    const acesso = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: user.id } } });
    if (acesso?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(acesso.role)) throw erro('forbidden', 'Permissão de contador nesta empresa necessária.', 403);
  }
  async function carregar(tx, companyId, guideId) {
    const g = await tx.guide.findFirst({ where: { id: guideId, portalClientId: companyId }, include: {
      accountingEntries: { select: { id: true } }, taxDocuments: { select: { id: true } },
      parcela: { select: { id: true } }, tributosParcela: { select: { id: true } }, composicoesParcelamento: { select: { id: true } },
      envios: { include: { historicoTentativas: true } },
    } });
    if (!g) throw erro('guide_not_found', 'Documento não encontrado nesta empresa.', 404);
    return g;
  }
  async function impedimentos(tx, g) {
    const motivos = [];
    if (documentoNaoArrecadatorio(g)) return ['DOCUMENTO_JA_RECLASSIFICADO'];
    // Caminho deliberadamente conservador: outras classificações precisam conciliar o domínio fiscal.
    if (g.status !== 'PROCESSED' || g.tipo !== 'OUTRA' || g.source === 'SERPRO') motivos.push('CLASSIFICACAO_FISCAL_A_CONCILIAR');
    if (g.parcelamentoId || g.numeroParcela || g.parcela || g.tributosParcela.length || g.composicoesParcelamento.length
      || g.extracted?.indicacaoParcelamentoId || g.extracted?.isParcelamento) motivos.push('VINCULO_PARCELAMENTO');
    if (g.accountingEntries.length || g.taxDocuments.length || g.lancamentoId || g.baixada || g.dataBaixa
      || g.extracted?.contabilizacaoPendente || g.extracted?.composicao?.length || g.extracted?.recalculoGuia
      || g.extracted?.numeroDocumento || g.extracted?.numeroDoc || g.extracted?.numeroDas
      || g.linhaDigitavel || g.linhaDigitavelValorLidoCentavos || g.serproService || g.serproLastCheckedAt) motivos.push('VINCULO_FISCAL_CONTABIL');
    if (g.paymentStatus === 'PAID' || g.paymentConfirmedAt || g.paymentConfirmedByUserId || g.clienteConfirmouEm
      || g.comprovantePdfFileId || g.extracted?.comprovante || await tx.arquivoWhatsapp.findFirst({ where: { comprovanteGuiaId: g.id }, select: { id: true } })) motivos.push('EVIDENCIA_PAGAMENTO');
    const terminais = ['enviado', 'entregue', 'lido', 'declarado_externo'];
    if (g.emailStatus === 'SENDING' || g.emailNextRetryAt || g.envios.some(e => !terminais.includes(e.status)
      || e.proximaTentativaEm || e.historicoTentativas.some(t => !terminais.includes(t.status)))) motivos.push('ENVIO_A_CONCILIAR');
    // Inclui tokens, confirmações e reservas legadas. Não reconstrói nem consome evidências.
    const referencias = await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE (strpos("value"::text, ${g.id}) > 0 OR strpos("key", ${g.id}) > 0) AND "key" NOT LIKE 'guia:entrega-externa:%' LIMIT 1`;
    if (referencias.length) motivos.push('OPERACAO_REFERENCIADA_A_CONCILIAR');
    const tarefas = await tx.manualTask.findFirst({ where: { status: 'running', companyIds: { array_contains: [g.portalClientId] } }, select: { id: true } });
    if (tarefas) motivos.push('TAREFA_EM_ANDAMENTO');
    // Não copia storage nem reinterpreta PDF remoto neste mecanismo administrativo mínimo.
    if (!g.pdfBytes?.length || Buffer.from(g.pdfBytes).subarray(0, 5).toString() !== '%PDF-' || !g.hash
      || sha(Buffer.from(g.pdfBytes)) !== g.hash) motivos.push('PDF_HASH_A_CONFERIR');
    return motivos;
  }
  async function previa(companyId, guideId, user) {
    await autorizar(db, companyId, user);
    const g = await carregar(db, companyId, guideId);
    const bloqueios = await impedimentos(db, g);
    return { companyId, guideId, competencia: g.competencia, tipo: g.tipo, hash: g.hash,
      revisao: revisaoReclassificacao(g), bloqueios, elegivel: bloqueios.length === 0,
      efeitos: ['Disponível em Documentos da mesma empresa.', 'Bloqueia tratamento como imposto; não confirma pagamento.', 'Preserva PDF, hash, mensagens e histórico de envios.'],
      envios: g.envios.map(e => ({ id: e.id, canal: e.canal, status: e.status, tentativas: e.historicoTentativas.length })) };
  }
  async function confirmar(companyId, guideId, user, body = {}) {
    const motivo = String(body.motivo || '').trim();
    if (body.confirmado !== true || motivo.length < 10 || motivo.length > 2000 || !CATEGORIAS.includes(body.categoria)
      || !/^[\w-]{8,100}$/.test(body.idempotencyKey || '') || !/^[a-f0-9]{64}$/.test(body.revisao || '')) throw erro('dados_invalidos', 'Confira categoria, motivo, revisão e confirmação explícita.', 400);
    return db.$transaction(async tx => {
      await autorizar(tx, companyId, user);
      let g = await carregar(tx, companyId, guideId);
      const lock = await tx.guide.updateMany({ where: { id: guideId, portalClientId: companyId, updatedAt: g.updatedAt }, data: { updatedAt: g.updatedAt } });
      if (lock.count !== 1) throw erro('GUIA_ALTERADA', 'Documento alterado. Atualize a prévia.');
      g = await carregar(tx, companyId, guideId);
      const key = `guia:reclassificacao:${guideId}:${body.idempotencyKey}`;
      const pedido = { companyId, guideId, atorId: user.id, motivo, categoria: body.categoria, revisao: body.revisao };
      const anterior = await tx.appSetting.findUnique({ where: { key } });
      if (anterior) {
        if (Object.keys(pedido).some(k => anterior.value.pedido?.[k] !== pedido[k])) throw erro('IDEMPOTENCIA_DIVERGENTE', 'Chave já usada para outra confirmação.');
        return { ok: true, repetido: true, documentId: anterior.value.documentId };
      }
      if (revisaoReclassificacao(g) !== body.revisao) throw erro('GUIA_ALTERADA', 'Documento alterado. Atualize a prévia.');
      const bloqueios = await impedimentos(tx, g);
      if (bloqueios.length) throw erro('RECLASSIFICACAO_BLOQUEADA', `Conciliação necessária: ${bloqueios.join(', ')}.`);
      const documentId = randomUUID();
      const prova = { pedido, documentId, registradoEm: agora().toISOString(), hash: g.hash,
        anterior: json({ status: g.status, extracted: g.extracted, liberadaCliente: g.liberadaCliente }),
        posterior: { status: STATUS_DOCUMENTO, liberadaCliente: false } };
      await tx.companyDocument.create({ data: { id: documentId, portalClientId: companyId, tipo: 'OUTRO',
        nome: `${body.categoria === 'FOLHA' ? 'Folha' : body.categoria === 'PRO_LABORE' ? 'Pró-labore' : 'Documento'}${g.competencia ? ` — ${g.competencia}` : ''}.pdf`,
        fileKey: `${PREFIXO_DOCUMENTO}${g.id}`, mimeType: 'application/pdf', bytes: g.pdfBytes.length, uploadedById: user.id } });
      const gravada = await tx.guide.updateMany({ where: { id: guideId, updatedAt: g.updatedAt, status: g.status }, data: {
        status: STATUS_DOCUMENTO, liberadaCliente: false,
        extracted: { ...(g.extracted || {}), documentoNaoArrecadatorio: { documentId, categoria: body.categoria, auditoriaKey: key, registradoEm: prova.registradoEm, atorId: user.id } },
      } });
      if (gravada.count !== 1) throw erro('GUIA_ALTERADA', 'Documento alterado. Atualize a prévia.');
      await tx.appSetting.create({ data: { key, value: prova } });
      return { ok: true, repetido: false, documentId };
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }
  return { previa, confirmar };
}
