import { prisma } from '../../infrastructure/db/prisma.js';

export async function contextoEmissaoRegistrado(nota, portalClientId, db = prisma) {
  if (nota.type !== 'NFSE' || nota.papel !== 'EMIT') return null;
  if (!nota.chaveAcesso && !nota.idDps) return { estado: 'SEM_REGISTRO' };
  try {
    const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
    if (!portal?.companyId) return { estado: 'SEM_REGISTRO' };
    const registros = await db.serviceInvoice.findMany({
      where: { companyId: portal.companyId, ...(nota.chaveAcesso ? { chaveAcesso: nota.chaveAcesso } : { idDps: nota.idDps }) },
      select: { configuracaoFiscal: true }, take: 2,
    });
    if (registros.length > 1) return { estado: 'VINCULO_AMBIGUO' };
    if (!registros[0]?.configuracaoFiscal) return { estado: 'SEM_REGISTRO' };
    return { estado: 'REGISTRADO_NA_EMISSAO', configuracao: registros[0].configuracaoFiscal };
  } catch { return { estado: 'INDISPONIVEL' }; }
}
