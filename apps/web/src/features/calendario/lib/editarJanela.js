import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';

const minutos = hora => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
export const horaDosMinutos = valor => `${String(Math.floor(valor / 60)).padStart(2, '0')}:${String(valor % 60).padStart(2, '0')}`;
export const diferencaDias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/** Mover o início preserva a duração; editar o fim continua alterando o intervalo. */
export function editarJanela(dados, chave, valor) {
  const alterados = { ...dados, [chave]: valor };
  if (chave === 'dataInicio' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && dados.dataInicio && dados.dataFim) {
    alterados.dataFim = somarDiasAgenda(valor, diferencaDias(dados.dataFim, dados.dataInicio));
  }
  if (chave === 'horaInicio' && valor && dados.horaInicio && dados.horaFim) {
    const fim = minutos(valor) + minutos(dados.horaFim) - minutos(dados.horaInicio);
    if (fim > minutos(valor) && fim < 1440) alterados.horaFim = horaDosMinutos(fim);
  }
  return alterados;
}

/** A chave da ocorrência nunca muda com sua posição na grade. */
export function janelaDoGesto(item, modo, data, deslocamento) {
  const inicio = item.horaInicio ? minutos(item.horaInicio) : 9 * 60;
  const fim = item.horaFim ? minutos(item.horaFim) : Math.min(1439, inicio + 30);
  const limitar = (valor, min, max) => Math.max(min, Math.min(max, valor));
  let a = inicio, b = fim;
  if (modo === 'inicio') a = limitar(inicio + deslocamento, 0, fim - 15);
  else if (modo === 'fim') b = limitar(fim + deslocamento, Math.min(1439, inicio + 15), 1439);
  else { a = limitar(inicio + deslocamento, 0, item.horaFim ? 1439 - (fim - inicio) : 1439); b = Math.min(1439, a + fim - inicio); }
  return { dataInicio: modo === 'mover' ? data : item.dataInicio, dataFim: modo === 'mover' ? data : item.dataFim,
    horaInicio: horaDosMinutos(a), horaFim: (modo === 'mover' && !item.horaFim) || b <= a ? null : horaDosMinutos(b) };
}
