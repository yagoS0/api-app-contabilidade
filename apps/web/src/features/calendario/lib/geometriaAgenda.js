import { horaDosMinutos } from './editarJanela';

const limitar = (valor, min, max) => Math.max(min, Math.min(max, valor));
export const arredondarMinutosAgenda = valor => Math.round(valor / 15) * 15;

/** Measure the actual day columns; the time gutter changes with the viewport. */
export function medirGradeAgenda(scroll, dias) {
  const grade = scroll?.querySelector('.agenda-time-columns');
  if (!grade) return null;
  const rect = grade.getBoundingClientRect();
  const alturaHora = grade.querySelector('.agenda-time-slot')?.getBoundingClientRect().height;
  if (!alturaHora) return null;
  return {
    rect, janela: scroll.getBoundingClientRect(), alturaHora,
    colunas: [...grade.querySelectorAll('.agenda-time-day')].map((el, i) => {
      const r = el.getBoundingClientRect();
      return { data: dias[i], left: r.left, right: r.right, width: r.width };
    }),
  };
}

export function pontoNaGrade(grade, x, y) {
  const coluna = grade.colunas.find(c => x >= c.left && x < c.right);
  if (!coluna || y < grade.janela.top || y > grade.janela.bottom) return null;
  return { data: coluna.data, minuto: limitar(arredondarMinutosAgenda((y - grade.rect.top) / grade.alturaHora * 60), 0, 1425) };
}

export function janelaCriacaoAgenda(data, inicio, fim = inicio + 60) {
  const a = limitar(Math.min(inicio, fim), 0, 1425);
  const b = limitar(Math.max(inicio, fim, a + 15), a + 1, 1439);
  return { dataInicio: data, dataFim: data, horaInicio: horaDosMinutos(a), horaFim: horaDosMinutos(b) };
}

export function velocidadeRolagemAgenda(y, rect) {
  const borda = 36;
  if (y < rect.top || y > rect.bottom) return 0;
  if (y < rect.top + borda) return -480 * limitar((rect.top + borda - y) / borda, 0, 1);
  if (y > rect.bottom - borda) return 480 * limitar((y - rect.bottom + borda) / borda, 0, 1);
  return 0;
}
