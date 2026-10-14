// Lê somente as tabelas de receitas do extrato já salvo, sem nova consulta à RFB.
export function receitasDoExtrato(rawText) {
  const text = String(rawText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const money = '(\\d[\\d.]*,\\d{2})';
  const numero = value => Number(value.replace(/\./g, '').replace(',', '.'));
  const meses = new Map();
  for (const [inicio, fim, campo] of [
    [/2\.2\.1\)\s*Mercado Interno/i, /2\.2\.2\)/i, 'valorInterno'],
    [/2\.2\.2\)\s*Mercado Externo/i, /2\.3\)/i, 'valorExterno'],
  ]) {
    const bloco = text.split(inicio)[1]?.split(fim)[0] || '';
    for (const match of bloco.matchAll(new RegExp('(0[1-9]|1[0-2])/(\\d{4})\\s*' + money, 'g'))) {
      const pa = `${match[2]}-${match[1]}`;
      const mes = meses.get(pa) || { pa };
      mes[campo] = numero(match[3]);
      meses.set(pa, mes);
    }
  }
  // Só usar meses com ambos os mercados lidos: ausência não prova receita zero.
  const receitas = [...meses.values()].filter(m => m.valorInterno != null && m.valorExterno != null);
  const pa = text.match(/Periodo de Apuracao\s*\(PA\):\s*(0[1-9]|1[0-2])\/(\d{4})/i);
  const atual = text.match(new RegExp('Receita Bruta do PA \\(RPA\\)\\s*-\\s*Competencia\\s*' + money + '\\s*' + money + '\\s*' + money, 'i'));
  if (pa && atual) receitas.push({ pa: `${pa[2]}-${pa[1]}`, valorInterno: numero(atual[1]), valorExterno: numero(atual[2]) });
  return receitas;
}
