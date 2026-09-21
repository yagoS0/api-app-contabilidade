import { useCallback, useEffect, useRef, useState } from "react";
import { chaveDoInterlocutor } from "../lib/identidadeAtendimento";

export function useConversasWhatsapp({ api, feedback, empresa = null } = {}) {
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const [filtro, setFiltro] = useState("todas");
  const [consulta, setConsulta] = useState({ q: "", relacionamento: "", naoLidas: false });
  const [buscaServidor, setBuscaServidor] = useState(Boolean(api?.whatsappContratoV2));
  const consultaChave = JSON.stringify(consulta);
  const lidas = useRef(new Map());
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
  const [empresaHistorico, setEmpresaHistorico] = useState(null);
  const empresaHistoricoRef = useRef(null);
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
    lidas.current.clear();
    setAberta(null); setConversas([]); setErro(null); setErroFio(null); setErroAcao(null); selecionada.current = null;
    setCursorLista(null); setCursorFio(null); setCarregandoMais(false); setCarregandoAnteriores(false);
    empresaHistoricoRef.current = null; setEmpresaHistorico(null);
    paginas.current = { lista: false, fio: false, filtro: null };
    setCarregandoFio(false); setOcupado(false); setTemMais(null); setTemMaisNoFio(null); setConsumoIa(null);
    return () => { montado.current = false; versaoLista.current++; versaoFio.current++; selecionada.current = null; };
  }, [api, empresa]);

  const carregar = useCallback(async (f = filtro, silencioso = false, cursor = null) => {
    if (!api || !contextoVigente()) return;
    const versao = ++versaoLista.current;
    const chaveLista = `${f}:${consultaChave}`;
    const mesmaLista = paginas.current.filtro === chaveLista;
    if (!mesmaLista) { paginas.current.lista = false; paginas.current.filtro = chaveLista; setConversas([]); setCursorLista(null); }
    if (cursor) setCarregandoMais(true);
    else if (!silencioso) setCarregando(true);
    try {
      const r = await api.listarConversasWhatsapp(f, { empresa, ...(api.whatsappContratoV2 ? consulta : {}), ...(cursor ? { cursor } : {}) });
      if (versao !== versaoLista.current) return;
      if (!Array.isArray(r?.conversas)) throw new Error("Resposta inválida ao ler conversas.");
      setBuscaServidor(r.buscaConfigurada === true || r.versaoContrato === 2);
      if (cursor) paginas.current.lista = true;
      const manter = cursor || (silencioso && mesmaLista && paginas.current.lista);
      setConversas(antigas => {
        if (!manter) return r.conversas;
        if (r.versaoContrato === 2) {
          const novas = new Map(r.conversas.map(c => [chaveDoInterlocutor(c), c]));
          return cursor ? unirPorId(antigas, r.conversas, chaveDoInterlocutor) : [...r.conversas, ...antigas.filter(c => !novas.has(chaveDoInterlocutor(c)))];
        }
        return unirPorId(antigas, r.conversas, chaveDoInterlocutor).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id)));
      });
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
  }, [api, filtro, empresa, contextoVigente, consultaChave]);
  useEffect(() => { carregar(filtro); }, [carregar, filtro]);

  const abrir = useCallback(async (conversaId, silencioso = false, cursor = null) => {
    if (!api || !conversaId || !contextoVigente()) return null;
    const versao = ++versaoFio.current;
    const mesmoFio = selecionada.current === conversaId;
    if (!mesmoFio) { setAberta(null); setCursorFio(null); paginas.current.fio = false; setErroAcao(null); empresaHistoricoRef.current = null; setEmpresaHistorico(null); }
    selecionada.current = conversaId;
    if (cursor) setCarregandoAnteriores(true);
    else if (!silencioso) setCarregandoFio(true);
    try {
      const opcoes = { ...(cursor ? { cursor } : {}) };
      const r = await api.getMensagensWhatsapp(conversaId, ...(Object.keys(opcoes).length ? [opcoes] : []));
      if (versao !== versaoFio.current || selecionada.current !== conversaId) return null;
      if (r?.conversa?.id !== conversaId || !Array.isArray(r?.mensagens)) throw new Error("Resposta inválida ao ler a conversa.");
      const fio = { conversa: r.conversa, mensagens: r.mensagens, notasInternas: r.notasInternas || [] };
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
  }, [api, empresa, contextoVigente]);

  // Um ciclo por vez; aba oculta não consulta. Respostas antigas não trocam o contato selecionado.
  const polling = useRef({ carregar, abrir, filtro, ocupado });
  polling.current = { carregar, abrir, filtro, ocupado: ocupado || carregandoMais || carregandoAnteriores };
  useEffect(() => {
    let cancelado = false;
    // Relógios independentes: uma lista lenta não atrasa o fio aberto. Um pedido por recurso.
    const loops = [ { tipo: "fio", ms: 2500 }, { tipo: "lista", ms: 10000 } ];
    const agendar = l => {
      clearTimeout(l.timer);
      if (!cancelado && document.visibilityState !== "hidden") l.timer = setTimeout(() => ciclo(l), l.ms);
    };
    async function ciclo(l) {
      if (cancelado || l.pendente || document.visibilityState === "hidden") return;
      l.pendente = true;
      try {
        const p = polling.current;
        if (!p.ocupado) {
          if (l.tipo === "fio") { if (selecionada.current) await p.abrir(selecionada.current, true); }
          else await p.carregar(p.filtro, true);
        }
      } finally { l.pendente = false; agendar(l); }
    }
    const visibilidade = () => loops.forEach(l => { clearTimeout(l.timer); if (document.visibilityState !== "hidden") ciclo(l); });
    document.addEventListener("visibilitychange", visibilidade);
    loops.forEach(agendar);
    return () => { cancelado = true; loops.forEach(l => clearTimeout(l.timer)); document.removeEventListener("visibilitychange", visibilidade); };
  }, [api, empresa]);

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
    await Promise.allSettled([atual.carregar(atual.filtro, true), conversaId && selecionada.current === conversaId ? abrir(conversaId, true) : Promise.resolve()]);
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
    const abertaInicio = selecionada.current;
    const r = await acao(() => api.responderConversaWhatsapp(id, texto));
    await recarregarTudo(abertaInicio || id); return r;
  }, [acao, api, recarregarTudo]);
  const vincular = useCallback(async (id, body) => {
    const r = await acao(() => api.vincularConversaWhatsapp(id, body), { sucesso: "Número vinculado à empresa e contato cadastrado." });
    const novoId = r?.conversa?.id || r?.conversaId;
    if (novoId && novoId !== id && contextoVigente()) { selecionada.current = novoId; paginas.current.fio = false; await recarregarTudo(novoId); }
    else await recarregarTudo(id);
    return r;
  }, [acao, api, recarregarTudo, contextoVigente]);
  const selecionarEmpresa = useCallback(async (id, portalClientId) => {
    const r = await acao(() => api.selecionarEmpresaConversaWhatsapp(id, portalClientId), { sucesso: "Empresa do atendimento selecionada. Confira o contexto antes de responder." });
    if (r?.ok === false || !r?.conversa?.id || !contextoVigente() || selecionada.current !== id) return r;
    versaoFio.current++;
    selecionada.current = r.conversa.id;
    paginas.current.fio = false;
    setAberta(null); setCursorFio(null);
    await recarregarTudo(r.conversa.id);
    return r;
  }, [acao, api, recarregarTudo, contextoVigente]);
  const filtrarHistorico = useCallback(async (valor) => {
    empresaHistoricoRef.current = valor || null;
    setEmpresaHistorico(valor || null);
    paginas.current.fio = false; setCursorFio(null);
    if (selecionada.current) await abrir(selecionada.current);
  }, [abrir]);
  const salvarApelidos = useCallback(async (id, portalClientId, apelidos) => {
    const r = await acao(() => api.salvarApelidosWhatsapp(portalClientId, apelidos), { sucesso: "Nomes curtos da empresa salvos." });
    await recarregarTudo(id); return r;
  }, [acao, api, recarregarTudo]);
  const marcarLida = useCallback(async (id, mensagemId) => {
    if (!mensagemId || typeof api?.marcarConversaWhatsappLida !== "function" || selecionada.current !== id || document.visibilityState === "hidden") return;
    if (lidas.current.get(id) === mensagemId) return;
    lidas.current.set(id, mensagemId);
    try { await api.marcarConversaWhatsappLida(id, mensagemId); }
    catch (err) { lidas.current.delete(id); if (contextoVigente()) setErroFio(err?.message || "Não foi possível registrar a leitura."); }
  }, [api, contextoVigente]);
  const salvarNota = useCallback(async (id, body) => {
    const abertaInicio = selecionada.current;
    const r = await acao(() => api.criarNotaInternaWhatsapp(id, body));
    await recarregarTudo(abertaInicio || id); return r;
  }, [api, acao, recarregarTudo]);
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
  return { api, consulta, setConsulta, buscaServidor, marcarLida, salvarNota, cursorLista, cursorFio, carregandoMais, carregandoAnteriores, erroAcao, rascunhosRef, empresaFixa: empresa, empresaHistorico, filtrarHistorico, selecionarEmpresa, salvarApelidos,
    excluir: id => moverConversa(id, "excluirConversaWhatsapp"),
    restaurar: id => moverConversa(id, "restaurarConversaWhatsapp"),
    carregarMais: () => cursorLista && !carregandoMais && carregar(filtro, false, cursorLista),
    carregarAnteriores: () => cursorFio && !carregandoAnteriores && abrir(selecionada.current, false, cursorFio),
    filtro, setFiltro: trocarFiltro, conversas, temMais, temMaisNoFio, consumoIa, carregando, erro, erroFio, aberta, carregandoFio, ocupado, carregar, abrir, atualizarConversa: recarregarTudo, assumir, devolver, responder, vincular, fechar };
}

function unirPorId(atuais = [], novas = [], chave = item => item.id) {
  return [...new Map([...atuais, ...novas].map(item => [chave(item), item])).values()];
}
