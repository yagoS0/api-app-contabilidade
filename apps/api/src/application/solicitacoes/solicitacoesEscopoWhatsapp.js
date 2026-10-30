import { carregarGrupoIdentidade } from '../whatsapp/InboxWhatsappService.js';
import { grupoNoEscopo } from '../whatsapp/escopoAtendimentoWhatsapp.js';

// Reading a company segment does not require control of the whole person's chat.
export async function segmentoAutorizado(tx, escopo, conversa, cache = new Map()) {
  if (!conversa || conversa.excluidaEm) return false;
  if (conversa.portalClientId && !escopo.empresas.includes(conversa.portalClientId)) return false;
  if (!conversa.portalClientId && !escopo.triagem) return false;
  if (!conversa.portalClientId && conversa.atendimentoId && !conversa.vinculoNumeroId) return false;
  if (conversa.vinculoNumeroId) {
    try {
      const key = `identidade:${conversa.vinculoNumeroId}:${String(conversa.chaveEscopo || '').startsWith('legado:')}`;
      if (!cache.has(key)) cache.set(key, await carregarGrupoIdentidade({ conversaId: conversa.id, visiveis: escopo.empresas, client: tx }));
      const grupo = cache.get(key);
      return grupo.segmentos.some(s => s.id === conversa.id);
    } catch (e) { if (e.status === 404) return false; throw e; }
  }
  if (conversa.atendimentoId && !String(conversa.chaveEscopo || '').startsWith('legado:')) {
    const key = `atendimento:${conversa.atendimentoId}`;
    if (!cache.has(key)) cache.set(key, await grupoNoEscopo({ conversa, visiveis: escopo.empresas, client: tx }));
    const grupo = cache.get(key);
    // A neutral receipt belongs to the attendance, never to global triage.
    return Boolean(conversa.portalClientId && grupo?.segmentos.some(s => s.id === conversa.id));
  }
  // Same legacy lead predicate as ConversaWhatsappService. A neutral receipt
  // attached to a known person's attendance never becomes global triage.
  const fila = ['sem-empresa:', 'legado:sem-empresa:'].some(prefix => String(conversa.chaveEscopo || '').startsWith(prefix));
  return Boolean(conversa.portalClientId || (!conversa.atendimentoId && fila));
}

export function mensagemNoSegmento(mensagem, conversa) {
  if (!mensagem || !conversa) return false;
  const contexto = mensagem.contexto;
  if (!contexto) return mensagem.conversaId === conversa.id;
  return contexto.estado === 'RESOLVIDA' && contexto.conversaId === conversa.id
    && contexto.portalClientId === conversa.portalClientId
    && contexto.atendimentoId === conversa.atendimentoId;
}

/** Materialize the authorized source set before SQL pagination and aggregates.
 * The same set is used for replay and commands, in the caller's snapshot.
 * All message reads are batched; never filter only the returned page.
 */
export async function escopoDasSolicitacoes(tx, escopo) {
  const rows = await tx.encaminhamentoSuporte.findMany({ where: { OR: [
    { portalClientId: { in: escopo.empresas } },
    { contratoVersao: null, portalClientId: null, conversa: { is: { portalClientId: { in: escopo.empresas } } } },
    ...(escopo.triagem ? [{ portalClientId: null }] : []),
  ] }, include: { conversa: true, mensagens: true } });
  const messageIds = [...new Set(rows.flatMap(r => [r.mensagemId, ...r.mensagens.map(m => m.mensagemId)]).filter(Boolean))];
  const messages = messageIds.length ? await tx.mensagemWhatsapp.findMany({ where: { id: { in: messageIds } }, include: { contexto: true } }) : [];
  const byMessage = new Map(messages.map(m => [m.id, m]));
  const allowed = new Map();
  const grupos = new Map();
  const empresasEfetivas = {};
  const ids = [];
  for (const row of rows) {
    const empresa = row.portalClientId ?? (row.contratoVersao == null ? row.conversa?.portalClientId : null) ?? null;
    if (empresa ? !escopo.empresas.includes(empresa) : !escopo.triagem) continue;
    if (row.conversaId) {
      if (!allowed.has(row.conversaId)) allowed.set(row.conversaId, await segmentoAutorizado(tx, escopo, row.conversa, grupos));
      if (!allowed.get(row.conversaId) || row.conversa.portalClientId !== empresa) continue;
      const vinculadas = [row.mensagemId, ...row.mensagens.map(m => m.mensagemId)].filter(Boolean);
      if (vinculadas.some(id => {
        const mensagem = byMessage.get(id);
        // Legacy evidence can be incomplete: retain the record read-only.
        // Adoption separately requires the actual persisted message.
        return !(row.contratoVersao == null && !mensagem) && !mensagemNoSegmento(mensagem, row.conversa);
      })) continue;
    }
    ids.push(row.id); empresasEfetivas[row.id] = empresa;
  }
  return { ...escopo, solicitacaoIds: ids.sort(), empresasEfetivas };
}
