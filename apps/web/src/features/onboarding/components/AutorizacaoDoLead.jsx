import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { formatarCnpj } from "../lib/brasilApi";
import { OrientacaoDoPasso } from "./PassosDoLead";

export function AutorizacaoDoLead({ api, recursos, estado, conversaId, ocupado, carregar, acao, trabalho }) {
  const [registrando, setRegistrando] = useState(false), [evidencia, setEvidencia] = useState("");
  const [aceiteConferido, setAceiteConferido] = useState(false), [executando, setExecutando] = useState(false);
  const trava = useRef(false);
  const a = estado.atendimento, verificando = ["PENDENTE", "PROCESSANDO", "AGUARDANDO"].includes(trabalho?.status);
  const pedido = a?.triagem?.preatendimento?.autorizacaoFiscal;
  const contexto = JSON.stringify([a?.id, estado.onboarding?.cnpj, conversaId, pedido?.recursoId, pedido?.recursoVersao, pedido?.institucionalId, pedido?.institucionalVersao]);
  useEffect(() => { setAceiteConferido(false); setRegistrando(false); setEvidencia(""); }, [contexto]);
  const conferido = Boolean(a?.representanteVerificadoEm);
  const habilitado = estado.configuracao?.consultasFiscais !== false;
  const bloqueado = ocupado || executando;
  async function executar(path, body) {
    if (trava.current) return false;
    trava.current = true; setExecutando(true);
    try { return await acao(path, body); } finally { trava.current = false; setExecutando(false); }
  }
  return <div className="lead-authorization">
    {pedido?.estado === 'AGUARDANDO_AUTORIZACAO' && <p role="status">Autorização solicitada ao cliente. Acompanhamento com o contador.</p>}
    {pedido?.estado === 'REVISAO_NECESSARIA' && <p role="alert">Confira a orientação de autorização e os dados institucionais antes de continuar.</p>}
    {pedido?.procuradorCnpj && <p>CNPJ do escritório: <strong>{formatarCnpj(pedido.procuradorCnpj)}</strong></p>}
    {!conferido && <><OrientacaoDoPasso key={`${contexto}:${pedido?.estado}`} api={api} recursos={recursos} chaves={["autorizacao-acesso", "autorizacao"]} onboarding={estado.onboarding} conversaId={conversaId} onEnviado={carregar} disabled={bloqueado} enviado={Boolean(a?.autorizacao?.mensagemId || pedido?.estado === 'AGUARDANDO_AUTORIZACAO')} />
      <p>Se a empresa já tem procuração, avance diretamente para a conferência do representante.</p></>}
    {!registrando ? <Button variant={conferido ? "secondary" : "primary"} disabled={bloqueado} onClick={() => setRegistrando(true)}>{conferido ? "Representante conferido · revisar registro" : "Registrar conferência do representante"}</Button> : <div>
      <label>Como a representação foi conferida<textarea rows={3} maxLength={2000} value={evidencia} onChange={e => setEvidencia(e.target.value)} /></label>
      <Button disabled={bloqueado || evidencia.trim().length < 10} onClick={async () => { if (await executar("/representante", { evidencia })) { setRegistrando(false); setEvidencia(""); } }}>OK: registrar e continuar</Button>
      <Button variant="secondary" disabled={bloqueado} onClick={() => setRegistrando(false)}>Cancelar</Button>
    </div>}
    {conferido && !registrando && <><h4>Aceite no portal da Receita</h4><p>Quando o cliente concluir a autorização, aceite-a no portal da Receita e volte para verificar a procuração.</p>
      <label className="lead-receita-acceptance"><input type="checkbox" checked={aceiteConferido} disabled={bloqueado || verificando} onChange={e => setAceiteConferido(e.target.checked)} /> Aceite conferido no portal da Receita</label>
      {!habilitado && <p role="alert">A consulta fiscal de leads está desativada no sistema. O escritório precisa habilitar a integração para continuar.</p>}
      <Button disabled={bloqueado || verificando || !habilitado || !aceiteConferido} onClick={() => executar("/consultas", { tipo: "PROCURACAO" })}>{verificando ? "Verificando procuração…" : "Verificar procuração e avançar"}</Button>
      {trabalho && <p role="status">{trabalho.resultado?.mensagem || (verificando ? "Aguarde a verificação. Esta tela será atualizada automaticamente." : trabalho.status)}</p>}
      {["BLOQUEADA", "REVOGADA"].includes(a?.autorizacao?.estado) && <OrientacaoDoPasso api={api} recursos={recursos} chaves={["autorizacao-acesso", "autorizacao"]} onboarding={estado.onboarding} conversaId={conversaId} onEnviado={carregar} disabled={ocupado} />}
    </>}
  </div>;
}
