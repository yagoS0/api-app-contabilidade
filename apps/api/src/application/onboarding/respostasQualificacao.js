const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function camposDispensadosNaResposta(texto, esperado) {
  const t = normalizar(texto);
  if (/^(?:se|caso|e se)\b|["“”]|\b(?:disse|falou|perguntou)\s*:/.test(t)) return [];
  if (!/\b(?:nao sei|nao lembro|nao tenho (?:certeza|ideia|prazo|previsao)|prefiro nao|nao (?:quero|posso) informar|ainda nao (?:defini|tenho)|a definir)\b/.test(t)) return [];
  const temas = { nome: /\bnome\b/, cnpj: /\bcnpj\b/, cidade: /\bcidade|municipio|localidade\b/, atividade: /\batividade|profissao\b/,
    estrutura: /\bestrutura|socios?|equipe|funcionarios?|operacao\b/, urgencia: /\bprazo|quando|data\b/,
    faturamento: /\bfaturamento|receita|faturar|estimar|estimativa\b/, necessidade: /\bnecessidade|problema\b/ };
  const mencionados = Object.entries(temas).filter(([, re]) => re.test(t)).map(([campo]) => campo);
  // Não dispensar cidade porque a pessoa desconhece seu CPF ou outra informação.
  if (mencionados.length) return mencionados;
  if (/^(?:(?:eu |ainda )?nao (?:sei|lembro|tenho certeza|tenho ideia)(?: dizer| informar| estimar)?(?: agora| ainda)?|prefiro nao(?: informar)?|nao (?:quero|posso) informar|a definir)[.!]*$/.test(t)) return esperado ? [esperado] : [];
  return [];
}

export function esclarecimentoCadastralSimples(texto) {
  const t = normalizar(texto).replace(/[.!?]+$/g, '').trim();
  if (/^(?:quero|preciso|gostaria) que (?:voces )?consultem(?: (?:o cadastro|o cnpj|minha empresa))?(?: para mim)?$/.test(t)) return true;
  if (/^(?:pode|podem|consegue|conseguem)(?:m)? consultar(?: (?:o|meu))? (?:cnpj|cadastro)(?: (?:da empresa|para mim))?(?: [\d./ -]+)?$/.test(t)) return true;
  if (/^(?:(?:o )?meu )?cpf(?: e|:)? [\d. -]+,? (?:serve|pode ser|funciona)$/.test(t)) return true;
  return false;
}
