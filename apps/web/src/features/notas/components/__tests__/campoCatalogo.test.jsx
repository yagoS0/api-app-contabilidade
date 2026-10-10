import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampoCatalogo } from '../CampoCatalogo';
import { Modal } from '../../../../components/ui/Modal';

test('Escape fecha sugestões antes do modal; Enter não submete nem escolhe resultado sem marcação', () => {
  const fechar = jest.fn();
  const salvar = jest.fn();
  function Tela() {
    const [valor, setValor] = useState('');
    return <Modal titulo="Perfil" aoFechar={fechar}><form onSubmit={salvar}>
      <CampoCatalogo id="cst" rotulo="CST" valor={valor} onChange={setValor}
        itens={[{ codigo: '000', descricao: 'Tributação integral' }]} />
      <button type="submit">Salvar</button>
    </form></Modal>;
  }
  render(<Tela />);
  const campo = screen.getByLabelText('CST');
  fireEvent.change(campo, { target: { value: 'tributacao' } });
  expect(fireEvent.keyDown(campo, { key: 'Enter' })).toBe(false);
  expect(campo).toHaveValue('tributacao');
  expect(salvar).not.toHaveBeenCalled();
  fireEvent.keyDown(campo, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(fechar).not.toHaveBeenCalled();
  fireEvent.keyDown(campo, { key: 'Escape' });
  expect(fechar).toHaveBeenCalledTimes(1);
});
