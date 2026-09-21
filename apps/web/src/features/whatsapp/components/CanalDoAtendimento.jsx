import { Button } from "../../../components/ui/Button";
import { canaisDaConversa, canalComercialDaConversa } from "../lib/identidadeAtendimento";

export function CanalDoAtendimento({ conversa, canalId, onSelecionar, disabled = false }) {
  const lead = conversa.relacionamento?.tipo === "LEAD";
  const canais = canaisDaConversa(conversa), canal = lead ? canalComercialDaConversa(conversa) : canais.find(c => c.id === canalId);
  const aberto = canal?.janela?.situacao === "ABERTA" && canal.podeResponder !== false;
  const alternativas = canais.filter(c => c.id !== canalId && c.podeResponder !== false && c.janela?.situacao === "ABERTA");
  const nome = c => c?.nome || c?.chave || "Principal";
  return <section className="lead-send-channel" aria-label="Canal de envio do atendimento">
    {!lead && canais.length > 1 && onSelecionar ? <label>Enviar pelo WhatsApp<select aria-label="Canal do atendimento" value={canalId || ""} disabled={disabled} onChange={e => onSelecionar(e.target.value)}>
      {!canal && <option value="">Selecione o canal</option>}{canais.map(c => <option key={c.id} value={c.id}>{nome(c)}</option>)}
    </select></label> : <strong>WhatsApp · {lead ? "Comercial" : nome(canal)}</strong>}
    <p role="status">{aberto ? "Disponível para enviar mensagens e documentos." : !canal && lead ? "Este contato ainda não tem uma conversa pelo número comercial. Prepare os documentos ou registre a apresentação por outro meio enquanto isso." : canal?.janela?.situacao === "ABERTA" ? "Este canal está indisponível. Confira a configuração antes de enviar." : `Sem janela de resposta no ${lead ? "Comercial" : nome(canal)}. Uma mensagem enviada a outro número do escritório não abre este canal.`}</p>
    {!aberto && !lead && alternativas.map(c => <Button key={c.id} variant="secondary" disabled={disabled} onClick={() => onSelecionar?.(c.id)}>Usar {nome(c)} — conversa aberta</Button>)}
    {!aberto && <p>Você pode preparar os documentos e registrar a apresentação por outro meio. O envio livre pelo WhatsApp depende de uma mensagem recente neste mesmo número.</p>}
  </section>;
}
