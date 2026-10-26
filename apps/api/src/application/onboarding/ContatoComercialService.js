import { OnboardingError } from './OnboardingService.js';
import { exigirEscopo } from './ComercialService.js';
import { normalizarE164 } from '../whatsapp/telefone.js';
import { garantirIdentidadeWhatsapp } from '../whatsapp/IdentidadeComunicacaoService.js';
import { garantirConversa } from '../whatsapp/ConversaWhatsappService.js';
import { carregarGrupoIdentidade } from '../whatsapp/InboxWhatsappService.js';
import { lerConsentimentoWhatsapp } from '../whatsapp/ConsentimentoWhatsappService.js';
import { exigirGestor } from './RecursosComerciaisService.js';

const erro = (codigo, mensagem, status = 409) => new OnboardingError(codigo, mensagem, status);
export function validarContatoComercial(body) {
  const telefone = normalizarE164(body?.telefone);
  const nome = String(body?.nome || '').trim();
  const evidencia = String(body?.evidencia || '').trim();
  if (!telefone || nome.length < 2 || nome.length > 120) throw erro('contato_invalido', 'Confira o nome e o telefone com DDI.', 400);
  if (body?.autorizado !== true || evidencia.length < 5 || evidencia.length > 500) throw erro('autorizacao_obrigatoria', 'Registre como o contato autorizou esta conversa.', 400);
  return { telefone, nome, evidencia, canalId: String(body.canalId || '') };
}

// Porta legada conserva a tomada de atendimento. O modo é interno, nunca vem do body.
export const prepararContatoComercial = args => registrarContatoComercial(args, false);
export const vincularContatoComercial = args => registrarContatoComercial(args, true);

async function registrarContatoComercial({ onboardingId, body, user, visiveis, db }, neutro) {
  if (neutro) exigirGestor(user);
  const dados = validarContatoComercial(body);
  const executar = () => db.$transaction(async tx => {
    const ficha = await exigirEscopo(onboardingId, user, tx);
    if (['CONVERTIDO', 'DESISTIU', 'CONCLUIDO_AVULSO'].includes(ficha.status)) throw erro('ficha_encerrada', 'Esta oportunidade está encerrada.');
    const canais = await tx.canalWhatsapp.findMany({ where: { ativo: true, finalidade: 'COMERCIAL', ...(dados.canalId ? { id: dados.canalId } : {}) } });
    if (canais.length !== 1) throw erro('canal_comercial_indefinido', 'Selecione um canal comercial ativo.');
    const canal = canais[0];
    if (neutro) {
      let consentimento;
      try { consentimento = await lerConsentimentoWhatsapp(dados.telefone, tx); }
      catch (e) {
        if (e?.code === 'IDENTIDADE_EM_REVISAO') throw erro('identidade_em_revisao', 'Confira a identidade deste contato antes de vincular.');
        throw e;
      }
      if (consentimento?.status === 'REVOGADO') throw erro('contato_revogado', 'Este contato pediu para não receber mensagens.');
    }
    const { vinculoNumero, interlocutor } = await garantirIdentidadeWhatsapp({ telefone: dados.telefone, canalId: canal.id, client: tx, origem: 'CONTATO_AUTORIZADO' });
    if (interlocutor.estado !== 'ATIVO') throw erro('identidade_em_revisao', 'Confira a identidade deste contato antes de iniciar.');
    const anteriores = await tx.conversaWhatsapp.findMany({ where: { vinculoNumero: { interlocutorId: interlocutor.id } }, select: { id: true } });
    for (const anterior of anteriores) {
      try { const grupo = await carregarGrupoIdentidade({ conversaId: anterior.id, visiveis, client: tx }); if (!grupo.completo) throw new Error(); }
      catch { throw erro('contato_indisponivel', 'Este contato precisa de conferência pela equipe autorizada.', 403); }
    }
    const contatosFora = await tx.contatoWhatsapp.count({ where: { vinculoNumero: { interlocutorId: interlocutor.id }, portalClientId: { notIn: visiveis } } });
    if (contatosFora) throw erro('contato_indisponivel', 'Este contato precisa de conferência pela equipe autorizada.', 403);
    const ativo = await tx.atendimentoLead.findFirst({ where: { interlocutorId: interlocutor.id, encerradoEm: null } });
    const daFicha = await tx.atendimentoLead.findFirst({ where: { onboardingId, encerradoEm: null } });
    if ((ativo && ativo.onboardingId !== onboardingId) || (daFicha && daFicha.interlocutorId !== interlocutor.id)) throw erro('contato_ja_vinculado', 'Há outro atendimento ativo. Confira o vínculo antes de continuar.');
    if (ativo?.triagem?.contatoRevogado) throw erro('contato_revogado', 'Este contato pediu para não receber mensagens.');
    if (ativo) {
      const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: ativo.conversaId } });
      if (!conversa || conversa.excluidaEm || conversa.canalId !== canal.id || (neutro && conversa.vinculoNumeroId !== vinculoNumero.id)) throw erro('atendimento_indisponivel', 'Confira o canal e o histórico deste atendimento.');
      return { conversaId: conversa.id, atendimentoId: ativo.id, existente: true };
    }
    // Não chamar garantirConversa para o vínculo neutro: ele atualiza agrupamento e
    // updatedAt de segmentos existentes. Ambiguidade exige resolução explícita.
    let conversa;
    if (neutro) {
      const existentes = await tx.conversaWhatsapp.findMany({ where: { canalId: canal.id, vinculoNumeroId: vinculoNumero.id } });
      if (existentes.length > 1) throw erro('conversa_ambigua', 'Há mais de um histórico neste canal. Confira o vínculo antes de continuar.');
      conversa = existentes[0] || await tx.conversaWhatsapp.create({ data: {
        telefoneE164: dados.telefone, canalId: canal.id, vinculoNumeroId: vinculoNumero.id,
        chaveEscopo: `sem-empresa:v2:${canal.id}:${vinculoNumero.id}:${dados.telefone}`, escopoVerificado: false,
      } });
    } else conversa = await garantirConversa({ telefone: dados.telefone, canalId: canal.id, vinculoNumeroId: vinculoNumero.id, client: tx });
    if (conversa.excluidaEm) throw erro('historico_excluido', 'Restaure ou confira o histórico deste contato antes de continuar.');
    const agora = new Date();
    if (!neutro) await tx.conversaWhatsapp.update({ where: { id: conversa.id }, data: { atendidaPor: user.id, atendidaDesde: agora, automacaoInvalidadaEm: agora } });
    const lead = await tx.atendimentoLead.create({ data: { conversaId: conversa.id, interlocutorId: interlocutor.id, onboardingId,
      triagem: { contatoAutorizado: { nome: dados.nome, telefone: dados.telefone, canalId: canal.id, evidencia: dados.evidencia, atorId: user.id, em: agora.toISOString() } } } });
    await tx.onboardingEvento.create({ data: { onboardingId, tipo: neutro ? 'CONTATO_COMERCIAL_VINCULADO' : 'CONTATO_COMERCIAL_AUTORIZADO', atorId: user.id, dados: { conversaId: conversa.id, canalId: canal.id, evidencia: dados.evidencia } } });
    return { conversaId: conversa.id, atendimentoId: lead.id, existente: false };
  }, { isolationLevel: 'Serializable' });
  for (let tentativa = 0; ; tentativa++) {
    try { return await executar(); }
    catch (e) {
      // Só repetir transações locais abortadas; nenhuma saída externa existe aqui.
      // O helper legado de identidade pode reler após P2002 dentro da mesma
      // transação; PostgreSQL então devolve 25P02 (transação já abortada).
      const abortada = ['P2034', 'P2002'].includes(e?.code) || /25P02|current transaction is aborted/i.test(e?.message || '');
      if (!neutro || !abortada) throw e;
      if (tentativa >= 2) throw erro('contato_em_concorrencia', 'O contato está sendo atualizado. Confira o vínculo antes de repetir.');
    }
  }
}

export async function salvarRetornoComercial({ onboardingId, body, user, db }) {
  const acao = String(body?.acao || '').trim();
  const quando = new Date(body?.quando || '');
  if (!acao || acao.length > 300 || !Number.isFinite(quando.getTime())) throw erro('retorno_invalido', 'Informe a próxima ação e a data.', 400);
  if (!Number.isInteger(body?.versao)) throw erro('versao_obrigatoria', 'Atualize a ficha antes de salvar.', 400);
  return db.$transaction(async tx => {
    const ficha = await exigirEscopo(onboardingId, user, tx);
    if (['CONVERTIDO','DESISTIU','CONCLUIDO_AVULSO'].includes(ficha.status)) throw erro('ficha_encerrada', 'Esta oportunidade está encerrada.');
    const r = await tx.onboarding.updateMany({ where: { id: onboardingId, versao: body.versao }, data: { versao: { increment: 1 } } });
    if (r.count !== 1) throw erro('ficha_alterada', 'A ficha mudou. Atualize antes de salvar.');
    const evento = await tx.onboardingEvento.create({ data: { onboardingId, tipo: 'RETORNO_COMERCIAL', atorId: user.id, dados: { acao, quando: quando.toISOString(), responsavelId: user.id, responsavelNome: user.name || user.email || 'Equipe' } } });
    return { retorno: evento, versao: body.versao + 1 };
  });
}
