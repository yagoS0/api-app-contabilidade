import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PendenciasList } from '../PendenciasList';

const pendencias = [{ id: 'p', competencia: '2026-08', motivo: 'nota_retroativa',
  createdAt: '2026-10-23T12:00:00Z', notaId: 'n', valor: 200,
  observacoes: 'Conferir despesas e retenções; não representa receita automaticamente.' }];

test('região local nomeada e focável preserva conteúdo e leitura sem callbacks de escrita', () => {
  render(<PendenciasList pendencias={pendencias} />);
  const region = screen.getByRole('region', { name: 'Pendências pós-fechamento' });
  expect(region).toHaveAttribute('tabindex', '0');
  region.focus(); expect(region).toHaveFocus();
  expect(region).toHaveTextContent('2026-08');
  expect(region).toHaveTextContent('Conferir despesas e retenções');
  expect(region).toHaveTextContent('Valor do documento');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('ações preservam identidades e ficam indisponíveis durante gravação', () => {
  const onAbrirNota = jest.fn(), onReabrir = jest.fn(), onResolver = jest.fn();
  const props = { pendencias, onAbrirNota, onReabrir, onResolver, rotuloResolver: 'Concluir revisão' };
  const { rerender } = render(<PendenciasList {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir nota' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir competência' }));
  fireEvent.click(screen.getByRole('button', { name: 'Concluir revisão' }));
  expect(onAbrirNota).toHaveBeenCalledWith('n'); expect(onReabrir).toHaveBeenCalledWith('2026-08');
  expect(onResolver).toHaveBeenCalledWith('p');
  rerender(<PendenciasList {...props} saving />);
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  expect(screen.getByRole('region').closest('section')).toHaveAttribute('aria-busy', 'true');
  rerender(<PendenciasList {...props} saving={false} />);
  expect(screen.getByRole('button', { name: 'Concluir revisão' })).toBeEnabled();
});

test('consulta da nota não habilita reabertura ou resolução e resolvidas saem da lista', () => {
  const { rerender } = render(<PendenciasList pendencias={pendencias} onAbrirNota={jest.fn()} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByText('Ignorar')).not.toBeInTheDocument();
  rerender(<PendenciasList pendencias={pendencias.map(p => ({ ...p, resolvida: true }))} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
