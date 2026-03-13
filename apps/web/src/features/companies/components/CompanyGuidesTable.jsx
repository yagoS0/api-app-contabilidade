import { Button } from "../../../components/ui/Button";

function fmtMoney(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

export function CompanyGuidesTable({
  guides,
  loadingGuides,
  onRefresh,
  onResendGuide,
  resendingGuideId,
}) {
  return (
    <section className="panel">
      <div className="inline-header">
        <h2>Guias</h2>
        <Button variant="secondary" onClick={onRefresh}>
          Atualizar
        </Button>
      </div>
      {loadingGuides ? (
        <p>Carregando guias...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Competencia</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Email</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {guides.map((guide) => {
              const guideId = guide.guideId || guide.id;
              const isLoading = resendingGuideId === guideId;
              return (
                <tr key={guideId}>
                  <td>{guide.tipo || "-"}</td>
                  <td>{guide.competencia || "-"}</td>
                  <td>{fmtMoney(guide.valor)}</td>
                  <td>{guide.status || "-"}</td>
                  <td>{guide.emailStatus || "-"}</td>
                  <td>
                        <Button
                          size="sm"
                          disabled={isLoading}
                          onClick={() => onResendGuide(guideId)}
                        >
                      {isLoading ? "Reenviando..." : "Reenviar"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loadingGuides && guides.length === 0 ? <p>Nenhuma guia encontrada.</p> : null}
    </section>
  );
}

