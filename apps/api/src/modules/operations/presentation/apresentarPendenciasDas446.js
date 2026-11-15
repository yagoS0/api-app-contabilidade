const fontes = {
  fiscal: { chamadas: 'Reservas fiscais', cache: 'Respostas locais em cache', despachos: 'Registros de despacho' },
  guias: { guias: 'Guias locais', pagamentos: 'Histórico local de pagamento' },
  contabilidade: { circular: 'Circular mensal', lancamentos: 'Lançamentos contábeis' },
  operacoes: { execucoes: 'Execuções fiscais', worker: 'Histórico da rotina' },
};
const dimensoes = { fiscal: 'Fiscal', guias: 'Guias e pagamentos', contabilidade: 'Contabilidade', operacoes: 'Operações' };
const textos = {
  RESUMO_MULTIEMPRESA_NAO_EXPOSTO: 'Resumo multiempresa excluído desta leitura individual.',
  LOG_SEM_IDENTIDADE_COMPLETA_NAO_ASSOCIADO: 'Logs sem identidade completa não são associados à empresa e competência.',
  SERVICO_FISCAL_NAO_RESTRINGE_DOCUMENTOS_MENSAIS: 'O filtro de serviço fiscal não restringe documentos mensais.',
  EVENTO_HISTORICO_NAO_COMPROVA_BAIXA_ATUAL_OU_REVISAO_VIGENTE: 'Evento histórico não comprova baixa atual ou revisão vigente.',
  ESTADO_SEPARADO_CONFIRMACAO_AUSENTE: 'Estado separado da confirmação não encontrado.',
  IDENTIDADE_CONFIRMACAO_DIVERGENTE: 'Identidade de confirmação divergente; registro não associado.',
  IDENTIDADE_DESPACHO_DIVERGENTE: 'Identidade de despacho divergente; registro não associado.',
  RESULTADO_EXTERNO_INCERTO_CACHE_NAO_RESOLVE_RESERVA: 'Resultado fiscal incerto; o cache não resolve a reserva.',
  LEDGER_NAO_COMPROVA_SUCESSO_FISCAL: 'O registro da chamada não comprova sucesso fiscal.',
  NENHUMA_AUTORIZACAO_DE_RETRY: 'Esta leitura não autoriza repetir a operação.',
  SEM_CHAMADA_ASSOCIAVEL_CACHE_NAO_VARRIDO: 'Nenhuma chamada associável no recorte; não houve busca global no cache.',
  CACHE_EXPIRADO_PRESERVADO_COMO_HISTORICO: 'Resposta expirada preservada como histórico.',
  CACHE_SEM_GUIA_NO_RECORTE: 'Resposta em cache sem guia correspondente no recorte.',
  GUIA_SEM_CIRCULAR_NO_RECORTE: 'Guia sem circular encontrada no recorte.',
  DOCUMENTO_GUIA_CIRCULAR_DIVERGENTE: 'Identificações documentais da guia e da circular divergem.',
  VALOR_GUIA_CIRCULAR_DIVERGENTE: 'Valores da guia e da circular do mesmo documento divergem.',
  VALOR_NAO_COMPARAVEL: 'Os valores observados não puderam ser comparados.',
  PDF_NAO_BAIXADO_NEM_VALIDADO: 'O conteúdo dos PDFs não foi baixado nem validado.',
  ORIGEM_DOCUMENTAL_NAO_COMPROVA_CONSULTA_SERPRO: 'Origem documental não comprova consulta ao SERPRO.',
  ENTREGA_NAO_VERIFICADA: 'Entrega do documento não verificada.',
  DOCUMENTOS_NAO_VERIFICAVEIS_POR_FALHA_DE_LEITURA: 'Documentos não verificáveis por falha de leitura.',
  SEM_DOCUMENTO_NO_RECORTE_NAO_AUTORIZA_RETRY: 'Nenhum documento encontrado no recorte; isso não autoriza nova emissão.',
  RECORTE_DOCUMENTAL_TRUNCADO_UNICIDADE_NAO_VERIFICAVEL: 'Recorte documental truncado; unicidade não verificável.',
  MULTIPLAS_GUIAS_REVISAO_VIGENTE_NAO_DETERMINADA: 'Múltiplas guias encontradas; revisão vigente não determinada. Duplicidade exige conferência.',
  PAGAMENTO_SEM_ORIGEM_VERIFICAVEL: 'Pagamento local sem origem verificável.',
  CONFIRMACAO_PAGAMENTO_DE_REVISAO_ANTERIOR: 'Há confirmação de pagamento de revisão anterior.',
  HISTORICO_PAGAMENTO_NAO_VERIFICAVEL: 'Histórico de pagamento não verificável.',
  HISTORICO_PAGAMENTO_TRUNCADO: 'Histórico de pagamento truncado.',
  CIRCULAR_NAO_COMPROVA_PROVISAO: 'Circular não comprova provisão contábil.',
  LINHAS_NAO_CERTIFICAM_CORRECAO_CONTABIL: 'As linhas observadas não certificam a correção contábil.',
  LANCAMENTOS_NAO_VERIFICAVEIS_POR_FALHA_DE_LEITURA: 'Lançamentos não verificáveis por falha de leitura.',
  LANCAMENTOS_TRUNCADOS_VINCULOS_AUSENTES_NAO_DETERMINAVEIS: 'Lançamentos truncados; ausência de vínculo não pode ser determinada.',
  CIRCULAR_E_FECHAMENTO_NAO_VERIFICAVEIS: 'Circular e fechamento não verificáveis.',
  SEM_LANCAMENTO_NO_RECORTE_NAO_COMPROVA_PROVISAO_CONCLUIDA: 'Nenhum lançamento no recorte; provisão concluída não comprovada.',
  LANCAMENTO_SEM_VINCULO_DOCUMENTAL_INEQUIVOCO: 'Lançamento sem vínculo documental inequívoco.',
  GUIA_SEM_PROVISAO_VINCULADA: 'Provisão vinculada à guia não encontrada no recorte.',
  VINCULO_PROVISAO_NAO_VERIFICAVEL: 'Vínculo de provisão não verificável nesta leitura.',
  LINHAS_TRUNCADAS_COMPOSICAO_CONTABIL_NAO_VERIFICAVEL: 'Linhas truncadas; composição contábil não verificável.',
  DIVERGENCIA_REGISTRADA_NA_CIRCULAR: 'Há divergência registrada na circular.',
  COMPLETED_NAO_COMPROVA_SUCESSO_FISCAL_OU_CONTABIL: 'Execução concluída não comprova sucesso fiscal ou contábil.',
  ACCOUNTING_OK_NAO_PERSISTIDO: 'O resultado contábil detalhado não é persistido neste log.',
  ENTRIES_GENERATED_ZERO_NAO_COMPROVA_CONCILIACAO: 'Nenhum lançamento gerado no log não comprova conciliação.',
  FALHA_DE_LEITURA_SEM_RETENTATIVA: 'Falha de leitura, sem retentativa.',
  CHAMADAS_INDISPONIVEIS: 'Leitura dependente indisponível porque as chamadas não puderam ser consultadas.',
  GUIAS_INDISPONIVEIS: 'Leitura dependente indisponível porque as guias não puderam ser consultadas.',
};
const estados = { abortada_auth: 'abortada por autorização', abortada_politica: 'abortada por política', recusada_cooldown: 'recusada por intervalo', recusada_teto: 'recusada por limite', DESPESA: 'despesa', RECEITA: 'receita', OUTRO: 'outro tipo', captured: 'captura registrada', error: 'erro registrado', skipped_procuration_inactive: 'não executada por procuração inativa', extrato_ja_sincronizado: 'extrato já sincronizado no log', extrato_ok: 'extrato registrado no log', extrato_erro: 'erro de extrato no log', extrato_incompleto: 'extrato incompleto no log', declaracao_nao_localizada: 'declaração não localizada no log', already_exists: 'documento já existente no log', aguardando_conferencia: 'aguardando conferência', documentos_ja_recuperados: 'documentos já recuperados no log', outro_estado_local: 'outro estado local', results: 'captura', extratoResults: 'extratos', incerta: 'resultado incerto', reservada: 'reserva pendente', ok: 'resposta registrada', erro: 'erro registrado', completed: 'concluída no log', running: 'em andamento', failed: 'falha no log', skipped: 'não executada', PAID: 'pagamento registrado', OPEN: 'pagamento não confirmado', OVERDUE: 'vencimento ultrapassado no registro', CLIENTE: 'cliente', SERPRO: 'SERPRO', MANUAL: 'registro manual', LOCAL: 'registro local', UPLOAD: 'anexo manual', DRIVE: 'importação', PROVISAO: 'provisão', BAIXA: 'baixa', ESTORNO: 'estorno' };
const label = v => estados[v] || 'não identificado';
const instante = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (Brasília)' : 'não identificado';
const interpretacoes = { DOCUMENTO_NA_RESPOSTA_LOCAL: 'documento interpretado na resposta local', SERPRO_PGDASD_NO_DEBTS_FOUND: 'resposta histórica interpretada como ausência de débitos', SERPRO_PGDASD_NO_AMOUNT_DUE: 'resposta histórica interpretada como ausência de valor devido', SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED: 'resposta histórica indica declaração não transmitida' };
const ref = item => item.id || item.guideId || item.reservaId || item.assinatura || 'sem referência identificada';
const avisosGerais = new Set(['LEDGER_NAO_COMPROVA_SUCESSO_FISCAL','NENHUMA_AUTORIZACAO_DE_RETRY','PDF_NAO_BAIXADO_NEM_VALIDADO','ORIGEM_DOCUMENTAL_NAO_COMPROVA_CONSULTA_SERPRO','ENTREGA_NAO_VERIFICADA','CIRCULAR_NAO_COMPROVA_PROVISAO','LINHAS_NAO_CERTIFICAM_CORRECAO_CONTABIL','COMPLETED_NAO_COMPROVA_SUCESSO_FISCAL_OU_CONTABIL','ACCOUNTING_OK_NAO_PERSISTIDO','ENTRIES_GENERATED_ZERO_NAO_COMPROVA_CONCILIACAO','RESUMO_MULTIEMPRESA_NAO_EXPOSTO','LOG_SEM_IDENTIDADE_COMPLETA_NAO_ASSOCIADO','SERVICO_FISCAL_NAO_RESTRINGE_DOCUMENTOS_MENSAIS','EVENTO_HISTORICO_NAO_COMPROVA_BAIXA_ATUAL_OU_REVISAO_VIGENTE','SEM_CHAMADA_ASSOCIAVEL_CACHE_NAO_VARRIDO','SEM_DOCUMENTO_NO_RECORTE_NAO_AUTORIZA_RETRY','SEM_LANCAMENTO_NO_RECORTE_NAO_COMPROVA_PROVISAO_CONCLUIDA']);
const limite = 'Evidência local do recorte; não comprova regularidade fiscal, conciliação definitiva ou autorização para repetir efeitos.';
function observar(nome, item) {
  switch (nome) {
    case 'chamadas': return `Reserva ${ref(item)}: ${label(item.estadoLocal)}. Registro: ${instante(item.registradaEm)}.`;
    case 'cache': return `Resposta local ${ref(item)}: ${interpretacoes[item.interpretacao] || 'interpretação não verificável'}; ${item.pdfNaResposta ? 'PDF presente na resposta' : 'PDF não identificado na interpretação'}; ${item.vigente ? 'prazo local vigente' : 'prazo local expirado'}. Documento ${item.numeroDocumento || 'não identificado'}. Correspondência documental e situação fiscal atual não certificadas.`;
    case 'guias': return `Guia ${ref(item)}; documento ${item.numeroDocumento || 'não identificado'}; origem ${label(item.origem)}; valor registrado ${item.valor ?? 'não identificado'}. Revisão atualizada em ${instante(item.revisao?.atualizadaEm)}; hash ${item.revisao?.hash || 'não identificado'}. Pagamento: ${label(item.pagamento?.estadoLocal)}, origem ${label(item.pagamento?.origem)}; ${item.pagamento?.referenciaComprovante ? 'referência de comprovante presente' : 'referência de comprovante não identificada'}. Confirmação local: ${instante(item.pagamento?.confirmadoEm)}.`;
    case 'circular': return `Circular ${ref(item)}: ${item.fechadoContabilEm ? `fechamento contábil registrado em ${instante(item.fechadoContabilEm)}` : 'sem data de fechamento contábil no registro'}; documento ${item.numeroDocumento || 'não identificado'}; valor registrado ${item.dasTotal ?? 'não identificado'}.`;
    case 'lancamentos': return `Lançamento ${ref(item)}: ${label(item.tipo)}; ${item.sourceGuideId ? `vinculado à guia ${item.sourceGuideId}` : 'sem vínculo documental inequívoco'}${item.linhasTruncadas ? '; linhas truncadas' : ''}.`;
    case 'execucoes': return `Execução ${ref(item)}: ${label(item.status)}; lançamentos gerados segundo o log: ${item.entriesGenerated ?? 'não informado'}. Resultado contábil não comprovado pelo log.`;
    case 'pagamentos': return `Evidência de pagamento ${ref(item)}, guia ${item.guideId || 'não identificada'}, origem ${label(item.origem)}, confirmada em ${instante(item.confirmadoEm)}${item.revisaoCompativel === false ? ': revisão anterior ou incompatível' : ': compatibilidade não certifica baixa'}. Comprovante referenciado não é validação bancária.`;
    case 'despachos': return `Despacho da reserva ${ref(item)}, autorização registrada em ${instante(item.autorizadoEm)}. Registro não comprova transporte ou resultado fiscal.`;
    case 'worker': return `Registro de rotina ${item.registro || 'não identificado'} (${label(item.grupo)}): ${label(item.status)}, observado para esta empresa e competência. Registro não comprova sucesso fiscal ou contábil.`;
    default: return `Registro local ${ref(item)} observado. Não comprova conclusão fiscal ou contábil.`;
  }
}

// Pure presentation of the authorized 4.4.5 DTO; no additional reads or business decisions.
export function apresentarPendenciasDas446(leitura) {
  const achados = [], fontesApresentadas = [], avisos = new Set();
  const adicionar = (dimensao, origem, evidencia, classificacao = 'Limitação da evidência') => achados.push({ id: String(achados.length), dimensao, origem, evidencia, classificacao, limitacao: limite });
  function lacuna(codigo, dimensao, origem) {
    const [chave, ...referencias] = codigo.split(':');
    const referencia = referencias.join(':');
    if (avisosGerais.has(chave)) { avisos.add(`${dimensao} — ${origem}: ${textos[chave]}`); return; }
    if (['FONTE_NAO_VERIFICAVEL', 'RECORTE_TRUNCADO'].includes(chave)) return; // source rows retain these explicitly
    adicionar(dimensao, origem, (textos[chave] || 'Limitação adicional não interpretada; evidência exige conferência.') + (referencia ? ` Referência: ${referencia}.` : ''), chave.includes('INCERTO') ? 'Resultado incerto' : chave.includes('DIVERGEN') ? 'Divergência observada' : 'Limitação da evidência');
  }
  for (const [dimensao, nomes] of Object.entries(fontes)) {
    const bloco = leitura[dimensao];
    for (const [nome, titulo] of Object.entries(nomes)) {
      const fonte = bloco[nome];
      const disponivel = fonte.consulta === 'ok' && Array.isArray(fonte.items);
      const truncado = fonte.truncated === true || fonte.items?.some(i => i.linhasTruncadas) === true;
      fontesApresentadas.push({ id: nome, nome: titulo, dimensao: dimensoes[dimensao], estado: !disponivel ? fonte.consulta === 'falhou' ? 'Falha na leitura' : 'Não consultada' : truncado ? 'Leitura truncada' : 'Leitura realizada', quantidade: disponivel ? fonte.items.length : null, truncado, limit: fonte.limit });
      if (!disponivel) adicionar(dimensoes[dimensao], titulo, 'Fonte indisponível nesta consulta; ausência de registros não pode ser determinada.', 'Leitura incompleta');
      if (truncado) adicionar(dimensoes[dimensao], titulo, 'Limite da fonte ou de suas linhas atingido. Os registros exibidos não representam o total.', 'Leitura truncada');
      for (const item of fonte.items || []) adicionar(dimensoes[dimensao], titulo, observar(nome, item), nome === 'chamadas' && ['incerta','reservada'].includes(item.estadoLocal) ? 'Resultado incerto' : 'Registro local observado');
      for (const codigo of fonte.lacunas || []) lacuna(codigo, dimensoes[dimensao], titulo);
    }
    for (const codigo of bloco.lacunas || []) lacuna(codigo, dimensoes[dimensao], 'Projeção local da dimensão');
  }
  for (const codigo of leitura.lacunas || []) lacuna(codigo, 'Entre dimensões', 'Comparação das evidências locais');
  return { contrato: 'pendencias-das-leitura-4.4.6', companyId: leitura.companyId, competencia: leitura.competencia, consultadoEm: leitura.consultadoEm,
    limit: leitura.limit, servico: leitura.servico, documentoId: leitura.documentoId, fontes: fontesApresentadas, achados,
    truncado: fontesApresentadas.some(f => f.truncado), falhasParciais: fontesApresentadas.some(f => f.quantidade === null),
    limitacoes: ['Observações independentes, sem snapshot global; as fontes podem mudar durante a leitura.', 'Limite padrão de 50, máximo de 100 registros por fonte e por conjunto de linhas; não há paginação das fontes.', 'Ausência de evidência não comprova regularidade, irregularidade ou ausência de dívida.', 'O filtro de serviço restringe chamadas e cache, não as guias mensais. Cache sem chamada associável não é varrido.', 'Presença de PDF ou comprovante não valida seu conteúdo. Esta consulta não acessa o SERPRO.', ...avisos] };
}
