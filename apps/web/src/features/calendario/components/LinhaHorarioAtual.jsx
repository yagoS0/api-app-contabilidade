import './LinhaHorarioAtual.shared.js';
import 'react';
import { ALTURA_HORA } from '../lib/escalaAgenda';
import './linha-horario-atual.css';


export function LinhaHorarioAtual({ dias, agora }) {
  const coluna = dias.indexOf(agora.data);
  if (coluna < 0) return null;
  return <div className="agenda-now-line" role="img" aria-label={`Horário atual: ${agora.hora}`}
    style={{ top: agora.minutos / 60 * ALTURA_HORA }}>
    <span className="agenda-now-today" style={{ left: `${coluna * 100 / dias.length}%`, width: `${100 / dias.length}%` }} />
    <time className={`agenda-now-label${agora.minutos < 10 ? ' is-day-start' : agora.minutos > 1430 ? ' is-day-end' : ''}`} dateTime={`${agora.data}T${agora.hora}:00-03:00`}>{agora.hora}</time>
  </div>;
}
