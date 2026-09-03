// O LOTE POR WHATSAPP — o estado da prévia e do envio, na página de envio em lote.
//
// ⚠ PRÉVIA ANTES, ENVIO DEPOIS, e a confirmação REPETE os números da prévia ao servidor
// (`conferencia`): é a rota que exige (`CONFERENCIA_OBRIGATORIA` / `CONFERENCIA_DIVERGENTE`), no
// mesmo padrão do `totalConferido` da baixa de parcela. Sem prévia não há como executar — o hook
// nem expõe um caminho.
//
// ⚠ NÃO EXISTE FILA nem retentativa automática. O que o servidor devolve é o que aconteceu; o que
// falhou volta com o motivo traduzido, e quem decide tentar de novo é o contador.

import { useCallback, useEffect, useRef, useState } from "react";
import { conferenciaDaPrevia } from "../../lib/canalDeEnvio";

export function useLoteWhatsapp({ api, feedback } = {}) {
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;

  // O estado do canal (flag, template). `null` = ainda não perguntado. Ausência não é "disponível".
  const [canal, setCanal] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [prevendo, setPrevendo] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  const carregarCanal = useCallback(async () => {
    if (!api || typeof api.getCanalWhatsapp !== "function") return;
    try {
      const r = await api.getCanalWhatsapp();
      setCanal(r?.canal || null);
    } catch (err) {
      // Sem resposta, o canal fica DESCONHECIDO (null) — não "disponível". O botão da tela trata
      // `null` como "não sei ainda" e deixa o servidor recusar com o motivo se for o caso.
      setCanal(null);
      feedbackRef.current?.notifyError?.(err?.message || "Não foi possível ler o estado do canal WhatsApp.");
    }
  }, [api]);

  useEffect(() => { carregarCanal(); }, [carregarCanal]);

  const prever = useCallback(async ({ competencia, portalClientIds, guideIds } = {}) => {
    if (!api) return null;
    setPrevendo(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await api.preverLoteWhatsapp({ competencia, portalClientIds, ...(guideIds ? { guideIds } : {}) });
      const p = r ? { competencia: r.competencia, canal: r.canal, linhas: r.linhas || [], resumo: r.resumo, portalClientIds } : null;
      setPrevia(p);
      if (r?.canal) setCanal(r.canal);
      return p;
    } catch (err) {
      setErro({ mensagem: err?.message || "", code: err?.code || null });
      setPrevia(null);
      return null;
    } finally {
      setPrevendo(false);
    }
  }, [api]);

  /** Executa o lote da ÚLTIMA prévia, repetindo os números dela como conferência. */
  const executar = useCallback(async ({ enviarPorEmail = true } = {}) => {
    if (!api || !previa) return null;
    setExecutando(true);
    setErro(null);
    try {
      const r = await api.executarLoteWhatsapp({
        competencia: previa.competencia,
        portalClientIds: previa.portalClientIds,
        conferencia: conferenciaDaPrevia(previa),
        enviarPorEmail,
      });
      setResultado(r || null);
      setPrevia(null);
      return r;
    } catch (err) {
      // ⚠ 409 CONFERENCIA_DIVERGENTE: a carteira mudou entre a prévia e o clique. A prévia é
      // descartada — a tela pede para conferir de novo, com os números novos.
      setErro({ mensagem: err?.message || "", code: err?.code || null });
      if (err?.code === "CONFERENCIA_DIVERGENTE") setPrevia(null);
      return null;
    } finally {
      setExecutando(false);
    }
  }, [api, previa]);

  const limpar = useCallback(() => { setPrevia(null); setResultado(null); setErro(null); }, []);

  return { canal, previa, prevendo, executando, resultado, erro, carregarCanal, prever, executar, limpar };
}
