import { Button } from "../../../components/ui/Button";
import { fmtMoney } from "../../../lib/format";

export function CompanyGuidesTable({
  guides,
  loadingGuides,
  onRefresh,
  onResendGuide,
  resendingGuideId,
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Guias</h2>
        <Button variant="secondary" type="button" onClick={onRefresh}>
          Atualizar
        </Button>
      </div>
      {loadingGuides ? (
        <p className="text-muted">Carregando…</p>
      ) : guides.length === 0 ? (
        <p className="text-muted">Nenhuma guia nesta empresa.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Competência</th>
                <th>Valor</th>
                <th>Status</th>
                <th>E-mail</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {guides.map((guide) => {
                const guideId = guide.guideId || guide.id;
                const isLoading = resendingGuideId === guideId;
                return (
                  <tr key={guideId}>
                    <td>{guide.tipo || "—"}</td>
                    <td>{guide.competencia || "—"}</td>
                    <td>{fmtMoney(guide.valor)}</td>
                    <td>{guide.status || "—"}</td>
                    <td>{guide.emailStatus || "—"}</td>
                    <td>
                      <Button
                        size="sm"
                        type="button"
                        disabled={isLoading}
                        onClick={() => onResendGuide(guideId)}
                      >
                        {isLoading ? "…" : "Reenviar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
