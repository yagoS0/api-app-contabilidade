// Fechamentos exclusivamente fictícios da prévia; nunca usados pela API real.
export function fechamentosRelatorioMock(id) {
  const hoje=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,7);
  const [ano,mes]=hoje.split('-').map(Number);
  const fechados=Array.from({length:48},(_,i)=>new Date(Date.UTC(ano,mes-i-2,1)).toISOString().slice(0,7));
  if(String(id).endsWith('-sem-fechamento'))return [];
  if(String(id).endsWith('-comparacao-aberta'))return fechados.filter((_,i)=>i!==1);
  return fechados;
}
