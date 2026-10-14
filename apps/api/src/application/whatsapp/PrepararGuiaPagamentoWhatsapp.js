import { prisma } from '../../infrastructure/db/prisma.js';
import { lerLinhaDigitavelDoPdf } from '../guides/lerLinhaDigitavelDoPdf.js';
import { parametrosPagamentoGuia } from './GuiaPagamentoWhatsapp.js';
import { janelaDaConversa } from './ConversaWhatsappService.js';
import { identificarGuiaWhatsapp } from './IdentificacaoGuiaWhatsapp.js';

export const TEMPLATE_GUIA_PAGAMENTO = 'guia_documento_pagamento_v1';
export async function prepararGuiaPagamentoWhatsapp({ guide, identificacao, conteudoPdf, referencia, conversa, conferir = async () => {}, templateOnly = false },
  { client = prisma, ler = lerLinhaDigitavelDoPdf, janela = janelaDaConversa } = {}) {
  const leitura = guide.linhaDigitavelLidaEm ? guide : await ler(conteudoPdf, { valorTotal: guide.valor, vencimento: guide.vencimento });
  if (!leitura.linhaDigitavel || leitura.linhaDigitavelMotivo) throw Object.assign(new Error('Código de barras indisponível ou divergente. Confira a guia antes de enviar.'), { code: 'LINHA_DIGITAVEL_INDISPONIVEL' });
  if (!identificacao) {
    const empresa = guide.portalClient || await client.portalClient.findUnique({ where: { id: guide.portalClientId }, select: { razao: true } });
    identificacao = identificarGuiaWhatsapp({ empresa: empresa?.razao, tipoGuia: guide.tipo });
  }
  const pagamento = { referencia, linhaDigitavel: leitura.linhaDigitavel, valor: guide.valor, descricao: `${identificacao} — ${guide.competencia}` };
  parametrosPagamentoGuia(pagamento);
  const aberto = !templateOnly && (await janela(conversa.id)).situacao === 'ABERTA';
  if (!templateOnly && !aberto) throw Object.assign(new Error('A janela de atendimento fechou antes do envio.'), { code: 'WHATSAPP_JANELA_FECHADA' });
  const verificar = async () => {
    await conferir();
    if (aberto) {
      if ((await janela(conversa.id)).situacao !== 'ABERTA') throw Object.assign(new Error('A janela de atendimento fechou antes do envio.'), { code: 'WHATSAPP_JANELA_FECHADA' });
      return null;
    }
    const t = await client.templateWhatsapp.findUnique({ where: { chave: TEMPLATE_GUIA_PAGAMENTO } });
    if (!t?.nomeMeta || t.statusAprovacao !== 'APROVADO' || !t.temDocumento) throw Object.assign(new Error('O modelo da guia com PDF e pagamento ainda precisa de aprovação na Meta.'), { code: 'WHATSAPP_TEMPLATE_PENDENTE' });
    return t;
  };
  const t = await verificar();
  return { ...pagamento, template: t?.nomeMeta || null, idioma: t?.idioma || 'pt_BR',
    texto: `${identificacao}\nCompetência: ${guide.competencia}. O PDF está anexado. Abra os detalhes para copiar o código de barras. Se já pagou, não pague novamente.`,
    antesDeEnviar: verificar };
}
