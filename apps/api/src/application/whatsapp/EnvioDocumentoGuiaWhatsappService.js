import { createHash } from 'node:crypto';
import { registrarEnvio, materializarEnvioDeEmailLegado, marcarEnviando, marcarEnviado, marcarFalhou, marcarIndeterminado } from '../guides/EnvioGuiaService.js';
import { versaoPagamentoGuia } from '../guides/ConfirmacaoPagamentoClienteService.js';
import { prepararHistoricoGuia } from './HistoricoArquivoWhatsappService.js';

const erro = (code, message) => Object.assign(new Error(message), { code });
export const revisaoDocumentoGuia = g => createHash('sha256').update(JSON.stringify([
  versaoPagamentoGuia(g), g.vencimento ? new Date(g.vencimento).toISOString() : null,
])).digest('hex');

// Uma entrada recebida autoriza uma intenção por guia e destinatário. A chave não
// inclui a revisão: replay após recálculo também não pode iniciar outra saída.
export async function enviarDocumentoGuiaWhatsapp({ conversa, documento, client, antesDeEnviar, registrarSaida }, deps = {}) {
  const { guideId, mensagemEntradaId, conteudo, nomeArquivo, revisao } = documento;
  if (!guideId || !mensagemEntradaId || !conversa.portalClientId || !conversa.telefoneE164 || !antesDeEnviar)
    throw erro('GUIA_ENVIO_SEM_ORIGEM', 'A solicitação da guia precisa de origem e acesso verificados.');
  const conferirEntrada = async () => {
    const { carregarMensagemResolvida } = await import('./AtendimentoResponsavelWhatsappService.js');
    // Uma seleção empresarial hidrata a entrada pelo recibo validado. A mensagem
    // original permanece no segmento de origem; nunca movê-la para liberar envio.
    const { mensagem: entrada } = await carregarMensagemResolvida({ conversa, mensagemId: mensagemEntradaId, client });
    if (!entrada || entrada.direcao !== 'in' || entrada.conversaId !== conversa.id)
      throw erro('GUIA_ENVIO_SEM_ORIGEM', 'A solicitação não pertence a esta conversa.');
  };
  const conferir = async () => {
    await antesDeEnviar();
    await conferirEntrada();
    const g = await client.guide.findFirst({ where: { id: guideId, portalClientId: conversa.portalClientId, liberadaCliente: true, status: 'PROCESSED' } });
    if (!g || !g.hash || !revisao || revisaoDocumentoGuia(g) !== revisao
      || g.extracted?.conferenciaDocumentoPendente === true)
      throw erro('GUIA_ALTERADA', 'A guia mudou ou precisa de conferência. Solicite novamente após a revisão.');
    if (createHash('sha256').update(conteudo).digest('hex') !== g.hash)
      throw erro('GUIA_PDF_DIVERGENTE', 'O PDF não corresponde à revisão da guia.');
    return g;
  };
  const guide = await conferir();
  const key = 'guia_documento_whatsapp:' + createHash('sha256').update(JSON.stringify([
    conversa.id, conversa.portalClientId, conversa.telefoneE164, mensagemEntradaId, guideId,
  ])).digest('hex');
  const value = { status: 'RESERVADO', guideId, mensagemEntradaId, conversaId: conversa.id, revisao };
  try { await client.appSetting.create({ data: { key, value } }); }
  catch (e) {
    if (e.code !== 'P2002') throw e;
    // Mesmo aceito não é nova autorização de transporte. O chamador não anuncia
    // novo envio nem dispara confirmação após replay ou resultado incerto.
    throw erro('GUIA_INTENCAO_JA_RESERVADA', 'Este pedido já foi processado ou precisa de conciliação. Confira o histórico antes de repetir.');
  }
  let envioId, tentativaId, wamid;
  try {
    await materializarEnvioDeEmailLegado(guide, client);
    // Reenvio estritamente vinculado à nova entrada reservada acima; nunca usado
    // pelo lote inicial nem para outros destinos. Indeterminado continua travado.
    const registro = await registrarEnvio({ guideId, canal: 'WHATSAPP', destino: conversa.telefoneE164, reenviar: true, tx: client });
    if (registro.emAndamento || registro.jaEnviado) throw erro('GUIA_ENVIO_EM_ANDAMENTO', 'Confira a tentativa anterior antes de enviar esta guia.');
    envioId = registro.envio.id;
    const reserva = await marcarEnviando(envioId, client);
    if (!reserva.reservado) throw erro('GUIA_ENVIO_EM_ANDAMENTO', 'Outra saída já reservou esta guia.');
    tentativaId = reserva.tentativaId;
    await (deps.prepararHistorico || prepararHistoricoGuia)({ tentativaId, envioGuiaId: envioId, guide, conversa,
      contato: { telefoneE164: conversa.telefoneE164 }, canal: {}, variaveis: [], nomeArquivo,
      conteudoPdf: conteudo, tipoLabel: guide.tipo, criarMensagem: false, tipoMensagem: documento.tipoMensagem || 'document', revisaoDocumento: revisao }, { client });
    const r = await registrarSaida({ antesDeEnviar: conferir,
      vinculoGuia: { envioGuiaId: envioId, envioGuiaTentativaId: tentativaId },
      // Preservar a correlação antes de qualquer escrita posterior ao transporte.
      aoAceitar: async resultado => {
        wamid = resultado.wamid;
        await marcarEnviado({ envioId, tentativaId, providerMessageId: wamid }, client);
      },
    });
    await client.appSetting.update({ where: { key }, data: { value: { ...value, status: 'ENVIADO', envioId, tentativaId, providerMessageId: r.wamid } } });
    return r;
  } catch (e) {
    if (tentativaId) {
      if (e.indeterminado || wamid) await marcarIndeterminado({ envioId, tentativaId, providerMessageId: wamid, mensagemUsuario: 'Confira o histórico antes de reenviar.' }, client);
      else await marcarFalhou({ envioId, tentativaId, codigo: e.code || e.codigo || 'GUIA_ENVIO_FALHOU', mensagemUsuario: 'A saída da guia não foi concluída.' }, client);
    }
    await client.appSetting.update({ where: { key }, data: { value: { ...value, status: e.indeterminado || wamid ? 'INDETERMINADO' : 'FALHOU', envioId: envioId || null, tentativaId: tentativaId || null } } });
    throw e;
  }
}
