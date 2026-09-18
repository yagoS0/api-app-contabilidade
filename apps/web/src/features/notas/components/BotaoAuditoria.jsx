import { useEffect, useState } from "react";
import { oNavegadorAssumeOClique } from "../../../components/ui/cliqueDeLink";

export function BotaoAuditoria({ api, companyId, competencia, revisao, href, onAbrir }) {
  const [estado, setEstado] = useState({ carregando: true });
  useEffect(() => {
    let cancelado = false;
    setEstado({ carregando: true });
    if (!api?.getAuditoriaNotas || !companyId || !competencia) {
      setEstado({ indisponivel: true });
      return;
    }
    Promise.allSettled([
      api.getAuditoriaNotas(companyId, competencia),
      api.listPendenciasPosFechamento?.(companyId, { onlyOpen: true }),
    ]).then(([auditoria, pendencias]) => {
      if (cancelado) return;
      const a = auditoria.status === "fulfilled" ? auditoria.value?.auditoria : null;
      const p = pendencias.status === "fulfilled" ? pendencias.value : null;
      setEstado({
        quantidade: Number(a?.totalAchados || 0) + Number(a?.foraDaConferencia?.total || 0) + (Array.isArray(p) ? p.length : 0),
        indisponivel: !a || !Array.isArray(p),
      });
    });
    return () => { cancelado = true; };
  }, [api, companyId, competencia, revisao]);
  const texto = estado.carregando ? "Conferindo…" : estado.quantidade > 0
    ? `${estado.quantidade} pendência(s)${estado.indisponivel ? " · conferência parcial" : ""}` : estado.indisponivel ? "Conferência indisponível" : "Sem pendências";
  return <a className="btn btn-secondary btn-md" href={href} onClick={(e) => {
    if (oNavegadorAssumeOClique(e)) return;
    e.preventDefault(); onAbrir?.();
  }} style={{ gap: 8 }}>
    Auditoria <span style={{ fontSize: 12, color: estado.quantidade > 0 ? "var(--state-warn)" : "var(--text-muted)" }}>{texto}</span>
  </a>;
}
