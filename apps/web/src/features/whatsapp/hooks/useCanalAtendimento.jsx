import { useCallback, useMemo, useState } from "react";
import { canaisDaConversa, canalInicialDaConversa, relacionamentoDaConversa } from "../lib/identidadeAtendimento";
import { CanalDoAtendimento } from "../components/CanalDoAtendimento";

// Central e ficha da empresa compartilham o destino preparado no compositor.
export function useCanalAtendimento(hook, { mensagemBiblioteca = null, onMensagemBibliotecaAberta } = {}) {
  const [revisao, setRevisao] = useState(0);
  const [preparado, setPreparado] = useState(null);
  const [pedidoCanal, setPedidoCanal] = useState(null);
  const conversa = hook.aberta?.conversa;
  const registrarCanal = useCallback(c => setPreparado(anterior => JSON.stringify(anterior) === JSON.stringify(c) ? anterior : c), []);
  const atualizacaoComercial = useMemo(() => ({ revisao, mensagemBiblioteca, onMensagemBibliotecaAberta,
    atualizar: () => { setRevisao(v => v + 1); return hook.atualizarConversa(conversa?.id); },
  }), [revisao, mensagemBiblioteca, onMensagemBibliotecaAberta, hook.atualizarConversa, conversa?.id]);
  const canalPreparado = preparado?.interlocutorId === (conversa?.interlocutorId || conversa?.id) ? preparado : null;
  const canal = conversa ? canaisDaConversa(conversa).find(c => c.id === (relacionamentoDaConversa(conversa).tipo === "LEAD"
    ? canalInicialDaConversa(conversa) : canalPreparado?.canalId || canalInicialDaConversa(conversa))) : null;
  const conversaComercial = conversa ? { ...conversa, ...(canal ? { id: canal.conversaId, canalId: canal.id, janela: canal.janela, podeResponder: canal.podeResponder } : {}) } : null;
  const canalDeEnvio = conversa ? <CanalDoAtendimento conversa={conversa} canalId={conversaComercial.canalId} disabled={hook.ocupado}
    onSelecionar={canalId => setPedidoCanal({ interlocutorId: conversa.interlocutorId || conversa.id, canalId })} /> : null;
  return { registrarCanal, pedidoCanal, conversaComercial, canalDeEnvio, atualizacaoComercial };
}

export const leituraDoCaso = conversa => conversa?.solicitacaoComercial?.onboardingId
  ? { situacao: "EXATO", candidatos: [{ id: conversa.solicitacaoComercial.onboardingId, origem: conversa.solicitacaoComercial.origem, status: conversa.solicitacaoComercial.etapa, confianca: "EXATO" }] }
  : { situacao: "SEM_ONBOARDING", candidatos: [] };
