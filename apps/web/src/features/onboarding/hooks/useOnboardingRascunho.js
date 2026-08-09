// O rascunho do wizard: carrega, edita em memória, salva com debounce e a cada troca de tela.
//
// ⚠ `podarInvisiveis` RODA ANTES DE TODO SALVAMENTO. Escolher LTDA, preencher dois sócios, voltar
// e trocar para MEI deixa os sócios em `dados`: eles sobreviveriam ao PATCH e a ficha do escritório
// mostraria quadro societário de um MEI.
//
// ⚠ TROCAR DE ORIGEM ZERA `dados` — e o SERVIDOR também zera, ignorando o body. Aqui a limpeza é só
// para a tela não piscar o conteúdo antigo; a garantia é de lá (um PATCH atrasado ou um retry
// regravaria campos da origem anterior se só a UI resetasse).

import { useCallback, useEffect, useRef, useState } from "react";
import { podarInvisiveis, rascunhoVazio } from "../lib/onboardingSpec";

const DEBOUNCE_MS = 800;

export function useOnboardingRascunho({ api, onboardingId }) {
  const [onboarding, setOnboarding] = useState(null);
  const [dados, setDados] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // "salvo" | "salvando" | "pendente" | "erro"
  const [estadoSalvamento, setEstadoSalvamento] = useState("salvo");

  const timerRef = useRef(null);
  const pendenteRef = useRef(null);
  const montadoRef = useRef(true);

  useEffect(() => () => {
    montadoRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const carregar = useCallback(async () => {
    if (!onboardingId) return;
    setCarregando(true);
    try {
      const r = await api.getOnboarding(onboardingId);
      const registro = r?.onboarding || r;
      setOnboarding(registro);
      setDados({ ...rascunhoVazio(registro?.origem), ...(registro?.dados || {}) });
      setErro(null);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, [api, onboardingId]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = useCallback(async (patch) => {
    setEstadoSalvamento("salvando");
    try {
      const r = await api.salvarOnboarding(onboardingId, patch);
      const registro = r?.onboarding || r;
      if (!montadoRef.current) return registro;
      setOnboarding(registro);
      // ⚠ Depois de trocar a origem o servidor devolve `dados: {}`. A tela precisa ACEITAR essa
      // resposta, não reimpor o que tinha em memória — senão o reset do servidor seria desfeito
      // pelo próximo salvamento.
      if (patch.origem) {
        setDados(rascunhoVazio(registro?.origem));
      }
      setEstadoSalvamento("salvo");
      return registro;
    } catch (e) {
      if (montadoRef.current) {
        setEstadoSalvamento("erro");
        setErro(e);
      }
      throw e;
    }
  }, [api, onboardingId]);

  /** Salva já, sem esperar o debounce. Usado ao trocar de tela e ao finalizar. */
  const salvarAgora = useCallback(async (extra = {}) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const origem = onboarding?.origem;
    const patch = { dados: podarInvisiveis(origem, pendenteRef.current ?? dados), ...extra };
    pendenteRef.current = null;
    return enviar(patch);
  }, [dados, enviar, onboarding?.origem]);

  /** Edita um campo em memória e agenda o salvamento. */
  const alterarCampo = useCallback((campo, valor) => {
    setDados((atual) => {
      const proximo = { ...atual, [campo]: valor };
      pendenteRef.current = proximo;
      return proximo;
    });
    setEstadoSalvamento("pendente");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const origem = onboarding?.origem;
      enviar({ dados: podarInvisiveis(origem, pendenteRef.current ?? {}) }).catch(() => {});
      pendenteRef.current = null;
    }, DEBOUNCE_MS);
  }, [enviar, onboarding?.origem]);

  const trocarOrigem = useCallback(async (novaOrigem) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    pendenteRef.current = null;
    return enviar({ origem: novaOrigem });
  }, [enviar]);

  const finalizar = useCallback(async () => salvarAgora({ finalizar: true }), [salvarAgora]);

  return {
    onboarding,
    dados,
    carregando,
    erro,
    estadoSalvamento,
    alterarCampo,
    trocarOrigem,
    salvarAgora,
    finalizar,
    recarregar: carregar,
  };
}

export default useOnboardingRascunho;
