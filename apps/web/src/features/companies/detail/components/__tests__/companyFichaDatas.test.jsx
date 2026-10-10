import { render, screen } from '@testing-library/react';
import { CompanyFichaTab } from '../renderCompanyFichaTab';

test('abertura e vigência exibem a data civil salva sem recuar um dia no fuso do contador', () => {
  render(<CompanyFichaTab selectedCompany={{ legacyCompany: {
    dataAbertura: '2025-01-14T00:00:00.000Z',
    regimeHistorico: [{ id: 'periodo', regime: 'SIMPLES', vigenciaInicio: '2025-01-14T00:00:00.000Z', vigenciaFim: '2026-12-31T00:00:00.000Z' }],
  } }} />);
  expect(screen.getAllByText('14/01/2025')).toHaveLength(2);
  expect(screen.getByText('31/12/2026')).toBeInTheDocument();
  expect(screen.queryByText('13/01/2025')).not.toBeInTheDocument();
});
