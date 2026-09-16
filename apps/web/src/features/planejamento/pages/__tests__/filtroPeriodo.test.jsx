import { render, screen, fireEvent } from '@testing-library/react';
import { FiltroPeriodo } from '../../components/FiltroPeriodo';
test('rascunho só altera a consulta ao aplicar e Escape cancela',()=>{
 const aplicar=jest.fn();render(<FiltroPeriodo de="2026-08" ate="2026-08" comparar="anterior" onAplicar={aplicar}/>);
 const abrir=screen.getByRole('button',{name:/Filtrar período/});fireEvent.click(abrir);
 fireEvent.click(screen.getByText('3 meses'));expect(aplicar).not.toHaveBeenCalled();
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(abrir).toHaveFocus();
 fireEvent.click(abrir);expect(screen.getByLabelText('De')).toHaveValue('2026-08');
 fireEvent.click(screen.getByText('3 meses'));fireEvent.click(screen.getByText('Aplicar período'));
 expect(aplicar).toHaveBeenCalledTimes(1);expect(aplicar).toHaveBeenCalledWith({de:'2026-06',ate:'2026-08',comparar:'anterior'});
});
test('bloqueia intervalo invertido ou maior que 24 meses',()=>{
 render(<FiltroPeriodo de="2026-08" ate="2026-08" comparar="anterior" onAplicar={jest.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));
 fireEvent.change(screen.getByLabelText('De'),{target:{value:'2026-09'}});expect(screen.getByText('Aplicar período')).toBeDisabled();
 fireEvent.change(screen.getByLabelText('De'),{target:{value:'2024-08'}});expect(screen.getByText('Aplicar período')).toBeDisabled();
});
