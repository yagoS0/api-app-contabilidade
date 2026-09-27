import { createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';

export const erroAtendimento = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])])) : v;
export const hashIntencao = v => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
function conferirChave(id) { if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(id || ''))) throw erroAtendimento('INTENCAO_INVALIDA', 'Atualize a conversa antes de enviar.', 400); }
export function destinoIntencao(conversa) { return hashIntencao([conversa.id, conversa.telefoneE164, conversa.canalId || 'principal', conversa.vinculoNumeroId || null]); }

export async function consultarIntencaoEnvio({ userId, clientRequestId, conversa, client = prisma }) {
  conferirChave(clientRequestId);
  const item = await client.intencaoEnvioAtendimento.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } } });
  if (!item || item.conversaId !== conversa.id || item.destinoHash !== destinoIntencao(conversa)) return null;
  const mensagem = await client.mensagemWhatsapp.findUnique({ where: { intencaoEnvioId: item.id } });
  const status = mensagem?.providerMessageId ? 'ACEITA' : mensagem?.statusEnvio === 'falhou' ? 'FALHOU'
    : mensagem?.statusEnvio === 'indeterminado' ? 'INCERTA' : item.status === 'RESERVADA'
      ? (Date.now() - new Date(item.createdAt).getTime() > 120000 ? 'INCERTA' : 'PROCESSANDO') : item.status;
  return { clientRequestId, status, mensagem: mensagem ? { id: mensagem.id, providerMessageId: mensagem.providerMessageId, statusEnvio: mensagem.statusEnvio, corpo: mensagem.corpo, autor: mensagem.autor } : null,
    resultado: item.resultado || null, erroCodigo: mensagem?.erroEnvioCodigo || item.erroCodigo || null };
}

/** Recupera antes de verificar janela/posse: uma saída já aceita continua consultável depois das 24h. */
export async function recuperarIntencaoEnvio({userId,clientRequestId,conversa,payload,client=prisma}) {
  if(!clientRequestId) return null;
  conferirChave(clientRequestId);
  const item = await client.intencaoEnvioAtendimento.findUnique({where:{userId_clientRequestId:{userId,clientRequestId}}});
  if(!item) return null;
  if(item.destinoHash !== destinoIntencao(conversa) || item.payloadHash !== hashIntencao(payload)) throw erroAtendimento('INTENCAO_DIVERGENTE','Esta tentativa pertence a outra mensagem ou destinatário. Confira o resultado anterior.');
  const intencao = await consultarIntencaoEnvio({userId,clientRequestId,conversa,client});
  if(intencao.status === 'ACEITA') return {...(intencao.resultado || {}),mensagem:intencao.mensagem,wamid:intencao.mensagem?.providerMessageId || intencao.resultado?.wamid,intencao,repetida:true};
  throw Object.assign(erroAtendimento(intencao.status === 'FALHOU' ? 'INTENCAO_FALHOU' : 'ENVIO_INDETERMINADO','Confira o resultado da tentativa anterior; ela não será reenviada.'),{intencao});
}

/** A reserva nunca expira para permitir outro transporte. Repetição apenas lê o resultado. */
export async function comIntencaoEnvio({ userId, clientRequestId, conversa, payload, enviar, client = prisma }) {
  if (clientRequestId === undefined || clientRequestId === null || clientRequestId === '') return enviar(null); // cliente legado
  conferirChave(clientRequestId);
  const destinoHash = destinoIntencao(conversa), payloadHash = hashIntencao(payload);
  let item;
  try { item = await client.intencaoEnvioAtendimento.create({ data: { userId, clientRequestId, conversaId: conversa.id, canalId: conversa.canalId || null, destinoHash, payloadHash } }); }
  catch (e) {
    if (e.code !== 'P2002') throw e;
    item = await client.intencaoEnvioAtendimento.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } } });
    if (!item || item.destinoHash !== destinoHash || item.payloadHash !== payloadHash) throw erroAtendimento('INTENCAO_DIVERGENTE', 'Esta tentativa pertence a outra mensagem ou destinatário. Confira o resultado anterior.');
    const intencao = await consultarIntencaoEnvio({ userId, clientRequestId, conversa, client });
    if (intencao.status === 'ACEITA') return { ...(intencao.resultado || {}), mensagem: intencao.mensagem, wamid: intencao.mensagem?.providerMessageId || intencao.resultado?.wamid, intencao, repetida: true };
    throw Object.assign(erroAtendimento(intencao.status === 'FALHOU' ? 'INTENCAO_FALHOU' : 'ENVIO_INDETERMINADO', intencao.status === 'FALHOU' ? 'Esta tentativa falhou. Confira o motivo antes de preparar outro envio.' : 'Esta tentativa já foi registrada. Consulte o resultado; ela não será reenviada.'), { intencao });
  }
  try {
    const r = await enviar(item.id);
    const resultado = { wamid: r.wamid || null, mensagem: r.mensagem ? { id: r.mensagem.id, providerMessageId: r.mensagem.providerMessageId || r.wamid, statusEnvio: r.mensagem.statusEnvio, corpo: r.mensagem.corpo, autor: r.mensagem.autor } : null };
    await client.intencaoEnvioAtendimento.update({ where: { id: item.id }, data: { status: 'ACEITA', mensagemId: r.mensagem?.id || null, resultado } });
    return { ...r, intencao: { clientRequestId, status: 'ACEITA' } };
  } catch (e) {
    // Se persistir o resultado falhou após aceite, o vínculo da mensagem é a prova recuperável.
    const m = await client.mensagemWhatsapp.findUnique({ where: { intencaoEnvioId: item.id } }).catch(() => null);
    const status = m?.providerMessageId ? 'ACEITA' : e.indeterminado || m?.statusEnvio === 'enviando' || m?.statusEnvio === 'indeterminado' ? 'INCERTA' : 'FALHOU';
    await client.intencaoEnvioAtendimento.updateMany({ where: { id: item.id }, data: { status, mensagemId: m?.id || null, erroCodigo: e.codigo || e.code || 'ENVIO_INTERROMPIDO' } }).catch(() => {});
    e.intencao = { clientRequestId, status }; throw e;
  }
}
