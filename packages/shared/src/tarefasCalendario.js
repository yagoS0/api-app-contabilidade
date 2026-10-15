import { dataAgenda, somarDiasAgenda, normalizarAgenda } from './agenda.js';
const DAY = 86400000;
const monthSteps = { MENSAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
export function vencimentoNoMes(mes, dia) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, Math.min(dia, new Date(Date.UTC(y, m, 0)).getUTCDate()))).toISOString().slice(0, 10);
}
export function normalizarTarefaCalendario(dados = {}) {
  const titulo = String(dados.titulo || '').trim();
  if (!titulo || titulo.length > 200) throw new Error('Informe um título de até 200 caracteres.');
  const c = dados.config || {};
  const base = normalizarAgenda({ ...c, horaInicio: null, horaFim: null, ajusteDiaUtil: 'MANTER' });
  const horarioModo = c.horarioModo || 'SEM';
  if (!['SEM', 'FIXO', 'ATE'].includes(horarioModo)) throw new Error('Selecione o tipo de horário.');
  const hora = horarioModo === 'FIXO' ? c.horaInicio : c.horaLimite;
  if (horarioModo !== 'SEM' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora || '')) throw new Error('Informe um horário válido.');
  const diaVencimento = c.diaVencimento == null || c.diaVencimento === '' ? null : Number(c.diaVencimento);
  if (diaVencimento !== null && (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31)) throw new Error('Escolha o dia de vencimento entre 1 e 31.');
  const repetirQuantidade = c.repetirQuantidade == null || c.repetirQuantidade === '' ? null : Number(c.repetirQuantidade);
  if (repetirQuantidade !== null && (!Number.isInteger(repetirQuantidade) || repetirQuantidade < 1 || repetirQuantidade > 10000)) throw new Error('Informe entre 1 e 10000 repetições.');
  if (!Array.isArray(dados.empresasIds || []) || (dados.empresasIds || []).some(id => typeof id !== 'string' || !id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id))) throw new Error('Selecione empresas válidas.');
  if (!Array.isArray(dados.subtarefas || []) || (dados.subtarefas || []).length > 100) throw new Error('Informe até 100 subtarefas.');
  const subtarefas = (dados.subtarefas || []).map(s => ({ id: String(s.id || ''), titulo: String(s.titulo || '').trim() }));
  if (subtarefas.some(s => !/^[\w-]{1,100}$/.test(s.id) || ['__proto__', 'constructor', 'prototype'].includes(s.id) || !s.titulo || s.titulo.length > 200) || new Set(subtarefas.map(s => s.id)).size !== subtarefas.length) throw new Error('Informe subtarefas com identificadores únicos e títulos de até 200 caracteres.');
  return { titulo, descricao: String(dados.descricao || '').slice(0, 10000), empresasIds: [...new Set(dados.empresasIds || [])], subtarefas, config: { ...base, horarioModo, horaInicio: horarioModo === 'FIXO' ? hora : null, horaLimite: horarioModo === 'ATE' ? hora : null, diaVencimento, repetirQuantidade, dataVencimento: c.dataVencimento ? dataAgenda(c.dataVencimento) : null, cor: /^#[0-9a-f]{6}$/i.test(c.cor || '') ? c.cor : null } };
}
function ciclos(c, inicio, fim) {
  const result = [], duration = (+new Date(c.dataFim) - +new Date(c.dataInicio)) / DAY;
  const add = (start, end, key, n) => {
    if (start < c.dataInicio || (c.repetirAte && start > c.repetirAte) || (c.repetirQuantidade && n >= c.repetirQuantidade)) return;
    result.push({ dataInicio: start, dataFim: end, cicloChave: key });
  };
  if (c.recorrencia === 'AVULSA') add(c.dataInicio, c.dataFim, c.dataInicio, 0);
  else if (['DIARIA','SEMANAL'].includes(c.recorrencia)) {
    const step = c.recorrencia === 'DIARIA' ? 1 : 7;
    const offset = Math.max(0, Math.floor(((+new Date(inicio) - +new Date(c.dataInicio)) / DAY - duration - 32) / step));
    for (let n = offset; ; n++) {
      const start = somarDiasAgenda(c.dataInicio, n * step);
      if (start > fim) break;
      add(start, somarDiasAgenda(start, duration), start, n);
    }
  } else {
    const [y,m,d] = c.dataInicio.split('-').map(Number), [ey,em,ed] = c.dataFim.split('-').map(Number);
    const delta = (ey-y)*12+em-m, step = monthSteps[c.recorrencia];
    const min = new Date(inicio), max = new Date(fim);
    const offset = Math.max(0, Math.floor(((min.getUTCFullYear()-y)*12+min.getUTCMonth()+1-m-delta-1)/step));
    for (let n = offset; ; n++) {
      const date = new Date(Date.UTC(y,m-1+n*step,1));
      if (date > max) break;
      const key = date.toISOString().slice(0,7), endMonth = new Date(Date.UTC(y,m-1+n*step+delta,1)).toISOString().slice(0,7);
      add(vencimentoNoMes(key,d),vencimentoNoMes(endMonth,ed),key,n);
    }
  }
  return result;
}
export function expandirTarefaCalendario(tarefa, inicio, fim) {
  dataAgenda(inicio); dataAgenda(fim);
  if (fim < inicio || (+new Date(fim)-+new Date(inicio))/DAY > 740) throw new Error('Consulte um intervalo de até dois anos.');
  if (tarefa.excluidaEm) return [];
  const baseBoundary = monthSteps[tarefa.config.recorrencia] ? `${tarefa.config.dataInicio.slice(0,7)}-01` : tarefa.config.dataInicio;
  const versions = [{ aPartirDe: baseBoundary, dados: tarefa }, ...(tarefa.versoes || [])].sort((a,b) => a.aPartirDe.localeCompare(b.aPartirDe));
  const result = [];
  versions.forEach((version, index) => {
    const t = { ...tarefa, ...version.dados }, c = t.config;
    const candidates = new Map(ciclos(c,inicio,somarDiasAgenda(fim,32)).map(o => [o.cicloChave,o]));
    // Overrides may have been moved far away from their nominal cycle.
    for (const key of Object.keys(tarefa.estados || {})) {
      const date = key.length === 7 ? `${key}-01` : key;
      if (!/^\d{4}-\d{2}(-\d{2})?$/.test(key)) continue;
      for (const o of ciclos(c,date,somarDiasAgenda(date,32))) if (o.cicloChave === key) candidates.set(key,o);
      const preserved = tarefa.estados[key];
      if (preserved.preservada && preserved.alteracoes?.config) candidates.set(key, { cicloChave:key, dataInicio:date, dataFim:date });
    }
    for (const oc of candidates.values()) {
      if (oc.dataInicio < version.aPartirDe || (versions[index+1] && oc.dataInicio >= versions[index+1].aPartirDe)) continue;
      const state = tarefa.estados?.[oc.cicloChave] || {};
      if (state.canceladaEm) continue;
      const effective = { ...t, ...(state.alteracoes || {}) };
      const config = { ...c, dataInicio: oc.dataInicio, dataFim: oc.dataFim, ...(state.alteracoes?.config || {}) };
      const empresas = (effective.empresasIds || []).map(companyId => {
        const status = state.empresas?.[companyId] || {};
        const subtarefas = (effective.subtarefas || []).map(s => ({ ...s, concluida: Boolean(status.subtarefas?.[s.id] ?? status.concluidaEm) }));
        return { companyId, nome: tarefa.nomesEmpresas?.[companyId] || companyId, subtarefas, concluida: Boolean(status.concluidaEm) || (subtarefas.length > 0 && subtarefas.every(s=>s.concluida)) };
      });
      const subtarefas = (effective.subtarefas || []).map(s=>({ ...s, concluida: Boolean(state.subtarefas?.[s.id] ?? state.concluidaEm) }));
      const concluida = empresas.length ? empresas.every(e=>e.concluida) : Boolean(state.concluidaEm) || (subtarefas.length > 0 && subtarefas.every(s=>s.concluida));
      const dataVencimento = config.recorrencia === 'AVULSA' ? config.dataVencimento : config.diaVencimento ? vencimentoNoMes(oc.dataInicio.slice(0,7),config.diaVencimento) : null;
      const diasAlerta = !concluida && dataVencimento ? [somarDiasAgenda(dataVencimento,-1),dataVencimento] : [];
      if (!(config.dataInicio <= fim && config.dataFim >= inicio) && !diasAlerta.some(d=>d>=inicio && d<=fim)) continue;
      result.push({ ...effective, ...config, config, id: `${tarefa.id}:${oc.cicloChave}`, tarefaId: tarefa.id, tipo:'tarefa', unificada:true, cicloChave: oc.cicloChave, empresas, subtarefas, concluidaEm: concluida ? state.concluidaEm || state.atualizadoEm || true : null, resolvido: concluida, dataVencimento, diasAlerta, data: config.dataInicio });
    }
  });
  return result.sort((a,b)=>a.dataInicio.localeCompare(b.dataInicio));
}
export function encontrarTarefaCalendario(tarefa, chave) {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(chave || '')) throw new Error('Ocorrência inválida.');
  const start = chave.length === 7 ? `${chave}-01` : chave;
  // Moved occurrences are found via their effective window.
  const moved = tarefa.estados?.[chave]?.alteracoes?.config?.dataInicio;
  return expandirTarefaCalendario(tarefa,moved || start,somarDiasAgenda(moved || start,40)).find(o=>o.cicloChave===chave);
}
export function aplicarAcaoTarefaCalendario(tarefa, dados, agora = new Date().toISOString()) {
  const { acao, cicloChave, companyId, subtarefaId } = dados;
  if (!['CONCLUIR','REABRIR','SUBTAREFA','EDITAR','EDITAR_SERIE','EXCLUIR','EXCLUIR_SERIE'].includes(acao)) throw new Error('Ação inválida.');
  if (acao === 'EXCLUIR_SERIE') return { excluidaEm: agora };
  const oc = encontrarTarefaCalendario(tarefa,cicloChave);
  if (!oc) throw new Error('Ocorrência não encontrada.');
  const state = { ...(tarefa.estados?.[cicloChave] || {}), atualizadoEm: agora };
  if (acao === 'EDITAR' || acao === 'EDITAR_SERIE') {
    const a = dados.alteracoes || {};
    const changed = normalizarTarefaCalendario({ ...oc, ...a, config: { ...oc.config, ...(a.config || {}) } });
    if (acao === 'EDITAR_SERIE') {
      // The boundary is nominal, even when this occurrence was moved individually.
      const boundary = cicloChave.length === 7 ? `${cicloChave}-01` : cicloChave;
      const versoes = (tarefa.versoes || []).filter(v=>v.aPartirDe < boundary);
      versoes.push({ aPartirDe: boundary, dados: changed });
      const estados = { ...tarefa.estados };
      // Freeze touched occurrences before replacing their schedule. This retains completed,
      // partially checked and explicitly edited work even if the frequency changes.
      for (const [key,s] of Object.entries(estados)) {
        if (key < cicloChave || s.canceladaEm) continue;
        if (s.concluidaEm || Object.keys(s.empresas || {}).length || Object.keys(s.subtarefas || {}).length || (s.alteracoes && key !== cicloChave)) {
          const old = encontrarTarefaCalendario(tarefa,key);
          if (old) estados[key] = { ...s, preservada:true, alteracoes:normalizarTarefaCalendario(old) };
        } else if (key === cicloChave) delete estados[key];
      }
      return { versoes, estados };
    }
    state.empresas = { ...state.empresas };
    for (const empresa of oc.empresas) if (empresa.concluida) state.empresas[empresa.companyId] = { ...state.empresas[empresa.companyId], concluidaEm:state.empresas[empresa.companyId]?.concluidaEm || agora };
    if (!oc.empresas.length && oc.concluidaEm) state.concluidaEm = state.concluidaEm || agora;
    state.alteracoes = changed;
  } else if (acao === 'EXCLUIR') state.canceladaEm = agora;
  else {
    if (companyId && !oc.empresasIds.includes(companyId)) throw new Error('Empresa não encontrada nesta tarefa.');
    if (acao === 'SUBTAREFA' && ((oc.empresasIds.length > 0 && !companyId) || !oc.subtarefas.some(s=>s.id===subtarefaId) || typeof dados.concluida !== 'boolean')) throw new Error('Subtarefa inválida.');
    if (!oc.empresasIds.length) {
      state.subtarefas = acao === 'SUBTAREFA'
        ? { ...Object.fromEntries(oc.subtarefas.map(s=>[s.id,s.concluida])), [subtarefaId]:dados.concluida }
        : Object.fromEntries(oc.subtarefas.map(s=>[s.id,acao==='CONCLUIR']));
    }
    state.empresas = { ...state.empresas };
    for (const id of companyId ? [companyId] : oc.empresasIds) {
      const e = { ...state.empresas[id] };
      if (acao === 'SUBTAREFA') {
        e.subtarefas = { ...Object.fromEntries(oc.empresas.find(x=>x.companyId===id).subtarefas.map(s=>[s.id,s.concluida])), [subtarefaId]: dados.concluida };
        e.concluidaEm = oc.subtarefas.every(s=>e.subtarefas[s.id]) ? agora : null;
      }
      else {
        e.subtarefas = Object.fromEntries(oc.subtarefas.map(s=>[s.id,acao==='CONCLUIR']));
        e.concluidaEm = acao === 'CONCLUIR' ? agora : null;
      }
      state.empresas[id] = e;
    }
    state.concluidaEm = acao === 'CONCLUIR' && !companyId ? agora : null;
  }
  return { estados: { ...tarefa.estados, [cicloChave]: state } };
}
