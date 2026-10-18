import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

const controles = new WeakSet();
const erro = () => Object.assign(new Error('A emissão está sendo processada. Aguarde antes de conferir o resultado.'), { code: 'NFSE_EXECUCAO_ATIVA', status: 409 });

// A conexão PostgreSQL mantém a exclusão, não um prazo presumido no JSON. Os
// callbacks não podem continuar enviando após a conexão/transação ser encerrada.
export async function comControleEmissao({ acaoId, client, executar, timeoutMs = 300000 }) {
  return client.$transaction(async tx => {
    const [lock] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${'nfse-whatsapp:' + acaoId}, 0)) AS acquired`;
    if (!lock?.acquired) throw erro();
    let encerrado = false;
    const controle = { acaoId, token: randomUUID(), async verificar() {
      if (encerrado) throw erro();
      await tx.$queryRaw`SELECT 1 AS alive`;
    } };
    controles.add(controle);
    try { return await executar(controle); }
    finally { encerrado = true; controles.delete(controle); }
  }, { timeout: timeoutMs, maxWait: 5000 });
}

export async function conferirControleEmissao(controle) {
  if (!controles.has(controle)) throw Object.assign(new Error('A supervisão fiscal exige controle de execução válido.'), { code: 'NFSE_SUPERVISAO_INVALIDA', status: 409 });
  await controle.verificar();
  await controle.conferirEscopo?.();
}

export async function execucaoEmissaoAtiva({ acaoId, client }) {
  return client.$transaction(async tx => {
    const [lock] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${'nfse-whatsapp:' + acaoId}, 0)) AS acquired`;
    return !lock?.acquired;
  });
}

// Todo desfecho é CAS. Se uma supervisão venceu após perda da conexão, preservar
// a resposta tardia como evidência, sem rebaixar/substituir o resultado recuperado.
export async function persistirDesfechoControlado({ client, controle, invoiceId, data, versao }) {
  let vigente = true;
  try { await conferirControleEmissao(controle); } catch { vigente = false; }
  for (let i = 0; i < 4; i++) {
    const atual = await client.serviceInvoice.findUnique({ where: { id: invoiceId } });
    if (!atual) throw Object.assign(new Error('Tentativa não encontrada.'), { code: 'NFSE_RETRY_INVOICE_NOT_FOUND' });
    if (vigente) { try { await conferirControleEmissao(controle); } catch { vigente = false; } }
    const mesmoEstado = atual.status === versao.status && new Date(atual.updatedAt).getTime() === new Date(versao.updatedAt).getTime()
      && JSON.stringify(atual.configuracaoFiscal) === JSON.stringify(versao.configuracaoFiscal);
    const aplicar = vigente && mesmoEstado && (!atual.configuracaoFiscal?.controleEmissaoToken || atual.configuracaoFiscal.controleEmissaoToken === controle.token);
    const configuracaoFiscal = { ...(atual.configuracaoFiscal || {}), ...(aplicar ? { ...data.configuracaoFiscal, controleEmissaoToken: controle.token } : {}), historicoDesfechos: [
      ...(atual.configuracaoFiscal?.historicoDesfechos || []),
      { token: controle.token, registradaEm: new Date().toISOString(), tardio: !aplicar, resultado: data },
    ] };
    const r = await client.serviceInvoice.updateMany({ where: { id: atual.id, companyId: atual.companyId, status: atual.status, updatedAt: atual.updatedAt,
      configuracaoFiscal: { equals: atual.configuracaoFiscal ?? Prisma.DbNull } },
      data: { ...(aplicar ? data : {}), configuracaoFiscal } });
    if (r.count === 1) return { ...(aplicar ? { ...atual, ...data } : atual), configuracaoFiscal, _controleAplicado: aplicar };
  }
  throw Object.assign(new Error('A tentativa mudou durante a gravação. Confira o histórico antes de continuar.'), { code: 'NFSE_CONCILIACAO_ESTADO_ALTERADO' });
}
