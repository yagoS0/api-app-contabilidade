import { MODOS_RASCUNHO_ATENDIMENTO } from '@contabilidade/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import { hashIntencao, erroAtendimento } from './IntencaoEnvioAtendimentoService.js';
const RETENCAO = 7 * 86400000;
function chave(conversa, modo) {
  if (!MODOS_RASCUNHO_ATENDIMENTO.includes(modo)) throw erroAtendimento('RASCUNHO_INVALIDO', 'Modo de rascunho inválido.', 400);
  return hashIntencao([conversa.vinculoNumeroId || conversa.atendimentoId || conversa.id, conversa.canalId || 'principal', conversa.id, conversa.telefoneE164, modo]);
}
const APAGADO = { texto: '', apagado: true };
const dto = r => r ? { versao: r.versao, conteudo: r.conteudo?.apagado ? {texto:''} : r.conteudo, expiraEm: r.expiraEm } : null;
export async function expirarRascunhosAtendimento({client = prisma, agora = new Date(), userId} = {}) {
  return client.rascunhoAtendimento.updateMany({where:{...(userId ? {userId} : {}),expiraEm:{lte:agora},NOT:{conteudo:{equals:APAGADO}}},data:{conteudo:APAGADO,versao:{increment:1}}});
}
const conflito = () => erroAtendimento('RASCUNHO_CONFLITO', 'O rascunho mudou em outro aparelho. Confira a versão salva antes de substituir.');
export async function lerRascunhoAtendimento({ userId, conversa, modo = 'texto', client = prisma, agora = new Date() }) {
  const chaveEscopo = chave(conversa, modo);
  await expirarRascunhosAtendimento({userId,client,agora});
  return dto(await client.rascunhoAtendimento.findUnique({ where: { userId_chaveEscopo: { userId, chaveEscopo } } }));
}
export async function salvarRascunhoAtendimento({ userId, conversa, modo = 'texto', versao, conteudo, client = prisma, agora = new Date() }) {
  const chaveEscopo = chave(conversa, modo);
  if (!Number.isInteger(versao) || versao < 0 || !conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)
    || typeof conteudo.texto !== 'string' || conteudo.texto.length > 10000 || Buffer.byteLength(JSON.stringify(conteudo)) > 32000) throw erroAtendimento('RASCUNHO_INVALIDO', 'Confira o texto e a versão do rascunho.', 400);
  const campos = ['texto','orientacao','destinoPreparado','clientRequestId','intencaoTexto','envioIncerto'];
  if (Object.keys(conteudo).some(k => !campos.includes(k))) throw erroAtendimento('RASCUNHO_INVALIDO', 'O rascunho contém campos não permitidos.', 400);
  const expiraEm = new Date(agora.getTime() + RETENCAO);
  await expirarRascunhosAtendimento({userId,client,agora});
  if (!versao) {
    try { return dto(await client.rascunhoAtendimento.create({ data: { userId, chaveEscopo, conversaId: conversa.id, conteudo, expiraEm, versao: 1 } })); }
    catch(e) { if(e.code === 'P2002') throw conflito(); throw e; }
  }
  return client.$transaction(async tx => {
    const r = await tx.rascunhoAtendimento.updateMany({ where: { userId, chaveEscopo, versao }, data: { conteudo, expiraEm, versao: { increment: 1 } } });
    if (r.count !== 1) throw conflito();
    return dto(await tx.rascunhoAtendimento.findUnique({ where: { userId_chaveEscopo: { userId, chaveEscopo } } }));
  });
}
export async function excluirRascunhoAtendimento({ userId, conversa, modo = 'texto', versao, client = prisma }) {
  if (!Number.isInteger(versao) || versao < 1) throw erroAtendimento('RASCUNHO_INVALIDO', 'Informe a versão do rascunho.', 400);
  const r = await client.rascunhoAtendimento.updateMany({ where: { userId, chaveEscopo: chave(conversa, modo), versao }, data:{conteudo:APAGADO,versao:{increment:1},expiraEm:new Date()} });
  if (r.count !== 1) throw conflito();
  return { excluido: true, versao: versao + 1 };
}
