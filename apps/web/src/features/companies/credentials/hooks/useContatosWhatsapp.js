// Estado da seção "WhatsApp" da aba Senhas e acessos — os contatos que recebem guia e o canal
// padrão de envio da empresa.
//
// ⚠ HOOK PRÓPRIO, pelo mesmo motivo de `useAcessoPortalCliente`: são outra natureza de dado (um
// cadastro de destinatários, com opt-in que a Meta pode pedir para ver) e outras rotas, com o mesmo
// gate de papel (`ACCOUNTANT`+). Juntar ao cofre faria a lista de contatos depender do estado de
// senhas reveladas.
//
// ⚠ NADA AQUI ENVIA MENSAGEM. Cadastrar contato e escolher canal são pré-requisitos do envio; quem
// envia é a tela de guias (individual) e a de envio em lote, pelas rotas de `whatsappGuias.js`.

import { useCallback, useEffect, useRef, useState } from "react";

function useFeedbackRef(feedback) {
  const ref = useRef(feedback);
  ref.current = feedback;
  return ref;
}

export function useContatosWhatsapp({ api, companyId, feedback }) {
  const feedbackRef = useFeedbackRef(feedback);

  const [contatos, setContatos] = useState([]);
  const [canalPadraoEnvio, setCanalPadraoEnvio] = useState("EMAIL");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // O erro de carga fica no ESTADO, não só no `feedback` — lista vazia depois de uma chamada que
  // não voltou é indistinguível de "esta empresa não tem contato", e os dois pedem coisas opostas.
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    if (!api || !companyId) return;
    setCarregando(true);
    try {
      const r = await api.listarContatosWhatsapp(companyId);
      setContatos(Array.isArray(r?.contatos) ? r.contatos : []);
      if (r?.canalPadraoEnvio) setCanalPadraoEnvio(String(r.canalPadraoEnvio).toUpperCase());
      setErro(null);
    } catch (err) {
      // ⚠ A LISTA NÃO É ZERADA NO ERRO.
      setErro({ mensagem: err?.message || "", status: err?.status || null, code: err?.code || null });
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao carregar os contatos de WhatsApp.");
    } finally {
      setCarregando(false);
    }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = useCallback(async (payload) => {
    if (!api || !companyId) return false;
    setSalvando(true);
    try {
      await api.salvarContatoWhatsapp(companyId, payload);
      feedbackRef.current?.notifySuccess?.(
        payload?.optIn ? "Contato salvo, com opt-in registrado." : "Contato salvo — sem opt-in, ele ainda não recebe guias.",
      );
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao salvar o contato de WhatsApp.");
      return false;
    } finally {
      setSalvando(false);
    }
  }, [api, companyId, carregar]);

  const remover = useCallback(async (contatoId) => {
    if (!api || !companyId) return false;
    try {
      await api.removerContatoWhatsapp(companyId, contatoId);
      await carregar();
      return true;
    } catch (err) {
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao remover o contato de WhatsApp.");
      return false;
    }
  }, [api, companyId, carregar]);

  const definirCanal = useCallback(async (canal) => {
    if (!api || !companyId) return false;
    const anterior = canalPadraoEnvio;
    setCanalPadraoEnvio(String(canal || "").toUpperCase());
    try {
      const r = await api.definirCanalEnvio(companyId, canal);
      if (r?.canalPadraoEnvio) setCanalPadraoEnvio(String(r.canalPadraoEnvio).toUpperCase());
      return true;
    } catch (err) {
      // Volta ao que estava: um select que mostra o valor novo depois de o servidor recusar diz que
      // a empresa mudou de canal quando não mudou.
      setCanalPadraoEnvio(anterior);
      feedbackRef.current?.notifyError?.(err?.message || "Falha ao definir o canal de envio.");
      return false;
    }
  }, [api, companyId, canalPadraoEnvio]);

  return { contatos, canalPadraoEnvio, carregando, salvando, erro, salvar, remover, definirCanal, recarregar: carregar };
}
