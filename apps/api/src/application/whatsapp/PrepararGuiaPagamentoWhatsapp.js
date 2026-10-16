import { prisma } from '../../infrastructure/db/prisma.js';
import { lerLinhaDigitavelDoPdf, MOTIVOS_LEITURA } from '../guides/lerLinhaDigitavelDoPdf.js';
import { parametrosPagamentoGuia } from './GuiaPagamentoWhatsapp.js';
import { janelaDaConversa } from './ConversaWhatsappService.js';
import { identificarGuiaWhatsapp } from './IdentificacaoGuiaWhatsapp.js';
import { MOTIVOS } from '../guides/linhaDigitavelArrecadacao.js';

export const TEMPLATE_GUIA_PAGAMENTO = 'guia_documento_pagamento_v1';
export const TEMPLATE_GUIA_CLARA = 'guia_documento_empresa_v2';
export const TEMPLATE_GUIA_SEM_CODIGO = 'guia_documento_sem_codigo_v1';
export async function prepararGuiaPagamentoWhatsapp({ guide, identificacao, conteudoPdf, referencia, conversa, conferir = async () => {}, templateOnly = false },
  { client = prisma, ler = lerLinhaDigitavelDoPdf, janela = janelaDaConversa } = {}) {
  const recusarCodigo = () => Object.assign(new Error('Não foi possível conferir o código de barras. Confira a guia antes de enviar.'), { code: 'LINHA_DIGITAVEL_INDISPONIVEL' });
  const relerMotivos = [MOTIVOS.NAO_ENCONTRADA, MOTIVOS_LEITURA.PDF_ILEGIVEL, MOTIVOS_LEITURA.PDF_SEM_TEXTO];
  if (guide.linhaDigitavelLidaEm && guide.linhaDigitavelMotivo && !relerMotivos.includes(guide.linhaDigitavelMotivo)) throw recusarCodigo();
  // Ausência legada pode esconder candidato inválido: relê o PDF antes de permitir envio sem botão.
  const leitura = guide.linhaDigitavelLidaEm && guide.linhaDigitavel ? guide
    : await ler(conteudoPdf, { valorTotal: guide.valor, vencimento: guide.vencimento }, { distinguirAusencia: true });
  const somenteDocumento = !leitura.linhaDigitavel && Boolean(leitura.linhaDigitavelLidaEm)
    && [MOTIVOS.NAO_ENCONTRADA, MOTIVOS_LEITURA.PDF_SEM_TEXTO].includes(leitura.linhaDigitavelMotivo);
  if (!somenteDocumento && (!leitura.linhaDigitavel || leitura.linhaDigitavelMotivo)) throw recusarCodigo();
  if (!identificacao) {
    const empresa = guide.portalClient || await client.portalClient.findUnique({ where: { id: guide.portalClientId }, select: { razao: true } });
    identificacao = identificarGuiaWhatsapp({ empresa: empresa?.razao, tipoGuia: guide.tipo });
  }
  const pagamento = { referencia, linhaDigitavel: leitura.linhaDigitavel, valor: guide.valor, descricao: `${identificacao} — ${guide.competencia}` };
  if (!somenteDocumento) parametrosPagamentoGuia(pagamento);
  const aberto = !templateOnly && (await janela(conversa.id)).situacao === 'ABERTA';
  if (!templateOnly && !aberto) throw Object.assign(new Error('A janela de atendimento fechou antes do envio.'), { code: 'WHATSAPP_JANELA_FECHADA' });
  let chave = somenteDocumento ? TEMPLATE_GUIA_SEM_CODIGO : TEMPLATE_GUIA_PAGAMENTO;
  if (templateOnly && !somenteDocumento) {
    const claro = await client.templateWhatsapp.findUnique({ where: { chave: TEMPLATE_GUIA_CLARA } });
    if (claro?.nomeMeta === TEMPLATE_GUIA_CLARA && claro.statusAprovacao === 'APROVADO' && claro.temDocumento) chave = TEMPLATE_GUIA_CLARA;
  }
  const verificar = async () => {
    await conferir();
    if (aberto) {
      if ((await janela(conversa.id)).situacao !== 'ABERTA') throw Object.assign(new Error('A janela de atendimento fechou antes do envio.'), { code: 'WHATSAPP_JANELA_FECHADA' });
      return null;
    }
    const t = await client.templateWhatsapp.findUnique({ where: { chave } });
    if (!t?.nomeMeta || t.statusAprovacao !== 'APROVADO' || !t.temDocumento) throw Object.assign(new Error('O modelo da guia com PDF e pagamento ainda precisa de aprovação na Meta.'), { code: 'WHATSAPP_TEMPLATE_PENDENTE' });
    return t;
  };
  const t = await verificar();
  return { ...pagamento, somenteDocumento, template: t?.nomeMeta || null, idioma: t?.idioma || 'pt_BR',
    texto: `*${identificacao}*\nCompetência: ${guide.competencia}.\n\n📎 *ABRIR PDF:* toque no arquivo anexado no topo desta mensagem.\n${somenteDocumento ? 'O código não está disponível para copiar nesta mensagem. Confira as instruções de pagamento no PDF.' : '📋 *COPIAR CÓDIGO:* abra os detalhes de pagamento abaixo.'}\nSe já pagou, não pague novamente.`,
    antesDeEnviar: verificar };
}
