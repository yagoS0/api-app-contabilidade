import { randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';

// Recebe a transação que pausa o atendimento. O registro é também o aviso persistente do portal.
export async function registrarEncaminhamentoSuporte({ conversa, mensagem, motivo, client, agora = new Date() }) {
  const motivos = { OPENAI_REDE: 'Falha de conexão com o assistente', OPENAI_TIMEOUT: 'O assistente não concluiu a resposta a tempo',
    TETO_PILOTO: 'Limite de uso do assistente atingido', TETO_PILOTO_INVALIDO: 'Configuração do assistente precisa de revisão',
    OPENAI_SEM_CHAVE: 'Assistente indisponível', OPENAI_USO_AUSENTE: 'Não foi possível confirmar o consumo do assistente',
    TETO_OPENAI_COMPARTILHADO: 'Limite compartilhado de IA atingido' };
  const existente = await client.encaminhamentoSuporte.findFirst({ where: { conversaId: conversa.id, estado: { not: 'RESOLVIDO' } } });
  if (existente) return existente;
  const repetido = await client.encaminhamentoSuporte.findUnique({ where: { mensagemId: mensagem.id } });
  if (repetido) return repetido;
  const registro = await client.encaminhamentoSuporte.create({ data: { id: randomUUID(), conversaId: conversa.id,
    mensagemId: mensagem.id, motivo: String(motivos[motivo] || motivo || 'Atendimento precisa da equipe').slice(0, 500),
    resumo: String(mensagem.corpo || 'Mensagem sem texto').slice(0, 1500) } });
  await client.eventoPushAtendimento.create({ data: { id: `suporte:${registro.id}`, conversaId: conversa.id, tipo: 'SUPORTE',
    createdAt: agora, expiraEm: new Date(agora.getTime() + 2 * 3600000) } });
  return registro;
}

export async function listarEncaminhamentosSuporte({ visiveis, companyId = null, client = prisma }) {
  const where = { estado: { not: 'RESOLVIDO' }, conversa: { portalClientId: { in: companyId ? visiveis.filter(id => id === companyId) : visiveis }, excluidaEm: null,
    NOT: { chaveEscopo: { startsWith: 'legado:' } } } };
  const [contagens, total, itens] = await Promise.all([
    client.conversaWhatsapp.findMany({ where: { ...where.conversa, encaminhamentosSuporte: { some: { estado: { not: "RESOLVIDO" } } } }, select: { portalClientId: true, _count: { select: { encaminhamentosSuporte: { where: { estado: { not: "RESOLVIDO" } } } } } } }),
    client.encaminhamentoSuporte.count({ where }),
    client.encaminhamentoSuporte.findMany({ where, orderBy: { createdAt: 'asc' }, take: 100,
      include: { conversa: { select: { portalClient: { select: { id: true, razao: true } } } } } }),
  ]);
  const porEmpresa = {};
  for (const c of contagens) porEmpresa[c.portalClientId] = (porEmpresa[c.portalClientId] || 0) + c._count.encaminhamentosSuporte;
  return { total, porEmpresa, itens: itens.map(({ conversa, ...i }) => ({ ...i, empresaId: conversa.portalClient?.id, empresa: conversa.portalClient?.razao || '' })) };
}

export async function atualizarEncaminhamentosSuporte({ conversaId, estado, responsavelId, client = prisma }) {
  return client.encaminhamentoSuporte.updateMany({ where: { conversaId, estado: { not: 'RESOLVIDO' } },
    data: { estado, responsavelId: responsavelId || null, ...(estado === 'RESOLVIDO' ? { resolvidoEm: new Date() } : {}) } });
}
