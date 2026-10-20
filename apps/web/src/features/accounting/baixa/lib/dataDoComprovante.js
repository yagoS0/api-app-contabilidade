// Datas do comprovante são datas civis; não passam por conversão de fuso horário.
export function dataDoComprovante(comprovante) {
  const valor = comprovante?.dataArrecadacao || comprovante?.dataArrecadacaoBR;
  if (typeof valor !== 'string') return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(valor.trim());
  if (!br && !iso) return null;
  const [ano, mes, dia] = br ? [br[3], br[2], br[1]] : iso.slice(1);
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (data.getUTCFullYear() !== Number(ano) || data.getUTCMonth() !== Number(mes) - 1 || data.getUTCDate() !== Number(dia)) return null;
  return `${ano}-${mes}-${dia}`;
}
