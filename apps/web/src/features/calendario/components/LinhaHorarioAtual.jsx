import { useEffect, useState } from 'react';
import { ALTURA_HORA } from '../lib/escalaAgenda';
import './linha-horario-atual.css';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function lerHorarioAtual() {
  const partes = Object.fromEntries(formato.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}`,
    minutos: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

export function useRelogioAgenda() {
  const [agora, setAgora] = useState(lerHorarioAtual);
  useEffect(() => {
    let timer;
    const atualizar = () => {
      clearTimeout(timer);
      setAgora(lerHorarioAtual());
      timer = setTimeout(atualizar, 60000 - Date.now() % 60000);
    };
    atualizar();
    window.addEventListener('focus', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', atualizar);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, []);
  return agora;
}

export function LinhaHorarioAtual({ dias, agora }) {
  const coluna = dias.indexOf(agora.data);
  if (coluna < 0) return null;
  return <div className="agenda-now-line" role="img" aria-label={`Horário atual: ${agora.hora}`}
    style={{ top: agora.minutos / 60 * ALTURA_HORA }}>
    <span className="agenda-now-today" style={{ left: `${coluna * 100 / dias.length}%`, width: `${100 / dias.length}%` }} />
    <time className={`agenda-now-label${agora.minutos < 10 ? ' is-day-start' : agora.minutos > 1430 ? ' is-day-end' : ''}`} dateTime={`${agora.data}T${agora.hora}:00-03:00`}>{agora.hora}</time>
  </div>;
}
