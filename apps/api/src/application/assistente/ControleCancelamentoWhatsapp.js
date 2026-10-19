import { createHash, randomUUID } from 'node:crypto';

const erroAceito = () => Object.assign(new Error('O cancelamento desta nota já foi aceito. Confira o resultado existente; não é necessário cancelar novamente.'), { code: 'NFSE_CANCELAMENTO_JA_ACEITO', codigo: 'NFSE_CANCELAMENTO_JA_ACEITO' });
const erro = () => Object.assign(new Error('A equipe precisa conferir o cancelamento anterior desta nota antes de qualquer nova tentativa.'), { code: 'NFSE_RESULTADO_INDETERMINADO', codigo: 'NFSE_RESULTADO_INDETERMINADO' });
export function chaveCancelamento(acao) {
  if (!acao?.portalClientId || !acao.payload?.chaveAcesso) throw Object.assign(new Error('Cancelamento sem identidade fiscal.'), { code: 'NFSE_CANCELAMENTO_SEM_CHAVE', antesDoPost: true });
  return 'nfse_cancelamento_whatsapp:' + createHash('sha256').update(JSON.stringify([String(acao.portalClientId), String(acao.payload.chaveAcesso)])).digest('hex');
}
export async function conferirCancelamentoAnterior(acao, client, excluirAcaoId = null) {
  const key = chaveCancelamento(acao);
  const registro = await client.appSetting.findUnique({ where: { key } });
  if (registro && registro.value?.status !== 'RECUSADO') throw registro.value?.status === 'ACEITO' ? erroAceito() : erro();
  const anterior = await client.acaoPendenteWhatsapp.findFirst({ where: {
    portalClientId: String(acao.portalClientId), tipo: 'CANCELAR_NFSE',
    payload: { path: ['chaveAcesso'], equals: String(acao.payload.chaveAcesso) },
    ...(excluirAcaoId ? { id: { not: excluirAcaoId } } : {}),
    OR: [{ status: 'confirmada' }, { status: 'executada', resultado: { path: ['indeterminado'], equals: true } },
      { status: 'executada', resultado: { path: ['status'], equals: 'accepted' } }],
  } });
  if (anterior) throw anterior.resultado?.status === 'accepted' ? erroAceito() : erro();
  return { key, registro };
}
export async function reservarCancelamento(acao, client) {
  const { key, registro } = await conferirCancelamentoAnterior(acao, client, acao.id);
  const value = { status: 'RESERVADO', token: randomUUID(), acaoId: acao.id, portalClientId: acao.portalClientId,
    chaveAcesso: acao.payload.chaveAcesso, reservadoEm: new Date().toISOString() };
  if (registro) {
    const r = await client.appSetting.updateMany({ where: { key, value: { equals: registro.value } }, data: { value } });
    if (r.count !== 1) throw erro();
  } else {
    try { await client.appSetting.create({ data: { key, value } }); }
    catch (e) { if (e.code === 'P2002') throw erro(); throw e; }
  }
  return async resultado => {
    const status = resultado?.status === 'accepted' ? 'ACEITO' : resultado?.indeterminado === false ? 'RECUSADO' : 'INDETERMINADO';
    const r = await client.appSetting.updateMany({ where: { key, value: { equals: value } },
      data: { value: { ...value, status, resultado, atualizadoEm: new Date().toISOString() } } });
    if (r.count !== 1) throw erro();
  };
}
