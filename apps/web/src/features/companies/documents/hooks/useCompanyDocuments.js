// Estado das abas Documentos e Anotações da empresa.
//
// As duas moram no mesmo hook porque compartilham a mesma casa na UI (grupo "Cadastro") e são
// pequenas — dois hooks quase idênticos seriam só cerimônia.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";


// `feedback` chega como objeto literal novo a cada render do App (`feedback={{ message, error }}`).
// Se ele entrar nas dependências dos callbacks, `carregar` muda de identidade em todo render, o
// efeito que o chama redispara, e vira um LAÇO INFINITO de requisições — o sintoma era o
// "carregando…" piscando sem parar na aba de Documentos.
// Guardado em ref: continua sempre atual quando chamado, sem participar das dependências.
function useFeedbackRef(feedback) {
  const ref = useRef(feedback);
  ref.current = feedback;
  return ref;
}

export function useCompanyDocuments({ api, companyId, feedback }) {
  const feedbackRef = useFeedbackRef(feedback);
  const [documentos, setDocumentos] = useState([]);
  const [tipoLabels, setTipoLabels] = useState({});
  const [tipos, setTipos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Seleção múltipla: é o que permite baixar/enviar vários de uma vez.
  const [selecionados, setSelecionados] = useState(() => new Set());

  const carregar = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregando(true);
    try {
      const r = await api.listCompanyDocuments(companyId);
      setDocumentos(r?.documentos || []);
      setTipos(r?.tipos || []);
      setTipoLabels(r?.tipoLabels || {});
      // Some da seleção o que não existe mais — senão "enviar" mandaria ids fantasma.
      setSelecionados((atual) => {
        const validos = new Set((r?.documentos || []).map((d) => d.id));
        return new Set([...atual].filter((id) => validos.has(id)));
      });
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar os documentos.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  const alternarSelecao = useCallback((id) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }, []);

  const limparSelecao = useCallback(() => setSelecionados(new Set()), []);

  const enviarArquivo = useCallback(async ({ arquivo, tipo, nome, validade }) => {
    if (!api || !companyId) return false;
    try {
      await api.uploadCompanyDocument(companyId, { arquivo, tipo, nome, validade });
      feedbackRef.current?.notifySuccess?.("Documento enviado.");
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao enviar o documento.");
      return false;
    }
  }, [api, companyId, carregar]);

  // O download precisa passar pelo fetch com token (um <a href> não leva o Bearer), então o
  // arquivo vem como Blob e é entregue por um link temporário.
  const baixar = useCallback(async (doc) => {
    if (!api || !companyId) return;
    try {
      const blob = await api.fetchCompanyDocumentBlob(companyId, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nome || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao baixar o documento.");
    }
  }, [api, companyId]);

  const baixarSelecionados = useCallback(async () => {
    const alvos = documentos.filter((d) => selecionados.has(d.id));
    for (const doc of alvos) {
      // eslint-disable-next-line no-await-in-loop
      await baixar(doc);
    }
  }, [documentos, selecionados, baixar]);

  const excluir = useCallback(async (doc) => {
    if (!api || !companyId) return;
    try {
      await api.deleteCompanyDocument(companyId, doc.id);
      feedbackRef.current?.notifySuccess?.("Documento excluído.");
      await carregar();
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao excluir o documento.");
    }
  }, [api, companyId, carregar]);

  const enviarPorEmail = useCallback(async (destinatario) => {
    if (!api || !companyId || !selecionados.size) return;
    setEnviando(true);
    try {
      const r = await api.sendCompanyDocuments(companyId, [...selecionados], destinatario);
      // Diz o que saiu e para quem — "enviado" sozinho não deixa conferir nada.
      feedbackRef.current?.notifySuccess?.(
        `${r?.enviados || 0} documento(s) enviado(s) para ${r?.destinatario || "o cliente"}.`,
      );
      limparSelecao();
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao enviar os documentos.");
    } finally {
      setEnviando(false);
    }
  }, [api, companyId, selecionados, limparSelecao]);

  return {
    documentos, tipos, tipoLabels, carregando, enviando,
    selecionados, alternarSelecao, limparSelecao,
    recarregar: carregar, enviarArquivo, baixar, baixarSelecionados, excluir, enviarPorEmail,
  };
}

export function useCompanyNotes({ api, companyId, feedback }) {
  const feedbackRef = useFeedbackRef(feedback);
  const [anotacoes, setAnotacoes] = useState([]);
  const [ordenarPor, setOrdenarPor] = useState("data");
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregando(true);
    try {
      const r = await api.listCompanyNotes(companyId, ordenarPor);
      setAnotacoes(r?.anotacoes || []);
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar as anotações.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId, ordenarPor]);

  useEffect(() => { carregar(); }, [carregar]);

  const criar = useCallback(async ({ texto, importancia, fixada }) => {
    if (!api || !companyId) return false;
    try {
      await api.createCompanyNote(companyId, { texto, importancia, fixada });
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao criar a anotação.");
      return false;
    }
  }, [api, companyId, carregar]);

  const atualizar = useCallback(async (noteId, patch) => {
    if (!api || !companyId) return;
    try {
      await api.updateCompanyNote(companyId, noteId, patch);
      await carregar();
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao atualizar a anotação.");
    }
  }, [api, companyId, carregar]);

  const excluir = useCallback(async (noteId) => {
    if (!api || !companyId) return;
    try {
      await api.deleteCompanyNote(companyId, noteId);
      await carregar();
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao excluir a anotação.");
    }
  }, [api, companyId, carregar]);

  // A fixada é destacada fora da lista; as demais seguem a ordenação escolhida. O backend já
  // devolve a fixada em primeiro, então isto é só a separação visual.
  const { fixada, demais } = useMemo(() => ({
    fixada: anotacoes.find((n) => n.fixada) || null,
    demais: anotacoes.filter((n) => !n.fixada),
  }), [anotacoes]);

  return { anotacoes, fixada, demais, ordenarPor, setOrdenarPor, carregando, criar, atualizar, excluir, recarregar: carregar };
}
