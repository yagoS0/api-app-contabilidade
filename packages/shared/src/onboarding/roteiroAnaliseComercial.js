// Roteiro orientativo: nenhum resultado é presumido por consulta ou por abrir a tela.
export const DADOS_ANALISE = [
  { chave: 'receita12Meses', rotulo: 'Receita dos últimos 12 meses (R$)', tipo: 'valor' },
  { chave: 'funcionariosClt', rotulo: 'Funcionários CLT', campoFicha: 'qtdFuncionarios', tipo: 'inteiro' },
  { chave: 'sociosProLabore', rotulo: 'Sócios com pró-labore', tipo: 'inteiro' },
  { chave: 'documentosEntradaMes', rotulo: 'Notas recebidas e despesas por mês', campoFicha: 'notasRecebidasMes', tipo: 'inteiro' },
  { chave: 'notasEmitidasMes', rotulo: 'Notas emitidas por mês', tipo: 'inteiro' },
  { chave: 'formaEmissao', rotulo: 'Como emite notas atualmente', tipo: 'texto' },
  { chave: 'contasBancarias', rotulo: 'Contas bancárias movimentadas', tipo: 'inteiro' },
  { chave: 'maquininhas', rotulo: 'Maquininhas movimentadas', tipo: 'inteiro' },
];
export const CONFERENCIAS_ANALISE = [
  { chave: 'viabilidade', rotulo: 'Atividade, endereço e viabilidade', abertura: true },
  { chave: 'cadastro', rotulo: 'Cartão CNPJ, atividade, sócios e abertura' },
  { chave: 'simples', rotulo: 'Simples Nacional, histórico e sublimites' },
  { chave: 'certidoesFederais', rotulo: 'Certidões RFB e PGFN' },
  { chave: 'certidoesLocais', rotulo: 'Certidões estadual e municipal' },
  { chave: 'certidoesTrabalhistas', rotulo: 'FGTS e CNDT' },
  { chave: 'declaracoes', rotulo: 'Declarações, eSocial e omissões' },
  { chave: 'debitos', rotulo: 'Débitos, origem e parcelamentos' },
  { chave: 'tributacao', rotulo: 'Regime, anexo ou presunção e retenções', todas: true },
  { chave: 'comparativo', rotulo: 'Comparativo tributário e Fator R, quando aplicável', todas: true },
  { chave: 'recuperacao', rotulo: 'Indícios de imposto pago a mais nos últimos 5 anos' },
];
export const BLOCOS_DEVOLUTIVA = [
  { chave: 'certo', rotulo: 'O que está certo' },
  { chave: 'atencao', rotulo: 'Pontos de atenção e o que falta conferir' },
  { chave: 'corrigir', rotulo: 'O que podemos corrigir ou fazer a seguir' },
];
export const conferenciasDaOrigem = origem => CONFERENCIAS_ANALISE.filter(c => c.todas || Boolean(c.abertura) === (origem === 'ABERTURA'));
const texto = v => typeof v === 'string' ? v.trim() : '';
const falhar = mensagem => { throw Object.assign(new Error(mensagem), { code: 'diagnostico_incompleto', status: 409 }); };
export function normalizarRoteiroAnalise(entrada = {}, origem) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) falhar('Confira o roteiro da análise.');
  const dados = {}, conferencias = {};
  for (const c of DADOS_ANALISE) {
    const v = entrada.dados?.[c.chave];
    if (v == null || v === '') continue;
    if (c.tipo === 'texto') {
      if (typeof v !== 'string' || v.trim().length > 500) falhar('Confira ' + c.rotulo.toLowerCase() + '.');
      dados[c.chave] = v.trim();
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000000000000 || c.tipo === 'inteiro' && !Number.isSafeInteger(v)) falhar('Confira ' + c.rotulo.toLowerCase() + '.');
      dados[c.chave] = v;
    }
  }
  for (const c of conferenciasDaOrigem(origem)) {
    const item = entrada.conferencias?.[c.chave] || {}, estado = item.estado || 'PENDENTE', evidencia = texto(item.evidencia);
    if (!['PENDENTE', 'FEITO', 'NAO_APLICAVEL'].includes(estado) || evidencia.length > 1200 || estado !== 'PENDENTE' && evidencia.length < 10) falhar('Registre a evidência ou o motivo de não aplicação: ' + c.rotulo + '.');
    conferencias[c.chave] = { estado, evidencia };
  }
  return { versao: 1, dados, conferencias };
}
export function pendenciasRoteiroAnalise(roteiro, origem) {
  return [
    ...DADOS_ANALISE.filter(c => roteiro?.dados?.[c.chave] == null || roteiro.dados[c.chave] === '').map(c => c.rotulo),
    ...conferenciasDaOrigem(origem).filter(c => !roteiro?.conferencias?.[c.chave] || roteiro.conferencias[c.chave].estado === 'PENDENTE').map(c => c.rotulo),
  ];
}
export function normalizarDiagnosticoComercial(body, origem) {
  const devolutiva = {};
  for (const c of BLOCOS_DEVOLUTIVA) {
    const v = texto(body.devolutiva?.[c.chave]);
    if (v.length < 10 || v.length > 1200) falhar('Preencha ' + c.rotulo.toLowerCase() + ' (10 a 1.200 caracteres).');
    devolutiva[c.chave] = v;
  }
  let regularizacao = null;
  if (origem !== 'ABERTURA') {
    const r = body.regularizacao;
    if (typeof r?.necessaria !== 'boolean' || texto(r.justificativa).length < 10 || texto(r.justificativa).length > 1200) falhar('Confira se há regularização necessária e registre o motivo.');
    const condicaoInicioMensal = r.necessaria ? 'APOS_REGULARIZACAO' : 'SEM_REGULARIZACAO';
    if (r.condicaoInicioMensal && r.condicaoInicioMensal !== condicaoInicioMensal) falhar('A regularização necessária deve ocorrer antes da contabilidade mensal.');
    regularizacao = { necessaria: r.necessaria, justificativa: texto(r.justificativa), condicaoInicioMensal };
  }
  const roteiro = normalizarRoteiroAnalise(body.roteiro, origem);
  return { devolutiva, regularizacao, roteiro, roteiroPendencias: pendenciasRoteiroAnalise(roteiro, origem) };
}
export function pendenciasDiagnosticoComercial(dados, origem) {
  if (!dados) return ['Diagnóstico atual conferido'];
  const pendencias = BLOCOS_DEVOLUTIVA.filter(c => texto(dados.devolutiva?.[c.chave]).length < 10).map(c => c.rotulo);
  if (origem !== 'ABERTURA' && (typeof dados.regularizacao?.necessaria !== 'boolean' || texto(dados.regularizacao?.justificativa).length < 10)) pendencias.push('Decisão sobre regularização e condição de início');
  return pendencias;
}
export function textoDaDevolutiva(dados, { cnpj, manual = false } = {}) {
  const partes = [cnpj ? `Análise do atendimento · CNPJ ${cnpj}` : 'Análise da abertura'];
  for (const bloco of BLOCOS_DEVOLUTIVA) partes.push(`${bloco.rotulo}:\n${dados.devolutiva[bloco.chave]}`);
  partes.push(`Serviços propostos:\n${dados.servicos}`);
  if (dados.regularizacao?.necessaria) partes.push('A regularização será orçada separadamente e deverá ocorrer antes do início da contabilidade mensal.');
  if (manual) partes.push('Dados cadastrais conferidos manualmente; consulta automática não utilizada. A conferência cadastral não comprova regularidade fiscal.');
  if (dados.dispensaConsultaPrivada) partes.push('Limitação do escopo, sem consulta fiscal privada: ' + dados.dispensaConsultaPrivada);
  if (dados.roteiroPendencias?.length) partes.push('Ainda não conferido nesta análise: ' + dados.roteiroPendencias.join('; ') + '.');
  partes.push('Apresentaremos os valores em uma proposta individual. Esta leitura também fica com você se decidir não contratar.');
  return partes.join('\n\n');
}
