import { validarEdicaoTarefa } from '../../../../../packages/shared/src/accounting/validarTarefaCarteira.js';
export { validarEdicaoTarefa };
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { projetarFluxoCarteira, ROTINAS_CARTEIRA, ETAPAS_CARTEIRA, chaveDaObrigacaoCarteira } from '../../../../../packages/shared/src/accounting/fluxoCarteira.js';
import { computeGuideComplianceMap } from '../guides/guideCompliance.js';
import { dataCivil } from '../obrigacoes/ObrigacoesService.js';

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const erro = (message, status = 400) => Object.assign(new Error(message), { status });
export function competenciaValida(c) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c || '')) throw erro('Informe uma competência válida (AAAA-MM).');
  return c;
}
export function hashLancamento(e, fechamento) {
  return hash([fechamento, e.id, e.updatedAt, e.data, e.tipo, e.status, e.historico, [...(e.lines || [])].sort((a,b) => a.id.localeCompare(b.id))]);
}

export async function contextosCarteira(companies, competencia, db = prisma) {
  competenciaValida(competencia);
  const ids = companies.map(c => c.companyId);
  if (!ids.length) return new Map();
  const inicio = new Date(`${competencia}-01T00:00:00Z`), fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  const [registros, snapshots, circulares, entries, notas, ocorrencias] = await Promise.all([
    db.carteiraTarefa.findMany({ where: { portalClientId: { in: ids }, competencia } }),
    db.apuracaoSnapshot.findMany({ where: { portalClientId: { in: ids }, competencia }, select: { portalClientId: true, estado: true, idempotencyKey: true, transmitidoEm: true } }),
    db.companyMonthlyCircular.findMany({ where: { portalClientId: { in: ids }, competencia }, select: { portalClientId: true, fechadoContabilEm: true } }),
    db.accountingEntry.findMany({ where: { portalClientId: { in: ids }, competencia, tipo: { not: 'PARCELA' } }, include: { lines: true }, orderBy: { id: 'asc' } }),
    db.portalInvoice.findMany({ where: { clientId: { in: ids }, competencia: { gte: inicio, lt: fim }, papel: 'EMIT' }, select: { clientId: true, id: true, total: true, statusEfetivo: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    db.ocorrenciaObrigacao.findMany({ where: { competenciaRef: competencia, canceladaEm: null, foraDaRecorrencia: false, obrigacao: { portalClientId: { in: ids }, ativa: true, tipo: 'OBRIGACAO', OR: [{ verificador: null }, { NOT: { verificador: { startsWith: 'CARTEIRA_' } } }] } }, include: { obrigacao: { select: { portalClientId: true, nome: true, verificador: true } } }, orderBy: { id: 'asc' } }),
  ]);
  return new Map(companies.map(company => {
    const id = company.companyId;
    const regs = registros.filter(r => r.portalClientId === id);
    const snapshot = snapshots.find(s => s.portalClientId === id);
    const fechadoEm = circulares.find(c => c.portalClientId === id)?.fechadoContabilEm || null;
    const es = entries.filter(e => e.portalClientId === id);
    const registroImportacao = regs.find(r => r.chave === 'importar')?.dados?.importacoes || {};
    const lancamentos = es.map(e => ({ id: e.id, historico: e.historico || 'Sem histórico', status: e.status, hash: hashLancamento(e, fechadoEm), importavel: Boolean(fechadoEm) && e.status === 'EXPORTADO' }));
    for (const e of lancamentos) e.importado = e.importavel && registroImportacao[e.id]?.hash === e.hash;
    const base = [id, competencia, company.legacyCompany?.regimeTributario, notas.filter(n => n.clientId === id), snapshot || null];
    const obrigacoes = ocorrencias.filter(o => o.obrigacao.portalClientId === id).map(o => ({ id: o.id, nome: o.obrigacao.nome, verificador: o.obrigacao.verificador, concluida: o.obrigacao.verificador === 'MES_FECHADO' ? Boolean(fechadoEm) : o.obrigacao.verificador === 'APURACAO_TRANSMITIDA' ? ['transmitida','confirmada'].includes(snapshot?.estado) : o.status === 'CONCLUIDA', vencimento: o.dataVencimento, updatedAt: o.updatedAt }));
    const contexto = { competencia, registros: regs, obrigacoes, hashes: { apurar: hash(base), transmitir: hash(base), obrigacoes: hash([base, obrigacoes]), importar: hash(lancamentos) }, lancamentos: { total: es.length, importados: lancamentos.filter(e => e.importado).length } };
    const atual = { ...company, apuracao: { ...company.apuracao, estado: snapshot?.estado || null, transmitidoEm: snapshot?.transmitidoEm || null }, fechamentoContabil: { fechado: Boolean(fechadoEm), fechadoEm } };
    return [id, { fluxo: projetarFluxoCarteira(atual, contexto), lancamentos, contexto, company: atual }];
  }));
}

export async function anexarFluxoCarteira(companies, competencia, db = prisma) {
  const mapa = await contextosCarteira(companies, competencia, db);
  return companies.map(c => ({ ...c, fluxoCarteira: mapa.get(c.companyId).fluxo }));
}

export async function listarAgendaCarteira(portalIds, inicio, fim, db = prisma) {
  const de = dataCivil(inicio), ate = dataCivil(fim);
  if (ate < de || ate - de > 366 * 86400000) throw erro('Escolha um intervalo de até um ano.');
  const agendadas = await db.carteiraTarefa.findMany({ where: { portalClientId: { in: portalIds }, dataInicio: { lte: ate }, dataFim: { gte: de } } });
  if (!agendadas.length) return [];
  const ids = [...new Set(agendadas.map(t => t.portalClientId))];
  const portals = await db.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true, razao: true, hasProlabore: true } });
  const legacies = await db.company.findMany({ where: { id: { in: portals.map(p => p.companyId).filter(Boolean) } } });
  const itens = [];
  for (const competencia of [...new Set(agendadas.map(t => t.competencia))]) {
    const tarefas = agendadas.filter(t => t.competencia === competencia);
    const companies = portals.filter(p => tarefas.some(t => t.portalClientId === p.id)).map(p => ({ companyId: p.id, razao: p.razao, hasProlabore: p.hasProlabore, legacyCompany: legacies.find(l => l.id === p.companyId) || null }));
    const guias = await computeGuideComplianceMap(companies.map(c => ({ portalId: c.companyId, hasProlabore: c.hasProlabore, legacy: c.legacyCompany })), competencia);
    for (const c of companies) c.guideCompliance = guias.get(c.companyId);
    const mapa = await contextosCarteira(companies, competencia, db);
    for (const r of tarefas) {
      const detalhe = mapa.get(r.portalClientId), t = detalhe.fluxo.tarefas.find(t => t.chave === r.chave);
      if (!t) continue;
      itens.push({ id: `fluxo:${r.id}`, tipo: 'fluxo', chave: r.chave, companyId: r.portalClientId, empresa: detalhe.company.razao, competencia, titulo: `${t.titulo} · ${detalhe.fluxo.regime}`, dataInicio: r.dados.dataInicio, dataFim: r.dados.dataFim, resolvido: t.concluida, responsavel: r.dados.responsavel });
    }
  }
  return itens;
}

export async function lerFluxoEmpresa(id, competencia, db = prisma) {
  competenciaValida(competencia);
  const portal = await db.portalClient.findUnique({ where: { id } });
  if (!portal) throw erro('Empresa não encontrada.', 404);
  const legacy = portal.companyId ? await db.company.findUnique({ where: { id: portal.companyId } }) : null;
  const company = { companyId: id, razao: portal.razao, hasProlabore: portal.hasProlabore, legacyCompany: legacy };
  // Este serviço consulta somente documentos e configurações locais.
  const compliance = await computeGuideComplianceMap([{ portalId: id, hasProlabore: Boolean(portal.hasProlabore), legacy }], competencia);
  company.guideCompliance = compliance.get(id) || null;
  return (await contextosCarteira([company], competencia, db)).get(id);
}

export async function salvarFluxoTarefa(id, competencia, chave, corpo, userId, db = prisma) {
  competenciaValida(competencia);
  if (!ROTINAS_CARTEIRA.some(t => t.chave === chave) && !/^extra:[a-zA-Z0-9-]{1,80}$/.test(chave)) throw erro('Tarefa inválida.');
  // Lock por empresa/competência + serializable preservam histórico e recusam prévias antigas.
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`carteira:${id}:${competencia}`}))`;
    const detalhe = await lerFluxoEmpresa(id, competencia, tx);
    const existente = detalhe.contexto.registros.find(t => t.chave === chave);
    const tarefa = detalhe.fluxo.tarefas.find(t => t.chave === chave) || (chave.startsWith('extra:') ? { chave, dados: {}, versao: 0, automatica: false } : null);
    if (!tarefa) throw erro('Esta tarefa não se aplica à empresa.');
    if (!existente && chave.startsWith('extra:') && (corpo.acao !== 'planejar' || !corpo.titulo?.trim() || !corpo.etapa)) throw erro('Informe título e etapa da tarefa específica.');
    const dados = validarEdicaoTarefa(corpo, tarefa, detalhe);
    const em = new Date().toISOString();
    if (corpo.acao === 'concluir') {
      dados.conclusao = { ...dados.conclusao, em, por: userId };
      if (chave === 'importar') for (const id of corpo.entryIds || []) dados.importacoes[id] = { ...dados.importacoes[id], em, por: userId };
    }
    const evento = { id: randomUUID(), em, por: userId, acao: corpo.acao || 'planejar', anterior: existente?.dados || {}, dados };
    const data = { dados, dataInicio: dados.dataInicio ? new Date(`${dados.dataInicio}T00:00:00Z`) : null, dataFim: dados.dataFim ? new Date(`${dados.dataFim}T00:00:00Z`) : null, historico: [...(existente?.historico || []), evento], versao: (existente?.versao || 0) + 1 };
    if (existente) await tx.carteiraTarefa.update({ where: { id: existente.id }, data });
    else await tx.carteiraTarefa.create({ data: { ...data, portalClientId: id, competencia, chave } });
    return { salvo: true };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

// Obrigações nativas observam a mesma evidência da carteira, inclusive sua invalidação.
export async function reconciliarObrigacoesCarteira(ocorrencias, db = prisma) {
  const ids = [...new Set(ocorrencias.map(o => o.obrigacao.portalClientId))];
  const portals = await db.portalClient.findMany({where:{id:{in:ids}},select:{id:true,companyId:true,razao:true,hasProlabore:true}});
  const legacies = await db.company.findMany({where:{id:{in:portals.map(p=>p.companyId).filter(Boolean)}}});
  let concluidas = 0;
  for (const competencia of [...new Set(ocorrencias.map(o=>o.competenciaRef))]) {
    const grupo = ocorrencias.filter(o=>o.competenciaRef===competencia);
    const companies = portals.filter(p=>grupo.some(o=>o.obrigacao.portalClientId===p.id)).map(p=>({companyId:p.id,razao:p.razao,hasProlabore:p.hasProlabore,legacyCompany:legacies.find(l=>l.id===p.companyId)}));
    const guias = await computeGuideComplianceMap(companies.map(c=>({portalId:c.companyId,hasProlabore:c.hasProlabore,legacy:c.legacyCompany})),competencia);
    for(const c of companies)c.guideCompliance=guias.get(c.companyId);
    const mapa = await contextosCarteira(companies,competencia,db);
    for(const oc of grupo){
      const tarefa = mapa.get(oc.obrigacao.portalClientId)?.fluxo.tarefas.find(t=>t.chave===chaveDaObrigacaoCarteira(oc.obrigacao.verificador));
      const feita = Boolean(tarefa?.concluida);
      if(feita === (oc.status==='CONCLUIDA'))continue;
      const out=await db.ocorrenciaObrigacao.updateMany({where:{id:oc.id,updatedAt:oc.updatedAt,canceladaEm:null,foraDaRecorrencia:false},data:{status:feita?'CONCLUIDA':'PENDENTE',concluidaEm:feita?new Date():null,fonteConclusao:feita?'AUTOMATICA':null}});
      if(feita)concluidas+=out.count;
    }
  }
  return concluidas;
}
