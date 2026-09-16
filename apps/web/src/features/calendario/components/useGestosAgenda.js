import { useEffect, useRef, useState } from 'react';
import { janelaDoGesto } from '../lib/editarJanela';
import { arredondarMinutosAgenda, janelaCriacaoAgenda, medirGradeAgenda, pontoNaGrade, velocidadeRolagemAgenda } from '../lib/geometriaAgenda';

const campos = ['dataInicio', 'dataFim', 'horaInicio', 'horaFim'];
const rascunho = { id: 'nova-atividade', tipo: 'tarefa', titulo: 'Nova atividade' };

export function useGestosAgenda({ dias, horasRef, salvar, criar, bloqueado }) {
  const [previa, setPrevia] = useState(null);
  const atual = useRef(null), ignorarClique = useRef(false), quadro = useRef(null), previaRef = useRef(null);
  const opcoes = useRef(); opcoes.current = { dias, salvar, criar, bloqueado };
  const habilitada = item => !bloqueado && ['tarefa', 'obrigacao'].includes(item.tipo) && Boolean(item.tarefaId || item.ocorrenciaId);

  function mostrar(valor) {
    const antes = previaRef.current;
    if (antes === valor || (antes && valor && antes.item.id === valor.item.id && campos.every(k => antes[k] === valor[k]) && antes.left === valor.left && antes.width === valor.width)) return;
    previaRef.current = valor; setPrevia(valor);
  }
  function cancelar() {
    if (quadro.current != null) cancelAnimationFrame(quadro.current);
    quadro.current = null; atual.current = null; mostrar(null);
  }
  useEffect(() => {
    const tecla = e => { if (e.key === 'Escape' && atual.current) { e.preventDefault(); ignorarClique.current = true; cancelar(); } };
    window.addEventListener('keydown', tecla);
    return () => { window.removeEventListener('keydown', tecla); if (quadro.current != null) cancelAnimationFrame(quadro.current); };
  }, []);
  useEffect(() => { cancelar(); }, [dias.join('|')]);

  function atualizar(grade) {
    const g = atual.current, scroll = horasRef.current;
    if (!g || !scroll || !grade) return;
    if (!g.ativo && Math.hypot(g.x - g.xInicial, g.y - g.yInicial) < 5) return;
    g.ativo = true; ignorarClique.current = true;
    const ponto = pontoNaGrade(grade, g.x, g.y);
    let patch = null;
    if (ponto) {
      if (g.modo === 'criar') patch = janelaCriacaoAgenda(g.data, g.minutoInicial, ponto.minuto);
      else {
        const delta = g.item.horaInicio
          ? arredondarMinutosAgenda((g.y - g.yInicial + scroll.scrollTop - g.scrollInicial) / grade.alturaHora * 60)
          : ponto.minuto - 9 * 60;
        patch = janelaDoGesto(g.item, g.modo, ponto.data, delta);
      }
    }
    g.patch = patch;
    const coluna = patch && grade.colunas.find(c => c.data === patch.dataInicio);
    mostrar(patch && coluna ? { item: g.item, ...patch, tipoGesto: g.modo, left: coluna.left - grade.rect.left + 2, width: Math.max(1, coluna.width - 5) } : null);
  }

  function agendar() { if (quadro.current == null) quadro.current = requestAnimationFrame(processarQuadro); }
  function processarQuadro(tempo) {
    quadro.current = null;
    const g = atual.current, scroll = horasRef.current;
    if (!g || !scroll) return;
    let grade = medirGradeAgenda(scroll, opcoes.current.dias);
    if (!grade) return;
    const passo = g.ativo && previaRef.current ? velocidadeRolagemAgenda(g.y, grade.janela) : 0;
    if (passo && g.tempo != null) {
      const antes = scroll.scrollTop;
      scroll.scrollTop += passo * Math.min(50, tempo - g.tempo) / 1000;
      if (scroll.scrollTop !== antes) grade = medirGradeAgenda(scroll, opcoes.current.dias);
    }
    g.tempo = tempo; atualizar(grade);
    if (g.ativo && previaRef.current && velocidadeRolagemAgenda(g.y, grade.janela)) agendar();
  }

  function comecar(e, valores) {
    if (atual.current || opcoes.current.bloqueado || (e.button != null && e.button !== 0) || e.isPrimary === false) return;
    const scroll = horasRef.current;
    if (!scroll) return;
    atual.current = { ...valores, xInicial: e.clientX, yInicial: e.clientY, x: e.clientX, y: e.clientY, scrollInicial: scroll.scrollTop, ativo: false, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function iniciar(e, item) {
    if (!habilitada(item)) return;
    // Touch scrolling remains native on the card body; explicit handles own editing gestures.
    if (e.pointerType === 'touch' && !e.target.closest('[data-agenda-resize], [data-agenda-move-handle]')) return;
    comecar(e, { item, modo: e.target.closest('[data-agenda-resize]')?.dataset.agendaResize || 'mover' });
  }
  function iniciarCriacao(e, data) {
    if (e.pointerType === 'touch' || !opcoes.current.criar) return;
    const grade = medirGradeAgenda(horasRef.current, opcoes.current.dias);
    const ponto = grade && pontoNaGrade(grade, e.clientX, e.clientY);
    if (ponto) comecar(e, { modo: 'criar', item: rascunho, data, minutoInicial: ponto.minuto });
  }
  function terminar(e) {
    const g = atual.current;
    if (!g || g.pointerId !== e.pointerId) return;
    g.x = e.clientX; g.y = e.clientY;
    atualizar(medirGradeAgenda(horasRef.current, opcoes.current.dias));
    const patch = g.patch;
    cancelar();
    if (!patch) return;
    if (g.modo === 'criar') opcoes.current.criar?.(patch);
    else if (campos.some(k => (g.item[k] || null) !== patch[k])) opcoes.current.salvar(g.item, patch);
  }
  function clicarHorario(e, data, horaFallback) {
    if (opcoes.current.bloqueado || ignorarClique.current) return;
    const grade = medirGradeAgenda(horasRef.current, opcoes.current.dias);
    const ponto = e.detail > 0 && grade ? pontoNaGrade(grade, e.clientX, e.clientY) : null;
    opcoes.current.criar?.(janelaCriacaoAgenda(data, ponto?.minuto ?? horaFallback * 60));
  }
  function teclado(e, item) {
    if (!habilitada(item) || !e.altKey || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const direcao = ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 1;
    const coluna = dias.indexOf(item.dataInicio) + (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? direcao : 0);
    if (!dias[coluna]) return;
    salvar(item, janelaDoGesto(item, e.shiftKey ? 'fim' : 'mover', dias[coluna], e.key === 'ArrowUp' || e.key === 'ArrowDown' ? direcao * 15 : 0));
  }
  return { previa, habilitada, iniciar, iniciarCriacao, clicarHorario, teclado,
    resetarClique: () => { ignorarClique.current = false; },
    clicar: e => { if (ignorarClique.current) { e.preventDefault(); e.stopPropagation(); ignorarClique.current = false; } },
    mover: e => { const g = atual.current; if (g?.pointerId === e.pointerId) { g.x = e.clientX; g.y = e.clientY; agendar(); } },
    terminar, cancelar,
  };
}
