export function mensagemCapturaAdn(value) {
  const texto = String(value || "Falha na consulta de NFS-e.").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (/bad record mac|decryption failed|ssl3_get_record|SSL routines/i.test(texto)) {
    return "A conexão segura com o ADN foi interrompida. A busca de NFS-e não terminou; confira as notas já recebidas antes de iniciar uma nova busca.";
  }
  return texto;
}
export function avisoCapturaParcial(result) {
  if (!result?.warning && !result?.partial) return null;
  return `Busca de NFS-e incompleta: ${Number(result.totalDocs) || 0} documento(s) recebido(s). ${mensagemCapturaAdn(result.warning || result.message)}`;
}
