import { useEffect, useState } from "react";
import { oNavegadorAssumeOClique } from "../../../components/ui/cliqueDeLink";

export function BotaoAuditoria({ api, companyId, competencia, revisao, href, onAbrir, card = false }) {
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
        quantidade: Number.isFinite(a?.totalAchados) ? a.totalAchados : null,
        fora: Number.isFinite(a?.foraDaConferencia?.total) ? a.foraDaConferencia.total : null,
        posteriores: Array.isArray(p) ? p.length : null,
        indisponivel: !a || !Number.isFinite(a.totalAchados) || !Array.isArray(p),
      });
    });
    return () => { cancelado = true; };
  }, [api, companyId, competencia, revisao]);
  const texto = estado.carregando ? "Conferindo…" : estado.quantidade > 0
    ? `${estado.quantidade} achado(s) na competência${estado.indisponivel ? " · conferência parcial" : ""}` : estado.indisponivel ? "Conferência indisponível" : "Sem achados na competência";
  const detalhe = estado.carregando ? undefined : (estado.fora == null ? 'Fora da conferência: indisponível' : estado.fora + ' fora da conferência') + ' · ' + (estado.posteriores ?? '—') + ' pendências pós-fechamento em todas as competências. Conjuntos podem se sobrepor.';
  return <a aria-description={card ? detalhe : undefined} className={card ? "notas-indicador notas-auditoria" : "btn btn-secondary btn-md"} href={href} onClick={(e) => {
    if (oNavegadorAssumeOClique(e)) return;
    if (onAbrir) { e.preventDefault(); onAbrir(); }
  }} style={{ gap: 8 }}>
    Auditoria {card && <strong>{estado.carregando ? "…" : estado.quantidade == null ? "—" : estado.quantidade}</strong>}<span style={{ fontSize: 12, color: estado.quantidade > 0 ? "var(--state-warn)" : "var(--text-muted)" }}>{card ? (estado.carregando ? "Carregando…" : estado.indisponivel ? (estado.quantidade == null ? "Conferência indisponível" : "Conferência parcial") : "Achados na competência") : texto}</span>
    {!card && !estado.carregando && <small>{estado.fora == null ? 'Fora da conferência: indisponível' : `${estado.fora} fora da conferência`} · {estado.posteriores ?? '—'} pendências pós-fechamento em todas as competências. Conjuntos podem se sobrepor.</small>}
  </a>;
}
