// Somente leitura dos bytes recebidos; não recupera arquivos de storage ou rede.
export async function lerTextoPdfDas(pdfBuffer) {
  if (!pdfBuffer || !pdfBuffer.length) return "";
  const pdfParse = (await import("pdf-parse")).default;
  const pdfData = await pdfParse(pdfBuffer);
  return String(pdfData?.text || "");
}
