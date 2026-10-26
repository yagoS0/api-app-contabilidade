import { prisma } from '../../infrastructure/db/prisma.js';
import { carregarEvidenciasJornada, tiposConferencia } from './JornadaLeadService.js';
import { montarJornadaComercial, procuracaoManualVigente } from './PoliticaJornadaComercial.js';

// Leitura interna de ficha já autorizada. A política existente decide o passo.
export async function projetarComercial(ficha, db = prisma) {
  const where = { onboardingId: ficha.id };
  const [jornada, propostas, contratos, marcos, atendimento] = await Promise.all([
    carregarEvidenciasJornada(ficha, db),
    db.propostaComercial.findMany({ where, orderBy: { versao: 'desc' } }),
    db.contratoComercial.findMany({ where, orderBy: { createdAt: 'desc' } }),
    db.onboardingEvento.findMany({ where: { ...where, tipo: { in: ['DOCUMENTACAO_CONFERIDA', 'PAGAMENTO_HONORARIOS_CONFERIDO', 'ANALISE_REVISADA', 'CONVERTIDO'] } }, orderBy: { createdAt: 'desc' } }),
    db.atendimentoLead.findFirst({ where: { ...where, encerradoEm: null } }),
  ]);
  return resumirComercial(ficha, jornada, propostas, contratos, marcos, atendimento);
}

function resumirComercial(ficha, jornada, propostas, contratos, marcos, atendimento) {
  const projecao = montarJornadaComercial({ onboarding: ficha, jornada, propostas, contratos, marcos, atendimento });
  const atual = projecao.passos.find(p => p.id === projecao.atual);
  return {
    contratacao: projecao.contratacao,
    atual: projecao.atual, titulo: (ficha.status === 'CONVERTIDO' && projecao.contratacao.politica ? (projecao.contratacao.ganha ? 'Ganha · na carteira' : 'Na carteira · recebimento pendente') : null)
      || ({ CONVERTIDO: 'Na carteira · implantação em acompanhamento', CONCLUIDO_AVULSO: 'Serviço avulso concluído', DESISTIU: 'Atendimento encerrado por desistência' })[ficha.status]
      || (projecao.contratacao.ganha ? 'Ganha · ' + (projecao.contratacao.carteiraPermitida ? 'entrada na carteira disponível' : 'confira os requisitos do atendimento')
        : projecao.contratacao.carteiraPermitida ? 'Carteira disponível · pagamento futuro contratado' : atual?.titulo) || 'Execução e conclusão',
    pendencias: projecao.pendencias, encerrado: projecao.encerrado,
    passos: projecao.passos.map(({ id, titulo, concluido }) => ({ id, titulo, concluido })),
    evidencias: evidenciasDiagnostico(ficha, jornada, atendimento),
  };
}

export function evidenciasDiagnostico(ficha, jornada, atendimento, agora = new Date()) {
  const evidencias = [];
  const fiscal = jornada.analises?.find(a => a.cnpj === ficha.cnpj && a.tipo === 'SITFIS' && a.status === 'CONCLUIDA' && a.resultado?.relatorioDisponivel);
  if (fiscal && jornada.fiscalConferido) evidencias.push({ chave: 'sitfis', id: fiscal.id, cnpj: ficha.cnpj, origem: 'Diagnóstico comercial', escopo: 'Relatório SITFIS conferido', em: fiscal.createdAt, satisfaz: true });
  const a = atendimento?.autorizacao;
  if (jornada.fiscalAlternativa) evidencias.push({ chave: 'sitfis', id: jornada.fiscalAlternativa.id, cnpj: ficha.cnpj,
    origem: jornada.fiscalAlternativa.dados.modo, escopo: jornada.fiscalAlternativa.dados.limitacao,
    em: jornada.fiscalAlternativa.createdAt, atorId: jornada.fiscalAlternativa.atorId, satisfaz: false });
  const manualAtendimento = a?.cnpj === ficha.cnpj && procuracaoManualVigente(ficha, a?.validacaoManual);
  if (manualAtendimento) evidencias.push({ chave: 'procuracao_ecac', id: atendimento.id,
    cnpj: ficha.cnpj, origem: 'MANUAL', escopo: a.validacaoManual.limitacao, em: a.validacaoManual.registradaEm,
    atorId: a.validacaoManual.atorId, estado: 'VALIDADA_MANUALMENTE', satisfaz: false });
  const manual = ficha.dados?.procuracaoManual;
  if (!manualAtendimento && procuracaoManualVigente(ficha, manual)) evidencias.push({ chave: 'procuracao_ecac', id: ficha.id,
    cnpj: ficha.cnpj, origem: 'MANUAL', escopo: manual.limitacao, em: manual.registradaEm, atorId: manual.atorId, estado: 'VALIDADA_MANUALMENTE', satisfaz: false });
  const expirada = a?.prova?.validUntil && new Date(a.prova.validUntil).getTime() <= new Date(agora).getTime();
  if (a && a.cnpj === ficha.cnpj) evidencias.push({ chave: 'procuracao_ecac', id: atendimento.id, cnpj: ficha.cnpj, origem: 'Diagnóstico comercial', escopo: 'Autorização para SITFIS; demais acessos exigem conferência', em: a.prova?.checkedAt || null, validade: a.prova?.validUntil || null, estado: expirada ? 'EXPIRADA · evidência histórica' : a.estado, estadoRegistrado: a.estado, historica: Boolean(expirada), satisfaz: false });
  return evidencias;
}

export function etapasComEvidencias(etapas = [], evidencias = []) {
  return etapas.map(etapa => ({ ...etapa, evidencias: evidencias.filter(e => e.chave === etapa.chave) }));
}

// Somente fichas previamente autorizadas. Janelas POR ficha, nunca take global.
// Reutiliza a leitura individual e a política; não cria outra jornada.
export async function projetarComerciais(fichas, db = prisma) {
  if (!fichas.length) return new Map();
  const ids = fichas.map(f => f.id);
  const where = { onboardingId: { in: ids } };
  const [analises, registros, conferencias, apresentacoes, propostas, contratos, marcos, atendimentos] = await Promise.all([
    db.onboardingAnalise.findMany({ where: { OR: fichas.map(f => ({ onboardingId: f.id, cnpj: f.cnpj || '' })) }, orderBy: { createdAt: 'desc' }, select: { onboardingId: true, id: true, tipo: true, status: true, cnpj: true, resultado: true, createdAt: true } }),
    db.onboardingEvento.findMany({ where: { ...where, tipo: 'JORNADA_DIAGNOSTICO' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    db.onboardingEvento.findMany({ where: { ...where, tipo: { in: tiposConferencia } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    db.onboardingEvento.findMany({ where: { ...where, tipo: 'JORNADA_DEVOLUTIVA_CONFERIDA' }, orderBy: { createdAt: 'desc' } }),
    db.propostaComercial.findMany({ where, orderBy: { versao: 'desc' } }),
    db.contratoComercial.findMany({ where, orderBy: { createdAt: 'desc' } }),
    db.onboardingEvento.findMany({ where: { ...where, tipo: { in: ['DOCUMENTACAO_CONFERIDA', 'PAGAMENTO_HONORARIOS_CONFERIDO', 'ANALISE_REVISADA', 'CONVERTIDO'] } }, orderBy: { createdAt: 'desc' } }),
    db.atendimentoLead.findMany({ where: { ...where, encerradoEm: null } }),
  ]);
  function agrupar(rows) {
    const grupos = new Map(ids.map(id => [id, []]));
    for (const row of rows) grupos.get(row.onboardingId)?.push(row);
    return grupos;
  }
  const grupos = [analises, registros, conferencias, apresentacoes, propostas, contratos, marcos, atendimentos].map(agrupar);
  const diagnosticos = [...grupos[1].values()].flatMap(rows => rows.slice(0, 1).map(r => r.id));
  const saidas = diagnosticos.length ? await db.mensagemWhatsapp.findMany({
    where: { direcao: 'out', OR: diagnosticos.map(id => ({ referenciaComercial: { path: ['diagnosticoId'], equals: id } })) },
    orderBy: [{ registradaEm: 'desc' }, { id: 'desc' }], select: { id: true, statusEnvio: true, referenciaComercial: true, erroEnvioMensagem: true },
  }) : [];
  const porDiagnostico = new Map(diagnosticos.map(id => [id, []]));
  for (const saida of saidas) porDiagnostico.get(saida.referenciaComercial?.diagnosticoId)?.push(saida);
  const resultado = new Map();
  for (const ficha of fichas) {
    const [a, r, c, ap, p, ct, m, at] = grupos.map(g => g.get(ficha.id));
    const jornada = await carregarEvidenciasJornada(ficha, db, { analises: a.slice(0, 100), registros: r.slice(0, 1), conferencias: c.slice(0, 100), apresentacoes: ap, saidas: porDiagnostico.get(r[0]?.id) || [] });
    resultado.set(ficha.id, resumirComercial(ficha, jornada, p, ct, m, at[0] || null));
  }
  return resultado;
}
