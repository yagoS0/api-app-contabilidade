import { act, renderHook } from '@testing-library/react';
import { useGestosAgenda } from '../useGestosAgenda';

const dias = ['2026-09-10', '2026-09-11'];
const item = { id: 'irrf', ocorrenciaId: 'irrf', tipo: 'obrigacao', titulo: 'IRRF', dataInicio: dias[0], dataFim: dias[0], horaInicio: '09:00', horaFim: '10:00' };
function preparar() {
  const scroll = document.createElement('div');
  scroll.innerHTML = '<div class="agenda-time-columns"><div class="agenda-time-day"><button class="agenda-time-slot"></button></div><div class="agenda-time-day"></div></div>';
  scroll.scrollTop = 420;
  scroll.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 500, height: 500, width: 400 });
  const grade = scroll.firstChild;
  grade.getBoundingClientRect = () => ({ left: 0, right: 400, top: -420, bottom: 1020, height: 1440, width: 400 });
  grade.querySelector('.agenda-time-slot').getBoundingClientRect = () => ({ height: 60 });
  [...grade.querySelectorAll('.agenda-time-day')].forEach((el, i) => { el.getBoundingClientRect = () => ({ left: i * 180, right: (i + 1) * 180, width: 180 }); });
  const evento = (x, y, extras = {}) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', ...extras });
  const salvar = jest.fn();
  return { ...renderHook(() => useGestosAgenda({ dias, horasRef: { current: scroll }, salvar, bloqueado: false })), evento, salvar };
}

test('clique no título ou ícone mantém a ativação do botão dentro do cartão', () => {
  const { result, evento, salvar } = preparar();
  const cartao = document.createElement('div');
  const titulo = document.createElement('button');
  const icone = document.createElement('span');
  titulo.append(icone); cartao.append(titulo);
  let capturado;
  cartao.setPointerCapture = jest.fn(() => { capturado = cartao; });
  titulo.setPointerCapture = jest.fn(() => { capturado = titulo; });
  const abrir = jest.fn(); titulo.onclick = abrir;
  for (const target of [titulo, icone]) {
    act(() => {
      result.current.iniciar(evento(90, 120, { target, currentTarget: cartao }), item);
      result.current.terminar(evento(90, 120, { target: capturado, currentTarget: cartao }));
    });
    // JSDOM não implementa pointer capture: reproduzimos o destino do click do navegador.
    const clique = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
    act(() => result.current.clicar(clique));
    expect(clique.stopPropagation).not.toHaveBeenCalled();
    capturado.click();
  }
  expect(abrir).toHaveBeenCalledTimes(2);
  expect(cartao.setPointerCapture).not.toHaveBeenCalled();
  expect(salvar).not.toHaveBeenCalled();
});

test('captura do botão preserva arraste, suprime abertura e alça continua usando o cartão', () => {
  const { result, evento, salvar } = preparar();
  const cartao = document.createElement('div'), titulo = document.createElement('button'), alca = document.createElement('span');
  alca.dataset.agendaResize = 'fim'; cartao.append(titulo, alca);
  cartao.setPointerCapture = jest.fn(); titulo.setPointerCapture = jest.fn();
  act(() => {
    result.current.iniciar(evento(90, 120, { target: titulo, currentTarget: cartao }), item);
    result.current.mover(evento(210, 180, { target: titulo, currentTarget: cartao }));
    result.current.terminar(evento(210, 180, { target: titulo, currentTarget: cartao }));
  });
  expect(titulo.setPointerCapture).toHaveBeenCalledWith(1);
  expect(salvar).toHaveBeenLastCalledWith(item, expect.objectContaining({ dataInicio: dias[1], horaInicio: '10:00' }));
  const clique = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
  act(() => result.current.clicar(clique));
  expect(clique.stopPropagation).toHaveBeenCalledTimes(1);
  act(() => {
    result.current.resetarClique();
    result.current.iniciar(evento(90, 120, { target: alca, currentTarget: cartao, pointerId: 2 }), item);
    result.current.terminar(evento(90, 180, { target: cartao, currentTarget: cartao, pointerId: 2 }));
  });
  expect(cartao.setPointerCapture).toHaveBeenCalledWith(2);
  expect(salvar).toHaveBeenLastCalledWith(item, expect.objectContaining({ dataInicio: dias[0], horaInicio: '09:00', horaFim: '11:00' }));
});

