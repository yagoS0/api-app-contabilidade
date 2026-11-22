import { createPortal } from 'react-dom';
import { Modal } from '../../components/ui/Modal';

// Presentation only. Commands and their previews remain owned by each stage.
export function OperationsStageModal({ title, competencia, loading, error, suspended, busy, onClose, footer, children }) {
  const period = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia || '');
  const periodLabel = period ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(period[1]), Number(period[2]) - 1, 1))) : competencia;
  return createPortal(<Modal titulo={`${title} · ${periodLabel}`} tamanho="lg"
    className="operacoes operacoes-stage-modal" ocupado={busy} suspenso={suspended}
    aoFechar={onClose} rodape={footer}>
    <div role="region" aria-label={`Tabela contextual: ${title}`} aria-busy={loading || undefined}>
      {loading ? <p role="status">Carregando empresas…</p> : error ? <p role="alert">{error}</p> : children}
    </div>
  </Modal>, document.body);
}
