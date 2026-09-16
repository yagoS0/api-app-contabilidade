import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { OrientacaoDoPasso } from "./PassosDoLead";

export function AutorizacaoDoLead({ api, recursos, estado, conversaId, ocupado, carregar, acao, trabalho }) {
  const [registrando, setRegistrando] = useState(false), [evidencia, setEvidencia] = useState("");
  const a = estado.atendimento, verificando = ["PENDENTE", "PROCESSANDO", "AGUARDANDO"].includes(trabalho?.status);
  const conferido = Boolean(a?.representanteVerificadoEm);
  const habilitado = estado.configuracao?.consultasFiscais !== false;
  return <div className="lead-authorization">
    {!conferido && <><OrientacaoDoPasso api={api} recursos={recursos} chaves={["autorizacao-acesso", "autorizacao"]} onboarding={estado.onboarding} conversaId={conversaId} onEnviado={carregar} disabled={ocupado} enviado={Boolean(a?.autorizacao?.mensagemId)} />
      <p>Se a empresa já tem procuração, avance diretamente para a conferência do representante.</p></>}
    {!registrando ? <Button variant={conferido ? "secondary" : "primary"} disabled={ocupado} onClick={() => setRegistrando(true)}>{conferido ? "Representante conferido · revisar registro" : "Registrar conferência do representante"}</Button> : <div>
      <label>Como a representação foi conferida<textarea rows={3} maxLength={2000} value={evidencia} onChange={e => setEvidencia(e.target.value)} /></label>
      <Button disabled={ocupado || evidencia.trim().length < 10} onClick={async () => { if (await acao("/representante", { evidencia })) { setRegistrando(false); setEvidencia(""); } }}>OK: registrar e continuar</Button>
      <Button variant="secondary" disabled={ocupado} onClick={() => setRegistrando(false)}>Cancelar</Button>
    </div>}
    {conferido && !registrando && <><p>Ao confirmar uma procuração válida, avançaremos para a consulta da situação fiscal.</p>
      {!habilitado && <p role="alert">A consulta fiscal de leads está desativada no sistema. O escritório precisa habilitar a integração para continuar.</p>}
      <Button disabled={ocupado || verificando || !habilitado} onClick={() => acao("/consultas", { tipo: "PROCURACAO" })}>{verificando ? "Verificando procuração…" : "Verificar procuração e avançar"}</Button>
      {trabalho && <p role="status">{trabalho.resultado?.mensagem || (verificando ? "Aguarde a verificação. Esta tela será atualizada automaticamente." : trabalho.status)}</p>}
      {["BLOQUEADA", "REVOGADA"].includes(a?.autorizacao?.estado) && <OrientacaoDoPasso api={api} recursos={recursos} chaves={["autorizacao-acesso", "autorizacao"]} onboarding={estado.onboarding} conversaId={conversaId} onEnviado={carregar} disabled={ocupado} />}
    </>}
  </div>;
}
