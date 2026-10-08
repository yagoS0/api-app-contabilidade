import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { ONBOARDING_ORIGENS } from "../lib/onboardingSpec";

export function NovaDemanda({ api, onboarding, onAbrir }) {
  const [aberto, setAberto] = useState(false);
  const [origem, setOrigem] = useState("TRANSFERENCIA");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const trava = useRef(false);
  const chaveSolicitacao = useRef(null);
  async function criar() {
    if (trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.criarDemandaOnboarding(onboarding.id, { origem, versao: onboarding.versao, chaveSolicitacao: chaveSolicitacao.current });
      if (!r?.onboarding?.id) throw new Error("Não foi possível confirmar a nova demanda. Confira a lista antes de tentar novamente.");
      setAberto(false);
      chaveSolicitacao.current = null;
      onAbrir(r.onboarding.id);
    } catch (e) { setErro(e.message); }
    finally { trava.current = false; setOcupado(false); }
  }
  if (!api.criarDemandaOnboarding || !onAbrir) return null;
  return <>
    <Button variant="secondary" size="sm" onClick={() => { chaveSolicitacao.current ||= crypto.randomUUID(); setErro(""); setAberto(true); }}>Adicionar empresa ou serviço</Button>
    {aberto && <Modal titulo="Novo serviço para este contato" aoFechar={() => setAberto(false)} ocupado={ocupado} rodape={<>
      <Button variant="secondary" disabled={ocupado} onClick={() => setAberto(false)}>Cancelar</Button>
      <Button disabled={ocupado} onClick={criar}>{ocupado ? "Criando…" : "Continuar"}</Button>
    </>}>
      <div className="onboarding-workspace onboarding-new">
        <p>Os dados de contato de {onboarding.responsavelNome || "este atendimento"} serão reaproveitados. O serviço atual e seus documentos permanecem no histórico.</p>
        <label htmlFor="nova-demanda-origem">O que precisa resolver?</label>
        <select id="nova-demanda-origem" value={origem} onChange={e => setOrigem(e.target.value)} disabled={ocupado}>
          {ONBOARDING_ORIGENS.map(o => <option key={o.chave} value={o.chave}>{o.titulo}</option>)}
        </select>
        {erro && <p role="alert">{erro}</p>}
      </div>
    </Modal>}
  </>;
}
