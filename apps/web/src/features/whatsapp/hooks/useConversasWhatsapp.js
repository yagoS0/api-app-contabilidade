// O estado da tela de conversas: a lista (com filtro), o fio aberto, e as quatro ações.
//
// ⚠ Erro de carga fica no ESTADO e a lista não é zerada; o fio recarrega depois de cada ação
// (assumir/devolver/responder/vincular) porque é o servidor quem diz o estado — nunca a tela.

import { useCallback, useEffect, useRef, useState } from "react";

function useFeedbackRef(feedback) {
  const ref = useRef(feedback);
  ref.current = feedback;
  return ref;
}

export function useConversasWhatsapp({ api, feedback, empresa = null } = {}) {
  const feedbackRef = useFeedbackRef(feedback);
  const [filtro, setFiltro] = useState("todas");
  const [conversas, setConversas] = useState([]);
  // ⚠⚠ TRES respostas, e a terceira e "nao sei": `null` e servidor que nao mandou o campo, e nao
  // pode virar "nao ha mais" — e a mesma familia do "0 achados" x "nao da para conferir".
  const [temMais, setTemMais] = useState(null);
  const [temMaisNoFio, setTemMaisNoFio] = useState(null);
  const [consumoIa, setConsumoIa] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aberta, setAberta] = useState(null); // { conversa, mensagens }
  const [carregandoFio, setCarregandoFio] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (f = filtro) => {
    if (!api) return;
    setCarregando(true);
    try {
      // ⚠ `empresa` viaja SEMPRE que existe: a mesma listagem serve a caixa geral e a aba da
      // empresa — nao ha uma segunda rota, e portanto nao ha um segundo eixo de autorizacao.
      const r = await api.listarConversasWhatsapp(f, { empresa });
      setConversas(Array.isArray(r?.conversas) ? r.conversas : []);
      setTemMais(r?.temMais === undefined ? null : r.temMais);
      setConsumoIa(r?.consumoIa || null);
      setErro(null);
    } catch (err) {
      setErro({ mensagem: err?.message || "", status: err?.status || null });
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as conversas.");
    } finally {
      setCarregando(false);
    }
  }, [api, filtro, empresa]);

  useEffect(() => { carregar(filtro); }, [carregar, filtro]);

  const abrir = useCallback(async (conversaId) => {
    if (!api || !conversaId) return null;
    setCarregandoFio(true);
    try {
      const r = await api.getMensagensWhatsapp(conversaId);
      const fio = { conversa: r?.conversa || null, mensagens: Array.isArray(r?.mensagens) ? r.mensagens : [] };
      setTemMaisNoFio(r?.temMais === undefined ? null : r.temMais);
      setAberta(fio);
      return fio;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao abrir a conversa.");
      return null;
    } finally {
      setCarregandoFio(false);
    }
  }, [api]);

  const acao = useCallback(async (fn, { sucesso = null } = {}) => {
    if (!api) return null;
    setOcupado(true);
    try {
      const r = await fn();
      if (sucesso) feedbackRef.current?.notifySuccess?.(sucesso);
      return r;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Não foi possível.");
      return { ok: false, erro: err };
    } finally {
      setOcupado(false);
    }
  }, [api]);

  const recarregarTudo = useCallback(async (conversaId) => {
    await carregar(filtro);
    if (conversaId) await abrir(conversaId);
  }, [carregar, abrir, filtro]);

  const assumir = useCallback(async (conversaId) => {
    const r = await acao(() => api.assumirConversaWhatsapp(conversaId), { sucesso: "Conversa assumida — o assistente fica em silêncio até você devolver." });
    await recarregarTudo(conversaId);
    return r;
  }, [acao, api, recarregarTudo]);

  const devolver = useCallback(async (conversaId) => {
    const r = await acao(() => api.devolverConversaWhatsapp(conversaId), { sucesso: "Conversa devolvida ao assistente." });
    await recarregarTudo(conversaId);
    return r;
  }, [acao, api, recarregarTudo]);

  const responder = useCallback(async (conversaId, texto) => {
    const r = await acao(() => api.responderConversaWhatsapp(conversaId, texto));
    // ⚠ 409 FORA_DA_JANELA chega como erro com `code`; a tela mostra o motivo do servidor.
    await recarregarTudo(conversaId);
    return r;
  }, [acao, api, recarregarTudo]);

  const vincular = useCallback(async (conversaId, body) => {
    const r = await acao(() => api.vincularConversaWhatsapp(conversaId, body), { sucesso: "Número vinculado à empresa e contato cadastrado." });
    await recarregarTudo(conversaId);
    return r;
  }, [acao, api, recarregarTudo]);

  return { filtro, setFiltro, conversas, temMais, temMaisNoFio, consumoIa, carregando, erro, aberta, carregandoFio, ocupado, carregar, abrir, assumir, devolver, responder, vincular, fechar: () => setAberta(null) };
}
