// Datas civis em São Paulo; nenhuma soma de 30 dias ou dependência do fuso do servidor.
export function hojeEmSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dataDoMes(mes, dia) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}
export function proximaData(data, dia) {
  const [ano, mes] = data.split('-').map(Number);
  const seguinte = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 7);
  return dataDoMes(seguinte, dia);
}
export function validarAgenda({ dia, inicio }, hoje = hojeEmSaoPaulo()) {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new Error('Escolha um dia de 1 a 31.');
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(inicio || '') || inicio < hoje || inicio > '2099-12-31' || inicio !== dataDoMes(inicio.slice(0, 7), dia)) {
    throw new Error('Informe a primeira emissão, a partir de hoje, no dia mensal escolhido (ou no último dia do mês).');
  }
  return { dia, inicio };
}
