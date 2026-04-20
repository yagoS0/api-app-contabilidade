import { AppShell } from "../../../../components/layout/AppShell";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { fmtDate, fmtMoney } from "../../../../lib/format";

export function PendingGuidesPage({
  guides,
  loading,
  selectedIds,
  onToggle,
  onToggleAll,
  onSendSelected,
  sending,
  onRefresh,
  onBack,
  message,
  error,
}) {
  const allSelected = guides.length > 0 && selectedIds.length === guides.length;

  return (
    <AppShell>
      <PageHeader
        title="Pendências de e-mail"
        description="Guias pendentes de envio, por empresa."
        actions={
          <>
            <Button variant="secondary" onClick={onRefresh} disabled={loading}>
              Atualizar
            </Button>
            <Button variant="secondary" onClick={onBack}>
              Voltar
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Lista</h2>
          <div className="toolbar">
            <Button variant="secondary" onClick={onToggleAll} disabled={!guides.length}>
              {allSelected ? "Desmarcar todas" : "Selecionar todas"}
            </Button>
            <Button onClick={onSendSelected} disabled={sending}>
              {sending ? "Enviando…" : "Enviar selecionadas"}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-muted">Carregando…</p>
        ) : guides.length === 0 ? (
          <p className="text-muted">Nenhuma guia pendente.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th-narrow" aria-label="Selecionar" />
                  <th>Empresa</th>
                  <th>CNPJ</th>
                  <th>Tipo</th>
                  <th>Competência</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status e-mail</th>
                  <th>Tentativas</th>
                  <th>Último erro</th>
                </tr>
              </thead>
              <tbody>
                {guides.map((guide) => (
                  <tr key={guide.guideId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(guide.guideId)}
                        onChange={() => onToggle(guide.guideId)}
                        aria-label={`Selecionar ${guide.companyName || guide.guideId}`}
                      />
                    </td>
                    <td>{guide.companyName || "—"}</td>
                    <td>{guide.cnpj || "—"}</td>
                    <td>{guide.tipo || "—"}</td>
                    <td>{guide.competencia || "—"}</td>
                    <td>{fmtMoney(guide.valor)}</td>
                    <td>{fmtDate(guide.vencimento)}</td>
                    <td>{guide.emailStatus || "—"}</td>
                    <td>{Number(guide.emailAttempts || 0)}</td>
                    <td className="td-ellipsis" title={guide.emailLastError || ""}>
                      {guide.emailLastError || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Feedback message={message} error={error} />
    </AppShell>
  );
}
