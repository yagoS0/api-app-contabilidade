import { prisma } from '../../infrastructure/db/prisma.js';
import { configuracaoDoCanal } from './CanalWhatsappService.js';
import { criarModelosMeta } from './ModelosMetaService.js';
import { hashIntencao, erroAtendimento } from './IntencaoEnvioAtendimentoService.js';

// Nome estável: consultar antes de criar também recupera submissões com resposta incerta.
export const MODELO_RETOMADA = {
  name: 'reabrir_conversa', language: 'pt_BR', category: 'MARKETING',
  components: [
    { type: 'BODY', text: 'Olá! Aqui é da Altan Contabilidade. Estamos retomando o atendimento que você solicitou sobre {{1}}. Para continuar, responda a esta mensagem ou toque em "Falar com a equipe".', example: { body_text: [['o envio das guias de impostos']] } },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Falar com a equipe' }] },
  ],
};

async function acesso({ conversa, client, consultarModelo, criarModelo }) {
  const local = await client.templateWhatsapp.findUnique({ where: { chave: 'reabrir_conversa' } });
  const nome = local?.nomeMeta || MODELO_RETOMADA.name, idioma = local?.idioma || 'pt_BR';
  if (consultarModelo) return { nome, idioma, consultar: () => consultarModelo(nome, conversa, idioma), criar: criarModelo };
  const canal = await configuracaoDoCanal(conversa, { client });
  const meta = criarModelosMeta({ token: canal.token, waba: canal.wabaId });
  return { nome, idioma, consultar: () => meta.consultar(nome, idioma), criar: m => meta.criar(m) };
}

function estrutura(modelo) {
  const cs = modelo.components;
  if (!Array.isArray(cs) || cs.some(c => !c || typeof c !== "object")) return null;
  const corpo = cs.find(c => c.type === 'BODY')?.text;
  if (!corpo || cs.filter(c => c.type === 'BODY').length !== 1 || cs.filter(c => c.type === 'BUTTONS').length > 1) return null;
  for (const c of cs) {
    if (c.type === 'BUTTONS') {
      if (c.buttons?.length !== 1 || c.buttons[0].type !== 'QUICK_REPLY' || c.buttons[0].text !== 'Falar com a equipe') return null;
    } else {
      if (!['BODY','HEADER','FOOTER'].includes(c.type) || typeof c.text !== 'string' || !c.text.trim() || c.type === 'HEADER' && c.format !== 'TEXT') return null;
      if (/[{}]/.test(c.type === 'BODY' ? c.text.replaceAll('{{1}}', '') : c.text)) return null;
    }
  }
  // Não devolve exemplos da Meta (podem conter URLs/arquivos), apenas o conteúdo exibido.
  return { requerAssunto: corpo.includes('{{1}}'), textoModelo: cs.filter(c => c.text).map(c => c.text).join('\n\n'),
    botoes: cs.find(c => c.type === 'BUTTONS')?.buttons.map(b => b.text) || [] };
}

function base(conversa) {
  return { destinatario: { nome: conversa.nomePerfilProvedor || null, telefone: conversa.telefoneE164 }, canalId: conversa.canalId || 'principal',
    aviso: 'O cliente precisa responder para liberar novamente mensagens livres.' };
}

/** Consulta explícita do operador. Aprovação é sempre da WABA do canal, nunca do cache global. */
export async function prepararRetomadaAtendimento({ conversa, assunto = '', client = prisma, consultarModelo = null }) {
  let a, modelo;
  try { a = await acesso({ conversa, client, consultarModelo }); modelo = await a.consultar(); }
  catch { return { ...base(conversa), disponivel: false, motivo: 'MODELO_NAO_CONFERIDO', message: 'Não foi possível conferir a aprovação na Meta. Toque em Atualizar aprovação para tentar novamente.' }; }
  if (!modelo) return { ...base(conversa), disponivel: false, motivo: 'MODELO_AUSENTE', statusMeta: 'AUSENTE',
    podeSolicitarAprovacao: a.nome === MODELO_RETOMADA.name && a.idioma === MODELO_RETOMADA.language,
    textoModelo: MODELO_RETOMADA.components[0].text, botoes: ['Falar com a equipe'],
    message: 'Este número ainda não tem o modelo de retomada. Solicite a aprovação uma vez; depois ele poderá ser reutilizado nos atendimentos.' };
  if (modelo.name !== a.nome || modelo.language !== a.idioma || !['UTILITY','MARKETING'].includes(modelo.category))
    return { ...base(conversa), disponivel: false, motivo: 'MODELO_INCOMPATIVEL', message: 'O modelo retornado não corresponde ao nome, idioma ou categoria deste atendimento.' };
  if (modelo.status !== 'APPROVED') return { ...base(conversa), disponivel: false, motivo: 'MODELO_NAO_APROVADO_NO_CANAL', statusMeta: modelo.status,
    message: modelo.status === 'PENDING' ? 'A Meta está analisando este modelo. Quando ela aprovar, toque em Atualizar aprovação. Não é necessário solicitar novamente.'
      : modelo.status === 'REJECTED' ? 'A Meta rejeitou este modelo. A equipe precisa corrigir o modelo no WhatsApp Manager antes de retomar por este número.'
        : 'Este modelo está indisponível na Meta. Confira a situação no WhatsApp Manager e atualize a aprovação.' };
  const formato = estrutura(modelo);
  if (!formato) return { ...base(conversa), disponivel: false, statusMeta: modelo.status, motivo: 'MODELO_REQUER_PARAMETROS', message: 'Este modelo usa campos, botões ou mídia incompatíveis. Use um modelo de texto com um campo de assunto e o botão Falar com a equipe.' };
  const previa = { ...base(conversa), ...formato, statusMeta: modelo.status, categoria: modelo.category };
  const tema = typeof assunto === 'string' ? assunto.trim() : '';
  if (formato.requerAssunto && (!tema || tema.length > 120 || /[\r\n\t{}]/.test(tema)))
    return { ...previa, disponivel: false, motivo: 'ASSUNTO_OBRIGATORIO', message: 'Informe o assunto do atendimento em uma linha, com até 120 caracteres.' };
  const variaveis = formato.requerAssunto ? [tema] : [];
  const botoesResposta = formato.botoes.map(() => conversa.canalId && conversa.canalId !== 'principal' ? 'altan.lead.human.v1' : 'altan.client.human.v1');
  const texto = formato.textoModelo.replaceAll('{{1}}', tema);
  const m = { id: modelo.id, nome: modelo.name, idioma: modelo.language, categoria: modelo.category,
    textoModelo: formato.textoModelo, botoes: formato.botoes };
  return { ...previa, disponivel: true, texto, assunto: formato.requerAssunto ? tema : '', modelo: m, variaveis, botoesResposta,
    previaHash: hashIntencao([conversa.id, conversa.telefoneE164, conversa.canalId || 'principal', conversa.vinculoNumeroId, m, variaveis, botoesResposta]) };
}

/** Cadastra somente o modelo fixo mostrado na prévia, sem enviar mensagem a ninguém. */
export async function solicitarModeloRetomada({ conversa, client = prisma, consultarModelo = null, criarModelo = null }) {
  const a = await acesso({ conversa, client, consultarModelo, criarModelo });
  const existente = await a.consultar();
  if (existente) return prepararRetomadaAtendimento({ conversa, client, consultarModelo: async () => existente });
  if (a.nome !== MODELO_RETOMADA.name || a.idioma !== MODELO_RETOMADA.language || !a.criar)
    throw erroAtendimento('MODELO_PERSONALIZADO', 'A equipe precisa revisar o modelo configurado no WhatsApp Manager.');
  await a.criar(MODELO_RETOMADA);
  return { ...base(conversa), disponivel: false, statusMeta: 'PENDING', motivo: 'MODELO_NAO_APROVADO_NO_CANAL',
    message: 'Modelo enviado para análise da Meta. Toque em Atualizar aprovação para conferir. Nenhuma mensagem foi enviada ao cliente.' };
}
