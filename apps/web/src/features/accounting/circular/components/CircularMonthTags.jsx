import { useLayoutEffect, useRef, useState } from 'react';

export function CircularMonthTags({ children }) {
  const container = useRef(null);
  const [tags, setTags] = useState([]);
  useLayoutEffect(() => {
    const root = container.current;
    const rows = [...root.querySelectorAll('[data-circular-month]')];
    const measure = () => {
      const top = root.getBoundingClientRect().top;
      setTags(rows.map(row => {
        const rect = row.getBoundingClientRect();
        return { month: row.dataset.circularMonth, closed: row.classList.contains('circular-month-closed'), top: rect.top - top + rect.height / 2 };
      }));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    rows.forEach(row => observer?.observe(row));
    window.addEventListener('resize', measure);
    window.addEventListener('beforeprint', measure);
    window.addEventListener('afterprint', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('beforeprint', measure);
      window.removeEventListener('afterprint', measure);
    };
  }, [children]);
  return <div className="circular-with-month-tags" ref={container}>
    <div className="circular-month-tags" aria-label="Fechamento dos meses">
      {tags.map(tag => <span key={tag.month} className={`circular-month-tag${tag.closed ? ' is-closed' : ''}`} style={{ top: tag.top }} aria-label={`${tag.month}: ${tag.closed ? 'Fechado' : 'Aberto'}`}>{tag.closed ? 'Fechado' : 'Aberto'}</span>)}
    </div>
    {children}
  </div>;
}
