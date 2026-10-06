import { useEffect, useState } from 'react';
import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';

export function MiniCalendarioAgenda({ data, onChange }) {
  const [mes, setMes] = useState(data.slice(0,7));
  useEffect(() => setMes(data.slice(0,7)), [data]);
  const primeiro = `${mes}-01`;
  const inicio = somarDiasAgenda(primeiro, -new Date(`${primeiro}T12:00:00Z`).getUTCDay());
  function navegar(delta) {
    const date = new Date(`${primeiro}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth()+delta);
    setMes(date.toISOString().slice(0,7));
  }
  return <div className="agenda-mini-calendar" aria-label="Escolher data">
    <div className="agenda-mini-heading"><strong>{new Date(`${primeiro}T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</strong><button type="button" aria-label="Mês anterior na seleção" onClick={() => navegar(-1)}>‹</button><button type="button" aria-label="Próximo mês na seleção" onClick={() => navegar(1)}>›</button></div>
    <div className="agenda-mini-days">{['D','S','T','Q','Q','S','S'].map((d,i) => <span key={i} aria-hidden="true">{d}</span>)}{Array.from({length:42},(_,i) => {
      const dia = somarDiasAgenda(inicio,i);
      return <button type="button" key={dia} className={dia.slice(0,7) !== mes ? 'is-outside' : ''} aria-pressed={dia === data} aria-label={`Selecionar ${dia.split('-').reverse().join('/')}`} onClick={() => onChange(dia)}>{Number(dia.slice(8))}</button>;
    })}</div>
  </div>;
}
