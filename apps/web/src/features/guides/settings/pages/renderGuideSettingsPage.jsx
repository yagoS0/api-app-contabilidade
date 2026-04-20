import { AppShell } from "../../../../components/layout/AppShell";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Button } from "../../../../components/ui/Button";

export function GuideSettingsPage({ pdfReaderConfigured, onBack }) {
  return (
    <AppShell>
      <PageHeader
        title="Guias — configuração"
        description="Upload no portal, extração via pdf-reader e armazenamento no PostgreSQL."
        actions={
          <Button variant="secondary" onClick={onBack}>
            Voltar
          </Button>
        }
      />

      <section className="panel">
        <h2 className="panel__title">Status</h2>
        <ul className="settings-list text-muted">
          <li>
            Leitor de PDF na API (<code className="code-inline">PDF_READER_URL</code>):{" "}
            <strong className="text-strong">{pdfReaderConfigured ? "OK" : "Ausente"}</strong>
          </li>
        </ul>
        <p className="hint">
          Não há integração com Google Drive para pastas de guias. O e-mail usa o PDF salvo no banco.
        </p>
      </section>
    </AppShell>
  );
}
