import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CamposDaEtapa } from "./PassosDoLead";

export function ConferenciaPublicaManual({ onboarding, ocupado, acao }) {
  const [fonte, setFonte] = useState(""), [evidencia, setEvidencia] = useState("");
  return <section aria-label="Conferência cadastral manual"><p>Se a consulta automática estiver indisponível, confira os documentos da empresa e registre a fonte. O atendimento continuará com essa conferência manual identificada.</p>
    <CamposDaEtapa sempreAberto onboarding={onboarding} campos={["cnpj", "razaoSocial"]} ocupado={ocupado} onSalvar={b => acao("/campos", b)} />
    <label>Fonte dos dados conferidos<input value={fonte} maxLength={200} onChange={e => setFonte(e.target.value)} placeholder="Ex.: comprovante de inscrição no CNPJ" /></label>
    <label>O que foi conferido e por que a consulta automática não foi usada<textarea rows={3} maxLength={2000} value={evidencia} onChange={e => setEvidencia(e.target.value)} /></label>
    <Button disabled={ocupado || !/^\d{14}$/.test(onboarding.cnpj || "") || fonte.trim().length < 3 || evidencia.trim().length < 20} onClick={() => acao("/jornada/conferencia", { tipo: "PUBLICA", versao: onboarding.versao, manual: { fonte, evidencia } })}>Conferi os documentos: continuar manualmente</Button>
  </section>;
}
