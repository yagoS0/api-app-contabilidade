// Projeção única do trabalho mensal. Ler o fluxo nunca executa uma operação fiscal.
export const ETAPAS_CARTEIRA = ['apuracao', 'obrigacoes', 'guias', 'contabilizacao', 'importacao', 'concluido'];
export const ROTULOS_ETAPA = { apuracao: 'Apuração', obrigacoes: 'Obrigações', guias: 'Guias', contabilizacao: 'Contabilização', importacao: 'Importação', concluido: 'Concluído' };
export const ROTINAS_CARTEIRA = [
  { chave: 'apurar', titulo: 'Apurar e conferir', etapa: 'apuracao', depende: [] },
  { chave: 'transmitir', titulo: 'Transmitir apuração', etapa: 'obrigacoes', depende: ['apurar'] },
  { chave: 'obrigacoes', titulo: 'Concluir obrigações do período', etapa: 'obrigacoes', depende: ['apurar'] },
  { chave: 'obter_guias', titulo: 'Obter e conferir guias', etapa: 'guias', depende: ['apurar'] },
  { chave: 'enviar_guias', titulo: 'Enviar guias ao cliente', etapa: 'guias', depende: ['obter_guias'] },
  { chave: 'contabilizar', titulo: 'Contabilizar e fechar o mês', etapa: 'contabilizacao', depende: [] },
  { chave: 'importar', titulo: 'Importar lançamentos no ERP', etapa: 'importacao', depende: ['contabilizar'] },
];

export function regimeCarteira(company) {
  const r = String(company?.legacyCompany?.regimeTributario || company?.regimeTributario || '').toUpperCase();
  return r.includes('PRESUMIDO') ? 'Presumido' : r.includes('SIMPLES') ? 'Simples' : 'Outros';
}

export function apuracaoCarteira(company) {
  const estado = company?.apuracao?.estado;
  const transmitida = ['transmitida', 'confirmada'].includes(estado);
  const apurada = transmitida || ['calculada', 'fechada', 'revisada'].includes(estado);
  return { chave: transmitida ? 'transmitido' : apurada ? 'apurado' : 'a_apurar', rotulo: transmitida ? 'Transmitido' : apurada ? 'Apurado' : 'A apurar', apurada, transmitida };
}

export function projetarFluxoCarteira(company, contexto = {}) {
  const regime = regimeCarteira(company);
  const apuracao = apuracaoCarteira(company);
  const registros = contexto.registros || [];
  const reg = chave => registros.find(r => r.chave === chave);
  const prova = chave => {
    const p = reg(chave)?.dados?.conclusao;
    return Boolean(p?.em && p.hash && p.hash === contexto.hashes?.[chave]);
  };
  if (prova('apurar')) Object.assign(apuracao, { apurada: true, chave: 'apurado', rotulo: 'Apurado', origem: 'Conferência registrada' });
  if (apuracao.transmitida || prova('transmitir')) Object.assign(apuracao, { apurada: true, transmitida: true, chave: 'transmitido', rotulo: 'Transmitido' });
  const guias = Object.values(company.guideCompliance || {}).filter(g => g && typeof g === 'object' && g.required);
  const guiasConhecidas = Boolean(company.guideCompliance) && !company.guideCompliance.erro;
  const disponiveis = guiasConhecidas && guias.every(g => ['gerada', 'enviada', 'falhou', 'vazio', 'present'].includes(g.state));
  const enviadas = guiasConhecidas && guias.every(g => ['enviada', 'vazio'].includes(g.state) && !g.pendenciaOperacional);
  const fechado = Boolean(company.fechamentoContabil?.fechado);
  const lancamentos = contexto.lancamentos || { total: null, importados: 0 };
  const importado = fechado && lancamentos.total > 0 && lancamentos.importados === lancamentos.total;
  const semLancamentos = fechado && lancamentos.total === 0;
  const contabilizacao = { chave: importado ? 'importado' : fechado ? 'fechado' : 'aberto', rotulo: importado ? 'Importado' : fechado ? 'Fechado' : 'Aberto', ...lancamentos };
  const obrigacoes = (contexto.obrigacoes || []).map(o => o.verificador === 'APURACAO_TRANSMITIDA' ? { ...o, concluida: apuracao.transmitida } : o);
  // Mês fechado é observado em sua própria etapa, não cria dependência circular.
  const fiscais = obrigacoes.filter(o => o.verificador !== 'MES_FECHADO');
  const obrigacoesOk = fiscais.every(o => o.concluida) && (regime !== 'Presumido' || fiscais.length > 0 || prova('obrigacoes'));
  const feitas = { apurar: apuracao.apurada, transmitir: apuracao.transmitida, obrigacoes: obrigacoesOk, obter_guias: disponiveis, enviar_guias: enviadas, contabilizar: fechado, importar: importado || semLancamentos };
  const modelos = ROTINAS_CARTEIRA
    .filter(t => t.chave !== 'obrigacoes' || regime !== 'Simples' || fiscais.some(o => o.verificador !== 'APURACAO_TRANSMITIDA'))
    .map(t => t.chave === 'transmitir' && regime !== 'Simples' ? { ...t, titulo: 'Registrar transmissão das declarações da apuração' } : t);
  const tarefas = modelos.map(t => ({ ...t, ...reg(t.chave), chave: t.chave, titulo: t.titulo, etapa: t.etapa, concluida: Boolean(feitas[t.chave]), automatica: !['apurar', 'transmitir', 'obrigacoes', 'importar'].includes(t.chave), dados: reg(t.chave)?.dados || {}, versao: reg(t.chave)?.versao || 0 }));
  for (const r of registros.filter(r => r.chave.startsWith('extra:'))) tarefas.push({ ...r, titulo: r.dados.titulo, etapa: r.dados.etapa, dados: r.dados, depende: [], concluida: Boolean(r.dados.conclusao?.em), automatica: false });
  for (const t of tarefas) {
    t.aguardando = (t.depende || []).filter(k => !feitas[k]);
    t.hash = contexto.hashes?.[t.chave] || null;
    t.revisar = Boolean(!t.concluida && t.dados.conclusao?.em);
  }
  const etapa = ETAPAS_CARTEIRA.find(e => tarefas.some(t => t.etapa === e && !t.concluida)) || 'concluido';
  return { competencia: contexto.competencia || company.apuracao?.competencia, regime, apuracao, contabilizacao, status: { chave: etapa, rotulo: ROTULOS_ETAPA[etapa] }, tarefas, obrigacoes, guiasConhecidas };
}

export const fluxoDaEmpresa = company => company.fluxoCarteira || projetarFluxoCarteira(company);

// As etapas usam o cadastro recorrente de obrigações; modelos não criam prazos.
export const VERIFICADORES_CARTEIRA = Object.fromEntries(ROTINAS_CARTEIRA.map(t => [
  'CARTEIRA_' + t.chave.toUpperCase(), t.titulo,
]));
export const chaveDaObrigacaoCarteira = verificador => Object.hasOwn(VERIFICADORES_CARTEIRA, verificador || '') ? verificador.slice(9).toLowerCase() : null;
export const MODELOS_OBRIGACOES_CARTEIRA = ROTINAS_CARTEIRA.flatMap(t => {
  const regimes = ['apurar', 'transmitir'].includes(t.chave) ? ['SIMPLES','LUCRO_PRESUMIDO'] : t.chave === 'obrigacoes' ? ['LUCRO_PRESUMIDO'] : [null];
  return regimes.map(regime => ({
    id: 'modelo-carteira:' + t.chave + ':' + (regime || 'TODAS'),
    titulo: (t.chave === 'transmitir' && regime === 'LUCRO_PRESUMIDO' ? 'Transmitir declarações da apuração' : t.titulo) + (regime ? ' · ' + (regime === 'SIMPLES' ? 'Simples Nacional' : 'Lucro Presumido') : ''),
    verificador: 'CARTEIRA_' + t.chave.toUpperCase(),
    categoria: ['contabilizacao','importacao'].includes(t.etapa) ? 'contabil' : 'fiscal',
    escopo: regime ? 'POR_FILTRO' : 'TODAS', filtros: regime ? {regimes:[regime]} : null,
  }));
});
