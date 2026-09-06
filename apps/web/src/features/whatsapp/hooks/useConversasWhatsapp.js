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
    setAberta(null); setConversas([]); setErro(null); setErroFio(null); selecionada.current = null;
    setCarregandoFio(false); setOcupado(false); setTemMais(null); setTemMaisNoFio(null); setConsumoIa(null);
    return () => { montado.current = false; versaoLista.current++; versaoFio.current++; selecionada.current = null; };
  }, [api, empresa]);

  const carregar = useCallback(async (f = filtro, silencioso = false) => {
    if (!api || !contextoVigente()) return;
    const versao = ++versaoLista.current;
    if (!silencioso) setCarregando(true);
    try {
      const r = await api.listarConversasWhatsapp(f, { empresa });
      if (versao !== versaoLista.current) return;
      if (!Array.isArray(r?.conversas)) throw new Error("Resposta inválida ao ler conversas.");
      setConversas(r.conversas);
      setTemMais(r?.temMais === undefined ? null : r.temMais);
      setConsumoIa(r?.consumoIa || null);
      setErro(null);
    } catch (err) {
      if (versao !== versaoLista.current) return;
      setErro({ mensagem: err?.message || "", status: err?.status || null });
      if (!silencioso) feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as conversas.");
    } finally {
      if (versao === versaoLista.current) setCarregando(false);
    }
  }, [api, filtro, empresa, contextoVigente]);
  useEffect(() => { carregar(filtro); }, [carregar, filtro]);

  const abrir = useCallback(async (conversaId, silencioso = false) => {
    if (!api || !conversaId || !contextoVigente()) return null;
    const versao = ++versaoFio.current;
    if (!silencioso && selecionada.current !== conversaId) setAberta(null);
    selecionada.current = conversaId;
    if (!silencioso) setCarregandoFio(true);
    try {
      const r = await api.getMensagensWhatsapp(conversaId);
      if (versao !== versaoFio.current || selecionada.current !== conversaId) return null;
      if (r?.conversa?.id !== conversaId || !Array.isArray(r?.mensagens)) throw new Error("Resposta inválida ao ler a conversa.");
      const fio = { conversa: r.conversa, mensagens: r.mensagens };
      setTemMaisNoFio(r?.temMais === undefined ? null : r.temMais);
      setAberta(fio); setErroFio(null);
      return fio;
    } catch (err) {
      if (versao !== versaoFio.current) return null;
      setErroFio(err?.message || "Falha ao abrir a conversa.");
      if (err?.status === 403 || err?.status === 404) { setAberta(null); selecionada.current = null; }
      if (!silencioso) feedbackRef.current?.notifyError?.(err?.message || "Falha ao abrir a conversa.");
      return null;
    } finally {
      if (versao === versaoFio.current) setCarregandoFio(false);
    }
  }, [api, contextoVigente]);

  // Um ciclo por vez; aba oculta não consulta. Respostas antigas não trocam o contato selecionado.
  const polling = useRef({ carregar, abrir, filtro, ocupado });
  polling.current = { carregar, abrir, filtro, ocupado };
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
    setOcupado(true);
    try {
      const r = await fn();
      if (sucesso && contextoVigente()) feedbackRef.current?.notifySuccess?.(sucesso);
      return r;
    } catch (err) {
      if (contextoVigente()) feedbackRef.current?.notifyError?.(err?.message || "Não foi possível.");
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
    await recarregarTudo(id); return r;
  }, [acao, api, recarregarTudo]);
  const fechar = () => { versaoFio.current++; selecionada.current = null; setAberta(null); setErroFio(null); setCarregandoFio(false); };
  return { filtro, setFiltro, conversas, temMais, temMaisNoFio, consumoIa, carregando, erro, erroFio, aberta, carregandoFio, ocupado, carregar, abrir, assumir, devolver, responder, vincular, fechar };
}
