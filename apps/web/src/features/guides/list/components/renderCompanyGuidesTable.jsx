import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../../../lib/format";

function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function formatGuideStatus(status) {
  const normalized = normalizeValue(status);
  if (normalized === "PROCESSED") {
    return { label: "Processada", tone: "success" };
  }
  if (normalized === "ERROR") {
    return { label: "Aguardando envio", tone: "warning" };
  }
  if (normalized === "PENDING") {
    return { label: "Pendente", tone: "muted" };
  }
  return { label: status || "-", tone: "default" };
}

function formatEmailStatus(status) {
  const normalized = normalizeValue(status);
  if (normalized === "PENDING") {
    return { label: "Pendente", tone: "accent" };
  }
  if (normalized === "SENT") {
    return { label: "Enviado", tone: "success" };
  }
  if (normalized === "ERROR") {
    return { label: "Erro", tone: "danger" };
  }
  return { label: status || "-", tone: "default" };
}

export function CompanyGuidesTable({
  guides,
  loadingGuides,
  onResendGuide,
  resendingGuideId,
}) {
  const [competencia, setCompetencia] = useState("all");
  const [tipo, setTipo] = useState("all");

  const competenciaOptions = useMemo(
    () => [...new Set(guides.map((guide) => guide.competencia).filter(Boolean))],
    [guides]
  );

  const tipoOptions = useMemo(
    () => [...new Set(guides.map((guide) => guide.tipo).filter(Boolean))],
    [guides]
  );

  const filteredGuides = useMemo(() => {
    return guides.filter((guide) => {
      if (competencia !== "all" && guide.competencia !== competencia) return false;
      if (tipo !== "all" && guide.tipo !== tipo) return false;
      return true;
    });
  }, [competencia, guides, tipo]);

  return (
    <section className="guides-page">
      <div className="guides-filters" aria-label="Filtros das guias">
        <strong className="guides-filters__title">Filtrar guias por:</strong>
        <label className="guides-filter-field">
          <span>Competência</span>
          <select value={competencia} onChange={(event) => setCompetencia(event.target.value)}>
            <option value="all">Todas</option>
            {competenciaOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="guides-filter-field">
          <span>Tipo</span>
          <select value={tipo} onChange={(event) => setTipo(event.target.value)}>
            <option value="all">Todos</option>
            {tipoOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="guides-list-panel">
        <h2 className="guides-list-panel__title">Guias</h2>

      {loadingGuides ? (
        <p className="text-muted">Carregando...</p>
      ) : filteredGuides.length === 0 ? (
        <p className="text-muted">Nenhuma guia encontrada para os filtros atuais.</p>
      ) : (
        <div className="guides-grid" role="table" aria-label="Lista de guias">
          <div className="guides-grid__head" role="rowgroup">
            <div className="guides-grid__row guides-grid__row--head" role="row">
              <span className="guides-grid__cell guides-grid__cell--type" role="columnheader">Tipo</span>
              <span className="guides-grid__cell guides-grid__cell--competencia" role="columnheader">Competência</span>
              <span className="guides-grid__cell guides-grid__cell--valor" role="columnheader">Valor</span>
              <span className="guides-grid__cell guides-grid__cell--status" role="columnheader">Status</span>
              <span className="guides-grid__cell guides-grid__cell--email" role="columnheader">E-mail</span>
              <span className="guides-grid__cell guides-grid__cell--actions" role="columnheader">Ações</span>
            </div>
          </div>

          <div className="guides-grid__body" role="rowgroup">
            {filteredGuides.map((guide) => {
              const guideId = guide.guideId || guide.id;
              const isLoading = resendingGuideId === guideId;
              const status = formatGuideStatus(guide.status);
              const emailStatus = formatEmailStatus(guide.emailStatus);

              return (
                <div key={guideId} className="guides-grid__row" role="row">
                  <span className="guides-grid__cell guides-grid__cell--type" role="cell">{guide.tipo || "-"}</span>
                  <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{guide.competencia || "-"}</span>
                  <span className="guides-grid__cell guides-grid__cell--valor guides-grid__money" role="cell">
                    {fmtMoney(guide.valor)}
                  </span>
                  <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${status.tone}`} role="cell">
                    {status.label}
                  </span>
                  <span className={`guides-grid__cell guides-grid__cell--email guides-grid__tone guides-grid__tone--${emailStatus.tone}`} role="cell">
                    {emailStatus.label}
                  </span>
                  <span className="guides-grid__cell guides-grid__cell--actions" role="cell">
                    <div className="guides-grid__actions-group">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className="guides-grid__action"
                        disabled={isLoading}
                        onClick={() => onResendGuide(guideId)}
                      >
                        {isLoading ? "..." : "Reenviar"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        className="guides-grid__action"
                        disabled
                      >
                        Download
                      </Button>
                    </div>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
