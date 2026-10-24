export function dataEmissaoDaNota(nota) {
  const data = nota?.dataEmissao;
  const value = data?.civil;
  if (data?.motivo || !/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'A verificar';
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'A verificar';
  return value.split('-').reverse().join('/');
}
