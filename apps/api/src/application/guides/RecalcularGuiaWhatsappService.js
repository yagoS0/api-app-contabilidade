import { createHash, randomUUID } from 'node:crypto';
import { canGuideRecalculate, especieDoRecalculo, ESPECIE_RECALCULO, traduzirRecusaParaCliente } from './lib/recalculoDaGuia.js';
import { calendarioAvisosGuia, hojeSaoPaulo } from './calendarioAvisosGuia.js';
import { prepararGuiaPagamentoWhatsapp } from '../whatsapp/PrepararGuiaPagamentoWhatsapp.js';

export const PREFIXO_RECALCULO = 'altan.payment.recalculate.';
const recusar = () => Object.assign(new Error('Esta opção não está mais disponível. Solicite a atualização ao escritório.'), { code: 'RECALCULO_RECUSADO' });

export async function recalcularGuiaNoServico(guia, contato, client) {
  const { comContextoSerpro } = await import('../fiscal/serpro/serproCallContext.js');
  const { registrarRecalculoGuia } = await import('./RegistroRecalculoGuia.js');
  const { markGuideOpenBySerpro } = await import('./GuidePaymentStatusService.js');
  const especie = especieDoRecalculo(guia);
  let id = guia.id;
  await comContextoSerpro({ origem: 'whatsapp:recalcular', userId: contato.userId || null, forcar: false }, async () => {
    if (especie === ESPECIE_RECALCULO.DARF_PRESUMIDO) {
      const { reemitirDarfLp } = await import('../fiscal/lp/LucroPresumidoProvisaoService.js');
      await reemitirDarfLp({ portalClientId: guia.portalClientId, competencia: guia.competencia, guideId: guia.id });
    } else {
      const { capturePgdasGuideForCompany } = await import('../fiscal/serpro/CaptureSerproGuidesService.js');
      const { SERPRO_PGDASD_SERVICE_COBRANCA } = await import('../fiscal/serpro/SerproPgdasdService.js');
      const r = await capturePgdasGuideForCompany({ portalClientId: guia.portalClientId, competencia: guia.competencia, existingGuideId: guia.id, serviceId: SERPRO_PGDASD_SERVICE_COBRANCA });
      id = r.guide.guideId;
    }
  });
  await registrarRecalculoGuia(client, { guiaAnterior: guia, guiaId: id, especie, userId: contato.userId });
  await markGuideOpenBySerpro({ guideId: id });
  return client.guide.findFirst({ where: { id, portalClientId: guia.portalClientId, competencia: guia.competencia } });
}

// O botão já autoriza a operação identificada. Reserva antes do provedor, sem repetir custo após timeout/crash.
export async function recalcularGuiaWhatsapp({ id, conversa, mensagem, client, cloud, enviar, conferirAcesso, agora = new Date() },
  { recalcular = recalcularGuiaNoServico, carregarPdf = null, prepararPagamento = prepararGuiaPagamentoWhatsapp } = {}) {
  if (!String(id || '').startsWith(PREFIXO_RECALCULO)) return null;
  const texto = async (corpo, sufixo) => enviar({ corpo, idTurno: `recalculo:${mensagem.id}:${sufixo}`, chamada: () => cloud.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo }) });
  let reserva = null;
  let iniciouRecalculo = false;
  try {
    if (!/^altan\.payment\.recalculate\.[0-9a-f-]{36}$/.test(id) || !conversa.portalClientId || mensagem.direcao !== 'in' || mensagem.conversaId !== conversa.id) throw recusar();
    const token = (await client.appSetting.findUnique({ where: { key: id } }))?.value;
    if (!token || token.companyId !== conversa.portalClientId || token.telefone !== conversa.telefoneE164 || !(Date.parse(token.expiraEm) > agora.getTime())) throw recusar();
    const contatoAtual = async () => {
      await conferirAcesso();
      const contato = await client.contatoWhatsapp.findFirst({ where: { id: token.contatoId, portalClientId: token.companyId, telefoneE164: token.telefone, ativo: true, optInEm: { not: null } } });
      if (!contato) throw recusar();
      return contato;
    };
    const conferirGuia = async (guideId, hash) => {
      await contatoAtual();
      const g = await client.guide.findFirst({ where: { id: guideId, portalClientId: token.companyId, competencia: token.competencia, liberadaCliente: true, status: 'PROCESSED' } });
      if (!g || g.baixada || g.clienteConfirmouEm || g.paymentStatus === 'PAID' || (g.hash || null) !== (hash || null)) throw recusar();
      return g;
    };
    const guia = await conferirGuia(token.guideId, token.hash);
    const company = await client.portalClient.findUnique({ where: { id: token.companyId }, select: { municipio: true } });
    const feriados = await client.feriado.findMany({});
    const vencimento = calendarioAvisosGuia(guia.vencimento, feriados, company?.municipio)?.vencimento;
    if (!canGuideRecalculate(guia) || !vencimento || vencimento >= hojeSaoPaulo(agora)) throw recusar();
    const key = 'recalculo_whatsapp:' + createHash('sha256').update(JSON.stringify([token.companyId, guia.id, guia.hash || null, guia.vencimento])).digest('hex');
    const value = { status: 'RESERVADO', guideId: guia.id, companyId: token.companyId, mensagemId: mensagem.id, criadoEm: agora.toISOString() };
    try { await client.appSetting.create({ data: { key, value } }); reserva = { key, value }; }
    catch (e) {
      if (e.code !== 'P2002') throw e;
      await texto('Esta atualização já foi solicitada. Confira as mensagens desta conversa; se a guia ainda não chegou, o escritório verificará o pedido.', 'repetido');
      return { tratado: true, acao: 'RECALCULAR_GUIA', repetido: true };
    }
    await texto('Aguarde em quanto recalculamos.', 'aguarde');
    await conferirGuia(token.guideId, token.hash);
    const contato = await contatoAtual();
    iniciouRecalculo = true;
    const atualizada = await recalcular(guia, contato, client);
    if (!atualizada?.id) throw recusar();
    const nova = await conferirGuia(atualizada.id, atualizada.hash);
    const pdf = carregarPdf ? await carregarPdf(nova) : await (await import('./GuideService.js')).getGuidePdfBuffer(nova);
    if (!pdf?.length) throw Object.assign(new Error('PDF atualizado indisponível.'), { code: 'GUIA_SEM_PDF' });
    const nomeArquivo = `${nova.tipo} ${nova.competencia}.pdf`.replace(/[\\/]+/g, '-');
    await conferirGuia(nova.id, nova.hash);
    const pagamento = await prepararPagamento({ guide: nova, conteudoPdf: pdf, conversa, referencia: key, conferir: () => conferirGuia(nova.id, nova.hash) }, { client });
    await enviar({ tipo: 'interactive', corpo: `Guia atualizada — ${nova.tipo}, ${nova.competencia}`, idTurno: `${key}:pdf`,
      chamada: async () => {
        await conferirGuia(nova.id, nova.hash);
        return cloud.enviarGuiaComPagamento({ telefone: conversa.telefoneE164, conteudoPdf: pdf, nomeArquivo, ...pagamento });
      } });
    const botaoConfirmacao = 'altan.payment.confirm.' + randomUUID();
    await client.appSetting.create({ data: { key: botaoConfirmacao, value: { companyId: token.companyId, guideId: nova.id,
      competencia: nova.competencia || null, hash: nova.hash || null, contatoId: token.contatoId, telefone: token.telefone,
      expiraEm: new Date(agora.getTime() + 7 * 86400000).toISOString() } } });
    const codigo = { status: 'ENVIADO', formato: 'PDF_E_CODIGO_NA_MESMA_MENSAGEM' };
    await enviar({ tipo: 'interactive', corpo: 'Quando pagar esta guia, toque em Confirmar pagamento para informar a data.', idTurno: `${key}:confirmar`,
      chamada: async () => { await conferirGuia(nova.id, nova.hash); return cloud.enviarBotoes({ telefone: conversa.telefoneE164,
        texto: 'Quando pagar esta guia, toque em Confirmar pagamento para informar a data.', botoes: [{ id: botaoConfirmacao, titulo: 'Confirmar pagamento' }] }); } });
    await client.appSetting.update({ where: { key }, data: { value: { ...value, status: codigo.status === 'ENVIADO' ? 'ENVIADO' : 'PARCIAL', guiaAtualizadaId: nova.id, codigo } } });
    return { tratado: true, acao: 'RECALCULAR_GUIA', codigo };
  } catch (e) {
    if (reserva) await client.appSetting.update({ where: { key: reserva.key }, data: { value: { ...reserva.value, status: iniciouRecalculo ? 'CONFERENCIA_NECESSARIA' : 'FALHOU', motivo: e.code || e.codigo || 'RECALCULO_FALHOU' } } });
    const resposta = e.code === 'RECALCULO_RECUSADO' ? e.message : iniciouRecalculo
      ? 'Não consegui concluir a entrega da guia atualizada. O escritório precisa conferir este pedido antes de uma nova tentativa.'
      : traduzirRecusaParaCliente(e).mensagem;
    await texto(resposta, 'falha');
    return { tratado: true, acao: 'RECALCULAR_GUIA', pendente: true };
  }
}
