import { useCallback, useEffect, useRef, useState } from "react";

export function useConversasWhatsapp({ api, feedback, empresa = null } = {}) {
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const [filtro, setFiltro] = useState("todas");
  const [conversas, setConversas] = useState([]);
  const [temMais, setTemMais] = useState(null);
  const [temMaisNoFio, setTemMaisNoFio] = useState(null);
  const [consumoIa, setConsumoIa] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [erroFio, setErroFio] = useState(null);
  const [erroAcao, setErroAcao] = useState(null);
  const [cursorLista, setCursorLista] = useState(null);
  const [cursorFio, setCursorFio] = useState(null);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  const paginas = useRef({ lista: false, fio: false, filtro: null });
  const rascunhosRef = useRef(new Map());
  const [aberta, setAberta] = useState(null);
  const [carregandoFio, setCarregandoFio] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const selecionada = useRef(null);
  const versaoLista = useRef(0);
  const versaoFio = useRef(0);
  const contextoAtual = useRef({ api, empresa });
  if (contextoAtual.current.api !== api || contextoAtual.current.empresa !== empresa) contextoAtual.current = { api, empresa };
  const contexto = contextoAtual.current;
  const montado = useRef(false);
  const contextoVigente = useCallback(() => montado.current && contextoAtual.current === contexto, [contexto]);
  useEffect(() => {
    montado.current = true;
    rascunhosRef.current.clear();
    setAberta(null); setConversas([]); setErro(null); setErroFio(null); setErroAcao(null); selecionada.current = null;
    setCursorLista(null); setCursorFio(null); setCarregandoMais(false); setCarregandoAnteriores(false);
    paginas.current = { lista: false, fio: false, filtro: null };
    setCarregandoFio(false); setOcupado(false); setTemMais(null); setTemMaisNoFio(null); setConsumoIa(null);
    return () => { montado.current = false; versaoLista.current++; versaoFio.current++; selecionada.current = null; };
  }, [api, empresa]);

  const carregar = useCallback(async (f = filtro, silencioso = false, cursor = null) => {
    if (!api || !contextoVigente()) return;
    const versao = ++versaoLista.current;
    const mesmaLista = paginas.current.filtro === f;
    if (!mesmaLista) { paginas.current.lista = false; paginas.current.filtro = f; setConversas([]); setCursorLista(null); }
    if (cursor) setCarregandoMais(true);
    else if (!silencioso) setCarregando(true);
    try {
      const r = await api.listarConversasWhatsapp(f, { empresa, ...(cursor ? { cursor } : {}) });
      if (versao !== versaoLista.current) return;
      if (!Array.isArray(r?.conversas)) throw new Error("Resposta inválida ao ler conversas.");
      if (cursor) paginas.current.lista = true;
      const manter = cursor || (silencioso && mesmaLista && paginas.current.lista);
      setConversas(antigas => manter ? unirPorId(antigas, r.conversas).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id))) : r.conversas);
      if (!manter || cursor) {
        setTemMais(r?.temMais === undefined ? null : r.temMais);
        setCursorLista(r?.proximoCursor || null);
      }
      setConsumoIa(r?.consumoIa || null);
      setErro(null);
    } catch (err) {
      if (versao !== versaoLista.current) return;
      setErro({ mensagem: err?.message || "", status: err?.status || null });
      if (!silencioso) feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as conversas.");
    } finally {
      if (versao === versaoLista.current) { setCarregando(false); setCarregandoMais(false); }
    }
  }, [api, filtro, empresa, contextoVigente]);
  useEffect(() => { carregar(filtro); }, [carregar, filtro]);

  const abrir = useCallback(async (conversaId, silencioso = false, cursor = null) => {
    if (!api || !conversaId || !contextoVigente()) return null;
    const versao = ++versaoFio.current;
    const mesmoFio = selecionada.current === conversaId;
    if (!mesmoFio) { setAberta(null); setCursorFio(null); paginas.current.fio = false; setErroAcao(null); }
    selecionada.current = conversaId;
    if (cursor) setCarregandoAnteriores(true);
    else if (!silencioso) setCarregandoFio(true);
    try {
      const r = await api.getMensagensWhatsapp(conversaId, ...(cursor ? [{ cursor }] : []));
      if (versao !== versaoFio.current || selecionada.current !== conversaId) return null;
      if (r?.conversa?.id !== conversaId || !Array.isArray(r?.mensagens)) throw new Error("Resposta inválida ao ler a conversa.");
      const fio = { conversa: r.conversa, mensagens: r.mensagens };
      if (cursor) paginas.current.fio = true;
      const manter = mesmoFio && (cursor || paginas.current.fio);
      if (!manter || cursor) { setTemMaisNoFio(r?.temMais === undefined ? null : r.temMais); setCursorFio(r?.proximoCursor || null); }
      setAberta(anterior => manter && anterior?.conversa?.id === conversaId
        ? { ...fio, mensagens: unirPorId(anterior.mensagens, r.mensagens).sort((a, b) => String(a.registradaEm).localeCompare(String(b.registradaEm)) || String(a.id).localeCompare(String(b.id))) } : fio);
      setErroFio(null);
      return fio;
    } catch (err) {
      if (versao !== versaoFio.current) return null;
      setErroFio(err?.message || "Falha ao abrir a conversa.");
      if (err?.status === 403 || err?.status === 404) { setAberta(null); selecionada.current = null; }
      if (!silencioso) feedbackRef.current?.notifyError?.(err?.message || "Falha ao abrir a conversa.");
      return null;
    } finally {
      if (versao === versaoFio.current) { setCarregandoFio(false); setCarregandoAnteriores(false); }
    }
  }, [api, contextoVigente]);

  // Um ciclo por vez; aba oculta não consulta. Respostas antigas não trocam o contato selecionado.
  const polling = useRef({ carregar, abrir, filtro, ocupado });
  polling.current = { carregar, abrir, filtro, ocupado: ocupado || carregandoMais || carregandoAnteriores };
  useEffect(() => {
    let cancelado = false;
    let timer;
    let pendente = false;
    const agendar = () => {
      clearTimeout(timer);
      if (!cancelado && document.visibilityState !== "hidden") timer = setTimeout(ciclo, selecionada.current ? 8000 : 30000);
    };
    async function ciclo() {
      if (cancelado || pendente || document.visibilityState === "hidden") return;
      pendente = true;
      try {
        const p = polling.current;
        if (!p.ocupado) {
          const id = selecionada.current;
          if (id) await p.abrir(id, true);
          // O usuário pode trocar o filtro ou ocultar a aba durante a leitura do fio.
          const atual = polling.current;
          if (!cancelado && !atual.ocupado && document.visibilityState !== "hidden") await atual.carregar(atual.filtro, true);
        }
      } finally { pendente = false; agendar(); }
    }
    const visibilidade = () => { clearTimeout(timer); if (document.visibilityState !== "hidden") ciclo(); };
    document.addEventListener("visibilitychange", visibilidade);
    agendar();
    return () => { cancelado = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibilidade); };
  }, [api, empresa, aberta?.conversa?.id]);

  const acao = useCallback(async (fn, { sucesso = null } = {}) => {
    if (!api || !contextoVigente()) return null;
    setOcupado(true); setErroAcao(null);
    try {
      const r = await fn();
      if (r?.ok === false) throw Object.assign(new Error(r.message || r.mensagem || "A ação não foi confirmada."), { payload: r });
      if (sucesso && contextoVigente()) feedbackRef.current?.notifySuccess?.(sucesso);
      return r;
    } catch (err) {
      if (contextoVigente()) { setErroAcao(err?.payload?.message || err?.payload?.mensagem || err?.message || "Não foi possível."); feedbackRef.current?.notifyError?.(err?.message || "Não foi possível."); }
      return { ok: false, erro: err };
    } finally { if (contextoVigente()) setOcupado(false); }
  }, [api, contextoVigente]);
  const recarregarTudo = useCallback(async (conversaId) => {
    if (!contextoVigente()) return;
    const atual = polling.current;
    await atual.carregar(atual.filtro);
    if (conversaId && selecionada.current === conversaId) await abrir(conversaId);
  }, [abrir, contextoVigente]);
  const assumir = useCallback(async (id) => {
    const r = await acao(() => api.assumirConversaWhatsapp(id), { sucesso: "Conversa assumida — o assistente fica em silêncio até você devolver." });
    await recarregarTudo(id); return r;
  }, [acao, api, recarregarTudo]);
  const devolver = useCallback(async (id) => {
    const r = await acao(() => api.devolverConversaWhatsapp(id), { sucesso: "Conversa devolvida ao assistente." });
    await recarregarTudo(id); return r;
  }, [acao, api, recarregarTudo]);
  const responder = useCallback(async (id, texto) => {
    const r = await acao(() => api.responderConversaWhatsapp(id, texto));
    await recarregarTudo(id); return r;
  }, [acao, api, recarregarTudo]);
  const vincular = useCallback(async (id, body) => {
    const r = await acao(() => api.vincularConversaWhatsapp(id, body), { sucesso: "Número vinculado à empresa e contato cadastrado." });
    const novoId = r?.conversa?.id || r?.conversaId;
    if (novoId && novoId !== id && contextoVigente()) { selecionada.current = novoId; paginas.current.fio = false; await recarregarTudo(novoId); }
    else await recarregarTudo(id);
    return r;
  }, [acao, api, recarregarTudo, contextoVigente]);
  const fechar = () => { versaoFio.current++; selecionada.current = null; setAberta(null); setErroFio(null); setErroAcao(null); setCursorFio(null); setCarregandoFio(false); };
  const trocarFiltro = (novo) => {
    if (novo === filtro) return;
    fechar();
    versaoLista.current++;
    paginas.current = { lista: false, fio: false, filtro: null };
    setConversas([]); setCursorLista(null); setTemMais(null); setErro(null);
    setFiltro(novo);
  };
  const moverConversa = async (id, metodo) => {
    const r = await acao(() => api[metodo](id));
    if (r?.ok !== false && r && contextoVigente()) {
      setConversas(atuais => atuais.filter(c => c.id !== id));
      if (selecionada.current === id) fechar();
      await polling.current.carregar(polling.current.filtro);
    }
    return r;
  };
  return { api, cursorLista, cursorFio, carregandoMais, carregandoAnteriores, erroAcao, rascunhosRef,
    excluir: id => moverConversa(id, "excluirConversaWhatsapp"),
    restaurar: id => moverConversa(id, "restaurarConversaWhatsapp"),
    carregarMais: () => cursorLista && !carregandoMais && carregar(filtro, false, cursorLista),
    carregarAnteriores: () => cursorFio && !carregandoAnteriores && abrir(selecionada.current, false, cursorFio),
    filtro, setFiltro: trocarFiltro, conversas, temMais, temMaisNoFio, consumoIa, carregando, erro, erroFio, aberta, carregandoFio, ocupado, carregar, abrir, assumir, devolver, responder, vincular, fechar };
}

function unirPorId(atuais = [], novas = []) {
  return [...new Map([...atuais, ...novas].map(item => [item.id, item])).values()];
}
