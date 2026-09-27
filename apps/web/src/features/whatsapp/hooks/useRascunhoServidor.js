import { useEffect, useRef, useState } from "react";
// Dados privados só na memória da sessão e no servidor autenticado. Um contexto com
// falha continua recuperável ao trocar de conversa; nunca bloqueia sem saída a atualização.
const caches = new WeakMap(), pendentes = new Set();
export const haRascunhoPendente = () => pendentes.size > 0;
export function limparRascunhosDaSessao(api) {
  const cache = caches.get(api);
  if (cache) for (const c of cache.values()) { c.cancelado = true; clearTimeout(c.timer); pendentes.delete(c); }
  caches.delete(api);
}
function avisar(c, estado, erro = "") {
  c.estado = estado; c.erro = erro;
  c.listeners.forEach(fn => fn({ estado, erro, pronto: c.pronto && estado !== "conflito" }));
}
function gravar(c) {
  clearTimeout(c.timer);
  const trabalho = async () => {
    if (c.cancelado || !c.pronto || c.estado === "conflito") return false;
    if (!c.ultima) return true;
    const conteudo = c.ultima; c.ultima = null; c.emGravacao = conteudo;
    try {
      const r = await c.api.salvarRascunhoWhatsapp(c.id, { modo: c.modo, versao: c.versao, conteudo });
      if (c.cancelado) return false;
      c.versao = r.rascunho.versao;
      if (!c.ultima) { pendentes.delete(c); avisar(c, "salvo"); }
      return true;
    } catch (e) {
      if (c.cancelado) return false;
      c.ultima ||= conteudo; pendentes.add(c);
      avisar(c, e.status === 409 ? "conflito" : "erro", e.status === 409
        ? "Este rascunho mudou em outro aparelho. Seu texto foi preservado aqui; abra a versão salva para comparar antes de continuar."
        : "Rascunho ainda não salvo. Mantenha esta tela aberta e tente salvar novamente.");
      return false;
    } finally { c.emGravacao = null; }
  };
  c.fila = c.fila.then(trabalho, trabalho); return c.fila;
}
export function useRascunhoServidor({ api, conversaId, modo = "texto", onRestaurar }) {
  const restaurar = useRef(onRestaurar); restaurar.current = onRestaurar;
  const [leitura, setLeitura] = useState({ estado: api?.getRascunhoWhatsapp ? "carregando" : "memoria", erro: "", pronto: !api?.getRascunhoWhatsapp });
  const contexto = useRef(null);
  const sessao = api?.getAccessToken?.() || "sessao";
  useEffect(() => {
    if (!conversaId || !api?.getRascunhoWhatsapp) { contexto.current = null; setLeitura({ estado: "memoria", pronto: true, erro: "" }); return; }
    let cache = caches.get(api); if (!cache) { cache = new Map(); caches.set(api, cache); }
    const key = `${sessao}:${modo}:${conversaId}`;
    let c = cache.get(key);
    if (!c) { c = { api, id: conversaId, modo, versao: 0, pronto: false, estado: "carregando", erro: "", ultima: null, fila: Promise.resolve(), listeners: new Set(), revisao: 0 }; cache.set(key, c); }
    contexto.current = c; c.listeners.add(setLeitura);
    let vivo = true;
    if (c.ultima || c.emGravacao) { setLeitura({ estado: c.estado, erro: c.erro, pronto: c.pronto && c.estado !== "conflito" }); restaurar.current?.(c.ultima || c.emGravacao); }
    else {
      c.pronto = false; avisar(c, "carregando"); const revisao = ++c.revisao;
      api.getRascunhoWhatsapp(conversaId, modo).then(r => {
        if (!vivo || c.cancelado || c.revisao !== revisao) return;
        c.versao = r?.rascunho?.versao || 0; c.pronto = true;
        if (r?.rascunho?.conteudo) restaurar.current?.(r.rascunho.conteudo);
        avisar(c, r?.rascunho ? "salvo" : "pronto");
      }).catch(e => { if (vivo && !c.cancelado && c.revisao === revisao) avisar(c, "erro", e.message || "Não foi possível recuperar o rascunho."); });
    }
    return () => { vivo = false; c.listeners.delete(setLeitura); clearTimeout(c.timer); if (c.ultima && c.estado !== "conflito") gravar(c); };
  }, [api, conversaId, modo, sessao]);
  const contextoDestaRenderizacao = contexto.current;
  const restaurarDestaRenderizacao = onRestaurar;
  function salvar(conteudo, imediato = false) {
    const c = contextoDestaRenderizacao;
    if (!api?.salvarRascunhoWhatsapp || !c) return Promise.resolve(true);
    if (!c.pronto || c.estado === "conflito" || c.cancelado) return Promise.resolve(false);
    c.ultima = conteudo; pendentes.add(c); avisar(c, "salvando"); clearTimeout(c.timer);
    if (imediato) return gravar(c);
    c.timer = setTimeout(() => gravar(c), 600); return Promise.resolve(true);
  }
  async function excluir() {
    const c = contextoDestaRenderizacao;
    if (!api?.excluirRascunhoWhatsapp || !c) return true;
    clearTimeout(c.timer); if (c.ultima && !(await gravar(c))) return false;
    await c.fila; if (c.cancelado) return false;
    try { const r = await api.excluirRascunhoWhatsapp(c.id, c.versao, modo); c.versao = r.versao ?? c.versao + 1; c.ultima = null; pendentes.delete(c); avisar(c, "pronto"); return true; }
    catch { avisar(c, "conflito", "Não foi possível apagar a versão salva. Seu texto foi preservado para conferência."); return false; }
  }
  async function conferir() {
    const c = contextoDestaRenderizacao, r = await api.getRascunhoWhatsapp(c.id, modo);
    c.conferido = r.rascunho || { versao: 0, conteudo: { texto: "" } };
    return c.conferido.conteudo;
  }
  async function resolverConflito(conteudo = null) {
    const c = contextoDestaRenderizacao;
    if (!c.conferido) await conferir();
    c.versao = c.conferido.versao; c.pronto = true; c.ultima = null; pendentes.delete(c);
    restaurarDestaRenderizacao?.(conteudo || c.conferido.conteudo); avisar(c, "salvo");
    if (conteudo) await salvar(conteudo, true);
  }
  return { ...leitura, pronto: leitura.pronto && (!api?.getRascunhoWhatsapp || (contextoDestaRenderizacao?.id === conversaId && contextoDestaRenderizacao?.modo === modo)), salvar, excluir, conferir, resolverConflito, tentarSalvar: async () => {
    const c = contextoDestaRenderizacao; if (!c.pronto) { await conferir(); return resolverConflito(); } return gravar(c);
  } };
}
