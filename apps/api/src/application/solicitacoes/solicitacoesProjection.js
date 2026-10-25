import { createHash } from 'node:crypto';
import { dataCivil, exigir, texto } from './solicitacoesPolicy.js';

export function canonico(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonico);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonico(value[k])]));
  return value;
}
export const hash = value => createHash('sha256').update(JSON.stringify(canonico(value))).digest('hex');
export const json = value => JSON.parse(JSON.stringify(value));

// Includes fields modified by legacy writers, not just S1's revision counter.
export function versao(row) {
  const { eventos, mensagens, comandos, conversa, portalClient, anotacao, ...persistido } = row;
  return hash(persistido);
}
export function comprovadamenteConcluida(row) {
  return row.contratoVersao === 1 && row.estado === 'RESOLVIDO' && Boolean(row.concluidoPorId && row.concluidoEm && row.resolvidoEm)
    && new Date(row.concluidoEm).getTime() === new Date(row.resolvidoEm).getTime();
}
export function projetar(row) {
  const comprovada = comprovadamenteConcluida(row);
  const situacao = row.estado === 'RESOLVIDO' ? (comprovada ? 'CONCLUIDA' : 'ENCERRADA_LEGADO')
    : ({ AGUARDANDO: 'NOVA', EM_ATENDIMENTO: 'EM_ATENDIMENTO', AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE' }[row.estado] || 'A_VERIFICAR');
  return json({ id: row.id, portalClientId: row.portalClientId, triagem: !row.portalClientId,
    titulo: row.titulo ?? null, resumo: row.resumo, motivo: row.motivo, situacao, estadoLegado: row.estado,
    prioridade: row.prioridade ?? null, prazoCivil: row.prazoCivil ?? null, origem: row.origem ?? 'LEGADO',
    responsavelId: row.responsavelId, criadorId: row.criadorId ?? null,
    concluidoPorId: comprovada ? row.concluidoPorId : null, concluidoEm: comprovada ? row.concluidoEm : null,
    observacaoConclusao: comprovada ? row.observacaoConclusao : null, resolvidoEmLegado: row.resolvidoEm,
    conversaId: row.conversaId, mensagemId: row.mensagemId, anotacaoId: row.anotacaoId ?? null,
    contratoVersao: row.contratoVersao ?? null, adocaoPendente: row.contratoVersao !== 1,
    revisao: row.revisao, versao: versao(row), createdAt: row.createdAt, updatedAt: row.updatedAt });
}
export function hojeBrasilia(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function normalizarFiltros(input = {}) {
  exigir(input && typeof input === 'object' && !Array.isArray(input), 'filtros_invalidos');
  exigir(Object.keys(input).every(k => ['portalClientId', 'triagem', 'situacao', 'prioridade', 'responsavelId', 'busca', 'recorte'].includes(k)), 'filtro_invalido');
  const out = {};
  for (const key of ['portalClientId', 'responsavelId', 'busca']) if (key in input) out[key] = texto(input[key], key, 200, key === 'responsavelId');
  if ('triagem' in input) { exigir(typeof input.triagem === 'boolean', 'triagem_invalida'); out.triagem = input.triagem; }
  exigir(!(out.triagem && out.portalClientId), 'filtros_incompativeis');
  if ('situacao' in input) {
    exigir(['NOVA', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE', 'CONCLUIDA', 'ENCERRADA_LEGADO', 'A_VERIFICAR', 'ABERTAS'].includes(input.situacao), 'situacao_invalida'); out.situacao = input.situacao;
  }
  if ('prioridade' in input) { exigir(input.prioridade === null || ['ALTA', 'MEDIA', 'BAIXA'].includes(input.prioridade), 'prioridade_invalida'); out.prioridade = input.prioridade; }
  if ('recorte' in input) { exigir(['novas', 'prioritarias', 'atrasadas', 'semResponsavel'].includes(input.recorte), 'recorte_invalido'); out.recorte = input.recorte; }
  return out;
}
export function recortes(hoje) {
  return {
    novas: { estado: 'AGUARDANDO' },
    prioritarias: { estado: { not: 'RESOLVIDO' }, prioridade: 'ALTA' },
    atrasadas: { estado: { not: 'RESOLVIDO' }, prazoCivil: { lt: dataCivil(hoje) } },
    semResponsavel: { estado: { not: 'RESOLVIDO' }, responsavelId: null },
  };
}
export function predicado(escopo, filtros, hoje, fields) {
  const conversa = { excluidaEm: null, atendimentoId: null, vinculoNumeroId: null, NOT: { chaveEscopo: { startsWith: 'legado:' } } };
  const dominio = empresa => ({ portalClientId: empresa, OR: [{ conversaId: null }, { conversa: { is: { ...conversa, portalClientId: empresa } } }] });
  // An empty boolean group can be elided by Prisma; an empty ID set cannot match.
  const scope = !escopo.empresas.length && !escopo.triagem ? { id: { in: [] } }
    : { OR: [...escopo.empresas.map(dominio), ...(escopo.triagem ? [dominio(null)] : [])] };
  const and = [scope];
  if (filtros.portalClientId) and.push({ portalClientId: filtros.portalClientId });
  if ('triagem' in filtros) and.push({ portalClientId: filtros.triagem ? null : { not: null } });
  for (const key of ['prioridade', 'responsavelId']) if (key in filtros) and.push({ [key]: filtros[key] });
  if (filtros.busca) and.push({ OR: [...['titulo', 'resumo'].map(k => ({ [k]: { contains: filtros.busca, mode: 'insensitive' } })), { portalClient: { is: { razao: { contains: filtros.busca, mode: 'insensitive' } } } }] });
  const prova = { contratoVersao: 1, concluidoPorId: { not: null }, concluidoEm: { not: null }, resolvidoEm: { equals: fields.concluidoEm } };
  const states = {
    NOVA: { estado: 'AGUARDANDO' }, EM_ATENDIMENTO: { estado: 'EM_ATENDIMENTO' }, AGUARDANDO_CLIENTE: { estado: 'AGUARDANDO_CLIENTE' },
    CONCLUIDA: { estado: 'RESOLVIDO', ...prova },
    // Explicit null branches avoid SQL's three-valued NOT(NULL) semantics.
    ENCERRADA_LEGADO: { estado: 'RESOLVIDO', OR: [{ contratoVersao: null }, { concluidoPorId: null }, { concluidoEm: null }, { resolvidoEm: null }, { NOT: { resolvidoEm: { equals: fields.concluidoEm } } }] },
    A_VERIFICAR: { estado: { notIn: ['AGUARDANDO', 'EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE', 'RESOLVIDO'] } },
    ABERTAS: { estado: { not: 'RESOLVIDO' } },
  };
  if (filtros.situacao) and.push(states[filtros.situacao]);
  if (filtros.recorte) and.push(recortes(hoje)[filtros.recorte]);
  return { AND: and };
}

export function lerCursor(cursor, fingerprint) {
  if (cursor == null) return null;
  exigir(typeof cursor === 'string' && cursor.length < 2000, 'cursor_invalido');
  let value;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { exigir(false, 'cursor_invalido'); }
  exigir(value && value.fingerprint === fingerprint && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)), 'cursor_invalido');
  return { OR: [{ createdAt: { gt: new Date(value.createdAt) } }, { createdAt: new Date(value.createdAt), id: { gt: value.id } }] };
}
export const criarCursor = (row, fingerprint) => Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt, fingerprint })).toString('base64url');
