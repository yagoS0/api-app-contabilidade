import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { PreviaFiscal } from '../PreviaFiscal';
import { PendenciasPeriodoBanner } from '../PendenciasPeriodoBanner';
test('contador mostra aviso mesmo com detalhes fiscais recolhidos', () => {
  render(<PreviaFiscal companyId="empresa" previa={{ habilitada: true, dados: { competencia: '2026-09-01', pendencias: [], periodo: { competencia: '2026-09', exigeRevisao: true, mensagem: 'Apuração já calculada. Confira a operação.' } } }} />);
  expect(screen.getByRole('status', { name: 'Revisão da competência' })).toHaveTextContent('Apuração já calculada');
});
test('lista persistente aponta para revisão e não fecha pendência', async () => {
  const api = { listPendenciasPosFechamento: jest.fn(async () => [{ id: 'p', competencia: '2026-09', resolvida: false }]) };
  render(<PendenciasPeriodoBanner api={api} companyId="a" competencia="2026-09" />);
  expect(await screen.findByText(/1 pendência/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Revisar competências' })).toHaveAttribute('href', '/companies/a/auditoria');
});
test('resposta de outra empresa é descartada', async () => {
  let liberar;
  const api = { listPendenciasPosFechamento: jest.fn(id => id === 'a' ? new Promise(r => { liberar = r; }) : Promise.resolve([])) };
  const view = render(<PendenciasPeriodoBanner api={api} companyId="a" />);
  await act(async () => {});
  view.rerender(<PendenciasPeriodoBanner api={api} companyId="b" />);
  await act(async () => { liberar([{ id: 'a', resolvida: false }]); });
  expect(screen.queryByText(/pendência\(s\)/)).not.toBeInTheDocument();
});
test('erro de leitura permanece explícito', async () => {
  const api = { listPendenciasPosFechamento: jest.fn(async () => { throw Error('offline'); }) };
  render(<PendenciasPeriodoBanner api={api} companyId="a" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');
});

test('aviso permanece visível sem permitir navegação durante a operação', async () => {
  const api = { listPendenciasPosFechamento: jest.fn(async () => [{ id: 'p', resolvida: false }]) };
  const view = render(<PendenciasPeriodoBanner api={api} companyId="a" ocupado />);
  expect(await screen.findByText(/1 pendência/)).toBeInTheDocument();
  const bloqueado = screen.getByRole('link', { name: 'Revisar competências' });
  expect(bloqueado).toHaveAttribute('aria-disabled', 'true');
  expect(bloqueado).not.toHaveAttribute('href');
  view.rerender(<PendenciasPeriodoBanner api={api} companyId="a" ocupado={false} />);
  expect(screen.getByRole('link', { name: 'Revisar competências' })).toHaveAttribute('href', '/companies/a/auditoria');
});
