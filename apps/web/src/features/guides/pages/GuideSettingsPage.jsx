import { AppShell } from "../../../components/layout/AppShell";
import { Button } from "../../../components/ui/Button";

export function GuideSettingsPage({ pdfReaderConfigured, guideScheduleCron, onBack }) {
  return (
    <AppShell>
      <header className="header inline-header">
        <div>
          <h1>Guias</h1>
          <p>
            As guias entram pelo <b>Upload de PDF</b> no portal. O arquivo é processado pelo serviço{" "}
            <code>pdf-reader</code> e o PDF fica armazenado no <b>banco de dados</b> (PostgreSQL).
          </p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>

      <section className="panel">
        <h2>Status</h2>
        <ul className="hint" style={{ lineHeight: 1.6 }}>
          <li>
            Leitor de PDF (API):{" "}
            <b>{pdfReaderConfigured ? "configurado (PDF_READER_URL)" : "ausente na API"}</b>
          </li>
          <li>
            Cron de e-mails agendados (ajuste na lista de empresas):{" "}
            <b>{guideScheduleCron || "desativado"}</b>
          </li>
        </ul>
        <p className="hint">
          Não há mais integração com Google Drive para pastas de guias. O envio por e-mail usa o PDF salvo no
          banco.
        </p>
      </section>
    </AppShell>
  );
}
