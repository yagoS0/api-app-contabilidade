import { prisma } from '../../infrastructure/db/prisma.js';
import { carregarPlano } from '../accounting/AliquotaPorLancamentosService.js';
import { whereFaturamentoEmit } from '../notas/apuracao/v2/FechamentoService.js';
import { definirPeriodos, montarAnalise, moverMes } from './analiseEmpresa.js';

// Leitura em lote, escopada pela empresa. Sem provedores, gravações ou uma query por mês.
export async function obterAnaliseEmpresa({ portalClientId, de, ate, comparar, client = prisma, agora = new Date() }) {
  if (client === prisma && client.$transaction) return client.$transaction(tx => obterAnaliseEmpresa({portalClientId,de,ate,comparar,client:tx,agora}), {isolationLevel:'RepeatableRead',timeout:20000});
  const periodos = definirPeriodos({ de, ate, comparar });
  const [lancamentos, notas, guias, plano, circulares] = await Promise.all([
    client.accountingEntry.findMany({ where: { portalClientId, competencia: { gte: periodos.inicio, lte: periodos.fim } }, select: { competencia: true, status: true, lines: { select: { tipo: true, valor: true, conta: true } } } }),
    client.portalInvoice.findMany({ where: { ...whereFaturamentoEmit(), clientId: portalClientId, competencia: { gte: new Date(`${periodos.inicio}-01T00:00:00Z`), lt: new Date(`${moverMes(periodos.fim,1)}-01T00:00:00Z`) } }, select: { competencia: true, total: true } }),
    client.guide.findMany({ where: { portalClientId, OR: [{ competencia: { gte: periodos.inicio, lte: periodos.fim } }, { paymentStatus: { in: ['OPEN','OVERDUE'] } }] }, select: { id: true, tipo: true, competencia: true, valor: true, vencimento: true, paymentStatus: true, parcelamentoId: true, numeroParcela: true, status: true, parcelaEstado: true, liberadaCliente: true } }),
    carregarPlano(portalClientId, client),
    client.companyMonthlyCircular.findMany({where:{portalClientId,competencia:{gte:periodos.inicio,lte:periodos.fim}},select:{competencia:true,semFaturamento:true,fechadoContabilEm:true}}),
  ]);
  return { ok: true, demonstracao: false, ...montarAnalise({ periodos, lancamentos, notas, guias, plano, circulares, hoje: agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) }) };
}
