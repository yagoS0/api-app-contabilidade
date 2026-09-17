import { act, renderHook } from '@testing-library/react';
import { useGestosAgenda } from '../useGestosAgenda';
import { janelaCriacaoAgenda, medirGradeAgenda, pontoNaGrade, velocidadeRolagemAgenda } from '../../lib/geometriaAgenda';
import { ALTURA_HORA, HORA_INICIAL } from '../../lib/escalaAgenda';

const dias = ['2026-09-10', '2026-09-11'];
const item = { id: 'tarefa', tarefaId: 'tarefa', tipo: 'tarefa', titulo: 'Notas', dataInicio: dias[0], dataFim: dias[0], horaInicio: '09:00', horaFim: '10:00' };
let frames, proximoFrame;
beforeEach(() => {
  frames = new Map(); proximoFrame = 0;
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frames.set(++proximoFrame, fn); return proximoFrame; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id));
});
afterEach(() => jest.restoreAllMocks());

function quadro(tempo = 16) {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => callbacks.forEach(fn => fn(tempo)));
}
function preparar() {
  const scroll = document.createElement('div');
  scroll.innerHTML = '<div class="agenda-time-columns"><div class="agenda-time-day"><button class="agenda-time-slot"></button></div><div class="agenda-time-day"></div><div class="agenda-hours"></div></div>';
  scroll.scrollTop = 420;
  scroll.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 500, height: 500, width: 400 });
  const grade = scroll.firstChild;
  grade.getBoundingClientRect = jest.fn(() => ({ left: 0, right: 400, top: -scroll.scrollTop, bottom: 1440 - scroll.scrollTop, height: 1440, width: 400 }));
  grade.querySelector('.agenda-time-slot').getBoundingClientRect = () => ({ height: 60 });
  [...grade.querySelectorAll('.agenda-time-day')].forEach((el, i) => { el.getBoundingClientRect = () => ({ left: i * 180, right: (i + 1) * 180, width: 180 }); });
  const target = document.createElement('button'); target.setPointerCapture = jest.fn();
  const evento = (x, y, extras = {}) => ({ target, currentTarget: target, button: 0, pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse', ...extras });
  const salvar = jest.fn(), criar = jest.fn();
  const hook = renderHook(() => useGestosAgenda({ dias, horasRef: { current: scroll }, salvar, criar, bloqueado: false }));
  return { ...hook, scroll, grade, target, evento, salvar, criar };
}

test('mobile: usa os limites reais do último dia e exclui a coluna de horas', () => {
  const { scroll } = preparar(); const geometria = medirGradeAgenda(scroll, dias);
  expect(pontoNaGrade(geometria, 359, 120)).toEqual({ data: dias[1], minuto: 540 });
  expect(pontoNaGrade(geometria, 360, 120)).toBeNull();
  expect(pontoNaGrade(geometria, 180, 120).data).toBe(dias[1]);
});

test('escala ampliada mede 96px por hora e posiciona o ponteiro em intervalos de 15 minutos', () => {
  const {scroll,grade}=preparar();
  scroll.scrollTop=HORA_INICIAL * ALTURA_HORA;
  grade.querySelector('.agenda-time-slot').getBoundingClientRect=()=>({height:ALTURA_HORA});
  const geometria=medirGradeAgenda(scroll,dias);
  expect(geometria.alturaHora).toBe(96);
  expect(pontoNaGrade(geometria,90,ALTURA_HORA * 1.25)).toEqual({data:dias[0],minuto:9*60+15});
});

test('coalesces pointer bursts, skips equal snaps and flushes latest position on release', () => {
  const { result, evento, grade, salvar } = preparar();
  act(() => result.current.iniciar(evento(90, 120), item));
  act(() => { result.current.mover(evento(200, 140)); result.current.mover(evento(210, 180)); });
  expect(frames.size).toBe(1); expect(grade.getBoundingClientRect).not.toHaveBeenCalled();
  quadro();
  const anterior = result.current.previa;
  expect(anterior).toMatchObject({ dataInicio: dias[1], horaInicio: '10:00', horaFim: '11:00', left: 182, width: 175 });
  act(() => result.current.mover(evento(212, 181))); quadro(32);
  expect(result.current.previa).toBe(anterior);
  act(() => { result.current.mover(evento(220, 195)); result.current.terminar(evento(220, 195)); });
  expect(salvar).toHaveBeenCalledWith(item, expect.objectContaining({ horaInicio: '10:15', horaFim: '11:15' }));
  expect(frames.size).toBe(0);
});

test.each([[135, 225], [225, 135]])('selection %s→%s creates one precise interval', (inicio, fim) => {
  const { result, evento, criar } = preparar();
  act(() => { result.current.iniciarCriacao(evento(90, inicio), dias[0]); result.current.mover(evento(90, fim)); }); quadro();
  expect(result.current.previa).toMatchObject({ tipoGesto: 'criar', horaInicio: '09:15', horaFim: '10:45' });
  act(() => result.current.terminar(evento(90, fim)));
  expect(criar).toHaveBeenCalledTimes(1);
  expect(criar).toHaveBeenCalledWith({ dataInicio: dias[0], dataFim: dias[0], horaInicio: '09:15', horaFim: '10:45' });
  const clique = { preventDefault: jest.fn(), stopPropagation: jest.fn() };
  act(() => result.current.clicar(clique));
  expect(clique.stopPropagation).toHaveBeenCalled();
});

test('simple click selects the quarter hour, keyboard uses the focused hour', () => {
  const { result, evento, criar } = preparar();
  act(() => { result.current.iniciarCriacao(evento(90, 135), dias[0]); result.current.terminar(evento(90, 135)); });
  expect(criar).not.toHaveBeenCalled();
  act(() => result.current.clicarHorario(evento(90, 135, { detail: 1 }), dias[0], 9));
  expect(criar).toHaveBeenLastCalledWith(expect.objectContaining({ horaInicio: '09:15', horaFim: '10:15' }));
  act(() => result.current.clicarHorario(evento(0, 0, { detail: 0 }), dias[1], 11));
  expect(criar).toHaveBeenLastCalledWith(expect.objectContaining({ horaInicio: '11:00', horaFim: '12:00' }));
});

test('Escape cancels selection and pending frame; no creation after pointerup', () => {
  const { result, evento, criar } = preparar();
  act(() => { result.current.iniciarCriacao(evento(90, 135), dias[0]); result.current.mover(evento(90, 225)); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(frames.size).toBe(0);
  act(() => result.current.terminar(evento(90, 225)));
  expect(criar).not.toHaveBeenCalled(); expect(result.current.previa).toBeNull();
});

test('all-day obligation receives the measured target date and time', () => {
  const { result, evento, salvar } = preparar();
  const obrigacao = { ...item, tipo: 'obrigacao', tarefaId: null, ocorrenciaId: 'irrf', horaInicio: null, horaFim: null };
  act(() => { result.current.iniciar(evento(90, -20), obrigacao); result.current.terminar(evento(355, 180)); });
  expect(salvar).toHaveBeenCalledWith(obrigacao, { dataInicio: dias[1], dataFim: dias[1], horaInicio: '10:00', horaFim: null });
});

test('touch body preserves native scrolling, explicit handle still moves', () => {
  const { result, evento, salvar, target } = preparar();
  const touch = { pointerType: 'touch' };
  act(() => { result.current.iniciar(evento(90, 120, touch), item); result.current.terminar(evento(210, 180, touch)); });
  expect(salvar).not.toHaveBeenCalled(); expect(target.setPointerCapture).not.toHaveBeenCalled();
  target.setAttribute('data-agenda-move-handle', '');
  act(() => { result.current.iniciar(evento(90, 120, touch), item); result.current.terminar(evento(210, 180, touch)); });
  expect(salvar).toHaveBeenCalledTimes(1);
});

test('autoscroll advances the same distance for equal elapsed time', () => {
  const executar = passos => {
    const { result, evento, scroll, unmount } = preparar();
    act(() => { result.current.iniciar(evento(90, 120), item); result.current.mover(evento(90, 488)); }); quadro(0);
    passos.forEach(quadro);
    const distancia = scroll.scrollTop - 420;
    unmount(); frames.clear(); return distancia;
  };
  expect(executar([10, 20, 30, 40])).toBeCloseTo(executar([20, 40]), 5);
});

test('selection clamps at the end of the day and speed rises only near visible edges', () => {
  expect(janelaCriacaoAgenda(dias[0], 1425)).toMatchObject({ horaInicio: '23:45', horaFim: '23:59' });
  expect(janelaCriacaoAgenda(dias[0], 600, 600)).toMatchObject({ horaInicio: '10:00', horaFim: '10:15' });
  expect(velocidadeRolagemAgenda(250, { top: 0, bottom: 500 })).toBe(0);
  expect(velocidadeRolagemAgenda(501, { top: 0, bottom: 500 })).toBe(0);
  expect(velocidadeRolagemAgenda(499, { top: 0, bottom: 500 })).toBeGreaterThan(velocidadeRolagemAgenda(475, { top: 0, bottom: 500 }));
});
