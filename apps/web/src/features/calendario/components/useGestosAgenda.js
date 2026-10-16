import { useEffect, useRef, useState } from 'react';
import { janelaDoGesto, diferencaDias } from '../lib/editarJanela';
import { somarDiasAgenda } from '../../../../../../packages/shared/src/agenda.js';
import { arredondarMinutosAgenda, janelaCriacaoAgenda, medirGradeAgenda, pontoNaGrade, velocidadeRolagemAgenda } from '../lib/geometriaAgenda';

const campos = ['dataInicio', 'dataFim', 'horaInicio', 'horaFim'];
const rascunho = { id: 'nova-atividade', tipo: 'tarefa', titulo: 'Nova atividade' };

export function useGestosAgenda({ dias, horasRef, mesRef, faixaRef, mensal = false, salvar, criar, bloqueado }) {
  const [previa, setPrevia] = useState(null);
  const atual = useRef(null), ignorarClique = useRef(false), quadro = useRef(null), previaRef = useRef(null);
  const opcoes = useRef(); opcoes.current = { dias, salvar, criar, bloqueado, mensal };
  const habilitada = item => !bloqueado && ['tarefa', 'obrigacao'].includes(item.tipo) && Boolean(item.tarefaId || item.ocorrenciaId);

  function mostrar(valor) {
    const antes = previaRef.current;
    if (antes === valor || (antes && valor && antes.item.id === valor.item.id && campos.every(k => antes[k] === valor[k]) && ['left','top','width','height'].every(k => antes[k] === valor[k]))) return;
    previaRef.current = valor; setPrevia(valor);
  }
  function cancelar() {
    if (quadro.current != null) cancelAnimationFrame(quadro.current);
    quadro.current = null; atual.current = null; mostrar(null);
  }
  useEffect(() => {
    const novoPonteiro = () => { ignorarClique.current = false; };
    document.addEventListener('pointerdown', novoPonteiro, true);
    const tecla = e => { if (e.key === 'Escape' && atual.current) { e.preventDefault(); ignorarClique.current = true; cancelar(); } };
    window.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', novoPonteiro, true); window.removeEventListener('keydown', tecla); if (quadro.current != null) cancelAnimationFrame(quadro.current); };
  }, []);
  useEffect(() => { cancelar(); }, [dias.join('|')]);

  function diaNoMes(x, y) {
    for (const semana of mesRef?.current?.querySelectorAll('[data-agenda-month-week]') || []) {
      const rect = semana.getBoundingClientRect();
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      const coluna = Math.floor((x - rect.left) / (rect.width / 7));
      return { data:somarDiasAgenda(semana.dataset.agendaMonthWeek, coluna), left:rect.left + coluna * rect.width / 7, top:rect.top, width:rect.width / 7, height:rect.height };
    }
    return null;
  }
  function diaNaFaixa(x, y) {
    for (const celula of faixaRef?.current?.querySelectorAll('[data-agenda-all-day]') || []) {
      const rect = celula.getBoundingClientRect();
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return { data: celula.dataset.agendaAllDay, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return null;
  }
  function atualizarDatas() {
    const g = atual.current;
    if (!g || (!g.ativo && Math.hypot(g.x - g.xInicial, g.y - g.yInicial) < 5)) return;
    g.ativo = true; ignorarClique.current = true;
    const destino = opcoes.current.mensal ? diaNoMes(g.x, g.y) : diaNaFaixa(g.x, g.y);
    const base = g.item.atividadeOriginal || g.item;
    let patch = null;
    if (destino) {
      const delta = diferencaDias(destino.data, g.diaInicial);
      const dataInicio = g.modo === 'mover' ? somarDiasAgenda(base.dataInicio, delta) : g.modo === 'inicio' ? (destino.data > base.dataFim ? base.dataFim : destino.data) : base.dataInicio;
      const dataFim = g.modo === 'mover' ? somarDiasAgenda(base.dataFim, delta) : g.modo === 'fim' ? (destino.data < base.dataInicio ? base.dataInicio : destino.data) : base.dataFim;
      patch = { dataInicio, dataFim, horaInicio: base.horaInicio || null, horaFim: base.horaFim || null };
    }
    g.patch = patch;
    mostrar(patch ? { item: g.item, ...destino, ...patch, mensal: true, tipoGesto: g.modo } : null);
  }

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
    if (opcoes.current.mensal || atual.current?.faixa) { atualizarDatas(); return; }
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
    const faixa = !opcoes.current.mensal && Boolean(e.target.closest?.('[data-agenda-all-day]'));
    const dia = opcoes.current.mensal ? diaNoMes(e.clientX,e.clientY) : faixa ? diaNaFaixa(e.clientX,e.clientY) : null;
    if (opcoes.current.mensal || faixa ? !dia : !scroll) return;
    ignorarClique.current = false;
    atual.current = { ...valores, faixa, diaInicial:dia?.data, xInicial: e.clientX, yInicial: e.clientY, x: e.clientX, y: e.clientY, scrollInicial: scroll?.scrollTop || 0, ativo: false, pointerId: e.pointerId };
    // Capturar no contêiner redireciona o click para fora do botão que abre a atividade.
    // O botão de origem mantém sua ativação nativa e continua propagando os gestos.
    const botao = e.target.closest?.('button');
    const captura = botao && e.currentTarget.contains(botao) ? botao : e.currentTarget;
    captura.setPointerCapture?.(e.pointerId);
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
    if (opcoes.current.mensal || g.faixa) atualizarDatas();
    else atualizar(medirGradeAgenda(horasRef.current, opcoes.current.dias));
    const patch = g.patch;
    cancelar();
    if (!patch) return;
    const somenteDatas = Boolean(opcoes.current.mensal || g.faixa);
    const base = somenteDatas ? g.item.atividadeOriginal || g.item : g.item;
    if (g.modo === 'criar') opcoes.current.criar?.(patch);
    else if (campos.some(k => (base[k] || null) !== patch[k])) opcoes.current.salvar(g.item, { ...patch, tipoGesto: g.modo, somenteDatas, periodoCompleto: somenteDatas });
  }
  function clicarHorario(e, data, horaFallback) {
    if (opcoes.current.bloqueado || !clicar(e)) return;
    // Clique seleciona a célula inteira; só o arraste escolhe frações de hora.
    opcoes.current.criar?.(janelaCriacaoAgenda(data, horaFallback * 60));
  }
  function clicar(e) {
    if (ignorarClique.current) {
      ignorarClique.current = false;
      e.preventDefault?.(); e.stopPropagation?.();
      return false;
    }
    return true;
  }
  function teclado(e, item) {
    if (!habilitada(item) || !e.altKey || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const direcao = ['ArrowUp','ArrowLeft'].includes(e.key) ? -1 : 1;
    if (mensal || e.currentTarget?.closest?.('[data-agenda-all-day]')) {
      const delta = direcao * (['ArrowUp','ArrowDown'].includes(e.key) ? 7 : 1);
      const base = item.atividadeOriginal || item;
      salvar(item, {dataInicio:somarDiasAgenda(base.dataInicio,delta),dataFim:somarDiasAgenda(base.dataFim,delta),horaInicio:base.horaInicio || null,horaFim:base.horaFim || null,tipoGesto:'mover',somenteDatas:true,periodoCompleto:true});
      return;
    }
    const coluna = dias.indexOf(item.dataInicio) + (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? direcao : 0);
    if (!dias[coluna]) return;
    salvar(item, { ...janelaDoGesto(item, e.shiftKey ? 'fim' : 'mover', dias[coluna], e.key === 'ArrowUp' || e.key === 'ArrowDown' ? direcao * 15 : 0), tipoGesto: e.shiftKey ? 'fim' : 'mover', somenteDatas: false });
  }
  return { previa, habilitada, iniciar, iniciarCriacao, clicarHorario, teclado, permiteRedimensionar:true, horizontal:mensal,
    resetarClique: () => { ignorarClique.current = false; },
    clicar,
    mover: e => { const g = atual.current; if (g?.pointerId === e.pointerId) { g.x = e.clientX; g.y = e.clientY; agendar(); } },
    terminar, cancelar,
  };
}
