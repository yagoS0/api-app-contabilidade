import { useMemo, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageHeader } from "../../../../components/layout/PageHeader";
import { Feedback } from "../../../../components/ui/Feedback";
import { Button } from "../../../../components/ui/Button";
import { fmtDate, fmtMoney } from "../../../../lib/format";

function buildSummary(results) {
  if (!Array.isArray(results) || !results.length) return "Nenhum upload nesta sessão.";
  const processed = results.filter((item) => item.status === "PROCESSED").length;
  const errors = results.filter((item) => item.status === "ERROR").length;
  const skipped = results.filter((item) => item.status === "SKIPPED").length;
  return `${processed} processadas, ${errors} com erro, ${skipped} ignoradas.`;
}

export function GuideUploadPage({
  onBack,
  onUpload,
  uploading,
  uploadResults,
  unidentifiedGuides,
  loadingUnidentifiedGuides,
  onRefreshUnidentified,
  message,
  error,
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);

  const selectedLabel = useMemo(() => {
    if (!selectedFiles.length) return "Nenhum arquivo selecionado.";
    if (selectedFiles.length === 1) return selectedFiles[0].name;
    return `${selectedFiles.length} arquivos`;
  }, [selectedFiles]);

  function handleFileChange(event) {
    setSelectedFiles(Array.from(event.target.files || []));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedFiles.length) return;
    const uploaded = await onUpload(selectedFiles);
    if (uploaded) {
      setSelectedFiles([]);
      event.currentTarget.reset();
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Guias — upload"
        description="Envie PDFs para processamento automático e acompanhe pendências de identificação."
        actions={
          <Button variant="secondary" onClick={onBack}>
            Voltar
          </Button>
        }
      />

      <section className="panel">
        <h2 className="panel__title">Enviar arquivos</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="full">
            PDFs (um ou mais)
            <input type="file" accept="application/pdf,.pdf" multiple onChange={handleFileChange} />
          </label>
          <p className="hint">{selectedLabel}</p>
          <div className="form-actions">
            <Button type="submit" disabled={uploading || !selectedFiles.length}>
              {uploading ? "Processando…" : "Enviar e processar"}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title">Último envio</h2>
        <p className="hint">{buildSummary(uploadResults)}</p>
        {uploadResults.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Status</th>
                  <th>Mensagem</th>
                  <th>CNPJ</th>
                  <th>Competência</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>E-mail</th>
                </tr>
              </thead>
              <tbody>
                {uploadResults.map((item, index) => (
                  <tr key={`${item.guideId || item.fileName}-${index}`}>
                    <td>{item.fileName || "—"}</td>
                    <td>{item.status || "—"}</td>
                    <td>{item.message || "—"}</td>
                    <td>{item.extracted?.cnpj || "—"}</td>
                    <td>{item.extracted?.competencia || "—"}</td>
                    <td>{item.extracted?.tipo || "—"}</td>
                    <td>{fmtMoney(item.extracted?.valor)}</td>
                    <td>{item.email?.message || item.email?.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">Nenhum resultado ainda.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Pendências de identificação</h2>
          <Button variant="secondary" type="button" onClick={onRefreshUnidentified} disabled={loadingUnidentifiedGuides}>
            {loadingUnidentifiedGuides ? "Atualizando…" : "Atualizar"}
          </Button>
        </div>
        {loadingUnidentifiedGuides ? (
          <p className="text-muted">Carregando…</p>
        ) : unidentifiedGuides.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Mensagem</th>
                  <th>CNPJ</th>
                  <th>Competência</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {unidentifiedGuides.map((item) => (
                  <tr key={item.guideId}>
                    <td>{item.fileName || "—"}</td>
                    <td>{item.message || "—"}</td>
                    <td>{item.cnpj || "—"}</td>
                    <td>{item.competencia || "—"}</td>
                    <td>{item.tipo || "—"}</td>
                    <td>{fmtMoney(item.valor)}</td>
                    <td>{fmtDate(item.vencimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">Nenhuma pendência de identificação.</p>
        )}
      </section>

      <Feedback message={message} error={error} />
    </AppShell>
  );
}
