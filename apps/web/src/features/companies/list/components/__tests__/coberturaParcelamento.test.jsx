import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DetalheGuias, ResumoGuias } from '../ResumoGuias';

test('parcela enviada aparece no detalhe e débito automático não pede guia; identidade preservada', () => {
  const company = { companyId: 'empresa-ficticia', razao: 'Empresa teste', guideCompliance: { das: { required: true, state: 'gerada', guideId: 'das' }, coberturaParcelamentoMes: [
    { id: 'p1', tipo: 'PARCSN', numeroParcela: 2, numeroParcelamento: 'acordo-1', mesOperacional: '2026-09', guideId: 'g1', documento: 'disponivel', comunicacao: 'enviada' },
    { id: 'p2', tipo: 'PARCSN', numeroParcela: 3, mesOperacional: '2026-09', documento: 'nao_exigido', comunicacao: 'nao_exigida' },
  ] } };
  render(<MemoryRouter><ResumoGuias company={company} /><DetalheGuias company={company} competencia="2026-08" /></MemoryRouter>);
  expect(screen.getByText('1/1 disponíveis')).toBeInTheDocument();
  expect(screen.getByText('· 1 guia de parcela')).toBeInTheDocument();
  expect(screen.getByText('1 documento disponível')).toBeInTheDocument();
  expect(screen.getByText('Parcelamentos · 09/2026')).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'PARCSN parcela 2' })).getByText('Enviada')).toBeVisible();
  const automatico = within(screen.getByRole('group', { name: 'PARCSN parcela 3' }));
  expect(automatico.getByText('Débito automático')).toBeVisible();
  expect(automatico.queryByText('Faltante')).not.toBeInTheDocument();
  for (const link of screen.getAllByRole('link', { name: 'Ver parcelamento' })) expect(link).toHaveAttribute('href', '/companies/empresa-ficticia/parcelamento');
});
