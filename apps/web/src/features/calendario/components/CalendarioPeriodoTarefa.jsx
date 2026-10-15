import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const civil = value => new Date(`${value}T12:00:00`);
const nome = value => civil(value).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** The first selection is immediately valid; a second click optionally extends it. */
export function CalendarioPeriodoTarefa({ inicio, fim, onChange }) {
  const [mes, setMes] = useState(() => inicio.slice(0, 7));
  const [ancora, setAncora] = useState(null);
  const grade = useRef(null);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const primeiro = new Date(ano, numeroMes - 1, 1, 12);
  const total = new Date(ano, numeroMes, 0, 12).getDate();
  function navegar(delta) { setMes(iso(new Date(ano, numeroMes - 1 + delta, 1, 12)).slice(0, 7)); }
  function selecionar(data) {
    if (!ancora) { setAncora(data); onChange(data, data); }
    else { onChange(data < ancora ? data : ancora, data < ancora ? ancora : data); setAncora(null); }
  }
  function teclado(e, data) {
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in passos)) return;
    e.preventDefault();
    const alvo = civil(data); alvo.setDate(alvo.getDate() + passos[e.key]);
    const valor = iso(alvo); setMes(valor.slice(0, 7));
    requestAnimationFrame(() => grade.current?.querySelector(`[data-dia="${valor}"]`)?.focus());
  }
  return <section className="tce-calendar" aria-label="Selecionar período da tarefa">
    <div className="tce-month-nav">
      <Button type="button" variant="secondary" size="sm" aria-label="Mês anterior" onClick={() => navegar(-1)}>‹</Button>
      <label><span className="tce-sr">Mês do calendário</span><select value={numeroMes} onChange={e => setMes(`${ano}-${String(e.target.value).padStart(2, '0')}`)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2026, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}</option>)}</select></label>
      <label><span className="tce-sr">Ano do calendário</span><input type="number" min="1900" max="9999" value={ano} onChange={e => { const value = Number(e.target.value); if (value >= 1900 && value <= 9999) setMes(`${value}-${String(numeroMes).padStart(2, '0')}`); }} /></label>
      <Button type="button" variant="secondary" size="sm" aria-label="Próximo mês" onClick={() => navegar(1)}>›</Button>
    </div>
    <div className="tce-days" ref={grade}>
      {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => <span key={d} className="tce-weekday">{d}</span>)}
      {Array.from({ length: primeiro.getDay() }, (_, i) => <span key={`blank-${i}`} />)}
      {Array.from({ length: total }, (_, i) => {
        const data = `${mes}-${String(i + 1).padStart(2, '0')}`;
        const selecionado = data >= inicio && data <= (fim || inicio);
        return <button type="button" key={data} data-dia={data} aria-label={nome(data)} aria-pressed={selecionado} className={`${selecionado ? 'tce-in-range' : ''} ${data === inicio || data === fim ? 'tce-range-edge' : ''}`} onClick={() => selecionar(data)} onKeyDown={e => teclado(e, data)}>{i + 1}</button>;
      })}
    </div>
    <p className="tce-hint" aria-live="polite">{nome(inicio)}{fim && fim !== inicio ? ` a ${nome(fim)}` : ''}</p>
    <p className="tce-hint">Um clique escolhe o dia. O segundo estende o período.</p>
  </section>;
}
