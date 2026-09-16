import { useEffect, useRef, useState } from 'react';
import { janelaDoGesto } from '../lib/editarJanela';

export function useGestosAgenda({ dias, horasRef, salvar, bloqueado }) {
  const [previa, setPrevia] = useState(null);
  const atual = useRef(null), ignorarClique = useRef(false);
  const habilitada = item => !bloqueado && item.tipo === 'tarefa' && Boolean(item.tarefaId || item.ocorrenciaId);
  const cancelar = () => { atual.current = null; setPrevia(null); };
  useEffect(() => {
    const tecla = e => { if (e.key === 'Escape' && atual.current) { e.preventDefault(); cancelar(); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  function atualizar(x, y) {
    const gesto = atual.current, scroll = horasRef.current;
    if (!gesto || !scroll) return;
    gesto.x = x; gesto.y = y;
    if (!gesto.ativo && Math.hypot(x - gesto.xInicial, y - gesto.yInicial) < 5) return;
    gesto.ativo = true; ignorarClique.current = true;
    const grade = scroll.querySelector('.agenda-time-columns').getBoundingClientRect();
    const janela = scroll.getBoundingClientRect();
    const coluna = Math.floor((x - grade.left) / ((grade.width - 56) / dias.length));
    const dentro = coluna >= 0 && coluna < dias.length && y >= janela.top && y <= janela.bottom;
    let delta = Math.round(((y - gesto.yInicial + scroll.scrollTop - gesto.scrollInicial) / 56 * 60) / 15) * 15;
    if (!gesto.item.horaInicio) delta = Math.round(((y - grade.top) / 56 * 60) / 15) * 15 - 9 * 60;
    gesto.patch = dentro ? janelaDoGesto(gesto.item, gesto.modo, dias[coluna], delta) : null;
    setPrevia(gesto.patch ? { item: gesto.item, ...gesto.patch } : null);
  }
  // Rolar perto das bordas permite alcançar horários fora da área visível.
  useEffect(() => {
    if (!previa) return;
    let frame;
    const rolar = () => {
      const g = atual.current, scroll = horasRef.current;
      if (!g || !scroll) return;
      const r = scroll.getBoundingClientRect();
      const passo = g.y < r.top + 28 ? -8 : g.y > r.bottom - 28 ? 8 : 0;
      if (passo) { const antes = scroll.scrollTop; scroll.scrollTop += passo; if (antes !== scroll.scrollTop) atualizar(g.x, g.y); }
      frame = requestAnimationFrame(rolar);
    };
    frame = requestAnimationFrame(rolar);
    return () => cancelAnimationFrame(frame);
  }, [Boolean(previa)]);

  function iniciar(e, item) {
    if (!habilitada(item) || (e.button != null && e.button !== 0)) return;
    const modo = e.target.closest('[data-agenda-resize]')?.dataset.agendaResize || 'mover';
    atual.current = { item, modo, xInicial: e.clientX, yInicial: e.clientY, x: e.clientX, y: e.clientY, scrollInicial: horasRef.current.scrollTop, ativo: false, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function terminar(e) {
    const g = atual.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.ativo) atualizar(e.clientX, e.clientY);
    const patch = g.patch;
    cancelar();
    if (patch && ['dataInicio','dataFim','horaInicio','horaFim'].some(k => (g.item[k] || null) !== patch[k])) salvar(g.item, patch);
  }
  function teclado(e, item) {
    if (!habilitada(item) || !e.altKey || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const direcao = ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 1;
    const coluna = dias.indexOf(item.dataInicio) + (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? direcao : 0);
    if (!dias[coluna]) return;
    salvar(item, janelaDoGesto(item, e.shiftKey ? 'fim' : 'mover', dias[coluna], e.key === 'ArrowUp' || e.key === 'ArrowDown' ? direcao * 15 : 0));
  }
  return { previa, habilitada, iniciar, teclado,
    resetarClique: () => { ignorarClique.current = false; },
    clicar: e => { if (ignorarClique.current) { e.preventDefault(); e.stopPropagation(); ignorarClique.current = false; } },
    mover: e => { if (atual.current?.pointerId === e.pointerId) atualizar(e.clientX, e.clientY); },
    terminar, cancelar,
  };
}
