import { Button } from '../../../../components/ui/Button';

const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export function rotuloCompetencia(competencia) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia || '');
  return match ? `${meses[Number(match[2]) - 1]} de ${match[1]}` : 'Selecione a competência';
}
export function CompetenciaCarteira({ competencia, onChange, onRefresh, loading = false, disabled = false }) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia || '');
  const label = rotuloCompetencia(competencia);
  const move = delta => {
    if (!match) return;
    const total = Number(match[1]) * 12 + Number(match[2]) - 1 + delta;
    onChange?.(`${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, '0')}`);
  };
  return <span role="group" aria-label="Competência da carteira" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
    <Button size="sm" variant="secondary" disabled={disabled || !match} aria-label="Mês anterior" onClick={() => move(-1)}>‹</Button>
    <span style={{ fontSize: '1.05rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>{label}</span>
    <Button size="sm" variant="secondary" disabled={disabled || !match} aria-label="Próximo mês" onClick={() => move(1)}>›</Button>
    <Button size="sm" variant="secondary" disabled={loading || disabled} aria-label={`Recarregar a lista de ${label}`} title={`Recarregar a lista de ${label}`} onClick={onRefresh}><span aria-hidden="true">{loading ? '…' : '↻'}</span></Button>
  </span>;
}
