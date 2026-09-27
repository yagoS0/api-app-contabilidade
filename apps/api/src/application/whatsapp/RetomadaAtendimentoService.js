import { prisma } from '../../infrastructure/db/prisma.js';
import { configuracaoDoCanal } from './CanalWhatsappService.js';
import { criarModelosMeta } from './ModelosMetaService.js';
import { hashIntencao } from './IntencaoEnvioAtendimentoService.js';

/** Consulta explícita do operador, nunca disparada pelo polling do histórico. */
export async function prepararRetomadaAtendimento({ conversa, client = prisma, consultarModelo = null }) {
  const local = await client.templateWhatsapp.findUnique({ where: { chave: 'reabrir_conversa' } });
  const base = { destinatario: { nome: conversa.nomePerfilProvedor || null, telefone: conversa.telefoneE164 }, canalId: conversa.canalId || 'principal', configuracao: '/configuracoes',
    aviso: 'O cliente precisa responder para liberar novamente mensagens livres.' };
  if (!local?.nomeMeta || local.statusAprovacao !== 'APROVADO') return { ...base, disponivel: false, motivo: 'MODELO_NAO_APROVADO', message: 'Configure e aprove o modelo de retomada antes de enviar.' };
  let modelo;
  try {
    const consultar = consultarModelo || (async nome => { const c = await configuracaoDoCanal(conversa, { client }); return criarModelosMeta({ token: c.token, waba: c.wabaId }).consultar(nome); });
    modelo = await consultar(local.nomeMeta, conversa);
  } catch { return { ...base, disponivel: false, motivo: 'MODELO_NAO_CONFERIDO', message: 'Não foi possível conferir o modelo neste canal. Tente preparar a retomada novamente.' }; }
  if (modelo?.status !== 'APPROVED' || modelo.name !== local.nomeMeta || modelo.language !== local.idioma || !['UTILITY','MARKETING'].includes(modelo.category)) return { ...base, disponivel: false, motivo: 'MODELO_NAO_APROVADO_NO_CANAL', message: 'O modelo não está aprovado para este canal e idioma.' };
  const componentes = modelo.components || [], corpo = componentes.find(c => c.type === 'BODY')?.text;
  // Esta primeira versão suporta modelos sem parâmetros. Recusa a prévia que não consegue representar.
  if (!corpo || componentes.some(c => !['BODY','FOOTER','HEADER'].includes(c.type) || c.type === 'HEADER' && c.format !== 'TEXT' || !c.text || /[{}]/.test(c.text))) return { ...base, disponivel: false, motivo: 'MODELO_REQUER_PARAMETROS', message: 'Este modelo exige parâmetros ou mídia ainda não configurados para a retomada.' };
  const previa = { ...base, disponivel: true, texto: componentes.map(c => c.text).join('\n\n'), modelo: { id: modelo.id, nome: modelo.name, idioma: modelo.language, categoria: modelo.category, componentes } };
  return { ...previa, previaHash: hashIntencao([conversa.id, conversa.telefoneE164, conversa.canalId || 'principal', conversa.vinculoNumeroId, previa.modelo]) };
}
