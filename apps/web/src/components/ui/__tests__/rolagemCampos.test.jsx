import { fireEvent, render, screen } from '@testing-library/react';
import { useProtegerCamposDaRolagem } from '../useProtegerCamposDaRolagem';

function Campos({tipo='number',valor='15'}) {
  useProtegerCamposDaRolagem();
  return <input aria-label="Valor" type={tipo} defaultValue={valor}/>;
}
test.each([['number','15'],['date','2026-10-08'],['time','09:30'],['month','2026-10'],['week','2026-W41'],['datetime-local','2026-10-08T09:30']])('rolagem em %s desativa incremento nativo sem cancelar scroll', (tipo,valor) => {
  render(<Campos tipo={tipo} valor={valor}/>);
  const campo=screen.getByLabelText('Valor');campo.focus();
  expect(campo).toHaveFocus();
  const evento=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:80});
  fireEvent(campo,evento);
  expect(campo).not.toHaveFocus();expect(campo.value).toBe(valor);expect(evento.defaultPrevented).toBe(false);
  campo.focus();fireEvent.change(campo,{target:{value:valor}});expect(campo).toHaveFocus();
});
test('rolagem em texto mantém foco e desmontar remove o tratamento',()=>{
  const {unmount}=render(<Campos tipo="text" valor="Texto"/>);
  const campo=screen.getByLabelText('Valor');campo.focus();fireEvent.wheel(campo);expect(campo).toHaveFocus();
  unmount();
  const numero=document.createElement('input');numero.type='number';document.body.append(numero);numero.focus();
  fireEvent.wheel(numero);expect(numero).toHaveFocus();numero.remove();
});
test('fechar um modal não desativa a proteção da aplicação ainda montada',()=>{
  const pagina=render(<Campos/>),modal=render(<Campos tipo="time" valor="08:00"/>);
  modal.unmount();
  const campo=screen.getByLabelText('Valor');campo.focus();fireEvent.wheel(campo);expect(campo).not.toHaveFocus();
  pagina.unmount();
});
