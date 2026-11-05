import { lerFluxoEmpresa, salvarFluxoTarefa } from '../company/FluxoCarteiraService.js';
import { regimeComprovado } from './OperationsEligibility.js';
import { actor } from './OperationsCalculationService.js';
const fail = message => Object.assign(new Error(message), { status: 409 });
export async function lerOperacaoExterna(db, companyId, competencia) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('Competência inválida.');
  const portal = await db.portalClient.findUnique({ where: { id: companyId } });
  if (!portal) throw fail('Empresa não encontrada.');
  const history = portal.companyId ? await db.regimeHistorico.findMany({ where: { companyId: portal.companyId } }) : [];
  if (regimeComprovado(history, competencia) !== 'PRESUMIDO') throw fail('Lucro Presumido não comprovado na competência.');
  const detail = await lerFluxoEmpresa(companyId, competencia, db);
  if (detail.fluxo.regime !== 'Presumido') throw fail('O regime atual diverge do histórico. Confira o cadastro antes do registro externo.');
  const tasks = detail.fluxo.tarefas.filter(t => ['apurar', 'transmitir'].includes(t.chave));
  return { companyId, competencia, regime: 'PRESUMIDO', tasks, apurar: tasks.find(t => t.chave === 'apurar'), transmitir: tasks.find(t => t.chave === 'transmitir') };
}
export async function salvarOperacaoExterna(db, { companyId, competencia, userId, chave, versao, hash, confirmCompetencia }) {
  if (!['apurar', 'transmitir'].includes(chave) || confirmCompetencia !== competencia) throw fail('Confirme a tarefa e a competência.');
  await db.$transaction(async tx => {
    await actor(tx, userId, companyId);
    await lerOperacaoExterna(tx, companyId, competencia);
    await salvarFluxoTarefa(companyId, competencia, chave, { acao: 'concluir', versao, hash }, userId, db, { transaction: tx });
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  return lerOperacaoExterna(db, companyId, competencia);
}
