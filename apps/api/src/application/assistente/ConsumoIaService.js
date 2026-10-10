import { prisma } from '../../infrastructure/db/prisma.js';
import { inicioDoMesSaoPaulo } from './GuardaIaService.js';

export async function detalharConsumoIa({ visiveis, client = prisma, agora = new Date() }) {
  const desde = inicioDoMesSaoPaulo(agora);
  const grupos = await client.chamadaIa.groupBy({ by: ['finalidade', 'modelo', 'portalClientId', 'conversaId', 'status'],
    where: { createdAt: { gte: desde }, OR: [{ portalClientId: { in: visiveis } }, { portalClientId: null, finalidade: 'comercial_whatsapp' }] },
    _sum: { custoEstimadoCentavos: true, reservaCentavos: true, inputTokens: true, outputTokens: true, cacheReadTokens: true }, _count: { _all: true } });
  const itens = grupos.map(g => ({ area: g.finalidade === 'assistente_whatsapp' ? 'Suporte' : g.finalidade === 'comercial_whatsapp' ? 'Comercial' : 'Outros',
    modelo: g.modelo, empresaId: g.portalClientId, conversaId: g.conversaId, status: g.status, chamadas: g._count._all,
    custoUsd: Number(g._sum.custoEstimadoCentavos || 0) / 100, reservaUsd: (g._sum.reservaCentavos || 0) / 100,
    entrada: g._sum.inputTokens || 0, saida: g._sum.outputTokens || 0, cache: g._sum.cacheReadTokens || 0 }));
  return { desde, moeda: 'USD', estimativa: true, historicoArredondado: true, itens,
    custoUsd: itens.reduce((s, i) => s + i.custoUsd, 0), reservaUsd: itens.reduce((s, i) => s + i.reservaUsd, 0) };
}
