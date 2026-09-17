// Sugestões locais e explicáveis. Decisões confirmadas da empresa sempre prevalecem.
const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export function sugerirClassificacoes(contas, confirmadas = {}) {
  const efetivas = { ...confirmadas }, sugestoes = {};
  for (const conta of contas) {
    const codigo = String(conta.codigo || '');
    if (confirmadas[codigo] || !/^\d{6,}$/.test(codigo) || conta.custo < 0) continue;
    const nome = normalizar(conta.nome).replace(/^DAS SIMPLES NACIONAL$/, 'SIMPLES NACIONAL');
    let sugestao;
    // Tributos sobre faturamento na família de deduções. Não inclui parcelamento,
    // multa, IRPJ/CSLL ou contas genéricas de impostos.
    if (conta.chaveCategoria === 'deducoes' && /^(SIMPLES NACIONAL|DAS|ISS|ISSQN|ISS SOBRE SERVICOS|PIS|PIS SOBRE FATURAMENTO|COFINS|COFINS SOBRE FATURAMENTO)$/.test(nome)) {
      sugestao = { comportamento: 'VARIAVEL', prolabore: false, confianca: 'ALTA', motivo: 'Conta específica de tributo sobre faturamento na categoria de deduções; acompanha a receita como premissa gerencial.' };
    } else if (codigo.startsWith('41101') && /^(PRO LABORE|PROLABORE|REMUNERACAO DOS SOCIOS)$/.test(nome)) {
      sugestao = { comportamento: 'FIXO', prolabore: true, confianca: 'MEDIA', motivo: 'Conta de pessoal identificada como pró-labore; confirme se a remuneração mensal é fixa.' };
    } else if (conta.chaveCategoria === 'gerais' && /^(ALUGUEL|ALUGUEIS|ALUGUEL DE IMOVEIS|ALUGUEIS DE IMOVEIS|HONORARIOS CONTABEIS|HONORARIOS CONTABILIDADE|SEGUROS)$/.test(nome)) {
      sugestao = { comportamento: 'FIXO', prolabore: false, confianca: 'MEDIA', motivo: 'Despesa normalmente contratual; confirme se o valor independe do faturamento.' };
    } else if (['gerais','custos','pessoal'].includes(conta.chaveCategoria) && /^(COMISSOES|COMISSOES SOBRE VENDAS|COMISSOES DE VENDAS)$/.test(nome)) {
      sugestao = { comportamento: 'VARIAVEL', prolabore: false, confianca: 'MEDIA', motivo: 'Comissão normalmente acompanha vendas; confirme a regra do contrato.' };
    }
    if (!sugestao) continue;
    sugestoes[codigo] = sugestao;
    if (sugestao.confianca === 'ALTA') efetivas[codigo] = { comportamento: sugestao.comportamento, prolabore: sugestao.prolabore };
  }
  return { efetivas, sugestoes, automaticas: Object.keys(sugestoes).filter(c => sugestoes[c].confianca === 'ALTA') };
}

// Conserva a proporção observada dos custos variáveis ao mudar receita.
// Com base zero/ausente não inventa proporção.
export function ajustarReceita(entrada, novaReceita) {
  const receita = Number(entrada.receita), nova = Number(novaReceita), variaveis = Number(entrada.variaveis);
  const temBase = entrada.receita !== '' && entrada.receita != null && entrada.variaveis !== '' && entrada.variaveis != null && Number.isFinite(receita) && receita > 0 && Number.isFinite(variaveis) && variaveis >= 0;
  return { ...entrada, receita: novaReceita, ...(temBase && novaReceita !== '' && novaReceita != null && Number.isFinite(nova) && nova >= 0 ? { variaveis: Math.round((variaveis * nova / receita + Number.EPSILON) * 100) / 100 } : {}) };
}
