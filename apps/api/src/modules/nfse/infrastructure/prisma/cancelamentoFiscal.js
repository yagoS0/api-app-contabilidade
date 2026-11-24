import { prisma as clientePadrao } from '../../../../infrastructure/db/prisma.js';
import { createHash, randomUUID } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { isDeepStrictEqual } from 'node:util';
import { decidirConfirmacaoFiscalCancelamento } from '../../domain/confirmacaoFiscalCancelamento.js';

const conflito = () => Object.assign(new Error('O estado do cancelamento mudou. Consulte a nota antes de continuar.'), { code: 'NFSE_CANCELAMENTO_CONCORRENTE', antesDoPost: true });
export function chaveReservaCancelamento({ companyId, ambiente, chaveAcesso }) {
  return 'nfse_cancelamento_fiscal:' + createHash('sha256').update(JSON.stringify([companyId, ambiente, chaveAcesso])).digest('hex');
}

export function criarPersistenciaCancelamento(prisma = clientePadrao, { aposConfirmacao = async () => {} } = {}) {
  async function cas(tx, reserva, value) {
    const r = await tx.appSetting.updateMany({ where: { key: reserva.key, value: { equals: reserva.value } }, data: { value } });
    if (r.count !== 1) throw conflito();
    return value;
  }
  async function conferirIdentidade(value) {
    const company = await prisma.company.findUnique({ where: { id: value.companyId }, select: { cnpj: true } });
    if (!company || String(company.cnpj).replace(/\D/g, '') !== value.cnpj) throw conflito();
    const notas = await prisma.serviceInvoice.findMany({ where: { companyId: value.companyId, chaveAcesso: value.chaveAcesso }, take: 2 });
    if (notas.length > 1) throw conflito();
    let xml;
    if (notas.length) {
      const nota = notas[0];
      if (value.invoiceId !== nota.id || value.invoiceStatus !== nota.status || value.invoiceUpdatedAt !== nota.updatedAt.toISOString()) throw conflito();
      if (!['issued', 'authorized', 'autorizado', 'cancelled', 'cancelled_substitution'].includes(nota.status)) throw conflito();
      xml = nota.xml || nota.xmlDps;
    } else {
      const portal = await prisma.portalClient.findUnique({ where: { companyId: value.companyId }, select: { id: true } });
      if (!portal || portal.id !== value.portalClientId) throw conflito();
      const nota = await prisma.portalInvoice.findFirst({ where: { clientId: portal.id, chaveAcesso: value.chaveAcesso, type: 'NFSE', papel: 'EMIT' } });
      if (!nota || String(nota.emitenteDoc).replace(/\D/g, '') !== value.cnpj || nota.id !== value.portalInvoiceId || nota.updatedAt.toISOString() !== value.portalUpdatedAt) throw conflito();
      xml = nota.xmlRaw;
    }
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw conflito();
    let invalid = false;
    const doc = new DOMParser({ errorHandler: { warning() { invalid = true; }, error() { invalid = true; }, fatalError() { invalid = true; } } }).parseFromString(xml, 'application/xml');
    const ambientes = new Set(Array.from(doc.getElementsByTagNameNS('http://www.sped.fazenda.gov.br/nfse', 'tpAmb')).map(n => n.textContent.trim()));
    if (invalid || ambientes.size !== 1 || !ambientes.has(value.ambiente === 'producao' ? '1' : '2')) throw conflito();
  }
  return {
    async reservar(contexto) {
      const { companyId, chaveAcesso, ambiente } = contexto;
      const key = chaveReservaCancelamento(contexto);
      const antiga = await prisma.appSetting.findUnique({ where: { key } });
      if (antiga) return { key, value: antiga.value, nova: false };
      const notas = await prisma.serviceInvoice.findMany({ where: { companyId, chaveAcesso }, take: 2 });
      if (notas.length > 1) throw conflito();
      const portal = await prisma.portalClient.findUnique({ where: { companyId }, select: { id: true } });
      let legadoIncerto = false;
      if (portal) {
        const legadoKey = 'nfse_cancelamento_whatsapp:' + createHash('sha256').update(JSON.stringify([String(portal.id), String(chaveAcesso)])).digest('hex');
        const legado = await prisma.appSetting.findUnique({ where: { key: legadoKey } });
        legadoIncerto = Boolean(legado && legado.value?.status !== 'RECUSADO' && legado.value?.acaoId !== contexto.acaoId);
        const acaoAnterior = await prisma.acaoPendenteWhatsapp.findFirst({ where: { portalClientId: portal.id, tipo: 'CANCELAR_NFSE', payload: { path: ['chaveAcesso'], equals: chaveAcesso }, ...(contexto.acaoId ? { id: { not: contexto.acaoId } } : {}), OR: [{ status: 'confirmada' }, { status: 'executada', resultado: { path: ['indeterminado'], equals: true } }, { status: 'executada', resultado: { path: ['status'], equals: 'accepted' } }, { status: 'executada', resultado: { path: ['confirmacaoFiscal'], equals: true } }] } });
        legadoIncerto ||= Boolean(acaoAnterior);
      }
      const nota = notas[0];
      const portalNota = !nota && portal ? await prisma.portalInvoice.findFirst({ where: { clientId: portal.id, chaveAcesso, type: 'NFSE', papel: 'EMIT' } }) : null;
      legadoIncerto ||= /cancel|substitu/i.test(String(nota?.status || portalNota?.statusEfetivo || portalNota?.status || ''));
      const value = { versao: 1, companyId, chaveAcesso, ambiente, cnpj: String(contexto.cnpj).replace(/\D/g, ''), portalClientId: portal?.id || null, portalInvoiceId: portalNota?.id || null, portalUpdatedAt: portalNota?.updatedAt?.toISOString() || null, token: randomUUID(), status: legadoIncerto ? 'INCERTO_LEGADO' : 'RESERVADO', criadoEm: new Date().toISOString(), invoiceId: nota?.id || null, invoiceStatus: nota?.status || null, invoiceUpdatedAt: nota?.updatedAt?.toISOString() || null };
      await conferirIdentidade(value);
      try { await prisma.appSetting.create({ data: { key, value } }); }
      catch (erro) { if (erro.code !== 'P2002') throw erro; const atual = await prisma.appSetting.findUnique({ where: { key } }); return { key, value: atual.value, nova: false }; }
      return { key, value, nova: !legadoIncerto };
    },
    async marcarDespacho(reserva) {
      await conferirIdentidade(reserva.value);
      reserva.value = await cas(prisma, reserva, { ...reserva.value, status: 'DESPACHADO', despachadoEm: new Date().toISOString() });
    },
    async registrarFalha(reserva, falha) {
      const atual = await prisma.appSetting.findUnique({ where: { key: reserva.key } });
      if (!atual || atual.value.status === 'CONFIRMADO') return;
      const r = await prisma.appSetting.updateMany({ where: { key: reserva.key, value: { equals: reserva.value } }, data: { value: { ...reserva.value, status: falha.incerto ? 'INCERTO' : 'NAO_ENVIADO', falha, atualizadoEm: new Date().toISOString() } } });
      return r.count === 1;
    },
    async registrarResultado(reserva, contexto, evidencia, decisao) {
      if (reserva.value.companyId !== contexto.companyId || reserva.value.chaveAcesso !== contexto.chaveAcesso || reserva.value.ambiente !== contexto.ambiente) throw conflito();
      const recebidos = evidencia?.evidencias || (evidencia ? [evidencia] : []);
      if (!Array.isArray(recebidos) || recebidos.length > 100) throw conflito();
      const eventos = [...new Map(recebidos.map(e => [`${e?.id}:${e?.hash}`, e])).values()]
        .sort((a, b) => `${a?.id}:${a?.hash}`.localeCompare(`${b?.id}:${b?.hash}`));
      if (!Array.isArray(eventos) || eventos.length > 100) throw conflito();
      let volume = 0;
      for (const evento of eventos) {
        if (decidirConfirmacaoFiscalCancelamento(evento, contexto).situacao === 'INCONCLUSIVO'
          || typeof evento.xml !== 'string' || Buffer.byteLength(evento.xml) > 2_000_000
          || evento.hash !== createHash('sha256').update(evento.xml).digest('hex')) throw conflito();
        volume += Buffer.byteLength(evento.xml);
      }
      if (volume > 8_000_000) throw conflito();
      decisao = decidirConfirmacaoFiscalCancelamento(evidencia, contexto);
      const decisaoAtual = decisao;
      // Diagnóstico sem XML rejeitado, idempotente por conjunto; sobrevive ao CAS perdido.
      const observacao = { hashes: [...new Set(eventos.map(e => e.hash))].sort(), problemas: evidencia?.problemas || [], completa: evidencia?.completa ?? Boolean(evidencia), decisao };
      if (!Array.isArray(observacao.problemas) || observacao.problemas.length > 100
        || observacao.problemas.some(p => typeof p !== 'string' || p.length > 200)) throw conflito();
      const observacaoKey = `${reserva.key}:observacao:${createHash('sha256').update(JSON.stringify(observacao)).digest('hex')}`;
      // Custódia e revisão da reserva são atômicas. Toda nova observação invalida
      // uma projeção concorrente que tenha lido o histórico anterior.
      const custodia = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = ${reserva.key} FOR UPDATE`;
        const atual = await tx.appSetting.findUnique({ where: { key: reserva.key } });
        if (!atual || atual.value.companyId !== contexto.companyId || atual.value.chaveAcesso !== contexto.chaveAcesso
          || atual.value.ambiente !== contexto.ambiente) throw conflito();
        const obsoleta = !isDeepStrictEqual(atual.value, reserva.value);
        for (const evento of eventos) {
          const evidenceKey = `${reserva.key}:evento:${evento.hash}`;
          await tx.appSetting.upsert({ where: { key: evidenceKey }, create: { key: evidenceKey, value: { ...evento, recebidoEm: new Date().toISOString() } }, update: {} });
        }
        await tx.appSetting.upsert({ where: { key: observacaoKey }, create: { key: observacaoKey, value: { ...observacao, recebidoEm: new Date().toISOString() } }, update: {} });
        const revisao = atual.value.revisaoEvidencias ?? 0;
        if (!Number.isSafeInteger(revisao) || revisao < 0 || revisao >= Number.MAX_SAFE_INTEGER) throw conflito();
        const value = { ...atual.value, revisaoEvidencias: revisao + 1 };
        await tx.appSetting.update({ where: { key: reserva.key }, data: { value } });
        return { value, obsoleta };
      });
      if (custodia.obsoleta) throw conflito();
      reserva.value = custodia.value;
      let proximoValor;
      const invoice = await prisma.$transaction(async (tx) => {
        const corrente = await tx.appSetting.findUnique({ where: { key: reserva.key } });
        // Uma resposta posterior não apaga um indeferimento/pedido anterior sem correlação.
        const historico = await tx.appSetting.findMany({ where: { key: { startsWith: `${reserva.key}:evento:` } }, take: 101 });
        const historicoValido = historico.map(e => e.value);
        const decisaoHistorica = decidirConfirmacaoFiscalCancelamento({ evidencias: historicoValido, completa: observacao.completa && historico.length <= 100 }, contexto);
        // Ausência ou resposta parcial atual não sana uma evidência histórica
        // anteriormente incompleta. Exige nova comprovação conclusiva atual.
        decisao = decisaoAtual.situacao === 'INCONCLUSIVO' ? decisaoAtual
          : decisaoHistorica.cancelada && !decisaoAtual.cancelada
            ? { situacao: 'INCONCLUSIVO', cancelada: false, motivo: 'SEM_COMPROVACAO_CONCLUSIVA_ATUAL' }
            : decisaoHistorica;
        if (corrente?.value.status === 'CONFIRMADO') {
          if (!decisao.cancelada) throw conflito();
          return corrente.value.invoiceId ? tx.serviceInvoice.findFirst({ where: { id: corrente.value.invoiceId, companyId: contexto.companyId, chaveAcesso: contexto.chaveAcesso } }) : null;
        }
        const julgamento = { observacaoKey, hashes: historico.map(e => e.value.hash).sort(), decisao };
        const julgamentoKey = `${reserva.key}:decisao:${createHash('sha256').update(JSON.stringify(julgamento)).digest('hex')}`;
        await tx.appSetting.upsert({ where: { key: julgamentoKey }, create: { key: julgamentoKey, value: { ...julgamento, registradoEm: new Date().toISOString() } }, update: {} });
        let atualizada = null;
        if (decisao.cancelada && reserva.value.invoiceId) {
          const atual = await tx.serviceInvoice.findFirst({ where: { id: reserva.value.invoiceId, companyId: contexto.companyId, chaveAcesso: contexto.chaveAcesso } });
          if (!atual) throw conflito();
          if (atual.status !== 'cancelled') {
            if (atual.status !== reserva.value.invoiceStatus || atual.updatedAt.toISOString() !== reserva.value.invoiceUpdatedAt) throw conflito();
            const r = await tx.serviceInvoice.updateMany({ where: { id: atual.id, companyId: contexto.companyId, chaveAcesso: contexto.chaveAcesso, status: atual.status, updatedAt: atual.updatedAt }, data: { status: 'cancelled', ...(contexto.ambiente === 'producao' ? { revisaoPeriodoPendente: true } : {}) } });
            if (r.count !== 1) throw conflito();
          }
          atualizada = await tx.serviceInvoice.findUnique({ where: { id: atual.id } });
        }
        proximoValor = await cas(tx, reserva, { ...reserva.value, status: decisao.situacao, eventoHash: eventos.length === 1 ? eventos[0].hash : null, eventoHashes: historico.map(e => e.value.hash).sort(), decisao, observacaoKey, atualizadoEm: new Date().toISOString() });
        return atualizada;
      });
      if (proximoValor) reserva.value = proximoValor;
      if (invoice && proximoValor) await aposConfirmacao(invoice, prisma);
      return { invoice, decisao, evidencias: eventos };
    },
  };
}
