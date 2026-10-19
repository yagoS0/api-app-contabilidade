import { createHash, randomUUID } from 'node:crypto';
import { gerarDanfseDaNota } from '../nfse/danfse/danfseDaNotaDoPortal.js';
import { enviarMensagemRastreada } from './SaidaWhatsappService.js';
import { carregarMensagemResolvida } from './AtendimentoResponsavelWhatsappService.js';
import { salvarArquivoManual } from './HistoricoArquivoWhatsappService.js';

const falha = codigo => Object.assign(new Error('O DANFSe precisa de conferência no histórico. Não emita outra nota.'), { codigo });
export const emissaoConfirmada = resultado => resultado?.status === 'issued' && resultado.indeterminado !== true && Boolean(resultado.nfseId);

// A revisão inclui todas as fontes locais usadas para XML, identidade e marca d'água.
// Não consulta o autorizador e não infere uma situação fiscal nova.
async function revisaoDanfse({ conversa, notaId, client }) {
  const nota = await client.portalInvoice.findFirst({ where: { id: notaId, clientId: conversa.portalClientId },
    select: { id: true, numero: true, chaveAcesso: true, chaveSubstituida: true, status: true, statusEfetivo: true, xmlRaw: true } });
  let fonte;
  if (nota) {
    const eventos = await client.portalInvoiceEvent.findMany({ where: { clientId: conversa.portalClientId, invoiceId: nota.id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], select: { type: true, chaveSubstituta: true } });
    const substituta = nota.chaveAcesso ? await client.portalInvoice.findFirst({ where: { clientId: conversa.portalClientId, chaveSubstituida: nota.chaveAcesso }, select: { chaveAcesso: true } }) : null;
    fonte = { nota, eventos, substituta };
  } else {
    const portal = await client.portalClient.findUnique({ where: { id: conversa.portalClientId }, select: { companyId: true } });
    const nossa = portal?.companyId ? await client.serviceInvoice.findFirst({ where: { id: notaId, companyId: portal.companyId },
      select: { id: true, numeroNfse: true, chaveAcesso: true, status: true, xml: true } }) : null;
    if (!nossa) throw falha('DANFSE_NOTA_NAO_ENCONTRADA');
    fonte = { companyId: portal.companyId, nossa };
  }
  return createHash('sha256').update(JSON.stringify(fonte)).digest('hex');
}

// Esta reserva pertence à entrega, nunca à emissão. Um processo interrompido ou
// resultado externo desconhecido não permite outro POST, mesmo com nova entrada.
export async function enviarDanfseWhatsapp({ conversa, notaId, acaoId = null, mensagemEntradaId, client, cloud,
  conferirAcesso, gerar = gerarDanfseDaNota, autor = 'SISTEMA', turnoIaId = null }) {
  if (!conversa?.id || !conversa.portalClientId || !notaId || !mensagemEntradaId || typeof conferirAcesso !== 'function') throw falha('DANFSE_SEM_ORIGEM');
  const conferirOrigem = async () => {
    await conferirAcesso();
    const { mensagem } = await carregarMensagemResolvida({ conversa, mensagemId: mensagemEntradaId, client });
    if (!mensagem || mensagem.conversaId !== conversa.id || mensagem.direcao !== 'in') throw falha('DANFSE_SEM_ORIGEM');
    if (acaoId) {
      const acao = await client.acaoPendenteWhatsapp.findUnique({ where: { id: acaoId } });
      if (!acao || acao.conversaId !== conversa.id || acao.portalClientId !== conversa.portalClientId
        || acao.status !== 'executada' || !emissaoConfirmada(acao.resultado) || acao.resultado.nfseId !== notaId) throw falha('DANFSE_ACAO_INVALIDA');
    }
  };
  await conferirOrigem();
  const key = 'danfse_whatsapp:' + createHash('sha256').update(JSON.stringify([conversa.id, conversa.portalClientId, conversa.telefoneE164, notaId])).digest('hex');
  const pedidoKey = key + ':' + createHash('sha256').update(acaoId || mensagemEntradaId).digest('hex');
  const recibo = await client.appSetting.findUnique({ where: { key: pedidoKey } });
  if (recibo?.value?.providerMessageId) return { wamid: recibo.value.providerMessageId, recuperado: true };
  const value = { status: 'RESERVADO', token: randomUUID(), conversaId: conversa.id, portalClientId: conversa.portalClientId,
    notaId, acaoId, mensagemEntradaId, criadoEm: new Date().toISOString() };
  try { await client.appSetting.create({ data: { key, value } }); }
  catch (e) {
    if (e.code !== 'P2002') throw e;
    const anterior = await client.appSetting.findUnique({ where: { key } });
    const mesmoPedido = acaoId ? anterior?.value?.acaoId === acaoId : anterior?.value?.mensagemEntradaId === mensagemEntradaId;
    if (anterior?.value?.status === 'ENVIADO' && anterior.value.providerMessageId && mesmoPedido) return { wamid: anterior.value.providerMessageId, recuperado: true };
    // Falha antes do POST ou recusa comprovada permite recuperar somente a entrega.
    if (!['FALHOU_ANTES_ENVIO', 'RECUSADO', 'ENVIADO'].includes(anterior?.value?.status)) throw falha('DANFSE_ENTREGA_A_CONFERIR');
    const reserva = await client.appSetting.updateMany({ where: { key, value: { equals: anterior.value } }, data: { value } });
    if (reserva.count !== 1) throw falha('DANFSE_ENTREGA_A_CONFERIR');
  }
  let revisao = null;
  let iniciouTransporte = false;
  let providerMessageId = null;
  const salvar = async campos => {
    const proximo = { ...value, ...campos };
    const alterada = await client.appSetting.updateMany({ where: { key, value: { equals: value } }, data: { value: proximo } });
    if (alterada.count !== 1) throw falha('DANFSE_RESERVA_ALTERADA');
    Object.assign(value, proximo);
  };
  const conferir = async () => {
    await conferirOrigem();
    const reserva = await client.appSetting.findUnique({ where: { key } });
    if (reserva?.value?.token !== value.token) throw falha('DANFSE_RESERVA_ALTERADA');
    if (revisao && revisao !== await revisaoDanfse({ conversa, notaId, client })) throw falha('DANFSE_REVISAO_ALTERADA');
  };
  try {
    await conferir();
    revisao = await revisaoDanfse({ conversa, notaId, client });
    const pdf = await gerar({ portalClientId: conversa.portalClientId, notaId, client });
    const conteudo = pdf.pdf || pdf.conteudo;
    await salvar({ revisaoDocumento: revisao, arquivoSha256: createHash('sha256').update(conteudo).digest('hex'), nomeArquivo: pdf.nomeArquivo });
    const enviada = await enviarMensagemRastreada({ conversa, tipo: 'document', corpo: `DANFSe da nota ${notaId}`, autor, turnoIaId, client,
      contextoConsulta: { tipo: 'DANFSE', notaId, acaoId, reserva: key, arquivoSha256: value.arquivoSha256 },
      antesDeEnviar: conferir,
      aposRegistrar: async mensagem => {
        await salvarArquivoManual({ mensagem, conversa, buffer: conteudo, nomeArquivo: pdf.nomeArquivo, mimeType: 'application/pdf' }, { client });
        await salvar({ mensagemId: mensagem.id });
      },
      enviar: async ({ antesDeEnviar: conferirSaida }) => {
        await conferirSaida();
        iniciouTransporte = true;
        return cloud.enviarDocumento({ telefone: conversa.telefoneE164, conteudo, nomeArquivo: pdf.nomeArquivo,
          legenda: 'DANFSe da sua nota fiscal.', mimeType: 'application/pdf', antesDeEnviar: conferirSaida });
      },
      aoAceitar: async r => { providerMessageId = r.wamid; await salvar({ status: 'ACEITO', providerMessageId }); },
    });
    await client.appSetting.upsert({ where: { key: pedidoKey }, create: { key: pedidoKey, value: { ...value } }, update: {} });
    await salvar({ status: 'ENVIADO' });
    return enviada;
  } catch (e) {
    // Se a gravação posterior falhar, preservar a aceitação; nunca repetir o envio.
    const status = providerMessageId ? 'ACEITO'
      : !iniciouTransporte || e.mensagemNaoEnviada === true ? 'FALHOU_ANTES_ENVIO'
        : e.indeterminado === false ? 'RECUSADO' : 'INDETERMINADO';
    await salvar({ status,
      providerMessageId, codigo: e.codigo || e.code || 'DANFSE_ENTREGA_FALHOU' });
    throw e;
  }
}
