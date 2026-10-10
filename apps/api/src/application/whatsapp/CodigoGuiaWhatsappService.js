import { prisma } from '../../infrastructure/db/prisma.js';
import { createHash } from 'node:crypto';
import { lerLinhaDigitavelDoPdf } from '../guides/lerLinhaDigitavelDoPdf.js';
import { enviarMensagemRastreada } from './SaidaWhatsappService.js';
import { janelaDaConversa } from './ConversaWhatsappService.js';
import { templateOperacional } from './TemplateOperacionalWhatsapp.js';

export async function enviarCodigoGuiaWhatsapp({ guide, conteudoPdf, conversa, cloud, chave, botaoConfirmacao = null, conferir = async () => {} },
  { client = prisma, ler = lerLinhaDigitavelDoPdf, janela = janelaDaConversa, enviar = enviarMensagemRastreada } = {}) {
  const leitura = guide.linhaDigitavelLidaEm ? guide : await ler(conteudoPdf, { valorTotal: guide.valor, vencimento: guide.vencimento });
  if (!leitura.linhaDigitavel || leitura.linhaDigitavelMotivo) return { status: 'PENDENTE', motivo: 'LINHA_DIGITAVEL_INDISPONIVEL' };
  const codigo = leitura.linhaDigitavel;
  const anterior = await client.mensagemWhatsapp.findFirst({ where: { turnoIaId: chave, direcao: 'out', conversaId: conversa.id } });
  if (anterior) return { status: ['enviado', 'entregue', 'lido'].includes(anterior.statusEnvio) ? 'ENVIADO' : 'PENDENTE', motivo: 'SAIDA_EXISTENTE' };
  const aberta = (await janela(conversa.id)).situacao === 'ABERTA';
  if (botaoConfirmacao && !aberta) throw Object.assign(new Error('A janela fechou antes da confirmação da guia atualizada.'), { code: 'WHATSAPP_JANELA_FECHADA' });
  const template = aberta ? null : await templateOperacional('guia_codigo_barras_v1', client);
  const variaveis = [guide.tipo, guide.competencia, codigo].map(String);
  const corpo = `Código de barras para copiar — ${guide.tipo}, ${guide.competencia}:\n\n${codigo}`;
  const key = 'codigo_guia_whatsapp:' + createHash('sha256').update(`${conversa.id}:${chave}`).digest('hex');
  const value = { status: 'RESERVADO', guideId: guide.id, conversaId: conversa.id };
  try { await client.appSetting.create({ data: { key, value } }); }
  catch (e) {
    if (e.code !== 'P2002') throw e;
    const r = await client.appSetting.findUnique({ where: { key } });
    return { status: r?.value?.status === 'ENVIADO' ? 'ENVIADO' : 'PENDENTE', motivo: 'CODIGO_JA_RESERVADO' };
  }
  try {
    await enviar({ conversa, corpo, tipo: botaoConfirmacao ? 'interactive' : aberta ? 'text' : 'template', autor: 'SISTEMA', turnoIaId: chave, client,
    antesDeEnviar: async () => {
      await conferir();
      if (aberta && (await janela(conversa.id)).situacao !== 'ABERTA') throw Object.assign(new Error('A janela fechou antes do envio do código.'), { code: 'WHATSAPP_JANELA_FECHADA' });
      if (!aberta) await templateOperacional('guia_codigo_barras_v1', client);
    },
    enviar: () => botaoConfirmacao ? cloud.enviarBotoes({ telefone: conversa.telefoneE164, texto: corpo, botoes: [{ id: botaoConfirmacao, titulo: 'Confirmar pagamento' }] })
      : aberta ? cloud.enviarTexto({ telefone: conversa.telefoneE164, texto: corpo })
      : cloud.enviarTemplate({ telefone: conversa.telefoneE164, template: template.nomeMeta, idioma: template.idioma, variaveis }) });
    await client.appSetting.update({ where: { key }, data: { value: { ...value, status: 'ENVIADO' } } });
  } catch (e) {
    await client.appSetting.update({ where: { key }, data: { value: { ...value, status: 'PENDENTE', motivo: e.code || e.codigo || 'CODIGO_ENVIO_NAO_CONFIRMADO' } } });
    throw e;
  }
  return { status: 'ENVIADO' };
}
