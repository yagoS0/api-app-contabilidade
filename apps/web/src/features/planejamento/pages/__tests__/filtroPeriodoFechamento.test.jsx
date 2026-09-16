import { render,screen,fireEvent } from '@testing-library/react';
import { FiltroPeriodo } from '../../components/FiltroPeriodo';
test('intervalo com lacuna de fechamento mostra mês e não aplica',()=>{
 const onAplicar=jest.fn();render(<FiltroPeriodo de="2026-06" ate="2026-08" comparar="anterior" competenciasFechadas={['2026-06','2026-08']} onAplicar={onAplicar}/>);
 fireEvent.click(screen.getByRole('button',{name:/Filtrar período/}));expect(screen.getByRole('alert')).toHaveTextContent('07/2026');expect(screen.getByRole('button',{name:'Aplicar período'})).toBeDisabled();
 fireEvent.change(screen.getByRole('combobox',{name:'Escolher mês fechado'}),{target:{value:'2026-08'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar período'}));expect(onAplicar).toHaveBeenCalledWith({de:'2026-08',ate:'2026-08',comparar:'anterior'});
});
test('sem datas identifica seleção e fechamento permite mês sem limite de calendário',()=>{
 const onAplicar=jest.fn();render(<FiltroPeriodo de="" ate="" comparar="anterior" competenciasFechadas={['2099-12']} onAplicar={onAplicar}/>);fireEvent.click(screen.getByRole('button',{name:/Selecionar período/}));fireEvent.change(screen.getByRole('combobox',{name:'Escolher mês fechado'}),{target:{value:'2099-12'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar período'}));expect(onAplicar).toHaveBeenCalledWith({de:'2099-12',ate:'2099-12',comparar:'anterior'});
});
