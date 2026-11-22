import { useEffect, useRef } from 'react';
import { Button } from '../../components/ui/Button';

export function OperationsTablePagination({ page, total, onPage, disabled }) {
  const pages = Math.max(1, Math.ceil(total / 30));
  if (pages === 1) return null;
  return <nav className="operacoes-acoes" aria-label="Páginas de empresas">
    <Button variant="secondary" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>Anterior</Button>
    <span role="status">Página {page + 1} de {pages} · {total} empresas</span>
    <Button variant="secondary" disabled={disabled || page + 1 >= pages} onClick={() => onPage(page + 1)}>Próxima</Button>
  </nav>;
}

// Specialized tables retain their existing commands, previews and readers.
export function OperationsContextualTable({ title, competencia, loading, error, suspended, children, footer }) {
  const heading = useRef(null), previous = useRef(title);
  useEffect(() => {
    if (previous.current !== title) heading.current?.focus();
    previous.current = title;
  }, [title]);
  return <section className="operacoes-contextual" aria-label={`Tabela contextual: ${title}`} aria-busy={loading || undefined} hidden={suspended}>
    <header className="operacoes-contextual-header"><h2 ref={heading} tabIndex={-1}>{title}</h2><span>Competência {competencia}</span></header>
    {loading ? <p role="status">Carregando empresas…</p> : error ? <p role="alert">{error}</p> : children}
    <div className="operacoes-contextual-footer">{footer}</div>
  </section>;
}

