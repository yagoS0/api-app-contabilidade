// Interpretação determinística de pedidos de consulta. Não decide empresa nem concede acesso.
export const normalizarConsulta = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function mesAtualConsulta(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(agora).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}
export function deslocarMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number), d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const mesValidoConsulta = mes => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || '')) && +mes.slice(0, 4) >= 2000 && +mes.slice(0, 4) <= 2100;
export const rotuloMesConsulta = mes => mesValidoConsulta(mes) ? `${MESES[+mes.slice(5) - 1]} de ${mes.slice(0, 4)}` : 'mês não informado';
export function periodoDaConsulta(texto, agora = new Date()) {
  const t = normalizarConsulta(texto), atual = mesAtualConsulta(agora);
  const datas = [...t.matchAll(/\b(?:(\d{4})-(\d{1,2})|(\d{1,2})\/(\d{4}|\d{2}))\b/g)];
  const nomes = [...t.matchAll(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+(?:de\s+)?(\d{4}))?\b/g)];
  if (datas.length || nomes.length) {
    if (datas.length && nomes.length) return { invalido: true };
    const tokens = datas.length ? datas : nomes;
    if (tokens.length > 2 || (tokens.length === 2 && !/^\s+(?:a|ate)\s+$/.test(t.slice(tokens[0].index + tokens[0][0].length, tokens[1].index)))) return { invalido: true };
    const anoComum = nomes.find(n => n[2])?.[2];
    const meses = tokens.map(n => {
      if (datas.length) return `${n[1] || (n[4].length === 2 ? `20${n[4]}` : n[4])}-${(n[2] || n[3]).padStart(2, '0')}`;
      const numero = MESES.map(normalizarConsulta).indexOf(n[1]) + 1;
      const ano = n[2] || anoComum || (+atual.slice(0, 4) - (numero > +atual.slice(5) ? 1 : 0));
      return `${ano}-${String(numero).padStart(2, '0')}`;
    });
    return meses.every(mesValidoConsulta) && meses[0] <= meses.at(-1) ? { inicio: meses[0], fim: meses.at(-1) } : { invalido: true };
  }
  if (/\b(?:ano passado|ano anterior)\b/.test(t)) { const a = +atual.slice(0, 4) - 1; return { inicio: `${a}-01`, fim: `${a}-12` }; }
  if (/\b(?:esse ano|este ano|desse ano|deste ano|ano atual)\b/.test(t)) return { inicio: `${atual.slice(0, 4)}-01`, fim: atual };
  if (/\b(?:mes passado|mes anterior|ultimo mes)\b/.test(t)) { const mes = deslocarMes(atual, -1); return { inicio: mes, fim: mes }; }
  if (/\b(?:este mes|esse mes|desse mes|deste mes|mes atual|do mes|nesse mes|neste mes)\b/.test(t)) return { inicio: atual, fim: atual };
  const ano = /\b(?:ano de |ano |em |de )?(20\d{2}|2100)\b/.exec(t);
  if (ano) return { inicio: `${ano[1]}-01`, fim: ano[1] === atual.slice(0, 4) ? atual : `${ano[1]}-12` };
  return null;
}

export function pedidoDeConsulta(texto, agora) {
  const t = normalizarConsulta(texto);
  if (!t || /\b(?:nao quero|nao precisa|nao envie|nao mande)\b/.test(t) || /(?:descricao|servico|tomador|cliente|valor)\s*[:=]/.test(t)) return null;
  if (/^(?:o que e|como funciona|por que)\b/.test(t)) return null;
  // Erro observado no atendimento; vocabulário fechado, sem aproximar nomes de empresas.
  if (/\b(?:faturamento|faturamemto|faturamnto|faturameto|faturei|faturou|faturamos|receita bruta)\b/.test(t)) return { acao: 'FATURAMENTO', periodo: periodoDaConsulta(t, agora) };
  if (/\b(?:recalcular|recalcule|atualizar|atualize)\b/.test(t) && /\b(?:guia|boleto|imposto|das)\b/.test(t)) return { acao: 'GUIAS', recalculo: true, periodo: periodoDaConsulta(t, agora) };
  if (/\b(?:cancelar|cancelamento|emitir|emissao|gerar|errad[ao]|incorret[ao]|discordo)\b/.test(t)) return null;
  if (/\b(?:guias?|boletos?|das|simples nacional|inss|fgts|darf)\b/.test(t)) {
    const tipo = /\b(?:simples(?: nacional)?|das)\b/.test(t) ? 'SIMPLES' : /\binss\b/.test(t) ? 'INSS' : /\bfgts\b/.test(t) ? 'FGTS' : /\bdarf\b/.test(t) ? 'DARF' : null;
    return { acao: 'GUIAS', periodo: periodoDaConsulta(t, agora), tipo,
      competencia: /\bcompetencia\b/.test(t), vencidas: /\b(?:venceu|venceram|vencid[ao]s?|atrasad[ao]s?)\b/.test(t),
      pagas: /\b(?:pag[ao]s?|ja paguei)\b/.test(t), todas: /\b(?:todas|todos)\b/.test(t) };
  }
  return null;
}

export function numeroDaOpcao(texto) {
  const t = normalizarConsulta(texto).replace(/[.!?]+$/, '').replace(/^(?:a |o |opcao |numero |quero a |quero o |manda a |manda o )/, '').trim();
  const ordinais = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'setima', 'oitava', 'nona'];
  if (ordinais.includes(t)) return ordinais.indexOf(t) + 1;
  return /^[1-9]\d?$/.test(t) ? +t : null;
}
