import { useRef, useState } from "react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { ONBOARDING_ORIGENS } from "../lib/onboardingSpec";

export function NovoAtendimentoModal({ onCriar, onFechar }) {
  const [origem, setOrigem] = useState("ABERTURA");
  const [modo, setModo] = useState("cliente");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [incerto, setIncerto] = useState(false);
  const trava = useRef(false);
  async function criar() {
    if (trava.current || incerto) return;
    trava.current = true; setOcupado(true);
    try { await onCriar({ origem, modo }); }
    catch (e) {
      setErro(e.message || "Não foi possível confirmar a criação.");
      // Resposta perdida pode ter criado a ficha. Não oferece outro POST às cegas.
      setIncerto(true);
    } finally { trava.current = false; setOcupado(false); }
  }
  return <Modal titulo="Novo atendimento" aoFechar={onFechar} ocupado={ocupado} tamanho="md" rodape={<>
    <Button variant="secondary" disabled={ocupado} onClick={onFechar}>{incerto ? "Voltar à lista e conferir" : "Cancelar"}</Button>
    <Button disabled={ocupado || incerto} onClick={criar}>{ocupado ? "Criando ficha…" : modo === "cliente" ? "Criar ficha para o cliente" : "Iniciar preenchimento interno"}</Button>
  </>}>
    <div className="onboarding-workspace onboarding-new">
      <p>Escolha o serviço e quem preencherá os dados iniciais. A empresa só entra na carteira após a conferência do escritório.</p>
      <fieldset disabled={ocupado || incerto}><legend>Qual é o serviço?</legend>
        {ONBOARDING_ORIGENS.map(o => <label className="onboarding-option" key={o.chave}><input type="radio" name="origem-atendimento" value={o.chave} checked={origem === o.chave} onChange={() => setOrigem(o.chave)} /><strong>{o.titulo}</strong></label>)}
      </fieldset>
      <fieldset disabled={ocupado || incerto}><legend>Quem vai preencher?</legend>
        <label className="onboarding-option"><input type="radio" name="modo-atendimento" checked={modo === "cliente"} onChange={() => setModo("cliente")} /><span><strong>Cliente, por um link pessoal</strong><small>Recomendado para abertura. Prepare o link na ficha e compartilhe com o cliente.</small></span></label>
        <label className="onboarding-option"><input type="radio" name="modo-atendimento" checked={modo === "escritorio"} onChange={() => setModo("escritorio")} /><span><strong>Escritório, durante o atendimento</strong><small>Use quando os dados já estiverem em mãos.</small></span></label>
      </fieldset>
      {erro && <p role="alert">{erro} Confira a lista antes de criar outra ficha.</p>}
    </div>
  </Modal>;
}
