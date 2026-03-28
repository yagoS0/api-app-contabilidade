import { useMemo, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { Feedback } from "../../../components/ui/Feedback";
import { Button } from "../../../components/ui/Button";

function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

function fmtDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("pt-BR");
}

function buildSummary(results) {
  if (!Array.isArray(results) || !results.length) return "Nenhum upload realizado ainda.";
  const processed = results.filter((item) => item.status === "PROCESSED").length;
  const errors = results.filter((item) => item.status === "ERROR").length;
  const skipped = results.filter((item) => item.status === "SKIPPED").length;
  return `${processed} processadas, ${errors} com erro e ${skipped} ignoradas.`;
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
    return `${selectedFiles.length} arquivos selecionados`;
  }, [selectedFiles]);

  function handleFileChange(event) {
    const files = Array.from(event.target.files || []);
    setSelectedFiles(files);
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
      <header className="header inline-header">
        <div>
          <h1>Upload de guias</h1>
          <p>Envie vários PDFs, processe automaticamente e acompanhe as pendências de identificação.</p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>

      <section className="panel">
        <div className="inline-header">
          <h2>Enviar arquivos</h2>
        </div>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="full">
            Selecione uma ou mais guias em PDF
            <input type="file" accept="application/pdf,.pdf" multiple onChange={handleFileChange} />
          </label>
          <p className="hint">{selectedLabel}</p>
          <div className="form-actions">
            <Button type="submit" disabled={uploading || !selectedFiles.length}>
              {uploading ? "Processando upload..." : "Enviar e processar guias"}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>Resultado do último envio</h2>
        </div>
        <p className="hint">{buildSummary(uploadResults)}</p>
        {uploadResults.length ? (
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
                  <td>{item.fileName || "-"}</td>
                  <td>{item.status || "-"}</td>
                  <td>{item.message || "-"}</td>
                  <td>{item.extracted?.cnpj || "-"}</td>
                  <td>{item.extracted?.competencia || "-"}</td>
                  <td>{item.extracted?.tipo || "-"}</td>
                  <td>{fmtMoney(item.extracted?.valor)}</td>
                  <td>{item.email?.message || item.email?.status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Nenhum resultado disponível ainda.</p>
        )}
      </section>

      <section className="panel">
        <div className="inline-header">
          <h2>Caixa de pendências</h2>
          <Button variant="secondary" onClick={onRefreshUnidentified} disabled={loadingUnidentifiedGuides}>
            {loadingUnidentifiedGuides ? "Atualizando..." : "Atualizar pendências"}
          </Button>
        </div>
        {loadingUnidentifiedGuides ? (
          <p>Carregando pendências...</p>
        ) : unidentifiedGuides.length ? (
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
                  <td>{item.fileName || "-"}</td>
                  <td>{item.message || "-"}</td>
                  <td>{item.cnpj || "-"}</td>
                  <td>{item.competencia || "-"}</td>
                  <td>{item.tipo || "-"}</td>
                  <td>{fmtMoney(item.valor)}</td>
                  <td>{fmtDate(item.vencimento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Nenhuma guia pendente de identificação.</p>
        )}
      </section>

      <Feedback message={message} error={error} />
    </AppShell>
  );
}
