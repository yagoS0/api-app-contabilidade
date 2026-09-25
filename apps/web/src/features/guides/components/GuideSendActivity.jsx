import { Button } from "../../../components/ui/Button";
import "./guide-send-activity.css";

// Montado no shell: navegar entre páginas não esconde um envio já iniciado.
export function GuideSendActivity({ activity, onDismiss }) {
  if (!activity) return null;
  const running = activity.status === "running";
  const title = running ? "Enviando guias" : activity.status === "error" ? "Envio precisa de atenção"
    : activity.status === "pending" ? "Envio com pendências" : "Envio processado";
  return <aside className="guide-send-activity" aria-label="Andamento do envio de guias">
    <div className="guide-send-activity__summary">
      <div role="status" aria-live="polite">
        <strong>{title}</strong><span> · {activity.companyName}</span>
        <span className="guide-send-activity__count">{activity.completed} de {activity.total} processadas</span>
      </div>
      {!running && <Button size="sm" variant="secondary" onClick={onDismiss} aria-label="Fechar resultado do envio">Fechar</Button>}
    </div>
    {running && <>
      <progress aria-label="Progresso do envio" value={activity.completed} max={activity.total} />
      <small>{activity.completed === activity.total ? "Atualizando os status…" : "Você pode continuar usando o sistema. Mantenha esta página aberta até o envio terminar."}</small>
    </>}
    {activity.error && <p role="alert">{activity.error}</p>}
    {activity.refreshError && <p role="alert">{activity.refreshError}</p>}
    {activity.resultados?.length > 0 && <details>
      <summary>Ver resultados{running ? " parciais" : " do envio"}</summary>
      {activity.resultados?.map((item, index) => <p key={`${item.guideId}-${index}`}>
        <strong>{item.rotulo || "Guia"}:</strong> {item.texto}
      </p>)}
    </details>}
  </aside>;
}
