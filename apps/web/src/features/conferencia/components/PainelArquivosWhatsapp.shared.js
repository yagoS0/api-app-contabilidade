
export function arquivoDoConteudo(r) {
  if (!r?.nomeArquivo || typeof r.base64 !== "string" || !r.base64) throw new Error("O servidor não devolveu o conteúdo do arquivo.");
  const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
  return new File([bytes], r.nomeArquivo, { type: ["application/pdf", "image/png", "image/jpeg"].includes(r.mimeType) ? r.mimeType : "text/plain" });
}
