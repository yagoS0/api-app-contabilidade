import { preencherTexto } from './CatalogoComercial.js';
import { cnpjValido } from './interpretacaoComercialWhatsapp.js';

const digitos = v => String(v || '').replace(/\D/g, '');
const formatar = cnpj => cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export function necessitaAutorizacaoFiscal(pre) {
  if (!cnpjValido(pre?.cnpj) || !['INATIVA', 'TRANSFERENCIA', 'PLANEJAMENTO'].includes(pre.intencao)) return false;
  if (['INATIVA', 'TRANSFERENCIA'].includes(pre.intencao)) return true;
  const relato = String(pre.necessidade || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return Boolean(pre.investigacaoPendencias || pre.tipoPendencias
    || /\b(?:impostos?|tributos?|fiscal|regulariz\w*|pendencias?|dividas?|declaracoes?|guias?|empresa parada|nao pago|nao paguei|encerrar|dar baixa)\b/.test(relato));
}

/** Apenas prepara texto aprovado. Não verifica procuração, aceita autorização ou consulta SERPRO. */
export async function prepararSolicitacaoAutorizacao({ pre, db, agora = new Date(), mensagemId, autorizacaoAtual = {} }) {
  if (!necessitaAutorizacaoFiscal(pre) || autorizacaoAtual.estado === 'ATIVA' && autorizacaoAtual.cnpj === pre.cnpj) return null;
  if (pre.autorizacaoFiscal?.estado === 'AGUARDANDO_AUTORIZACAO' && pre.autorizacaoFiscal.cnpj === pre.cnpj) return null;
  const base = { cnpj: pre.cnpj, mensagemOrigemId: mensagemId, solicitadaEm: agora.toISOString() };
  const revisao = motivo => ({ texto: null, solicitacao: { ...base, estado: 'REVISAO_NECESSARIA', motivo } });
  if (!db?.recursoComercial?.findFirst) return revisao('ORIENTACAO_INDISPONIVEL');
  try {
    const guia = await db.recursoComercial.findFirst({ where: { tipo: 'ORIENTACAO', chave: 'autorizacao-acesso', aprovadoEm: { not: null } }, orderBy: { versao: 'desc' } });
    const institucional = await db.recursoComercial.findFirst({ where: { tipo: 'INSTITUCIONAL', chave: 'escritorio', aprovadoEm: { not: null } }, orderBy: { versao: 'desc' } });
    if (!guia?.aprovadoEm || guia.tipo !== 'ORIENTACAO' || guia.chave !== 'autorizacao-acesso' || !guia.texto?.trim()) return revisao('ORIENTACAO_NAO_APROVADA');
    const procuradorCnpj = digitos(institucional?.dados?.procuradorCnpj);
    if (!institucional?.aprovadoEm || institucional.tipo !== 'INSTITUCIONAL' || institucional.chave !== 'escritorio'
      || !cnpjValido(procuradorCnpj) || !String(institucional.dados.escritorio || '').trim()) return revisao('INSTITUCIONAL_INCOMPLETO');
    // Só dados cadastrais do cliente e configuração aprovada podem preencher o guia.
    const textoGuia = preencherTexto(guia.texto, { nome: pre.nome || '', cnpj: formatar(pre.cnpj),
      escritorio: institucional.dados.escritorio, procuradorCnpj: formatar(procuradorCnpj), linkAutorizacao: institucional.dados.linkAutorizacao || '' });
    const documentosNoGuia = textoGuia.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/g) || [];
    if (documentosNoGuia.some(documento => ![pre.cnpj, procuradorCnpj].includes(digitos(documento)))) return revisao('CNPJ_DIVERGENTE_NO_GUIA');
    const identificacao = `CNPJ do escritório a autorizar: ${formatar(procuradorCnpj)}.`;
    const texto = `A consulta inicial da situação fiscal é gratuita. Para preparar o relatório de pendências, precisamos da sua autorização.\n\n${textoGuia}\n\n${identificacao}\n\nO contador continuará seu atendimento. Depois que você concluir, ele confirmará o recebimento da autorização no portal da Receita e fará a análise pelo aplicativo.`;
    if (texto.length > 3500 || /{{[^}]+}}/.test(texto)) return revisao('ORIENTACAO_INVALIDA');
    return { texto, solicitacao: { ...base, estado: 'AGUARDANDO_AUTORIZACAO', procuradorCnpj,
      recursoId: guia.id, recursoVersao: guia.versao, institucionalId: institucional.id, institucionalVersao: institucional.versao } };
  } catch {
    return revisao('ORIENTACAO_INDISPONIVEL');
  }
}
