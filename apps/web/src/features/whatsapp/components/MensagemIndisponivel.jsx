import { Button } from "../../../components/ui/Button";

export function MensagemIndisponivel({ onPreparar }) {
  return <div className="wa-unavailable-message" role="note" aria-label="Conteúdo indisponível">
    <strong>Mensagem indisponível</strong>
    <p>O WhatsApp não disponibilizou o conteúdo desta mensagem.</p>
    {onPreparar && <Button variant="secondary" size="sm" onClick={onPreparar}>Preparar pedido de reenvio</Button>}
  </div>;
}
