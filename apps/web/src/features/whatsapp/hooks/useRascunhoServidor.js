import { useEffect, useMemo, useRef, useState } from "react";
// Dados privados só na memória da sessão e no servidor autenticado. Um contexto com
// falha continua recuperável ao trocar de conversa; nunca bloqueia sem saída a atualização.
const canonico = valor => JSON.stringify(valor, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const caches = new WeakMap(), pendentes = new Set();
function rascunhoValido(r) {
  return r && r.ok !== false && Object.hasOwn(r, "rascunho") && (r.rascunho === null ||
    (Number.isInteger(r.rascunho?.versao) && r.rascunho.versao >= 0 && typeof r.rascunho.conteudo?.texto === "string"));
}
export const haRascunhoPendente = () => pendentes.size > 0;
export function limparRascunhosDaSessao(api) {
  const cache = caches.get(api);
  if (cache) for (const c of cache.values()) { c.cancelado = true; clearTimeout(c.timer); c.ultima = null; c.conteudo = null; c.confirmado = null; c.conferido = null; c.restauradores.forEach(fn => fn({ texto: "" })); pendentes.delete(c); avisar(c, c.estado, c.erro); }
  caches.delete(api);
}
function avisar(c, estado, erro = "") {
  c.estado = estado; c.erro = erro;
  c.listeners.forEach(fn => fn(leituraDe(c)));
}
function leituraDe(c) {
  return { estado: c.excluindo ? "excluindo" : c.estado, erro: c.erro,
    pendente: Boolean(c.ultima || c.emGravacao || c.excluindo || c.estado === "conflito" || c.estado === "erro"),
    pronto: c.pronto && !c.excluindo && !c.cancelado && !c.incerto && c.estado !== "conflito" };
}
function gravar(c, explicito = false) {
  clearTimeout(c.timer);
  const trabalho = async () => {
    if (c.cancelado || c.incerto || c.sessao !== (c.api?.getAccessToken?.() || "sessao") || !c.pronto || c.excluindo || c.estado === "conflito" || (c.suspensoes.size && !explicito)) return false;
    if (!c.ultima) return true;
    const conteudo = c.ultima; c.ultima = null; c.emGravacao = conteudo;
    try {
      const r = await c.api.salvarRascunhoWhatsapp(c.id, { modo: c.modo, versao: c.versao, conteudo });
      if (c.cancelado || c.incerto || c.sessao !== (c.api?.getAccessToken?.() || "sessao")) return false;
      if (r?.ok === false || !Number.isInteger(r?.rascunho?.versao) || r.rascunho.versao <= c.versao || typeof r.rascunho?.conteudo?.texto !== "string" || canonico(r.rascunho.conteudo) !== canonico(conteudo)) throw new Error("Revisão do rascunho não confirmada.");
      c.versao = r.rascunho.versao;
      c.confirmado = r.rascunho;
      c.conteudo = conteudo;
      if (!c.ultima) { if (!c.excluindo) pendentes.delete(c); avisar(c, "salvo"); }
      return true;
    } catch (e) {
      if (c.cancelado || c.incerto || c.sessao !== (c.api?.getAccessToken?.() || "sessao")) return false;
      c.incerto = !e.status || e.status >= 500;
      c.ultima = c.descartavel || c.ultima || conteudo; pendentes.add(c);
      avisar(c, e.status === 409 ? "conflito" : "erro", e.status === 409
        ? "Este rascunho mudou em outro aparelho. Seu texto foi preservado aqui; abra a versão salva para comparar antes de continuar."
        : "Rascunho ainda não salvo. Mantenha esta tela aberta e tente salvar novamente.");
      return false;
    } finally { c.emGravacao = null; if (!c.cancelado) avisar(c, c.estado, c.erro); }
  };
  c.fila = c.fila.then(trabalho, trabalho); return c.fila;
}
export function useRascunhoServidor({ api, conversaId, modo = "texto", canalId = null, vinculoId = null, onRestaurar }) {
  const restaurar = useRef(onRestaurar); restaurar.current = onRestaurar;
  const [leitura, setLeitura] = useState({ estado: api?.getRascunhoWhatsapp ? "carregando" : "memoria", erro: "", pronto: !api?.getRascunhoWhatsapp });
  const contexto = useRef(null);
  const sessao = api?.getAccessToken?.() || "sessao";
  // O lease é opaco: credenciais nunca são expostas ao coordenador ou à URL.
  const identidade = useMemo(() => ({}), [api, sessao, conversaId, modo, canalId, vinculoId]);
  const lease = useMemo(() => ({ ativo: true }), [identidade]);
  useEffect(() => { lease.ativo = true; return () => { lease.ativo = false; }; }, [lease]);
  useEffect(() => {
    if (!conversaId || !api?.getRascunhoWhatsapp) { contexto.current = null; setLeitura({ estado: "memoria", pronto: true, erro: "" }); return; }
    let cache = caches.get(api); if (!cache) { cache = new Map(); caches.set(api, cache); }
    const key = JSON.stringify([sessao, modo, conversaId, canalId, vinculoId]);
    let c = cache.get(key);
    if (!c) { c = { api, id: conversaId, modo, sessao, canalId, vinculoId, versao: 0, edicao: 0, pronto: false, estado: "carregando", erro: "", ultima: null, fila: Promise.resolve(), listeners: new Set(), restauradores: new Set(), suspensoes: new Set(), revisao: 0 }; cache.set(key, c); }
    contexto.current = c; c.listeners.add(setLeitura);
    const restaurarContexto = valor => restaurar.current?.(valor);
    c.restauradores.add(restaurarContexto);
    let vivo = true;
    if (c.excluindo || c.ultima || c.emGravacao || c.estado === "conflito") {
      setLeitura(leituraDe(c));
      const conteudo = c.ultima || c.emGravacao || c.descartavel || c.conteudo;
      if (conteudo) restaurarContexto(conteudo);
    }
    else {
      c.pronto = false; avisar(c, "carregando"); const revisao = ++c.revisao;
      api.getRascunhoWhatsapp(conversaId, modo).then(r => {
        if (!vivo || c.cancelado || c.revisao !== revisao || c.sessao !== (api?.getAccessToken?.() || "sessao")) return;
        if (!rascunhoValido(r)) throw new Error("Leitura do rascunho não confirmada.");
        c.versao = r?.rascunho?.versao || 0; c.pronto = true;
        c.conteudo = r?.rascunho?.conteudo;
        c.confirmado = r?.rascunho;
        if (c.conteudo) restaurarContexto(c.conteudo);
        avisar(c, r?.rascunho ? "salvo" : "pronto");
      }).catch(e => { if (vivo && !c.cancelado && c.revisao === revisao) avisar(c, "erro", e.message || "Não foi possível recuperar o rascunho."); });
    }
    return () => { vivo = false; c.listeners.delete(setLeitura); c.restauradores.delete(restaurarContexto); const suspenso = c.suspensoes.size > 0; c.suspensoes.delete(lease); clearTimeout(c.timer); if (c.ultima && !suspenso && !c.excluindo && c.estado !== "conflito") gravar(c); };
  }, [api, conversaId, modo, sessao, canalId, vinculoId, lease]);
  const candidato = contexto.current;
  const contextoDestaRenderizacao = candidato && candidato.api === api && candidato.sessao === sessao && candidato.id === conversaId && candidato.modo === modo && candidato.canalId === canalId && candidato.vinculoId === vinculoId ? candidato : null;
  const restaurarDestaRenderizacao = onRestaurar;
  function salvar(conteudo, imediato = false) {
    const c = contextoDestaRenderizacao;
    if (!api?.salvarRascunhoWhatsapp || !c) return Promise.resolve(true);
    if (c.sessao !== (api?.getAccessToken?.() || "sessao") || !c.pronto || c.excluindo || c.estado === "conflito" || c.cancelado) return Promise.resolve(false);
    c.ultima = conteudo; c.conferido = null; ++c.edicao; ++c.revisao; pendentes.add(c); avisar(c, "salvando"); clearTimeout(c.timer);
    if (imediato) return gravar(c, true);
    if (!c.suspensoes.size) c.timer = setTimeout(() => gravar(c), 600); return Promise.resolve(true);
  }
  async function excluir() {
    const c = contextoDestaRenderizacao;
    if (!api?.excluirRascunhoWhatsapp || !c) return true;
    if (c.excluindo || c.cancelado || c.incerto || !c.pronto || c.estado === "conflito" || c.sessao !== (api?.getAccessToken?.() || "sessao")) return false;
    c.excluindo = true;
    pendentes.add(c);
    ++c.revisao; // Uma leitura iniciada antes do descarte não restaura a versão antiga.
    avisar(c, c.estado);
    clearTimeout(c.timer);
    // Não publicar o debounce só para apagá-lo. A operação já iniciada termina
    // antes do DELETE; falha incerta exige conferência, nunca um novo efeito.
    const descartavel = c.ultima; c.descartavel = descartavel;
    c.ultima = null;
    let confirmado = false;
    const trabalho = async () => {
      try {
        if (c.cancelado || c.incerto || c.ultima || c.estado === "conflito" || c.sessao !== (api?.getAccessToken?.() || "sessao")) return false;
        const r = c.versao === 0 ? { versao: 0 } : await api.excluirRascunhoWhatsapp(c.id, c.versao, c.modo);
        if (c.cancelado || c.incerto || c.sessao !== (c.api?.getAccessToken?.() || "sessao")) return false;
        if (r?.ok === false || !Number.isInteger(r?.versao) || (c.versao > 0 && r.versao <= c.versao)) throw new Error("Exclusão não confirmada.");
        c.versao = r.versao;
        c.conteudo = { texto: "" }; c.ultima = null; c.conferido = null;
        c.confirmado = { versao: c.versao, conteudo: c.conteudo };
        c.restauradores.forEach(fn => fn(c.conteudo));
        confirmado = true; pendentes.delete(c); avisar(c, "pronto"); return true;
      } catch (e) { if (!c.cancelado) { c.incerto = !e.status || e.status >= 500; c.ultima ||= descartavel; avisar(c, "conflito", "Não foi possível apagar a versão salva. Seu texto foi preservado para conferência."); } return false; }
      finally {
        if (!confirmado && !c.cancelado) c.ultima ||= descartavel;
        c.excluindo = false; c.descartavel = null;
        if (!c.ultima && !c.emGravacao && !["erro", "conflito"].includes(c.estado)) pendentes.delete(c);
        if (!c.cancelado) avisar(c, c.estado, c.erro);
      }
    };
    c.fila = c.fila.then(trabalho, trabalho);
    return c.fila;
  }
  async function conferir() {
    const c = contextoDestaRenderizacao;
    if (!c || c.excluindo || c.cancelado) return null;
    const revisao = ++c.revisao; c.conferido = null; c.conferidoAusente = false;
    await c.fila;
    if (!lease.ativo || c.excluindo || c.cancelado || c.revisao !== revisao) return null;
    const r = await api.getRascunhoWhatsapp(c.id, modo);
    if (!lease.ativo || c.excluindo || c.cancelado || c.revisao !== revisao || c.sessao !== (api?.getAccessToken?.() || "sessao")) return null;
    if (!rascunhoValido(r)) throw new Error("Leitura do rascunho não confirmada.");
    c.conferidoAusente = r.rascunho === null;
    c.conferido = r.rascunho || { versao: 0, conteudo: { texto: "" } };
    return c.conferido.conteudo;
  }
  async function resolverConflito(conteudo = null) {
    const c = contextoDestaRenderizacao;
    if (!c || c.excluindo || c.cancelado) return false;
    if (!c.conferido) return false;
    if (!lease.ativo || !c.conferido || c.excluindo || c.cancelado || c.sessao !== (api?.getAccessToken?.() || "sessao")) return false;
    c.versao = c.conferido.versao; c.incerto = false; c.pronto = true; c.ultima = null; pendentes.delete(c);
    c.conteudo = c.conferido.conteudo; c.confirmado = c.conferido;
    restaurarDestaRenderizacao?.(conteudo || c.conferido.conteudo); avisar(c, "salvo");
    if (conteudo) await salvar(conteudo, true);
  }
  const ativo = () => lease.ativo && (api?.getAccessToken?.() || "sessao") === sessao && (!api?.getRascunhoWhatsapp || (contextoDestaRenderizacao && contexto.current === contextoDestaRenderizacao && !contextoDestaRenderizacao.cancelado));
  const atual = () => ativo() && contextoDestaRenderizacao && !contextoDestaRenderizacao.incerto;
  async function guardarConfirmado() {
    const c = contextoDestaRenderizacao;
    if (!atual() || !api?.salvarRascunhoWhatsapp) return { ok: false };
    const edicao = c.edicao;
    if (!(await gravar(c, true)) || !atual() || edicao !== c.edicao || c.ultima || c.emGravacao || !c.confirmado?.conteudo || c.confirmado.versao !== c.versao) return { ok: false };
    return { ok: true, context: identidade, revision: c.versao };
  }
  async function descartarConfirmado() {
    if (!atual() || !api?.excluirRascunhoWhatsapp || !(await excluir()) || !atual()) return { ok: false };
    return { ok: true, context: identidade, revision: contextoDestaRenderizacao.versao };
  }
  return { ...leitura, estaAtivo: ativo, get ausenciaConferida() { return Boolean(ativo() && contextoDestaRenderizacao?.conferido && contextoDestaRenderizacao.conferidoAusente); }, get pendente() { return Boolean(contextoDestaRenderizacao && !contextoDestaRenderizacao.cancelado && (contextoDestaRenderizacao.ultima || contextoDestaRenderizacao.emGravacao || contextoDestaRenderizacao.excluindo || ["erro", "conflito"].includes(contextoDestaRenderizacao.estado))); }, context: identidade, guardarConfirmado, descartarConfirmado,
    suspend: () => { const c = contextoDestaRenderizacao; if (c) { c.suspensoes.add(lease); clearTimeout(c.timer); } },
    resume: () => { const c = contextoDestaRenderizacao; if (ativo() && c) { c.suspensoes.delete(lease); if (!c.suspensoes.size && !c.incerto && c.ultima && c.estado === "salvando") c.timer = setTimeout(() => gravar(c), 600); } },
    invalidate: () => { if (api) limparRascunhosDaSessao(api); },
    pronto: leitura.pronto && (!api?.getRascunhoWhatsapp || (contextoDestaRenderizacao?.api === api && contextoDestaRenderizacao?.canalId === canalId && contextoDestaRenderizacao?.vinculoId === vinculoId && contextoDestaRenderizacao?.id === conversaId && contextoDestaRenderizacao?.modo === modo && contextoDestaRenderizacao?.sessao === sessao && !contextoDestaRenderizacao.excluindo && !contextoDestaRenderizacao.cancelado)), salvar, excluir, conferir, resolverConflito, tentarSalvar: async () => {
    const c = contextoDestaRenderizacao; if (!c || !ativo() || c.excluindo || c.cancelado || c.incerto) return false; if (!c.pronto) { await conferir(); return resolverConflito(); } return gravar(c);
  } };
}
