import { CAMPOS_INVESTIGACAO } from './investigacaoComercial.js';

export const ORDEM_QUALIFICACAO = Object.freeze({
  ABERTURA: ['nome', 'atividade', 'cidade', 'estrutura', 'urgencia', 'faturamento'],
  TRANSFERENCIA: ['necessidade', 'atividade', 'cidade', 'estrutura', 'urgencia', 'faturamento'],
  INATIVA: ['cnpj', 'necessidade', 'atividade', 'cidade', 'estrutura', 'urgencia', 'faturamento'],
  PLANEJAMENTO: ['necessidade', 'atividade', 'cidade', 'estrutura', 'faturamento', 'urgencia'],
  GESTAO: ['necessidade', 'atividade', 'estrutura', 'faturamento', 'urgencia'],
});

export function ordemQualificacao(pre) {
  const ordem = ORDEM_QUALIFICACAO[pre.intencao] || ['necessidade', 'atividade'];
  return pre.intencao === 'INATIVA' && pre.investigacaoPendencias
    ? [...ordem.slice(0, 2), ...CAMPOS_INVESTIGACAO, ...ordem.slice(2)] : ordem;
}

export function perguntasQualificacao(pre) {
  const medico = /m[eé]dic|cl[ií]nic|consult[oó]ri/i.test(pre.atividade || '');
  return {
    cnpj: 'Qual é o CNPJ da empresa? Vou consultar o cadastro para entender a situação e aproveitar os dados no atendimento.',
    periodoPendencias: 'Desde quando você deixou de pagar ou percebeu esses atrasos? Se não lembrar, tudo bem.',
    tipoPendencias: 'Você sabe quais pagamentos ou obrigações ficaram em aberto? Se não souber, a equipe verifica.',
    situacaoOperacional: 'A empresa está funcionando atualmente ou está parada?',
    nome: 'Como posso chamar você?',
    atividade: pre.intencao === 'ABERTURA' ? 'Com o que você pretende trabalhar na empresa?' : 'Qual é a atividade da sua empresa?',
    cidade: 'Em qual cidade você pretende atuar?',
    necessidade: pre.intencao === 'TRANSFERENCIA' ? 'O que você gostaria de melhorar em relação ao contador atual?' : pre.intencao === 'INATIVA' ? 'A empresa está funcionando hoje ou está parada?' : 'O que você gostaria de resolver primeiro?',
    estrutura: medico ? 'Você vai atender em consultório próprio ou prestar serviços para clínicas e hospitais?' : 'Como vai funcionar a operação: você trabalha sozinho ou terá sócios e equipe?',
    urgencia: 'Você tem algum prazo em mente para começar ou resolver isso?',
    faturamento: pre.intencao === 'INATIVA' && !pre.situacaoOperacional ? 'Quanto você estima faturar por mês na retomada? Se ainda não souber, seguimos sem essa informação.' : 'Já tem uma estimativa de faturamento mensal? Pode ser uma faixa; se ainda não souber, seguimos sem ela.',
  };
}

// A IA redige; o servidor continua escolhendo a etapa e autorizando a resposta.
export function respostaNaturalPermitida(resposta, campo) {
  if (!resposta || resposta.campo !== campo || !campo || typeof resposta.texto !== 'string') return null;
  const texto = resposta.texto.trim();
  if (!texto || texto.length > 600 || (texto.match(/\?/g) || []).length !== 1 || !texto.endsWith('?')) return null;
  if (/https?:|www\.|@|R\$|US\$|%|\b(?:pix|senha|token|api.key|garanti\w*|isen\w*|economi\w*|al[ií]quota|agendad\w*|agendei|contratad\w*|aprovad\w*|protocolei|emitida|consultei|encaminhei|encaminhar|vou chamar|chamei|MEI|simples nacional|lucro presumido)\b/i.test(texto)) return null;
  if (campo === 'faturamento' && !/mensal|por m[eê]s/i.test(texto)) return null;
  const tema = { cnpj: /cnpj/i, nome: /chama|nome/i, atividade: /atividade|trabalh|servi[cç]|atua/i, cidade: /cidade|munic[ií]pio|local/i,
    necessidade: /resolver|melhorar|precisa|necessidade|dificuldade|problema|busca|situa[cç]|parad|funciona/i, estrutura: /opera[cç]|s[oó]ci|equipe|sozinh|consult[oó]ri|cl[ií]nic|hospita|estrutura|atend/i,
    urgencia: /prazo|quando|tempo|come[cç]|urg[eê]ncia/i, faturamento: /faturamento|receita|mensal/i,
    periodoPendencias: /quando|tempo|per[ií]odo|desde/i, tipoPendencias: /pagamento|obriga[cç]|guia|imposto|tributo/i,
    situacaoOperacional: /funciona|opera|parad|atividad/i }[campo];
  return tema?.test(texto) ? texto : null;
}
