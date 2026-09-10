import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProtecaoEdicao, useEdicaoPendente, useConfirmarSaida } from '../ProtecaoEdicao';

function Editor({ navegar }) {
  const [valor, setValor] = useState('salvo');
  const confirmar = useConfirmarSaida();
  useEdicaoPendente(valor !== 'salvo');
  return <><input aria-label="Nome" value={valor} onChange={e=>setValor(e.target.value)}/>
    <a href="/outra-secao" onClick={e=>{e.preventDefault();navegar();}}>Outra seção</a>
    <button onClick={()=>confirmar(navegar)}>Voltar</button>
    <button onClick={()=>setValor('salvo')}>Salvar</button></>;
}
afterEach(()=>jest.restoreAllMocks());
it('preserva edição ao recusar troca por link ou botão e libera após salvar',()=>{
  const navegar=jest.fn();
  render(<ProtecaoEdicao><Editor navegar={navegar}/></ProtecaoEdicao>);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'novo'}});
  fireEvent.click(screen.getByText('Outra seção'));
  expect(screen.getByRole('dialog',{name:'Alterações não salvas'})).toBeInTheDocument();
  fireEvent.click(screen.getByText('Continuar editando'));fireEvent.click(screen.getByText('Voltar'));
  expect(navegar).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Continuar editando'));
  expect(screen.getByLabelText('Nome')).toHaveValue('novo');
  fireEvent.click(screen.getByText('Salvar'));fireEvent.click(screen.getByText('Outra seção'));
  expect(navegar).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();
});
it('avisa recarga apenas com edição pendente e não avisa de novo após confirmar saída',()=>{
  render(<ProtecaoEdicao><Editor navegar={jest.fn()}/></ProtecaoEdicao>);
  const limpo=new Event('beforeunload',{cancelable:true});window.dispatchEvent(limpo);expect(limpo.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'novo'}});
  const pendente=new Event('beforeunload',{cancelable:true});window.dispatchEvent(pendente);expect(pendente.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText('Outra seção'));
  fireEvent.click(screen.getByText('Descartar e sair'));
  const saiu=new Event('beforeunload',{cancelable:true});window.dispatchEvent(saiu);expect(saiu.defaultPrevented).toBe(false);
});
