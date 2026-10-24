// This UI only formats the server's evidence projection; a legacy DateTime is not evidence.
export function formatarDataEmissao(nota) {
  const data = nota?.dataEmissao;
  if (!data || data.motivo || !/^\d{4}-\d{2}-\d{2}$/.test(data.civil || '')) return 'A verificar';
  const [ano, mes, dia] = data.civil.split('-');
  return `${dia}/${mes}/${ano}`;
}
