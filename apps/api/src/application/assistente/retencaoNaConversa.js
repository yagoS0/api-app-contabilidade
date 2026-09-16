// Reconhece uma observação para conferência humana; não determina incidência,
// alíquotas, valores ou sequer se a retenção foi afirmada ou negada.
const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TRIBUTOS = [
  ['ISS', /\biss(?:qn)?\b/], ['IRRF', /\b(?:irrf|imposto de renda)\b/],
  ['Previdência', /\b(?:inss|previdencia|previdenciari[ao])\b/],
  ['PIS', /\bpis\b/], ['COFINS', /\bcofins\b/], ['CSLL', /\bcsll\b/],
];

export function observacaoDeRetencao(texto) {
  const t = normalizar(texto);
  const impostosMencionados = TRIBUTOS.filter(([, re]) => re.test(t)).map(([nome]) => nome);
  // Retenção de clientes/talentos e de líquidos pode ser o próprio serviço.
  // Remover só a expressão: um aviso fiscal na mesma mensagem continua visível.
  const fiscal = t.replace(/\bretenc(?:ao|oes) (?:de |dos? |das? )?(?:clientes|talentos|funcionarios|usuarios|alunos|assinantes|liquidos|agua|dados)\b/g, '');
  const retencao = /\b(?:reten[cs](?:ao|oes)|retid[oa]s?|reter|retem|retiver(?:am)?|retendo)\b/.test(fiscal);
  const descontoFiscal = /\b(?:descont\w*|deduz\w*|deducao)\b/.test(t)
    && /\b(?:impostos?|tributos?|na fonte)\b/.test(t);
  const tributoInformado = impostosMencionados.length && (
    /\b(?:iss(?:qn)?|irrf|inss|pis|cofins|csll)\s*[:=\d]/.test(t)
    || /\b(?:com|sem|tem|possui|incluir|tirar|descont\w*|deduz\w*)\b.{0,60}\b(?:iss(?:qn)?|irrf|inss|pis|cofins|csll)\b/.test(t)
    || /^(?:iss(?:qn)?|irrf|inss|pis|cofins|csll)[.!]?\s*$/.test(t.trim())
    || t.includes('?')
  );
  if (!retencao && !descontoFiscal && !tributoInformado) return null;
  return { impostosMencionados };
}
