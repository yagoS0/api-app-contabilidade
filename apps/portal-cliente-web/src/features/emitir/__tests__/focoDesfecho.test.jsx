import { render, screen } from '@testing-library/react';
import { DesfechoEmissao } from '../DesfechoEmissao';

test('resultado recebe foco ao substituir o formulário, sem roubá-lo em nova renderização', () => {
  const desfecho = { tipo: 'TRANSPORTE' };
  const props = { desfecho, aoVoltarParaNotas: jest.fn(), aoNovaNota: jest.fn() };
  const { rerender } = render(<DesfechoEmissao {...props} />);
  expect(screen.getByRole('region', { name: 'Resultado da emissão' })).toHaveFocus();
  const notas = screen.getByRole('button', { name: 'Ver minhas notas' });
  notas.focus();
  rerender(<DesfechoEmissao {...props} />);
  expect(notas).toHaveFocus();
  rerender(<DesfechoEmissao {...props} desfecho={{ tipo: 'SUCESSO', nfse: { numeroNfse: '123' } }} />);
  expect(screen.getByRole('region', { name: 'Resultado da emissão' })).toHaveFocus();
});
