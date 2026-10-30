import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const SITUACOES = { ABERTAS: 'Em aberto', NOVA: 'Nova', EM_ATENDIMENTO: 'Em atendimento', AGUARDANDO_CLIENTE: 'Aguardando cliente', CONCLUIDA: 'Concluída', ENCERRADA_LEGADO: 'Encerrada no legado', A_VERIFICAR: 'A verificar', TODAS: 'Todas' };
export const PRIORIDADES = { ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa', null: 'A classificar' };
export const RECORTES = { novas: 'Novas', prioritarias: 'Prioritárias', atrasadas: 'Atrasadas', semResponsavel: 'Sem responsável' };
const campos = ['busca', 'portalClientId', 'triagem', 'situacao', 'prioridade', 'responsavelId', 'recorte', 'cursor', 'limite'];

export function lerFiltros(search) {
  const params = new URLSearchParams(search);
  const filtros = { situacao: 'ABERTAS', limite: 100 };
  const invalidos = [];
  for (const [key, value] of params) {
    if (!campos.includes(key) || params.getAll(key).length !== 1) { invalidos.push(key); continue; }
    let valido = true;
    if (key === 'situacao') valido = Object.hasOwn(SITUACOES, value);
    else if (key === 'prioridade') valido = Object.hasOwn(PRIORIDADES, value);
    else if (key === 'recorte') valido = Object.hasOwn(RECORTES, value);
    else if (key === 'triagem') valido = ['true', 'false'].includes(value);
    else if (key === 'limite') valido = /^(?:[1-9][0-9]?|100)$/.test(value);
    else valido = Boolean(value.trim()) && value.length <= (key === 'cursor' ? 1999 : 200) && !Array.from(value).some(char => char.charCodeAt(0) < 32);
    if (!valido) { invalidos.push(key); continue; }
    if (key === 'situacao' && value === 'TODAS') delete filtros.situacao;
    else filtros[key] = ['prioridade', 'responsavelId'].includes(key) && value === 'null' ? null
      : key === 'triagem' ? value === 'true' : key === 'limite' ? Number(value) : value;
  }
  if (filtros.triagem && filtros.portalClientId) invalidos.push('triagem/empresa');
  return { filtros, invalidos: [...new Set(invalidos)] };
}

export function dataCivilValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function respostaValida(data) {
  return data && data.ok !== false && Array.isArray(data.itens)
    && Number.isInteger(data.total) && data.total >= data.itens.length
    && dataCivilValida(data.hoje)
    && ['resumo', 'porEmpresa', 'porPrioridade'].every(key => data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]))
    && (data.proximoCursor === null || typeof data.proximoCursor === 'string' && data.proximoCursor.length > 0)
    && data.itens.every(item => item && typeof item.id === 'string' && item.id.length && item.apresentacao && typeof item.apresentacao === 'object')
    && new Set(data.itens.map(item => item.id)).size === data.itens.length;
}

export function useSolicitacoes({ api, usuario, search }) {
  const consulta = useMemo(() => lerFiltros(search), [search]);
  const [state, setState] = useState(null);
  const sequencia = useRef(0);
  const contexto = useMemo(() => ({ api, usuario, search }), [api, usuario, search]);
  const atual = useRef(contexto);
  atual.current = contexto;
  const carregar = useCallback(async () => {
    if (atual.current !== contexto || consulta.invalidos.length) return;
    const numero = ++sequencia.current;
    setState(old => ({ contexto, data: old?.contexto === contexto ? old.data : null, loading: true, error: null }));
    try {
      if (typeof api?.listarSolicitacoes !== 'function') throw new Error('Leitura indisponível');
      const data = await api.listarSolicitacoes(consulta.filtros);
      if (data?.ok === false) throw Object.assign(new Error('Leitura recusada'), data);
      if (!respostaValida(data)) throw new Error('Resposta incompleta');
      if (atual.current === contexto && numero === sequencia.current) setState({ contexto, data, loading: false, error: null });
    } catch (error) {
      if (atual.current !== contexto || numero !== sequencia.current) return;
      const status = Number(error?.status);
      const code = error?.code || error?.data?.code || error?.payload?.code || error?.message;
      const tipo = status === 401 ? 'sessao' : status === 403 ? 'acesso' : /cursor[_ ]inv[aá]lido/i.test(code || '') ? 'cursor' : 'falha';
      setState(old => ({ contexto, data: tipo === 'falha' && old?.contexto === contexto ? old.data : null, loading: false, error: tipo }));
    }
  }, [api, consulta, contexto]);
  useEffect(() => {
    carregar();
    const refresh = () => { if (document.visibilityState !== 'hidden') carregar(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { sequencia.current++; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [carregar]);
  const visible = state?.contexto === contexto ? state : { data: null, loading: !consulta.invalidos.length, error: null };
  return { ...visible, ...consulta, carregar };
}
