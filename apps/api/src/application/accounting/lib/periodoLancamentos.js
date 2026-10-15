// Datas contábeis são datas civis gravadas à meia-noite UTC.
export function periodoLancamentos(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) return null;
  const [ano, numero] = mes.split('-').map(Number);
  return { gte: new Date(`${mes}-01T00:00:00.000Z`), lt: new Date(Date.UTC(ano, numero, 1)) };
}
